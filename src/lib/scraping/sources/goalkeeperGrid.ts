import * as cheerio from "cheerio";
import { eq } from "drizzle-orm";
import { fetchHtml } from "../http";
import { resolveTeamByName, nowIso } from "../normalize";
import { startRun, finishRunOk, finishRunError, runWriteTransaction } from "../pipeline";
import { goalkeeperGrids } from "@/db/schema";

const BASE_URL =
  "https://www.sosfanta.com/asta-fantacalcio/griglia-portieri-seriea-fantacalcio-alternanze-asta-chi-prendere";
const SEASON = "2026-27";
const MIN_EXPECTED_ROWS = 15; // guard-rail: solo "coppie" ne dà già ~15

export type GridCategory = "coppie" | "coppie_low_cost" | "terzetti";

// Mappa titolo pagina -> categoria: solo le pagine "a coppie/terzetti di
// squadre separate da trattino" hanno un formato uniforme da parsare; la
// pagina "chi prendere con i top" ha una struttura diversa (squadra ancora +
// lista) e concettualmente ripete gli stessi abbinamenti migliori già coperti
// da "coppie", quindi non viene scaricata separatamente.
const CATEGORY_BY_TITLE: Record<string, GridCategory> = {
  COPPIE: "coppie",
  "COPPIE LOW COST": "coppie_low_cost",
  TERZETTI: "terzetti",
};

export type ParsedGridRow = {
  category: GridCategory;
  teamNames: string[]; // 2 per coppie, 3 per terzetti
  score: number;
};

async function fetchPage(page: number, opts: { force?: boolean } = {}) {
  const url = page === 1 ? `${BASE_URL}/` : `${BASE_URL}/${page}/`;
  return fetchHtml(url, { cacheKey: `goalkeeper-grid-${page}`, force: opts.force, maxAgeMinutes: 1440 });
}

/** Legge "Prossima scheda X di Y" per sapere quante schede scaricare in totale. */
export function parseTotalPages(html: string): number {
  const $ = cheerio.load(html);
  const text = $("body").text();
  const m = text.match(/(\d+)\s*di\s*(\d+)/);
  return m ? Number(m[2]) : 1;
}

/**
 * Funzione pura: HTML di UNA scheda -> righe tipizzate (o [] se la scheda non
 * è una delle categorie note, es. "chi prendere con i top"). Le righe utili
 * sono nel <p> con più righe "Squadra-Squadra Punteggio" separate da <br>.
 */
export function parseHtml(html: string): ParsedGridRow[] {
  const $ = cheerio.load(html);
  const title = $(".article-page-subtitle").first().text().trim().toUpperCase();
  const category = CATEGORY_BY_TITLE[title];
  if (!category) return [];

  const rows: ParsedGridRow[] = [];
  const linePattern = /^([\p{L}.'’ ]+(?:-[\p{L}.'’ ]+)+)\s+(\d+)$/u;

  $("p").each((_, el) => {
    const innerHtml = $(el).html() ?? "";
    const lines = innerHtml
      .split(/<br\s*\/?>/i)
      .map((l) => l.replace(/<[^>]+>/g, "").trim())
      .filter(Boolean);
    if (lines.length < 2) return; // scarta intro/nota, tiene solo blocchi con più righe

    for (const line of lines) {
      const m = line.match(linePattern);
      if (!m) continue;
      const teamNames = m[1].split("-").map((s) => s.trim());
      const score = Number(m[2]);
      if (teamNames.length < 2 || !Number.isFinite(score)) continue;
      rows.push({ category, teamNames, score });
    }
  });

  return rows;
}

export type GoalkeeperGridRunResult = {
  ok: boolean;
  rowsSeen: number;
  rowsInserted: number;
  rowsUnmatched: number;
};

/**
 * Fonte "di riferimento": non crea mai giocatori/squadre. Legge la scheda 1
 * per sapere quante schede totali ci sono, poi le scarica tutte e tiene solo
 * quelle di categoria nota (coppie/coppie low cost/terzetti).
 */
export async function run(opts: { force?: boolean } = {}): Promise<GoalkeeperGridRunResult> {
  const runId = await startRun("goalkeeper_grid", BASE_URL);

  try {
    const first = await fetchPage(1, opts);
    const totalPages = parseTotalPages(first.html);

    const allRows: ParsedGridRow[] = [...parseHtml(first.html)];
    for (let page = 2; page <= totalPages; page++) {
      const { html } = await fetchPage(page, opts);
      allRows.push(...parseHtml(html));
    }

    if (allRows.length < MIN_EXPECTED_ROWS) {
      await finishRunError(
        runId,
        `Solo ${allRows.length} righe trovate (attese >= ${MIN_EXPECTED_ROWS}): probabile cambio di struttura della pagina, dati non toccati.`,
      );
      return { ok: false, rowsSeen: allRows.length, rowsInserted: 0, rowsUnmatched: 0 };
    }

    type ResolvedAction =
      | { kind: "write"; row: ParsedGridRow; teamIds: number[] }
      | { kind: "skip_unmatched" };

    const actions: ResolvedAction[] = [];
    for (const row of allRows) {
      const resolved = await Promise.all(row.teamNames.map((name) => resolveTeamByName(name)));
      if (resolved.some((t) => !t)) {
        actions.push({ kind: "skip_unmatched" });
        continue;
      }
      actions.push({ kind: "write", row, teamIds: resolved.map((t) => t!.id) });
    }

    const now = nowIso();
    const counters = await runWriteTransaction(async (tx) => {
      let inserted = 0;
      let unmatched = 0;

      await tx.delete(goalkeeperGrids).where(eq(goalkeeperGrids.season, SEASON));

      for (const action of actions) {
        if (action.kind === "skip_unmatched") {
          unmatched++;
          continue;
        }
        await tx
          .insert(goalkeeperGrids)
          .values({
            season: SEASON,
            category: action.row.category,
            teamNames: action.row.teamNames.join("|"),
            teamIds: action.teamIds.join("|"),
            score: action.row.score,
            sourceUrl: BASE_URL,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [goalkeeperGrids.season, goalkeeperGrids.category, goalkeeperGrids.teamNames],
            set: { teamIds: action.teamIds.join("|"), score: action.row.score, updatedAt: now },
          });
        inserted++;
      }

      return { rowsInserted: inserted, rowsUpdated: 0, rowsUnmatched: unmatched };
    });

    await finishRunOk(
      runId,
      counters,
      `${allRows.length} righe lette su ${totalPages} schede, ${counters.rowsInserted} salvate, ${counters.rowsUnmatched} non abbinate.`,
    );

    return {
      ok: true,
      rowsSeen: allRows.length,
      rowsInserted: counters.rowsInserted,
      rowsUnmatched: counters.rowsUnmatched,
    };
  } catch (err) {
    await finishRunError(runId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
