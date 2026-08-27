import fs from "node:fs";
import path from "node:path";

const CACHE_DIR = path.resolve(process.cwd(), "data/campioncini");
const REMOTE_BASE = "https://content.fantacalcio.it/web/campioncini/21/small";
const USER_AGENT = "Fantacucciolo/1.0 (assistente personale non commerciale, uso privato)";

export function cachedImagePath(externalId: string): string {
  return path.join(CACHE_DIR, `${externalId}.png`);
}

export function hasCachedImage(externalId: string): boolean {
  return fs.existsSync(cachedImagePath(externalId));
}

export function readCachedImage(externalId: string): Buffer | null {
  const filePath = cachedImagePath(externalId);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
}

async function fetchRemoteImage(externalId: string): Promise<Buffer | null> {
  const res = await fetch(`${REMOTE_BASE}/${externalId}.png`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

/** Scarica e mette in cache su disco il campioncino di un giocatore. Idempotente:
 * se è già in cache non rifa la richiesta. Non lancia mai: ritorna false su errore
 * di rete o di scrittura su disco. Pensato per il backfill da CLI in locale. */
export async function downloadPlayerImage(externalId: string): Promise<boolean> {
  if (hasCachedImage(externalId)) return true;

  try {
    const buf = await fetchRemoteImage(externalId);
    if (!buf) return false;
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachedImagePath(externalId), buf);
    return true;
  } catch {
    return false;
  }
}

/**
 * Come downloadPlayerImage, ma pensata per servire una richiesta: ritorna
 * sempre i byte dell'immagine se il download remoto riesce, anche quando il
 * salvataggio su disco fallisce (filesystem di sola lettura, es. Vercel) — la
 * cache su disco resta un "best effort" per lo sviluppo locale, mai un
 * requisito per rispondere alla richiesta.
 */
export async function getOrFetchPlayerImage(externalId: string): Promise<Buffer | null> {
  const cached = readCachedImage(externalId);
  if (cached) return cached;

  try {
    const buf = await fetchRemoteImage(externalId);
    if (!buf) return null;
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cachedImagePath(externalId), buf);
    } catch {
      // Filesystem di sola lettura in produzione: l'immagine viene comunque
      // servita da questa risposta, semplicemente non resta in cache per la
      // prossima — non è un errore per chi chiama.
    }
    return buf;
  } catch {
    return null;
  }
}
