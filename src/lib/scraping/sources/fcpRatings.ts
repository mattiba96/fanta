import * as cheerio from "cheerio";
import { eq } from "drizzle-orm";
import { fetchHtml, readCachedHtml } from "../http";
import { resolveTeamByName, matchPlayer, nowIso } from "../normalize";
import { startRun, finishRunOk, finishRunError, runWriteTransaction } from "../pipeline";
import { fcpRatings, unmatchedNames } from "@/db/schema";
import { db } from "@/db/client";

const BASE = "https://www.fantacalciopedia.com/lista-calciatori-serie-a";
const ROLE_PATHS = ["portieri", "difensori", "centrocampisti", "attaccanti"];
const MIN_EXPECTED_ROWS = 300; // guard-rail: le 4 pagine insieme coprono ~500-600 giocatori
const COMMENT_MAX_AGE_DAYS = 30; // il commento cambia raramente, non serve ri-fetchare ad ogni visita

export type ParsedRating = {
  rawName: string;
  teamName: string;
  fcpUrl: string;
  algScore: number | null;
  trend: number | null;
  tags: string[];
};

async function fetchRolePage(rolePath: string, opts: { force?: boolean }) {
  return fetchHtml(`${BASE}/${rolePath}/`, {
    cacheKey: `fcp-list-${rolePath}`,
    force: opts.force,
    maxAgeMinutes: 1440,
  });
}

/** Funzione pura: HTML di una pagina-elenco -> righe tipizzate. */
export function parseListHtml(html: string): ParsedRating[] {
  const $ = cheerio.load(html);
  const rows: ParsedRating[] = [];

  $(".col_full.giocatore").each((_, el) => {
    const $card = $(el);
    const nameEl = $card.find("h3.tit_calc").first();
    const rawName = nameEl.text().trim();
    if (!rawName) return;

    const fcpUrl = nameEl.closest("a").attr("href") ?? "";
    const teamName = $card.find("p").first().find("small").first().text().trim();
    const algScoreText = $card.find(".punt_calc").first().text().trim();
    const algScore = algScoreText ? parseInt(algScoreText, 10) : null;

    let trend: number | null = null;
    $card.find(".stats_calc").each((_, s) => {
      const t = $(s).text();
      if (t.includes("%")) {
        const m = t.match(/(-?\d+(?:[.,]\d+)?)/);
        if (m) trend = Number(m[1].replace(",", "."));
      }
    });

    const tags: string[] = [];
    $card.find(".tag_calc img").each((_, img) => {
      const title = $(img).attr("title")?.trim();
      if (title) tags.push(title);
    });

    if (!teamName || !fcpUrl) return;
    rows.push({ rawName, teamName, fcpUrl, algScore, trend, tags });
  });

  return rows;
}

export type FcpRatingsRunResult = {
  ok: boolean;
  rowsSeen: number;
  rowsInserted: number;
  rowsUnmatched: number;
};

/**
 * Fonte "di riferimento": un nome non riconosciuto va loggato, mai creato un
 * nuovo giocatore. Copre solo indice/tag dalle 4 pagine-elenco (poche
 * richieste): il commento testuale e i punteggi extra vivono nella pagina
 * individuale di ogni giocatore e vengono presi al volo solo quando la sua
 * scheda viene aperta (vedi getOrFetchComment), non qui.
 */
