import * as cheerio from "cheerio";
import { fetchHtml } from "../http";
import { resolveTeamByName, nowIso } from "../normalize";
import { startRun, finishRunOk, finishRunError, runWriteTransaction } from "../pipeline";
import { fixtures } from "@/db/schema";

const BASE_URL = "https://www.fantacalcio.it/serie-a/calendario";
const SEASON = "2026-27";
const TOTAL_MATCHDAYS = 38;
// guard-rail: 38 giornate x 10 partite = 380, tollerante a qualche riga
// mancante per giornate non ancora completamente programmate.
const MIN_EXPECTED_ROWS = 340;

export type ParsedFixtureRow = {
  matchday: number;
  homeTeamName: string;
  awayTeamName: string;
  kickoffAt: string | null;
  venue: string | null;
};

export async function fetchMatchdayPage(matchday: number, opts: { force?: boolean } = {}) {
  return fetchHtml(`${BASE_URL}/${matchday}`, {
    cacheKey: `calendario-${matchday}`,
    force: opts.force,
    maxAgeMinutes: 1440,
  });
}

/**
 * Funzione pura: HTML -> righe tipizzate. Ogni pagina /calendario/{N} mostra
 * in realtà più di una giornata (paginazione a coppie): il parser legge TUTTI
 * i blocchi partita presenti sulla pagina, non solo quelli della giornata
 * richiesta — il chiamante fa comunque il giro su tutte le 38 pagine e
 * deduplica, così il risultato è corretto anche se la paginazione cambia.
 */
export function parseHtml(html: string): ParsedFixtureRow[] {
  const $ = cheerio.load(html);
  const rows: ParsedFixtureRow[] = [];

  $(".match-pill").each((_, el) => {
    const $el = $(el);
    const matchday = Number($el.find(".matchweek").first().text().trim());
    const homeTeamName =
      $el.find('label.team-home meta[itemprop="name"]').first().attr("content") ?? "";
    const awayTeamName =
      $el.find('label.team-away meta[itemprop="name"]').first().attr("content") ?? "";
    const kickoffAt = $el.find('meta[itemprop="startDate"]').first().attr("content") ?? null;
    const venue = $el.find(".stadium").first().text().trim() || null;

    if (!Number.isFinite(matchday) || !homeTeamName || !awayTeamName) return;
    rows.push({ matchday, homeTeamName, awayTeamName, kickoffAt, venue });
  });

  return rows;
}

export type CalendarioRunResult = {
  ok: boolean;
  rowsSeen: number;
  rowsInserted: number;
  rowsUnmatched: number;
};

/**
 * Fonte "di riferimento": il calendario non crea mai giocatori, serve solo a
 * popolare `fixtures` per l'intera stagione (non solo la prossima giornata,
 * a differenza dello scraper probabili-formazioni) — è il calendario completo
 * a rendere possibile la griglia portieri/attaccanti basata sulle giornate
 * facili/difficili future.
 */
export async function run(opts: { force?: boolean } = {}): Promise<CalendarioRunResult> {
  const runId = await startRun("calendario", BASE_URL);

  try {
    const byKey = new Map<string, ParsedFixtureRow>();
    for (let matchday = 1; matchday <= TOTAL_MATCHDAYS; matchday++) {
      const { html } = await fetchMatchdayPage(matchday, opts);
      for (const row of parseHtml(html)) {
        byKey.set(`${row.matchday}|${row.homeTeamName}|${row.awayTeamName}`, row);
      }
    }
    const rows = [...byKey.values()];

    if (rows.length < MIN_EXPECTED_ROWS) {
      await finishRunError(
        runId,
        `Solo ${rows.length} partite trovate (attese >= ${MIN_EXPECTED_ROWS}): probabile cambio di struttura della pagina, dati non toccati.`,
      );
      return { ok: false, rowsSeen: rows.length, rowsInserted: 0, rowsUnmatched: 0 };
    }

    type ResolvedAction =
      | { kind: "write"; homeTeamId: number; awayTeamId: number; row: ParsedFixtureRow }
      | { kind: "skip_unmatched" };

    const actions: ResolvedAction[] = [];
    for (const row of rows) {
      const [home, away] = await Promise.all([
        resolveTeamByName(row.homeTeamName),
        resolveTeamByName(row.awayTeamName),
      ]);
      if (!home || !away) {
        actions.push({ kind: "skip_unmatched" });
        continue;
      }
      actions.push({ kind: "write", homeTeamId: home.id, awayTeamId: away.id, row });
    }

    const now = nowIso();
    const counters = await runWriteTransaction(async (tx) => {
      let inserted = 0;
      let unmatched = 0;

      for (const action of actions) {
        if (action.kind === "skip_unmatched") {
          unmatched++;
          continue;
        }
        await tx
          .insert(fixtures)
          .values({
            season: SEASON,
            matchday: action.row.matchday,
            homeTeamId: action.homeTeamId,
            awayTeamId: action.awayTeamId,
            kickoffAt: action.row.kickoffAt,
            venue: action.row.venue,
            sourceUrl: BASE_URL,
            fetchedAt: now,
          })
          .onConflictDoUpdate({
            target: [fixtures.season, fixtures.matchday, fixtures.homeTeamId, fixtures.awayTeamId],
            set: { kickoffAt: action.row.kickoffAt, venue: action.row.venue, fetchedAt: now },
          });
        inserted++;
      }

      return { rowsInserted: inserted, rowsUpdated: 0, rowsUnmatched: unmatched };
    });

    await finishRunOk(
      runId,
      counters,
      `${rows.length} partite lette su ${TOTAL_MATCHDAYS} giornate, ${counters.rowsInserted} salvate, ${counters.rowsUnmatched} non abbinate.`,
    );

    return {
      ok: true,
      rowsSeen: rows.length,
      rowsInserted: counters.rowsInserted,
      rowsUnmatched: counters.rowsUnmatched,
    };
  } catch (err) {
    await finishRunError(runId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
