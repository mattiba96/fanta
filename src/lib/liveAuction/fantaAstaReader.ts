/**
 * Lettura dello stato live di FantaAsta Desktop (app Electron separata,
 * NON Fantacucciolo) via Chrome DevTools Protocol. L'app tiene tutto lo
 * stato dell'asta in una singola chiave di localStorage; per leggerla va
 * lanciata con `--remote-debugging-port` e va aperta una connessione
 * WebSocket al target esposto da `http://localhost:<port>/json`.
 *
 * Formato non documentato di terze parti: i tipi sotto sono permissivi
 * (index signature) dove non siamo certi che il campo sia sempre presente
 * o che non ne esistano altri non ancora osservati.
 */

const DEFAULT_PORT = 9222;
const LOCALSTORAGE_KEY = "fanta-asta-desktop";
const DISCOVERY_TIMEOUT_MS = 3_000;
const OVERALL_TIMEOUT_MS = 5_000;

const APP_NOT_OPEN_MESSAGE =
  'FantaAsta Desktop non risulta aperta con il debug remoto attivo. Aprila con il pulsante qui sotto, oppure manualmente con: open -a "FantaAsta Desktop" --args --remote-debugging-port=9222';

/**
 * Errore specifico per problemi di comunicazione con FantaAsta Desktop (app
 * non aperta, CDP irraggiungibile, dati non validi). Serve a distinguere,
 * lato chiamante, questi problemi da altri errori (es. query al DB di
 * Fantacucciolo) che non hanno nulla a che fare con l'app desktop.
 */
export class FantaAstaConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FantaAstaConnectionError";
  }
}

/**
 * FantaAsta Desktop gira sul Mac dell'utente: "localhost" ha senso solo
 * quando anche Fantacucciolo gira in locale sulla stessa macchina. Su
 * Vercel il server è una macchina remota che non potrà MAI raggiungere
 * quella porta — non è un problema temporaneo/riprovabile, va segnalato
 * in modo distinto per non far credere che riaprire l'app risolva.
 */
export class FantaAstaUnsupportedEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FantaAstaUnsupportedEnvironmentError";
  }
}

export function isLocalEnvironment(): boolean {
  return !process.env.VERCEL;
}

const UNSUPPORTED_ENVIRONMENT_MESSAGE =
  "L'asta live legge FantaAsta Desktop sul tuo Mac: funziona solo aprendo Fantacucciolo in locale (npm run dev) sullo stesso computer, non dal sito online, perché un server remoto non può raggiungere un'app sul tuo computer.";

export type FantaAstaZone = "gk" | "def" | "mid" | "atk" | (string & {});

export interface FantaAstaRosterComposition {
  gk: number;
  def: number;
  mid: number;
  atk: number;
  min: number;
  max: number;
  [key: string]: unknown;
}

export interface FantaAstaSettings {
  gameType: number;
  auctionType: number;
  startingBudget: number;
  rosterComposition: FantaAstaRosterComposition;
  [key: string]: unknown;
}

export interface FantaAstaPlayer {
  index: number;
  id: number;
  name: string;
  fullName?: string;
  zone: FantaAstaZone;
  roles?: string[];
  prices?: number[];
  price?: number;
  marketValues?: number[];
  team?: string;
  foot?: string;
  birthplace?: string;
  birthday?: string;
  image?: string;
  sold: boolean;
  customIndex?: number;
  [key: string]: unknown;
}

export interface FantaAstaRosterHash {
  gk: number;
  def: number;
  mid: number;
  atk: number;
  [key: string]: unknown;
}

export interface FantaAstaTeamSnapshot {
  index: number;
  name: string;
  budget: number;
  players: unknown[];
  avatar?: string;
  credits?: number;
  rosterHash: FantaAstaRosterHash;
  playersToBuy?: number;
  maxOffer?: number;
  [key: string]: unknown;
}

export interface FantaAstaTransaction {
  player: FantaAstaPlayer;
  team: FantaAstaTeamSnapshot;
  cost: number;
  id: number;
  index: number;
  [key: string]: unknown;
}

