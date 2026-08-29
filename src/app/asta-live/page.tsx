"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { launchFantaAstaDesktop } from "@/actions/liveAuction";
import type { Role } from "@/lib/advice/engine";
import type {
  CompetingTeamsInfo,
  LiveAdvice,
  LiveAuctionSnapshot,
  MarketTrendInfo,
  RecentTransactionInfo,
  RoleBudgetInfo,
  Verdict,
} from "@/lib/liveAuction/recommend";
import type { FantaAstaTeamSnapshot } from "@/lib/liveAuction/fantaAstaReader";
import type { PlayerSpotlight } from "@/lib/liveAuction/spotlight";
import { bandLabel } from "@/lib/advice/engine";

const POLL_INTERVAL_MS = 4000;
const STORAGE_KEY = "fantacucciolo:myTeamName";
const DEFAULT_TEAM_NAME = "Io";

const ROLE_ORDER: Role[] = ["P", "D", "C", "A"];
const ROLE_LABELS: Record<Role, string> = {
  P: "Portieri",
  D: "Difensori",
  C: "Centrocampisti",
  A: "Attaccanti",
};
const ROLE_ICONS: Record<Role, string> = {
  P: "🧤",
  D: "🛡️",
  C: "🎯",
  A: "⚽",
};
const BAND_LABELS: Record<string, string> = {
  top: "Top",
  "semi-top": "Semi-top",
  centrale: "Centrale",
  scommessa: "Scommessa",
};

// Commenti automatici post-acquisto (feature 5): mostrate solo le ultime N,
// si resettano al refresh della pagina (nessuna persistenza voluta).
const MAX_PURCHASE_NOTIFICATIONS = 5;
// "vicino o sotto il consigliato" / "supera parecchio il consigliato": margini
// arbitrari ma coerenti con quelli già usati altrove nel file (es. verdetto).
const GOOD_DEAL_MARGIN = 1.1;
const OVERPAID_MARGIN = 1.5;

type PurchaseNotificationKind = "buon-colpo" | "pagato-troppo" | "occasione-persa" | "neutro";

type PurchaseNotification = {
  id: number;
  isMine: boolean;
  kind: PurchaseNotificationKind;
  message: string;
};

const NOTIFICATION_STYLES: Record<PurchaseNotificationKind, string> = {
  "buon-colpo":
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300",
  "pagato-troppo": "border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300",
  "occasione-persa":
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300",
  neutro: "border-zinc-200 bg-white text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
};
const NOTIFICATION_ICONS: Record<PurchaseNotificationKind, string> = {
  "buon-colpo": "👍",
  "pagato-troppo": "💸",
  "occasione-persa": "😬",
  neutro: "🛒",
};

// Stesso criterio di normalizzazione usato lato server (buildLiveAuctionSnapshot)
// per far corrispondere il nome squadra dell'utente a quello registrato in FantaAsta.
function isMyTeam(teamName: string, myTeamName: string): boolean {
  return teamName.trim().toLowerCase() === myTeamName.trim().toLowerCase();
}

function buildPurchaseNotification(tx: RecentTransactionInfo, myTeamName: string): PurchaseNotification {
  const isMine = isMyTeam(tx.teamName, myTeamName);
  const roleLabel = tx.role ? ROLE_LABELS[tx.role].toLowerCase() : "questo ruolo";

  if (!isMine && tx.wasTopPick) {
    return {
      id: tx.id,
      isMine,
      kind: "occasione-persa",
      message: `Occasione persa: ${tx.playerName} (era il migliore libero per ${roleLabel}) preso da ${tx.teamName}.`,
    };
  }
  if (tx.suggestedPrice != null && tx.cost > tx.suggestedPrice * OVERPAID_MARGIN) {
    return {
      id: tx.id,
      isMine,
      kind: "pagato-troppo",
      message: `Pagato più del dovuto: ${tx.playerName} a ${tx.cost}, il consigliato era ${tx.suggestedPrice}.`,
    };
  }
  if (tx.wasRecommended && tx.suggestedPrice != null && tx.cost <= tx.suggestedPrice * GOOD_DEAL_MARGIN) {
    return {
      id: tx.id,
      isMine,
      kind: "buon-colpo",
      message: `Buon colpo: ${tx.playerName} preso a ${tx.cost}, era tra i consigliati.`,
    };
  }
  return {
    id: tx.id,
    isMine,
    kind: "neutro",
    message: `${tx.playerName} preso da ${tx.teamName} per ${tx.cost} crediti.`,
  };
}