export async function run(opts: { force?: boolean } = {}): Promise<FcpRatingsRunResult> {
  const runId = await startRun("fcp_ratings", BASE);

  try {
    const allRows: ParsedRating[] = [];
    for (const rolePath of ROLE_PATHS) {
      const { html } = await fetchRolePage(rolePath, opts);
      allRows.push(...parseListHtml(html));
    }

    if (allRows.length < MIN_EXPECTED_ROWS) {
      await finishRunError(
        runId,
        `Solo ${allRows.length} righe trovate (attese >= ${MIN_EXPECTED_ROWS}): probabile cambio di struttura del sito, dati non toccati.`,
      );
      return { ok: false, rowsSeen: allRows.length, rowsInserted: 0, rowsUnmatched: 0 };
    }

    type ResolvedAction =
      | { kind: "write"; playerId: number; created: boolean; row: ParsedRating }
      | { kind: "unmatched"; row: ParsedRating; teamId: number }
      | { kind: "skip_no_team" };

    const actions: ResolvedAction[] = [];
    for (const row of allRows) {
      const team = await resolveTeamByName(row.teamName);
      if (!team) {
        actions.push({ kind: "skip_no_team" });
        continue;
      }
      const match = await matchPlayer({ rawName: row.rawName, teamId: team.id });
      if (match.playerId) {
        actions.push({ kind: "write", playerId: match.playerId, created: false, row });
      } else {
        actions.push({ kind: "unmatched", row, teamId: team.id });
      }
    }

    const now = nowIso();
    const counters = runWriteTransaction((tx) => {
      let inserted = 0;
      let unmatched = 0;

      tx.delete(unmatchedNames).where(eq(unmatchedNames.source, "fcp_ratings")).run();

      for (const action of actions) {
        if (action.kind === "skip_no_team") continue;

        if (action.kind === "unmatched") {
          unmatched++;
          tx
            .insert(unmatchedNames)
            .values({
              source: "fcp_ratings",
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
          continue;
        }

        tx
          .insert(fcpRatings)
          .values({
            playerId: action.playerId,
            rawName: action.row.rawName,
            fcpUrl: action.row.fcpUrl,
            algScore: action.row.algScore,
            trend: action.row.trend,
            tags: action.row.tags.join(";"),
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: fcpRatings.playerId,
            set: {
              rawName: action.row.rawName,
              fcpUrl: action.row.fcpUrl,
              algScore: action.row.algScore,
              trend: action.row.trend,
              tags: action.row.tags.join(";"),
              updatedAt: now,
            },
          })
          .run();
        inserted++;
      }

      return { rowsInserted: inserted, rowsUpdated: 0, rowsUnmatched: unmatched };
    });

    await finishRunOk(
      runId,
      counters,
      `${allRows.length} righe lette, ${counters.rowsInserted} abbinate, ${counters.rowsUnmatched} non riconosciute.`,
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

export type PlayerComment = {
  appealScore: number | null;
  injuryResistance: number | null;
  investmentSolidity: number | null;
  comment: string | null;
  predictedAppearances: [number, number] | null;
  predictedGoals: [number, number] | null;
  predictedAssists: [number, number] | null;
};

function extractRange(text: string, label: string): [number, number] | null {
  const m = text.match(new RegExp(`${label}\\s*:?\\s*(\\d+)\\s*/\\s*(\\d+)`, "i"));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function parseIndividualPage(html: string): PlayerComment {
  const $ = cheerio.load(html);

  let appealScore: number | null = null;
  let injuryResistance: number | null = null;
  let investmentSolidity: number | null = null;

  $("ul.skills li[data-percent]").each((_, li) => {
    const $li = $(li);
    const label = $li.find("span").first().text().trim().toLowerCase();
    const pct = Number($li.attr("data-percent"));
    if (!Number.isFinite(pct)) return;
    if (label.includes("punteggio fantacalciopedia")) appealScore = pct;
    else if (label.includes("resistenza infortuni")) injuryResistance = pct;
    else if (label.includes("solidità fantainvestimento") || label.includes("solidita fantainvestimento"))
      investmentSolidity = pct;
  });

  // "SCHEDA FANTACALCIO" è la descrizione stabile di ruolo/stile di gioco:
  // molto più utile fantacalcisticamente del box "Consigli asta {mese anno}"
  // più recente, che spesso è solo cronaca di calciomercato (valore cartellino).
  let comment: string | null = null;
  $("#descr")
    .next(".mc_hookEvolution")
    .find("p")
    .each((_, p) => {
      const $p = $(p);
      const label = $p.find("strong").first().text();
      if (/scheda fantacalcio/i.test(label)) {
        comment = $p.text().replace(label, "").replace(/^[:\s]+/, "").trim();
      }
    });

  // Box "Riepilogo previsionali": testo semplice con <strong>Label:</strong> valore,
  // non paragrafi — prendiamo il testo dell'intero contenitore e leggiamo i range.
  const riepilogoHeading = $("h2.panel-title").filter((_, h) =>
    /riepilogo previsionali/i.test($(h).text()),
  );
  const riepilogoText = riepilogoHeading.closest(".topmargin.font18").text();

  return {
    appealScore,
    injuryResistance,
    investmentSolidity,
    comment,
    predictedAppearances: extractRange(riepilogoText, "Presenze previste"),
    predictedGoals: extractRange(riepilogoText, "Gol previsti"),
    predictedAssists: extractRange(riepilogoText, "Assist previsti"),
  };
}

/**
 * Fetch pigro: chiamata dalla scheda giocatore, non da un job in blocco.
 * Se il commento è già in cache (e non troppo vecchio) lo restituisce subito
 * senza rete; altrimenti scarica la pagina individuale del giocatore su
 * fantacalciopedia.com (unica volta ogni ~30 giorni per giocatore) e salva.
 * Non lancia mai: un fallimento di rete ritorna i dati che c'erano (o null),
 * la scheda giocatore non deve rompersi per questo.
 */
type FcpRatingRow = typeof fcpRatings.$inferSelect;

function rowToComment(row: FcpRatingRow): PlayerComment {
  const range = (min: number | null, max: number | null): [number, number] | null =>
    min != null && max != null ? [min, max] : null;
  return {
    appealScore: row.appealScore,
    injuryResistance: row.injuryResistance,
    investmentSolidity: row.investmentSolidity,
    comment: row.comment,
    predictedAppearances: range(row.predictedAppearancesMin, row.predictedAppearancesMax),
    predictedGoals: range(row.predictedGoalsMin, row.predictedGoalsMax),
    predictedAssists: range(row.predictedAssistsMin, row.predictedAssistsMax),
  };
}

function commentToUpdateValues(parsed: PlayerComment) {
  return {
    appealScore: parsed.appealScore,
    injuryResistance: parsed.injuryResistance,
    investmentSolidity: parsed.investmentSolidity,
    comment: parsed.comment,
    predictedAppearancesMin: parsed.predictedAppearances?.[0] ?? null,
    predictedAppearancesMax: parsed.predictedAppearances?.[1] ?? null,
    predictedGoalsMin: parsed.predictedGoals?.[0] ?? null,
    predictedGoalsMax: parsed.predictedGoals?.[1] ?? null,
    predictedAssistsMin: parsed.predictedAssists?.[0] ?? null,
    predictedAssistsMax: parsed.predictedAssists?.[1] ?? null,
  };
}

export type CommentsRunResult = {
  ok: boolean;
  playersSeen: number;
  playersUpdated: number;
  playersFailed: number;
};

/**
 * Backfill in blocco dei commenti individuali. A differenza di getOrFetchComment
 * (fetch al volo durante il rendering di una scheda, un solo tentativo e timeout
 * corto per non bloccare la pagina), qui gira come job in background: si può
 * permettere i retry pazienti di default di fetchHtml, ed è il modo giusto per
 * recuperare i giocatori il cui tentativo lazy è fallito (commentUpdatedAt mai
 * impostato) per via dei blocchi/reset di connessione intermittenti che
 * fantacalciopedia.com applica a chi fa troppe richieste ravvicinate.
 */
export async function runComments(opts: { force?: boolean } = {}): Promise<CommentsRunResult> {
  const rows = await db.select().from(fcpRatings);
  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.fcpUrl) continue;
    if (!opts.force && row.commentUpdatedAt) {
      const ageDays = (Date.now() - new Date(row.commentUpdatedAt).getTime()) / 86_400_000;
      if (ageDays < COMMENT_MAX_AGE_DAYS) continue;
    }
    try {
      const { html } = await fetchHtml(row.fcpUrl, {
        cacheKey: `fcp-player-${row.playerId}`,
        maxAgeMinutes: COMMENT_MAX_AGE_DAYS * 1440,
        force: opts.force,
      });
      const parsed = parseIndividualPage(html);
      await db
        .update(fcpRatings)
        .set({ ...commentToUpdateValues(parsed), commentUpdatedAt: nowIso() })
        .where(eq(fcpRatings.playerId, row.playerId));
      updated++;
    } catch {
      failed++;
    }
  }

  return { ok: true, playersSeen: rows.length, playersUpdated: updated, playersFailed: failed };
}

export async function getOrFetchComment(playerId: number): Promise<PlayerComment | null> {
  const [existing] = await db.select().from(fcpRatings).where(eq(fcpRatings.playerId, playerId)).limit(1);
  if (!existing?.fcpUrl) return null;

  if (existing.commentUpdatedAt) {
    const ageDays = (Date.now() - new Date(existing.commentUpdatedAt).getTime()) / 86_400_000;
    if (ageDays < COMMENT_MAX_AGE_DAYS) {
      return rowToComment(existing);
    }
  }

  try {
    const cacheKey = `fcp-player-${playerId}`;
    // Fetch al volo dentro il rendering della scheda giocatore: timeout corto e
    // nessun retry, altrimenti un sito lento blocca la pagina per decine di
    // secondi (i valori pazienti di fetchHtml sono pensati per gli scraper in
    // blocco, dove nessuno aspetta col caricamento fermo).
    const { html } = await fetchHtml(existing.fcpUrl, {
      cacheKey,
      maxAgeMinutes: COMMENT_MAX_AGE_DAYS * 1440,
      maxAttempts: 1,
      timeoutMs: 4000,
    });
    const parsed = parseIndividualPage(html);

    await db
      .update(fcpRatings)
      .set({ ...commentToUpdateValues(parsed), commentUpdatedAt: nowIso() })
      .where(eq(fcpRatings.playerId, playerId));

    return parsed;
  } catch {
    // Rete assente/pagina cambiata: non rompere la scheda, usa la cache locale se esiste.
    const cached = readCachedHtml(`fcp-player-${playerId}`);
    if (cached) {
      try {
        return parseIndividualPage(cached);
      } catch {
        return null;
      }
    }
    return existing.comment ? rowToComment(existing) : null;
  }
}
