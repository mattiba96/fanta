import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { scrapeRuns } from "@/db/schema";
import * as statistiche from "./sources/statistiche";
import * as listone from "./sources/listone";
import * as setPieces from "./sources/setPieces";
import * as probabiliFormazioni from "./sources/probabiliFormazioni";
import * as news from "./sources/news";
import { DEFAULT_STATS_SEASON } from "@/lib/queries/players";

// Soglie di "freschezza" per fonte: le notizie cambiano di continuo, le
// formazioni/infortuni ogni giorno, quotazioni/statistiche molto più
// lentamente.
const THRESHOLDS_MINUTES: Record<string, number> = {
  news: 60, // 1 ora
  probabili: 180, // 3 ore
  set_piece_roles: 1440, // 24 ore
  listone: 1440,
  statistiche: 1440,
};

const RUNNERS: Record<string, () => Promise<unknown>> = {
  news: () => news.run(),
  probabili: () => probabiliFormazioni.run(),
  set_piece_roles: () => setPieces.run(),
  listone: () => listone.run(),
  statistiche: () => statistiche.run(DEFAULT_STATS_SEASON),
};

// Evita di far partire due refresh della stessa fonte in parallelo se più
// pagine vengono aperte/navigate nella stessa finestra di tempo.
const inFlight = new Set<string>();

async function getLastOkRunAgeMinutes(source: string): Promise<number> {
  const [row] = await db
    .select({ startedAt: scrapeRuns.startedAt })
    .from(scrapeRuns)
    .where(and(eq(scrapeRuns.source, source), eq(scrapeRuns.status, "ok")))
    .orderBy(desc(scrapeRuns.startedAt))
    .limit(1);
  if (!row) return Infinity;
  return (Date.now() - new Date(row.startedAt).getTime()) / 60000;
}

/**
 * Controlla la freschezza di ogni fonte e, se scaduta, lancia lo scraping
 * corrispondente in background (fire-and-forget: non blocca il rendering
 * della pagina che l'ha chiamata). Pensato per essere richiamato dal root
 * layout ad ogni navigazione — il controllo è una query indicizzata economica,
 * il refresh vero e proprio parte solo quando serve davvero.
 */
export function triggerAutoRefreshIfStale(): void {
  for (const source of Object.keys(THRESHOLDS_MINUTES)) {
    if (inFlight.has(source)) continue;

    void (async () => {
      const ageMinutes = await getLastOkRunAgeMinutes(source);
      if (ageMinutes < THRESHOLDS_MINUTES[source]) return;

      inFlight.add(source);
      try {
        await RUNNERS[source]();
      } catch {
        // L'errore è già registrato in scrape_runs dal modulo stesso.
      } finally {
        inFlight.delete(source);
      }
    })();
  }
}