export interface FantaAstaSelector {
  sortType?: string;
  zoneFilter?: string;
  soldFilter?: boolean;
  randomSeed?: number;
  cursor?: number;
  garbage?: unknown[];
  [key: string]: unknown;
}

export interface FantaAstaData {
  settings: FantaAstaSettings;
  players: FantaAstaPlayer[];
  randomSeed?: number;
  selector?: FantaAstaSelector;
  downloadPlayersDate?: number;
  transactions: FantaAstaTransaction[];
  [key: string]: unknown;
}

export interface FantaAstaState {
  version: string;
  data: FantaAstaData;
  [key: string]: unknown;
}

export const ZONE_TO_ROLE_CLASSIC: Record<string, "P" | "D" | "C" | "A"> = {
  gk: "P",
  def: "D",
  mid: "C",
  atk: "A",
};

interface CdpTarget {
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
  [key: string]: unknown;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeoutMessage: string,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Avvisa il chiamante (che chiude la risorsa perdente, es. il socket
      // CDP aperto) PRIMA di far vincere il timeout alla race.
      onTimeout?.();
      reject(new FantaAstaConnectionError(onTimeoutMessage));
    }, ms);
  });
  // La promise originale può comunque rigettare più tardi (dopo che la race
  // è già stata decisa dal timeout): senza questo .catch quel rigetto
  // risulterebbe "unhandled" perché nessun altro lo osserva.
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

async function findFantaAstaTarget(port: number): Promise<CdpTarget> {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);

  let targets: CdpTarget[];
  try {
    const res = await fetch(`http://localhost:${port}/json`, { signal: controller.signal });
    if (!res.ok) {
      throw new FantaAstaConnectionError(APP_NOT_OPEN_MESSAGE);
    }
    targets = (await res.json()) as CdpTarget[];
  } catch (err) {
    if (err instanceof FantaAstaConnectionError) throw err;
    throw new FantaAstaConnectionError(APP_NOT_OPEN_MESSAGE);
  } finally {
    clearTimeout(abortTimer);
  }

  const target = targets.find(
    (t) =>
      t.title === "FantaAsta Desktop" ||
      (typeof t.url === "string" && t.url.includes("roster-manager")),
  );

  if (!target || !target.webSocketDebuggerUrl) {
    throw new FantaAstaConnectionError(APP_NOT_OPEN_MESSAGE);
  }

  return target;
}

async function evaluateLocalStorage(
  webSocketDebuggerUrl: string,
  registerCancel: (cancel: () => void) => void,
): Promise<string | null> {
  return new Promise<string | null>((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    const requestId = 1;
    let settled = false;

    const cleanup = () => {
      try {
        ws.close();
      } catch {
        // connessione già chiusa: nessuna azione necessaria
      }
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    // Permette al chiamante (readFantaAstaState, allo scadere del timeout
    // complessivo) di chiudere subito questo socket invece di lasciarlo
    // aperto in attesa di una risposta che magari non arriverà mai in tempo.
    registerCancel(() =>
      finish(() =>
        reject(
          new FantaAstaConnectionError(
            "Tempo scaduto durante la lettura dei dati da FantaAsta Desktop. Riprova.",
          ),
        ),
      ),
    );

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          id: requestId,
          method: "Runtime.evaluate",
          params: {
            expression: `localStorage.getItem("${LOCALSTORAGE_KEY}")`,
            returnByValue: true,
          },
        }),
      );
    });

    ws.addEventListener("message", (event) => {
      let message: {
        id?: number;
        result?: {
          result?: { value?: unknown };
          exceptionDetails?: { text?: string; exception?: { description?: string } };
        };
        error?: { message?: string };
      };
      try {
        message = JSON.parse(event.data.toString());
      } catch {
        return;
      }

      if (message.id !== requestId) {
        // evento CDP senza id corrispondente (o non nostro): lo ignoriamo
        return;
      }

      if (message.error) {
        finish(() =>
          reject(
            new FantaAstaConnectionError(
              `Errore comunicando con FantaAsta Desktop: ${message.error?.message ?? "errore sconosciuto"}`,
            ),
          ),
        );
        return;
      }

      // Runtime.evaluate segnala un'eccezione durante l'esecuzione tramite
      // exceptionDetails, non tramite il campo "error" di livello superiore
      // (riservato agli errori di protocollo CDP): va controllato a parte,
      // altrimenti un errore reale verrebbe scambiato per "nessuna asta".
      const exceptionDetails = message.result?.exceptionDetails;
      if (exceptionDetails) {
        finish(() =>
          reject(
            new FantaAstaConnectionError(
              `Errore eseguendo la lettura in FantaAsta Desktop: ${
                exceptionDetails.exception?.description ?? exceptionDetails.text ?? "eccezione sconosciuta"
              }`,
            ),
          ),
        );
        return;
      }

      const value = message.result?.result?.value;
      finish(() => resolve(typeof value === "string" ? value : null));
    });

    ws.addEventListener("error", () => {
      finish(() =>
        reject(
          new FantaAstaConnectionError(
            "Connessione a FantaAsta Desktop interrotta durante la lettura dei dati.",
          ),
        ),
      );
    });

    ws.addEventListener("close", () => {
      finish(() =>
        reject(
          new FantaAstaConnectionError(
            "Connessione a FantaAsta Desktop chiusa prima di ricevere i dati.",
          ),
        ),
      );
    });
  });
}