type ErrorSource = "fantaasta" | "internal" | "input" | "unsupported-environment";
type ApiResponse = LiveAuctionSnapshot | { error: string; source?: ErrorSource };

function isErrorResponse(data: unknown): data is { error: string; source?: ErrorSource } {
  return typeof data === "object" && data !== null && "error" in data && typeof (data as Record<string, unknown>).error === "string";
}

export default function AstaLivePage() {
  const [myTeamName, setMyTeamName] = useState(DEFAULT_TEAM_NAME);
  const [prefsReady, setPrefsReady] = useState(false);
  const [snapshot, setSnapshot] = useState<LiveAuctionSnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<ErrorSource>("internal");
  const [loading, setLoading] = useState(true);
  const [justLaunched, setJustLaunched] = useState(false);
  const [launchOutcome, setLaunchOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  // Contatore per scartare risposte "vecchie" arrivate dopo una più recente
  // (rete lenta/variabile, o cambio rapido di myTeamIndex): senza questo,
  // fetch fuori ordine potrebbero sovrascrivere lo stato con dati stale.
  const requestSeqRef = useRef(0);
  const [notifications, setNotifications] = useState<PurchaseNotification[]>([]);
  // null finché non arriva il primo snapshot della sessione: le transazioni
  // già presenti in quel primo snapshot sono storia pregressa (asta magari
  // già in corso da tempo), non "nuovi acquisti" da notificare — servono
  // solo a inizializzare il set di riferimento.
  const seenTransactionIdsRef = useRef<Set<number> | null>(null);

  // La preferenza va letta da localStorage prima del primo poll, altrimenti
  // partiremmo sempre col nome di default e poi "salteremmo" al valore salvato.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored != null && stored.trim()) setMyTeamName(stored);
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    window.localStorage.setItem(STORAGE_KEY, myTeamName);
  }, [myTeamName, prefsReady]);

  const fetchState = useCallback(async (teamName: string) => {
    const requestId = ++requestSeqRef.current;
    try {
      const res = await fetch(`/api/asta-live/state?myTeamName=${encodeURIComponent(teamName)}`, {
        cache: "no-store",
      });
      const data: ApiResponse = await res.json();
      if (requestId !== requestSeqRef.current) return; // superata da una richiesta più recente
      if (!res.ok || isErrorResponse(data)) {
        setErrorMessage(isErrorResponse(data) ? data.error : "Errore sconosciuto durante la lettura dell'asta.");
        setErrorSource(isErrorResponse(data) && data.source ? data.source : "internal");
        setSnapshot(null);
      } else {
        setSnapshot(data);
        setErrorMessage(null);
      }
    } catch (err) {
      if (requestId !== requestSeqRef.current) return;
      setErrorMessage(err instanceof Error ? err.message : "Errore di rete durante la lettura dell'asta.");
      setErrorSource("internal");
      setSnapshot(null);
    } finally {
      if (requestId === requestSeqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!prefsReady || !myTeamName.trim()) return;
    fetchState(myTeamName);
    const id = setInterval(() => fetchState(myTeamName), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [prefsReady, myTeamName, fetchState]);

  // Rilevamento "cosa è cambiato dall'ultimo poll" (backend stateless, non
  // tiene memoria delle chiamate precedenti): confronta gli id delle
  // transazioni recenti esposte dallo snapshot con l'ultimo set visto.
  useEffect(() => {
    if (!snapshot) return;
    const recent = snapshot.recentTransactions;

    if (seenTransactionIdsRef.current === null) {
      seenTransactionIdsRef.current = new Set(recent.map((tx) => tx.id));
      return;
    }

    const seen = seenTransactionIdsRef.current;
    const freshlyNew = recent.filter((tx) => !seen.has(tx.id));
    if (freshlyNew.length === 0) return;
    for (const tx of freshlyNew) seen.add(tx.id);

    const newNotifications = freshlyNew.map((tx) => buildPurchaseNotification(tx, myTeamName));
    setNotifications((prev) => [...newNotifications.reverse(), ...prev].slice(0, MAX_PURCHASE_NOTIFICATIONS));
  }, [snapshot, myTeamName]);

  const handleLaunch = () => {
    setJustLaunched(false);
    setLaunchOutcome(null);
    startTransition(async () => {
      const outcome = await launchFantaAstaDesktop();
      setLaunchOutcome(outcome);
      setJustLaunched(true);
    });
  };

  return (
    <div className="min-h-screen p-6 font-sans sm:p-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          <span aria-hidden>🔨</span> Asta Live
        </h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            La mia squadra (nome)
            <input
              type="text"
              value={myTeamName}
              onChange={(e) => setMyTeamName(e.target.value)}
              className="w-28 rounded-md border border-zinc-200 bg-white px-2 py-1 text-center text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </label>
          <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
            ← Dashboard
          </Link>
        </div>
      </header>

      <PurchaseNotifications notifications={notifications} />

      {loading && !snapshot && !errorMessage && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Caricamento...</p>
      )}

      {errorMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-900/40 dark:bg-red-950/30">
          <p className="text-sm text-red-800 dark:text-red-300">
            {errorSource === "fantaasta"
              ? `FantaAsta Desktop non è raggiungibile: ${errorMessage}`
              : errorSource === "unsupported-environment"
                ? errorMessage
                : `Errore durante la lettura dell'asta: ${errorMessage}`}
          </p>
          {errorSource === "fantaasta" && (
            <>
              <button
                onClick={handleLaunch}
                disabled={isPending}
                className="mt-3 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {isPending ? "Avvio in corso..." : "Apri FantaAsta Desktop"}
              </button>
              {justLaunched && !isPending && launchOutcome && (
                <p
                  className={`mt-2 text-xs ${launchOutcome.ok ? "text-zinc-500 dark:text-zinc-400" : "text-red-700 dark:text-red-400"}`}
                >
                  {launchOutcome.ok
                    ? `${launchOutcome.message} Riprovo tra qualche secondo...`
                    : launchOutcome.message}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {snapshot && (
        <>
          <TeamSummary snapshot={snapshot} />
          <OtherTeamsRecap teams={snapshot.otherTeams} />
          <SelectedPlayerSpotlight
            player={snapshot.selectedPlayer}
            verdict={snapshot.verdict}
            competingTeams={snapshot.competingTeams}
          />
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {ROLE_ORDER.map((role) => (
              <RoleSection
                key={role}
                role={role}
                picks={snapshot.bestPicksByRole[role]}
                trend={snapshot.marketTrend[role]}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Le notifiche più recenti in cima (unshift già fatto sopra con reverse()),
// max MAX_PURCHASE_NOTIFICATIONS: nessuna persistenza, si resettano al refresh
// (seenTransactionIdsRef/notifications sono solo stato React in memoria).
function PurchaseNotifications({ notifications }: { notifications: PurchaseNotification[] }) {
  if (notifications.length === 0) return null;

  return (
    <div className="mb-6 space-y-2">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${NOTIFICATION_STYLES[n.kind]}`}
        >
          <span aria-hidden>{NOTIFICATION_ICONS[n.kind]}</span>
          <p className="flex-1">{n.message}</p>
          <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium dark:bg-white/10">
            {n.isMine ? "Tu" : "Avversari"}
          </span>
        </div>
      ))}
    </div>
  );
}

function TeamSummary({ snapshot }: { snapshot: LiveAuctionSnapshot }) {
  const { myTeam, settings, roleBudget, spendingPace } = snapshot;
  const budget = myTeam?.credits ?? myTeam?.budget ?? settings.startingBudget;
  const slots = myTeam?.rosterHash ?? {
    gk: settings.rosterComposition.gk,
    def: settings.rosterComposition.def,
    mid: settings.rosterComposition.mid,
    atk: settings.rosterComposition.atk,
  };

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
        {myTeam ? myTeam.name : "La mia squadra"}
        {!myTeam && (
          <span className="ml-2 text-xs text-zinc-400">
            (nessun acquisto registrato per questo nome squadra: valori di default)
          </span>
        )}
      </h2>
      <div className="flex flex-wrap gap-6">
        <Stat label="Crediti rimanenti" value={budget} />
        {myTeam?.maxOffer != null && <Stat label="Offerta massima" value={myTeam.maxOffer} />}
        <Stat
          label="Portieri da comprare"
          value={slots.gk}
          roleBudget={roleBudget.P}
        />
        <Stat
          label="Difensori da comprare"
          value={slots.def}
          roleBudget={roleBudget.D}
        />
        <Stat
          label="Centrocampisti da comprare"
          value={slots.mid}
          roleBudget={roleBudget.C}
        />
        <Stat
          label="Attaccanti da comprare"
          value={slots.atk}
          roleBudget={roleBudget.A}
        />
      </div>
      {spendingPace.message && (
        <p className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-400">
          ⚡ {spendingPace.message}
        </p>
      )}
    </section>
  );
}

function OtherTeamsRecap({ teams }: { teams: FantaAstaTeamSnapshot[] }) {
  if (teams.length === 0) return null;

  return (
    <section className="mt-6 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">Altre squadre</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className="py-1 pr-4 font-medium">Squadra</th>
              <th className="py-1 pr-4 font-medium">Crediti</th>
              <th className="py-1 pr-4 font-medium">P</th>
              <th className="py-1 pr-4 font-medium">D</th>
              <th className="py-1 pr-4 font-medium">C</th>
              <th className="py-1 font-medium">A</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.index} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1.5 pr-4 font-medium text-zinc-900 dark:text-zinc-50">{team.name}</td>
                <td className="py-1.5 pr-4 text-zinc-600 dark:text-zinc-300">{team.credits ?? team.budget}</td>
                <td className="py-1.5 pr-4 text-zinc-600 dark:text-zinc-300">{team.rosterHash.gk}</td>
                <td className="py-1.5 pr-4 text-zinc-600 dark:text-zinc-300">{team.rosterHash.def}</td>
                <td className="py-1.5 pr-4 text-zinc-600 dark:text-zinc-300">{team.rosterHash.mid}</td>
                <td className="py-1.5 text-zinc-600 dark:text-zinc-300">{team.rosterHash.atk}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const VERDICT_STYLES: Record<Verdict["action"], string> = {
  punta: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  aspetta: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  attenzione: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

function SelectedPlayerSpotlight({
  player,
  verdict,
  competingTeams,
}: {
  player: PlayerSpotlight | null;
  verdict: Verdict | null;
  competingTeams: CompetingTeamsInfo | null;
}) {
  if (!player) return null;

  const worstStatus = player.lineupStatuses[0]; // già ordinato per giornata decrescente
  const priceHistoryLabel = player.priceHistory.map((p) => `${p.seasonLabel}: ${p.price}cr`).join(" · ");

  return (
    <section className="mt-6 rounded-md border-2 border-brand bg-white p-4 dark:bg-zinc-900">
      <h2 className="mb-1 flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        🔎 In visione ora
      </h2>
      {player.watchlistEntry && (
        <div className="mb-3 rounded-md border-2 border-violet-400 bg-violet-50 px-3 py-2 text-sm text-violet-900 dark:border-violet-600 dark:bg-violet-950/40 dark:text-violet-200">
          <p className="font-semibold">⭐ Obiettivo in watchlist</p>
          <p>
            {player.watchlistEntry.targetPrice != null && `Prezzo obiettivo: ${player.watchlistEntry.targetPrice} crediti`}
            {player.watchlistEntry.priority != null && ` · Priorità ${player.watchlistEntry.priority}`}
          </p>
          {player.watchlistEntry.note && <p className="mt-0.5 italic">"{player.watchlistEntry.note}"</p>}
        </div>
      )}
      {verdict && (
        <div className={`mb-1 rounded-md px-3 py-2 text-sm ${VERDICT_STYLES[verdict.action]}`}>
          <p className="font-semibold">
            {verdict.action === "punta" ? "✅" : verdict.action === "aspetta" ? "⏸️" : "⚠️"} {verdict.headline}
          </p>
          <p>{verdict.detail}</p>
        </div>
      )}
      {competingTeams && (
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          🔭 {competingTeams.message}
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            <Link href={`/giocatori/${player.slug}`} target="_blank" className="hover:underline">
              {player.name}
            </Link>
            <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">{player.teamName}</span>
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Quotazione {player.quotCurrentClassic ?? "—"} · FVM {player.fvmClassic ?? "—"}
            {player.stats && ` · MV ${player.stats.mv ?? "—"} · FM ${player.stats.fm ?? "—"} · ${player.stats.goals ?? 0} gol, ${player.stats.assists ?? 0} assist`}
          </p>
          {priceHistoryLabel && (
            <p className="text-xs text-zinc-400">Prezzi passati: {priceHistoryLabel}</p>
          )}
        </div>
        {player.advice && (
          <div className="text-right">
            <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {player.advice.suggestedPrice ?? "—"}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              consigliato · {bandLabel(player.advice.band)} · punteggio {player.advice.score}
            </p>
          </div>
        )}
      </div>
      {worstStatus && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          Formazione: {worstStatus.status}
          {worstStatus.probability != null && ` (${worstStatus.probability}%)`}
          {worstStatus.note && ` — ${worstStatus.note}`} · vs {worstStatus.isHome ? "" : "@"}
          {worstStatus.opponentName}
        </p>
      )}
      {player.setPieces.length > 0 && (
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
          {player.setPieces.map((sp) => `${sp.kind} #${sp.priority}`).join(" · ")}
        </p>
      )}
      {(player.proDescription || player.contraDescription) && (
        <div className="mt-2 space-y-1 text-sm">
          {player.proDescription && (
            <p className="text-emerald-700 dark:text-emerald-400">PRO: {player.proDescription}</p>
          )}
          {player.contraDescription && (
            <p className="text-red-700 dark:text-red-400">CONTRO: {player.contraDescription}</p>
          )}
        </div>
      )}
      {player.news.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {player.news.slice(0, 3).map((n) => (
            <li key={n.id}>· {n.title}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  roleBudget,
}: {
  label: string;
  value: number;
  roleBudget?: RoleBudgetInfo;
}) {
  return (
    <div>
      <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{value}</p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      {roleBudget && (
        <p
          className={
            roleBudget.spent > roleBudget.targetBudget
              ? "text-xs font-medium text-red-600 dark:text-red-400"
              : "text-xs text-zinc-500 dark:text-zinc-400"
          }
        >
          budget reparto: {roleBudget.spent}/{roleBudget.targetBudget}
        </p>
      )}
    </div>
  );
}

function RoleSection({ role, picks, trend }: { role: Role; picks: LiveAdvice[]; trend: MarketTrendInfo }) {
  const trendPct = Math.round((trend.factor - 1) * 100);
  const trendLabel =
    trendPct !== 0
      ? `${ROLE_LABELS[role].toLowerCase()}: ${trendPct > 0 ? "+" : ""}${trendPct}% rispetto al previsto in questa asta`
      : null;

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className={`flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50 ${trendLabel ? "mb-1" : "mb-3"}`}>
        <span aria-hidden>{ROLE_ICONS[role]}</span> {ROLE_LABELS[role]}
      </h2>
      {trendLabel && (
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">📈 {trendLabel}</p>
      )}
      {picks.length === 0 ? (
        <p className="text-sm text-zinc-400">Nessun giocatore disponibile.</p>
      ) : (
        <ul className="max-h-[420px] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
          {picks.map((pick) => (
            <li key={pick.player.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-900 dark:text-zinc-50">
                  <Link href={`/giocatori/${pick.player.slug}`} target="_blank" className="hover:underline">
                    {pick.player.name}
                  </Link>
                  <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                    {pick.player.team ?? "—"}
                  </span>
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {BAND_LABELS[pick.advice.band] ?? pick.advice.band} · punteggio {pick.advice.score}
                  {pick.advice.tags.length > 0 && ` · ${pick.advice.tags.join(", ")}`}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {pick.adjustedPrice != null &&
                  pick.advice.suggestedPrice != null &&
                  pick.adjustedPrice !== pick.advice.suggestedPrice && (
                    <p className="text-xs text-zinc-400 line-through">{pick.advice.suggestedPrice}</p>
                  )}
                <p
                  className={
                    pick.affordable
                      ? "font-semibold text-zinc-900 dark:text-zinc-50"
                      : "font-semibold text-red-600 dark:text-red-400"
                  }
                >
                  {!pick.affordable && <span aria-hidden>⚠️ </span>}
                  {pick.adjustedPrice ?? pick.advice.suggestedPrice ?? "—"}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">consigliato</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
