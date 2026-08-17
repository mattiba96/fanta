import * as cheerio from "cheerio";
import { eq, and } from "drizzle-orm";
import { fetchHtml } from "../http";
import { resolveTeamByName, matchPlayer, nowIso } from "../normalize";
import { startRun, finishRunOk, finishRunError, runWriteTransaction } from "../pipeline";
import { setPieceRoles, unmatchedNames } from "@/db/schema";

const URL =
  "https://www.fantacalciopedia.com/articoli-fcp/consigli-fantacalcio/216-rigoristi-e-tiratori-2026-27.html";
const SEASON = "2026-27";
const MIN_EXPECTED_ROWS = 100; // guard-rail: 20 squadre x ~3 categorie x 2+ nomi

export type SetPieceKind = "penalty" | "free_kick" | "corner";

export type ParsedSetPieceRow = {
  teamName: string;
  kind: SetPieceKind;
  priority: number; // 1 = primo, 2 = alternativa...
  rawName: string;
};

const KIND_PATTERNS: { match: RegExp; kind: SetPieceKind }[] = [
  { match: /rigorist/i, kind: "penalty" },
  { match: /punizion/i, kind: "free_kick" },
  { match: /angolo/i, kind: "corner" },
];

export async function fetch(opts: { force?: boolean } = {}) {
  return fetchHtml(URL, { cacheKey: "set-piece-roles", force: opts.force, maxAgeMinutes: 1440 });
}

/**
 * Funzione pura: HTML -> righe tipizzate. Zero I/O, zero DB.
 * Il contenuto è un H2 "Tiratori {Squadra} {stagione}" per squadra, seguito
 * da un <ul> con 3 <li> etichettati (rigoristi/punizioni/corner), nomi in
 * ordine di priorità separati da virgola.
 */
export function parseHtml(html: string): ParsedSetPieceRow[] {
  const $ = cheerio.load(html);
  const rows: ParsedSetPieceRow[] = [];

  $("h2").each((_, el) => {
    const heading = $(el).text().trim();
    const m = heading.match(/^Tiratori\s+(.+?)\s+\d{4}\/\d{2}$/);
    if (!m) return;
    const teamName = m[1].trim();

    const list = $(el).next("ul");
    if (list.length === 0) return;

    list.find("li").each((_, li) => {
      const $li = $(li);
      const label = $li.find("strong").first().text();
      const kindEntry = KIND_PATTERNS.find((k) => k.match.test(label));
      if (!kindEntry) return;

      const fullText = $li.text();
      const namesPart = fullText
        .slice(label.length)
        .replace(/^[:\s]+/, "")
        .replace(/\.\s*$/, "");
      const names = namesPart
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean);

      names.forEach((rawName, idx) => {
        rows.push({ teamName, kind: kindEntry.kind, priority: idx + 1, rawName });
      });
    });
  });

  return rows;
}

export type SetPieceRunResult = {
  ok: boolean;
  rowsSeen: number;
  rowsInserted: number;
  rowsUnmatched: number;
};

/**
 * Fonte "di riferimento", non di roster: se un nome non è riconosciuto va
 * loggato in unmatched_names, MAI creato un nuovo giocatore (a differenza di
 * listone/statistiche). Snapshot completo ad ogni run: si cancellano le righe
 * della stagione corrente e si reinseriscono, così le priorità che cambiano
 * (un giocatore sale/scende in gerarchia) sono sempre coerenti.
 */
export async function run(opts: { force?: boolean } = {}): Promise<SetPieceRunResult> {
  const runId = await startRun("set_piece_roles", URL);

  try {
    const { html } = await fetch(opts);
    const rows = parseHtml(html);

    if (rows.length < MIN_EXPECTED_ROWS) {
      await finishRunError(
        runId,
        `Solo ${rows.length} righe trovate (attese >= ${MIN_EXPECTED_ROWS}): probabile cambio di struttura della pagina, dati non toccati.`,
      );
      return { ok: false, rowsSeen: rows.length, rowsInserted: 0, rowsUnmatched: 0 };
    }

    type ResolvedAction =
      | { kind: "insert"; teamId: number; row: ParsedSetPieceRow; playerId: number | null }
      | { kind: "skip_no_team" };

    const actions: ResolvedAction[] = [];
    for (const row of rows) {
      const team = await resolveTeamByName(row.teamName);
      if (!team) {
        actions.push({ kind: "skip_no_team" });
        continue;
      }
      const match = await matchPlayer({ rawName: row.rawName, teamId: team.id });
      actions.push({ kind: "insert", teamId: team.id, row, playerId: match.playerId });
    }

    const now = nowIso();
    const counters = runWriteTransaction((tx) => {
      let inserted = 0;
      let unmatched = 0;
      let skipped = 0;

      tx.delete(setPieceRoles).where(eq(setPieceRoles.season, SEASON)).run();
      // Ripulisce anche i "non riconosciuti" della fonte: altrimenti un nome
      // risolto grazie a un alias o a un matching migliorato resterebbe per
      // sempre nella lista come falso residuo.
      tx.delete(unmatchedNames).where(eq(unmatchedNames.source, "set_piece_roles")).run();

      for (const action of actions) {
        if (action.kind === "skip_no_team") {
          skipped++;
          continue;
        }

        tx
          .insert(setPieceRoles)
          .values({
            teamId: action.teamId,
            kind: action.row.kind,
            priority: action.row.priority,
            playerId: action.playerId,
            rawName: action.row.rawName,
            season: SEASON,
            sourceUrl: URL,
            updatedAt: now,
          })
          .run();
        inserted++;

        if (!action.playerId) {
          unmatched++;
          tx
            .insert(unmatchedNames)
            .values({
              source: "set_piece_roles",
              rawName: action.row.rawName,
              teamId: action.teamId,
              seenCount: 1,
              lastSeenAt: now,
            })
            .onConflictDoUpdate({
              target: [unmatchedNames.source, unmatchedNames.rawName, unmatchedNames.teamId],
              set: { lastSeenAt: now },
            })
            .run();
        }
      }

      return { rowsInserted: inserted, rowsUpdated: 0, rowsUnmatched: unmatched + skipped };
    });

    await finishRunOk(
      runId,
      counters,
      `${rows.length} righe lette, ${counters.rowsInserted} inserite, ${counters.rowsUnmatched} non abbinate/ignorate.`,
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