async function readFantaAstaStateInner(
  port: number,
  registerCancel: (cancel: () => void) => void,
): Promise<FantaAstaState> {
  const target = await findFantaAstaTarget(port);
  const raw = await evaluateLocalStorage(target.webSocketDebuggerUrl!, registerCancel);

  if (!raw) {
    throw new FantaAstaConnectionError("Nessuna asta trovata: apri o crea una lega in FantaAsta Desktop.");
  }

  let parsed: FantaAstaState;
  try {
    parsed = JSON.parse(raw) as FantaAstaState;
  } catch {
    throw new FantaAstaConnectionError(
      "Dati dell'asta non leggibili: il formato restituito da FantaAsta Desktop non è JSON valido.",
    );
  }

  if (!parsed || typeof parsed !== "object" || !parsed.data) {
    throw new FantaAstaConnectionError(
      "Dati dell'asta non riconosciuti: la struttura restituita da FantaAsta Desktop non è quella attesa.",
    );
  }

  return parsed;
}

export async function readFantaAstaState(opts?: { port?: number }): Promise<FantaAstaState> {
  if (!isLocalEnvironment()) {
    throw new FantaAstaUnsupportedEnvironmentError(UNSUPPORTED_ENVIRONMENT_MESSAGE);
  }

  const envPort = Number(process.env.FANTAASTA_DEBUG_PORT);
  const port = opts?.port ?? (Number.isFinite(envPort) && envPort > 0 ? envPort : DEFAULT_PORT);

  // cancel viene popolato non appena il socket CDP è aperto (dentro
  // evaluateLocalStorage): se scade il timeout complessivo prima che questo
  // avvenga, non c'è nulla da chiudere (findFantaAstaTarget ha già il suo
  // AbortController separato).
  let cancel: (() => void) | null = null;
  const registerCancel = (fn: () => void) => {
    cancel = fn;
  };

  return withTimeout(
    readFantaAstaStateInner(port, registerCancel),
    OVERALL_TIMEOUT_MS,
    "Tempo scaduto durante la lettura dei dati da FantaAsta Desktop. Riprova.",
    () => cancel?.(),
  );
}

export function deriveTeams(state: FantaAstaState): FantaAstaTeamSnapshot[] {
  const byIndex = new Map<number, FantaAstaTeamSnapshot>();

  for (const transaction of state.data.transactions ?? []) {
    byIndex.set(transaction.team.index, transaction.team);
  }

  return Array.from(byIndex.values());
}
