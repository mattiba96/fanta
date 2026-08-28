import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const USER_AGENT =
  "Fantacucciolo/1.0 (assistente personale non commerciale, uso privato)";
const CACHE_DIR = path.resolve(process.cwd(), "data/cache");
const MIN_DELAY_MS = 1500;

let lastRequestAt = 0;

async function throttle() {
  const wait = MIN_DELAY_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

function hashOf(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function cachePath(cacheKey: string) {
  const safe = cacheKey.replace(/[^a-z0-9-_]/gi, "_");
  return path.join(CACHE_DIR, `${safe}.html`);
}

async function fetchWithRetry(
  url: string,
  maxAttempts: number,
  timeoutMs: number,
  attempt = 1,
): Promise<string> {
  await throttle();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "it-IT" },
      signal: controller.signal,
    });
    if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
      const retryAfterHeader = Number(res.headers.get("retry-after"));
      const waitSeconds = Number.isFinite(retryAfterHeader)
        ? retryAfterHeader
        : attempt * 2;
      await new Promise((r) => setTimeout(r, waitSeconds * 1000));
      return fetchWithRetry(url, maxAttempts, timeoutMs, attempt + 1);
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} per ${url}`);
    }
    return await res.text();
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    if (!isAbort && attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, attempt * 1500));
      return fetchWithRetry(url, maxAttempts, timeoutMs, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export type FetchHtmlResult = { html: string; fromCache: boolean; hash: string };

/**
 * Fetch onesto verso siti terzi: user-agent dichiarato, richieste sequenziali
 * con throttle, retry minimo solo su errori di rete/5xx/429, e cache su disco
 * per non rifare richieste inutili (permette anche di sviluppare i parser offline).
 *
 * `maxAttempts`/`timeoutMs` di default sono pensati per gli scraper in blocco
 * (pazienti, nessuno aspetta col caricamento bloccato). Per un fetch "al volo"
 * dentro il rendering di una pagina (es. scheda giocatore) vanno abbassati,
 * altrimenti un sito lento blocca la pagina per lo stesso tempo di un job
 * in background — da lì il bug "apre un giocatore e ci mette 30 secondi".
 */
export async function fetchHtml(
  url: string,
  opts: {
    cacheKey: string;
    maxAgeMinutes?: number;
    force?: boolean;
    maxAttempts?: number;
    timeoutMs?: number;
  },
): Promise<FetchHtmlResult> {
  const maxAgeMinutes = opts.maxAgeMinutes ?? 360;
  const file = cachePath(opts.cacheKey);

  if (!opts.force && fs.existsSync(file)) {
    const ageMinutes = (Date.now() - fs.statSync(file).mtimeMs) / 60000;
    if (ageMinutes < maxAgeMinutes) {
      const html = fs.readFileSync(file, "utf-8");
      return { html, fromCache: true, hash: hashOf(html) };
    }
  }

  const html = await fetchWithRetry(url, opts.maxAttempts ?? 3, opts.timeoutMs ?? 15000);
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, html, "utf-8");
  } catch {
    // Filesystem di sola lettura in produzione (Vercel): l'HTML appena
    // scaricato viene comunque ritornato a chi chiama, semplicemente non
    // resta in cache per la prossima volta — la cache su disco è solo un
    // best-effort per sviluppare/testare i parser offline in locale.
  }
  return { html, fromCache: false, hash: hashOf(html) };
}

export function readCachedHtml(cacheKey: string): string | null {
  const file = cachePath(cacheKey);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null;
}
