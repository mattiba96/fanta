import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { scrapeRuns } from "@/db/schema";
import * as statistiche from "./sources/statistiche";
import * as listone from "./sources/listone";
import * as setPieces from "./sources/setPieces";
import * as probabiliFormazioni from "./sources/probabiliFormazioni";
import * as news from "./sources/news";
import * as fcpRatings from "./sources/fcpRatings";
import * as calendario from "./sources/calendario";
import * as goalkeeperGrid from "./sources/goalkeeperGrid";
import { DEFAULT_STATS_SEASON } from "@/lib/queries/players";

// Soglie di "freschezza" per fonte: le notizie cambiano di continuo, le
// formazioni/infortuni ogni giorno, quotazioni/statistiche/indice molto più
// lentamente. Il calendario è il più lento da scaricare (38 pagine) e il più
// stabile una volta pubblicato: soglia lunghissima, non deve mai bloccare una
// navigazione qualunque con 60-90s di fetch in background.
const THRESHOLDS_MINUTES: Record<string, number> = {
  news: 60, // 1 ora
  probabili: 180, // 3 ore
  set_piece_roles: 1440, // 24 ore
  listone: 1440,
  statistiche: 1440,
  fcp_ratings: 1440 * 7, // 7 giorni: l'indice/tag cambiano raramente
  calendario: 1440 * 14, // 14 giorni
  goalkeeper_grid: 1440 * 7, // 7 giorni: contenuto editoriale, aggiornato saltuariamente
};

const RUNNERS: Record<string, () => Promise<unknown>> = {
  news: () => news.run(),
  probabili: () => probabiliFormazioni.run(),
  set_piece_roles: () => setPieces.run(),
  listone: () => listone.run(),
  statistiche: () => statistiche.run(DEFAULT_STATS_SEASON),
  fcp_ratings: () => fcpRatings.run(),
  calendario: () => calendario.run(),
  goalkeeper_grid: () => goalkeeperGrid.run(),
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
 *
 * Le fonti vengono controllate IN SEQUENZA, non in parallelo: 8 query
 * concorrenti sullo stesso client appena aperto (cold start serverless su
 * Vercel) hanno causato errori intermittenti nel client libSQL. In sequenza
 * costano comunque pochi millisecondi in totale (query indicizzate), e il
 * try/catch attorno a OGNI fonte evita che il fallimento di una (query di
 * freschezza o scraping vero e proprio) lasci una promise non gestita o
 * blocchi il controllo delle altre.
 */
export function triggerAutoRefreshIfStale(): void {
  void (async () => {
    for (const source of Object.keys(THRESHOLDS_MINUTES)) {
      if (inFlight.has(source)) continue;

      try {
        const ageMinutes = await getLastOkRunAgeMinutes(source);
        if (ageMinutes < THRESHOLDS_MINUTES[source]) continue;

        inFlight.add(source);
        try {
          await RUNNERS[source]();
        } finally {
          inFlight.delete(source);
        }
      } catch {
        // L'errore dello scraping è comunque già registrato in scrape_runs
        // dal modulo stesso; qui basta non lasciare una rejection non gestita.
      }
    }
  })();
}
