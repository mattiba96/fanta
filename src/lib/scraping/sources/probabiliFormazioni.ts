import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import { eq } from "drizzle-orm";
import { fetchHtml } from "../http";
import { resolveTeamByName, matchPlayer, nowIso } from "../normalize";
import { startRun, finishRunOk, finishRunError, runWriteTransaction } from "../pipeline";
import { fixtures, teamLineups, lineupPlayers, unmatchedNames } from "@/db/schema";

const URL = "https://www.fantacalcio.it/probabili-formazioni-serie-a";
const SEASON = "2026-27";
const MIN_EXPECTED_MATCHES = 5; // guard-rail: una giornata piena ne ha 10

export type LineupStatus = "starter" | "bench" | "doubt" | "injured" | "suspended" | "warned";

export type ParsedLineupPlayer = {
  rawName: string;
  externalId: number | null;
  status: LineupStatus;
  probability: number | null;
  note: string | null;
  ballotGroup: string | null;
};

export type ParsedTeamLineup = {
  teamName: string;
  formation: string | null;
  players: ParsedLineupPlayer[];
};

export type ParsedMatch = {
  externalMatchId: number | null;
  matchday: number | null;
  kickoffAt: string | null;
  venue: string | null;
  home: ParsedTeamLineup;
  away: ParsedTeamLineup;
};

export async function fetch(opts: { force?: boolean } = {}) {
  return fetchHtml(URL, { cacheKey: "probabili-formazioni", force: opts.force, maxAgeMinutes: 180 });
}

function extractPlayerId(href: string | undefined): number | null {
  if (!href) return null;
  const m = href.match(/\/(\d+)(?:\/[\d-]+)?\/?$/);
  return m ? Number(m[1]) : null;
}

