import * as cheerio from "cheerio";
import { fetchHtml } from "../http";
import {
  parseItalianNumber,
  parsePenalties,
  resolveTeamByExternalId,
  resolveOrCreatePlayer,
  nowIso,
} from "../normalize";
import { startRun, finishRunOk, finishRunError, runWriteTransaction } from "../pipeline";
import { playerSeasonStats } from "@/db/schema";

const BASE_URL = "https://www.fantacalcio.it/statistiche-serie-a";
const MIN_EXPECTED_ROWS = 300; // guard-rail: sotto questa soglia, probabile cambio di struttura del sito

export type ParsedPlayerStat = {
  name: string;
  teamExternalId: number;
  teamCode: string;
  roleClassic: string; // P | D | C | A
  roleMantra: string | null; // es. "por", "pc" (codice fantacalcio.it)
  externalId: number | null;
  pv: number | null;
  mv: number | null;
  fm: number | null;
  goals: number | null;
  goalsConceded: number | null;
  penaltiesScored: number | null;
  penaltiesTaken: number | null;
  penaltiesSaved: number | null;
  assists: number | null;
  yellowCards: number | null;
  redCards: number | null;
};

export function buildUrl(season: string): string {
  return `${BASE_URL}/${season}`;
}

export async function fetch(
  season: string,
  opts: { force?: boolean } = {},
) {
  return fetchHtml(buildUrl(season), {
    cacheKey: `statistiche-${season}`,
    force: opts.force,
  });
}

/**
 * Funzione pura: HTML -> righe tipizzate. Zero I/O, zero DB — testabile
 * con vitest contro le fixture salvate in data/cache/.
 */
export function parseHtml(html: string): ParsedPlayerStat[] {
  const $ = cheerio.load(html);
  const rows: ParsedPlayerStat[] = [];

  $("table#stats tbody tr.player-row").each((_, el) => {
    const $row = $(el);
    const teamExternalId = Number($row.attr("data-filter-team-id"));
    const roleClassic = ($row.attr("data-filter-role-classic") ?? "").toUpperCase();
    const roleMantra = $row.attr("data-filter-role-mantra") || null;

    const nameLink = $row.find("th.player-name a.player-name");
    const name = nameLink.find("span").first().text().trim();
    const href = nameLink.attr("href") ?? "";
    const idMatch = href.match(/\/(\d+)(?:\/[\d-]+)?\/?$/);
    const externalId = idMatch ? Number(idMatch[1]) : null;

    const teamCode = $row.find('td[data-col-key="sq"]').text().trim();
    const cell = (key: string) =>
      $row.find(`td[data-col-key="${key}"]`).first().text().trim();

    if (!name || !Number.isFinite(teamExternalId)) return;

    const { scored, taken } = parsePenalties(cell("rig"));

    rows.push({
      name,
      teamExternalId,
      teamCode,
      roleClassic,
      roleMantra,
      externalId,
      pv: parseItalianNumber(cell("pg")),
      mv: parseItalianNumber(cell("mv")),
      fm: parseItalianNumber(cell("mfv")),
      goals: parseItalianNumber(cell("gol")),
      goalsConceded: parseItalianNumber(cell("gs")),
      penaltiesScored: scored,
      penaltiesTaken: taken,
      penaltiesSaved: parseItalianNumber(cell("rp")),
      assists: parseItalianNumber(cell("ass")),
      yellowCards: parseItalianNumber(cell("amm")),
      redCards: parseItalianNumber(cell("esp")),
    });
  });

  return rows;
}

export type StatisticheRunResult = {
  ok: boolean;
  rowsSeen: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsSkippedOtherTeam: number;
};

/**
 * Orchestrazione: fetch -> parse -> per riga risolve la squadra (skip se non è
 * una delle 20 correnti, es. Cremonese/Pisa/Verona retrocesse) -> crea o
 * abbina il giocatore -> upsert delle statistiche in un'unica transazione.
 * Non tocca mai players.team_id/role_* di un giocatore già esistente: quei
 * campi sono di competenza del listone (fonte autoritativa per il roster
 * corrente), qui si scrivono solo le statistiche stagionali.
 */
export async function run(
  season: string,
  opts: { force?: boolean } = {},
): Promise<StatisticheRunResult> {
  const url = buildUrl(season);
  const runId = await startRun("statistiche", url);

  try {
    const { html } = await fetch(season, opts);
    const rows = parseHtml(html);

    if (rows.length < MIN_EXPECTED_ROWS) {
      await finishRunError(
        runId,
        `Solo ${rows.length} righe trovate (attese >= ${MIN_EXPECTED_ROWS}): probabile cambio di struttura della pagina, dati non toccati.`,
      );
      return { ok: false, rowsSeen: rows.length, rowsInserted: 0, rowsUpdated: 0, rowsSkippedOtherTeam: 0 };
    }

    type ResolvedAction =
      | { kind: "write"; playerId: number; created: boolean; row: ParsedPlayerStat }
      | { kind: "skip_other_team" };

    const actions: ResolvedAction[] = [];
    for (const row of rows) {
      const team = await resolveTeamByExternalId(row.teamExternalId);
      if (!team) {
        actions.push({ kind: "skip_other_team" });
        continue;
      }
      const { playerId, created } = await resolveOrCreatePlayer({
        rawName: row.name,
        teamId: team.id,
        teamSlug: team.slug,
        roleClassic: row.roleClassic || null,
        rolesMantra: row.roleMantra,
        externalId: row.externalId,
      });
      actions.push({ kind: "write", playerId, created, row });
    }

    const now = nowIso();
    const counters = runWriteTransaction((tx) => {
      let inserted = 0;
      let updated = 0;
      let skipped = 0;

      for (const action of actions) {
        if (action.kind === "skip_other_team") {
          skipped++;
          continue;
        }

        const values = {
          playerId: action.playerId,
          season,
          pv: action.row.pv,
          mv: action.row.mv,
          fm: action.row.fm,
          goals: action.row.goals,
          goalsConceded: action.row.goalsConceded,
          penaltiesScored: action.row.penaltiesScored,
          penaltiesTaken: action.row.penaltiesTaken,
          penaltiesSaved: action.row.penaltiesSaved,
          assists: action.row.assists,
          yellowCards: action.row.yellowCards,
          redCards: action.row.redCards,
          updatedAt: now,
        };

        tx
          .insert(playerSeasonStats)
          .values(values)
          .onConflictDoUpdate({
            target: [playerSeasonStats.playerId, playerSeasonStats.season],
            set: values,
          })
          .run();

        if (action.created) inserted++;
        else updated++;
      }

      return { rowsInserted: inserted, rowsUpdated: updated, rowsUnmatched: skipped };
    });

    await finishRunOk(
      runId,
      counters,
      `Stagione ${season}: ${rows.length} righe lette, ${counters.rowsInserted} giocatori creati, ${counters.rowsUpdated} statistiche aggiornate, ${counters.rowsUnmatched} righe di altre squadre ignorate.`,
    );

    return {
      ok: true,
      rowsSeen: rows.length,
      rowsInserted: counters.rowsInserted,
      rowsUpdated: counters.rowsUpdated,
      rowsSkippedOtherTeam: counters.rowsUnmatched,
    };
  } catch (err) {
    await finishRunError(runId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
