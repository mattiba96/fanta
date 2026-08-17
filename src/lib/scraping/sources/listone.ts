import * as cheerio from "cheerio";
import { and, eq, notInArray } from "drizzle-orm";
import { fetchHtml } from "../http";
import {
  parseItalianNumber,
  resolveTeamByExternalId,
  resolveOrCreatePlayer,
  nowIso,
} from "../normalize";
import { startRun, finishRunOk, finishRunError, runWriteTransaction } from "../pipeline";
import { players } from "@/db/schema";

const URL = "https://www.fantacalcio.it/quotazioni-fantacalcio";
const MIN_EXPECTED_ROWS = 400; // guard-rail: il listone copre ~500 giocatori delle 20 squadre correnti

export type ParsedListingRow = {
  name: string;
  teamExternalId: number;
  roleClassic: string; // P | D | C | A
  roleMantra: string | null;
  externalId: number | null;
  quotInitialClassic: number | null;
  quotCurrentClassic: number | null;
  fvmClassic: number | null;
  quotInitialMantra: number | null;
  quotCurrentMantra: number | null;
  fvmMantra: number | null;
};

export async function fetch(opts: { force?: boolean } = {}) {
  return fetchHtml(URL, { cacheKey: "listone", force: opts.force });
}

/** Funzione pura: HTML -> righe tipizzate. Zero I/O, zero DB. */
export function parseHtml(html: string): ParsedListingRow[] {
  const $ = cheerio.load(html);
  const rows: ParsedListingRow[] = [];

  $("table.serie-a tbody tr.player-row").each((_, el) => {
    const $row = $(el);
    const teamExternalId = Number($row.attr("data-filter-team-id"));
    const roleClassic = ($row.attr("data-filter-role-classic") ?? "").toUpperCase();
    const roleMantra = $row.attr("data-filter-role-mantra") || null;

    const nameLink = $row.find("th.player-name a.player-name");
    const name = nameLink.find("span").first().text().trim();
    const href = nameLink.attr("href") ?? "";
    const idMatch = href.match(/\/(\d+)\/?$/);
    const externalId = idMatch ? Number(idMatch[1]) : null;

    const cell = (key: string) =>
      $row.find(`td[data-col-key="${key}"]`).first().text().trim();

    if (!name || !Number.isFinite(teamExternalId)) return;

    rows.push({
      name,
      teamExternalId,
      roleClassic,
      roleMantra,
      externalId,
      quotInitialClassic: parseItalianNumber(cell("c_qi")),
      quotCurrentClassic: parseItalianNumber(cell("c_qa")),
      fvmClassic: parseItalianNumber(cell("c_fvm")),
      quotInitialMantra: parseItalianNumber(cell("m_qi")),
      quotCurrentMantra: parseItalianNumber(cell("m_qa")),
      fvmMantra: parseItalianNumber(cell("m_fvm")),
    });
  });

  return rows;
}

export type ListoneRunResult = {
  ok: boolean;
  rowsSeen: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsSkippedOtherTeam: number;
};

/**
 * Fonte autoritativa per il roster corrente: crea il giocatore se non esiste,
 * e aggiorna sempre team/ruoli/quotazioni/FVM anche per i giocatori già creati
 * da altre fonti (es. dallo scraper statistiche) — a differenza di quest'ultimo,
 * il listone HA il diritto di correggere team_id/role_* perché rappresenta il
 * roster ufficiale della stagione in corso.
 */
export async function run(opts: { force?: boolean } = {}): Promise<ListoneRunResult> {
  const runId = await startRun("listone", URL);

  try {
    const { html } = await fetch(opts);
    const rows = parseHtml(html);

    if (rows.length < MIN_EXPECTED_ROWS) {
      await finishRunError(
        runId,
        `Solo ${rows.length} righe trovate (attese >= ${MIN_EXPECTED_ROWS}): probabile cambio di struttura della pagina, dati non toccati.`,
      );
      return { ok: false, rowsSeen: rows.length, rowsInserted: 0, rowsUpdated: 0, rowsSkippedOtherTeam: 0 };
    }

    type ResolvedAction =
      | { kind: "write"; playerId: number; created: boolean; teamId: number; row: ParsedListingRow }
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
      actions.push({ kind: "write", playerId, created, teamId: team.id, row });
    }

    const now = nowIso();
    const seenPlayerIds = new Set<number>();
    const counters = runWriteTransaction((tx) => {
      let inserted = 0;
      let updated = 0;
      let skipped = 0;

      for (const action of actions) {
        if (action.kind === "skip_other_team") {
          skipped++;
          continue;
        }
        seenPlayerIds.add(action.playerId);

        tx
          .update(players)
          .set({
            teamId: action.teamId,
            roleClassic: action.row.roleClassic || null,
            rolesMantra: action.row.roleMantra,
            quotInitialClassic: action.row.quotInitialClassic,
            quotCurrentClassic: action.row.quotCurrentClassic,
            fvmClassic: action.row.fvmClassic,
            quotInitialMantra: action.row.quotInitialMantra,
            quotCurrentMantra: action.row.quotCurrentMantra,
            fvmMantra: action.row.fvmMantra,
            isActive: 1,
            updatedAt: now,
          })
          .where(eq(players.id, action.playerId))
          .run();

        if (action.created) inserted++;
        else updated++;
      }

      // Giocatori non più nel listone (fine prestito, svincolo, ecc.): soft-delete,
      // mai cancellati fisicamente per non rompere le FK su auction_picks/stats.
      const ids = [...seenPlayerIds];
      if (ids.length > 0) {
        tx
          .update(players)
          .set({ isActive: 0, updatedAt: now })
          .where(and(eq(players.isActive, 1), notInArray(players.id, ids)))
          .run();
      }

      return { rowsInserted: inserted, rowsUpdated: updated, rowsUnmatched: skipped };
    });

    await finishRunOk(
      runId,
      counters,
      `${rows.length} righe lette, ${counters.rowsInserted} giocatori creati, ${counters.rowsUpdated} aggiornati, ${counters.rowsUnmatched} ignorati (squadra non riconosciuta).`,
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