function parsePercent(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Sezioni extra (ballottaggi/squalificati/diffidati/infortunati/in dubbio):
 * ciascuna ha esattamente 2 div.content in sequenza, home poi away. */
function extractSectionEntries(
  $: CheerioAPI,
  contentDiv: Cheerio<import("domhandler").Element>,
  status: LineupStatus,
  ballotGroupPrefix?: string,
): ParsedLineupPlayer[] {
  if (contentDiv.find(".empty-list-message").length > 0) return [];

  const entries: ParsedLineupPlayer[] = [];
  contentDiv.find("li").each((liIndex, li) => {
    const $li = $(li);
    const link = $li.find("a.player-name").first();
    const rawName = link.find("span").first().text().trim();
    if (!rawName) return;
    const note = $li.find("p.description").first().text().trim() || null;

    entries.push({
      rawName,
      externalId: extractPlayerId(link.attr("href")),
      status,
      probability: null,
      note,
      ballotGroup: ballotGroupPrefix ? `${ballotGroupPrefix}-${liIndex}` : null,
    });
  });
  return entries;
}

function parsePlayerItems(
  $: CheerioAPI,
  list: Cheerio<import("domhandler").Element>,
  status: LineupStatus,
): ParsedLineupPlayer[] {
  const out: ParsedLineupPlayer[] = [];
  list.find("li.player-item").each((_, li) => {
    const $li = $(li);
    const link = $li.find("a.player-name").first();
    const rawName = link.find("span").first().text().trim();
    if (!rawName) return;
    out.push({
      rawName,
      externalId: extractPlayerId(link.attr("href")),
      status,
      probability: parsePercent($li.find(".progress-value").first().text()),
      note: null,
      ballotGroup: null,
    });
  });
  return out;
}

/**
 * Ogni squadra è rappresentata due volte nella pagina: una vista "campo"
 * (senza percentuali per i titolari) e una vista "lista" (`.card.team-card`,
 * con percentuale di titolarità su titolari E panchina, oltre a data-status).
 * Usiamo quest'ultima perché più ricca e affidabile.
 */
function parseTeamCard($: CheerioAPI, card: Cheerio<import("domhandler").Element>): {
  teamName: string;
  formation: string | null;
  starters: ParsedLineupPlayer[];
  bench: ParsedLineupPlayer[];
} {
  const teamName = card.find("h3.team-name").first().text().trim();
  const formation = card.find(".team-formation").first().text().trim() || null;
  const starters = parsePlayerItems($, card.find("ul.player-list.starters").first(), "starter");
  const bench = parsePlayerItems($, card.find("ul.player-list.reserves").first(), "bench");
  return { teamName, formation, starters, bench };
}

/**
 * Funzione pura: HTML -> partite tipizzate. Zero I/O, zero DB.
 */
export function parseHtml(html: string): ParsedMatch[] {
  const $ = cheerio.load(html);
  const matches: ParsedMatch[] = [];

  $("li.match.match-item").each((_, el) => {
    const $match = $(el);
    const externalMatchId = Number($match.attr("data-match-id")) || null;
    const matchday = parsePercent($match.find(".matchweek").first().text());

    const homeTeamName = $match
      .find('label[itemprop="homeTeam"] a.team-name')
      .first()
      .text()
      .trim();
    const awayTeamName = $match
      .find('label[itemprop="awayTeam"] a.team-name')
      .first()
      .text()
      .trim();
    if (!homeTeamName || !awayTeamName) return;

    const kickoffAt =
      $match.find('meta[itemprop="startDate"]').first().attr("content") ?? null;
    const venueRaw = $match.find(".match-location .stadium").first().text().trim();
    const venue = venueRaw && venueRaw !== "-" ? venueRaw : null;

    const cards = $match.find(".card.team-card");
    const cardByTeam = (teamName: string) =>
      cards.filter((_, c) => $(c).find("h3.team-name").first().text().trim() === teamName).first();
    const homeParsed = parseTeamCard($, cardByTeam(homeTeamName));
    const awayParsed = parseTeamCard($, cardByTeam(awayTeamName));

    // Sezioni extra: ogni sezione ha 2 div.content (home, away), in quest'ordine.
    const extraSections: { selector: string; status: LineupStatus; ballotPrefix?: string }[] = [
      { selector: "section.ballots", status: "doubt", ballotPrefix: `ballot-${externalMatchId}` },
      { selector: "section.suspendeds", status: "suspended" },
      { selector: "section.cautioneds", status: "warned" },
      { selector: "section.injureds", status: "injured" },
      { selector: "section.dubts", status: "doubt" },
    ];

    const homeExtra: ParsedLineupPlayer[] = [];
    const awayExtra: ParsedLineupPlayer[] = [];
    for (const { selector, status, ballotPrefix } of extraSections) {
      const contents = $match.find(selector).first().find("> .content");
      const homeContent = contents.eq(0);
      const awayContent = contents.eq(1);
      homeExtra.push(
        ...extractSectionEntries($, homeContent, status, ballotPrefix ? `${ballotPrefix}-h` : undefined),
      );
      awayExtra.push(
        ...extractSectionEntries($, awayContent, status, ballotPrefix ? `${ballotPrefix}-a` : undefined),
      );
    }

    matches.push({
      externalMatchId,
      matchday,
      kickoffAt,
      venue,
      home: {
        teamName: homeTeamName,
        formation: homeParsed.formation,
        players: [...homeParsed.starters, ...homeParsed.bench, ...homeExtra],
      },
      away: {
        teamName: awayTeamName,
        formation: awayParsed.formation,
        players: [...awayParsed.starters, ...awayParsed.bench, ...awayExtra],
      },
    });
  });

  return matches;
}

export type ProbabiliRunResult = {
  ok: boolean;
  matchesSeen: number;
  playersInserted: number;
  playersUnmatched: number;
};

/**
 * Fonte "di riferimento": un nome non riconosciuto va loggato, mai creato un
 * nuovo giocatore. Ogni squadra della partita viene sostituita per intero
 * (delete + insert di lineup_players) ad ogni run: è uno snapshot dello stato
 * attuale, non uno storico incrementale.
 */
export async function run(opts: { force?: boolean } = {}): Promise<ProbabiliRunResult> {
  const runId = await startRun("probabili", URL);

  try {
    const { html } = await fetch(opts);
    const parsedMatches = parseHtml(html);

    if (parsedMatches.length < MIN_EXPECTED_MATCHES) {
      await finishRunError(
        runId,
        `Solo ${parsedMatches.length} partite trovate (attese >= ${MIN_EXPECTED_MATCHES}): probabile cambio di struttura della pagina, dati non toccati.`,
      );
      return { ok: false, matchesSeen: parsedMatches.length, playersInserted: 0, playersUnmatched: 0 };
    }

    type ResolvedTeamLineup = {
      teamId: number;
      formation: string | null;
      players: { row: ParsedLineupPlayer; playerId: number | null }[];
    };
    type ResolvedMatch = {
      matchday: number;
      homeTeamId: number;
      awayTeamId: number;
      kickoffAt: string | null;
      venue: string | null;
      home: ResolvedTeamLineup;
      away: ResolvedTeamLineup;
    };

    const resolved: ResolvedMatch[] = [];
    for (const m of parsedMatches) {
      const homeTeam = await resolveTeamByName(m.home.teamName);
      const awayTeam = await resolveTeamByName(m.away.teamName);
      if (!homeTeam || !awayTeam || m.matchday == null) continue;

      const resolveTeamPlayers = async (
        team: ParsedTeamLineup,
        teamId: number,
      ): Promise<ResolvedTeamLineup> => {
        const players: ResolvedTeamLineup["players"] = [];
        for (const row of team.players) {
          const match = await matchPlayer({
            rawName: row.rawName,
            teamId,
            externalId: row.externalId,
          });
          players.push({ row, playerId: match.playerId });
        }
        return { teamId, formation: team.formation, players };
      };

      resolved.push({
        matchday: m.matchday,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        kickoffAt: m.kickoffAt,
        venue: m.venue,
        home: await resolveTeamPlayers(m.home, homeTeam.id),
        away: await resolveTeamPlayers(m.away, awayTeam.id),
      });
    }

    const now = nowIso();
    const counters = runWriteTransaction((tx) => {
      let inserted = 0;
      let unmatched = 0;

      tx.delete(unmatchedNames).where(eq(unmatchedNames.source, "probabili")).run();

      for (const match of resolved) {
        const [fixtureRow] = tx
          .insert(fixtures)
          .values({
            season: SEASON,
            matchday: match.matchday,
            homeTeamId: match.homeTeamId,
            awayTeamId: match.awayTeamId,
            kickoffAt: match.kickoffAt,
            venue: match.venue,
            sourceUrl: URL,
            fetchedAt: now,
          })
          .onConflictDoUpdate({
            target: [fixtures.season, fixtures.matchday, fixtures.homeTeamId, fixtures.awayTeamId],
            set: { kickoffAt: match.kickoffAt, venue: match.venue, fetchedAt: now },
          })
          .returning({ id: fixtures.id })
          .all();

        const fixtureId = fixtureRow.id;

        for (const teamLineup of [match.home, match.away]) {
          const [lineupRow] = tx
            .insert(teamLineups)
            .values({
              fixtureId,
              teamId: teamLineup.teamId,
              formation: teamLineup.formation,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [teamLineups.fixtureId, teamLineups.teamId],
              set: { formation: teamLineup.formation, updatedAt: now },
            })
            .returning({ id: teamLineups.id })
            .all();

          const teamLineupId = lineupRow.id;
          tx.delete(lineupPlayers).where(eq(lineupPlayers.teamLineupId, teamLineupId)).run();

          for (const { row, playerId } of teamLineup.players) {
            tx
              .insert(lineupPlayers)
              .values({
                teamLineupId,
                playerId,
                rawName: row.rawName,
                status: row.status,
                probability: row.probability,
                note: row.note,
                ballotGroup: row.ballotGroup,
              })
              .run();
            inserted++;

            if (!playerId) {
              unmatched++;
              tx
                .insert(unmatchedNames)
                .values({
                  source: "probabili",
                  rawName: row.rawName,
                  teamId: teamLineup.teamId,
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
        }
      }

      return { rowsInserted: inserted, rowsUpdated: 0, rowsUnmatched: unmatched };
    });

    await finishRunOk(
      runId,
      counters,
      `${resolved.length} partite, ${counters.rowsInserted} righe giocatori, ${counters.rowsUnmatched} non abbinate.`,
    );

    return {
      ok: true,
      matchesSeen: resolved.length,
      playersInserted: counters.rowsInserted,
      playersUnmatched: counters.rowsUnmatched,
    };
  } catch (err) {
    await finishRunError(runId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
