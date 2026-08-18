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

/** Scarica e mette in cache su disco il campioncino di un giocatore. Idempotente:
 * se è già in cache non rifa la richiesta. Non lancia mai: ritorna false su errore. */
export async function downloadPlayerImage(externalId: string): Promise<boolean> {
  if (hasCachedImage(externalId)) return true;

  try {
    const res = await fetch(`${REMOTE_BASE}/${externalId}.png`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) return false;

    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachedImagePath(externalId), buf);
    return true;
  } catch {
    return false;
  }
}
