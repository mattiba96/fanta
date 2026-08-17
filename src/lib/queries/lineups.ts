import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { fixtures, teamLineups, lineupPlayers, teams, players } from "@/db/schema";

export type LineupPlayerEntry = {
  playerId: number | null;
  rawName: string;
  status: string;
  probability: number | null;
  note: string | null;
};

export type MatchLineup = {
  fixtureId: number;
  matchday: number;
  kickoffAt: string | null;
  venue: string | null;
  home: { teamCode: string; teamName: string; formation: string | null; players: LineupPlayerEntry[] };
  away: { teamCode: string; teamName: string; formation: string | null; players: LineupPlayerEntry[] };
};

export async function getLatestMatchday(): Promise<number | null> {
  const [row] = await db
    .select({ matchday: fixtures.matchday })
    .from(fixtures)
    .orderBy(asc(fixtures.matchday))
    .limit(1);
  return row?.matchday ?? null;
}

export async function getMatchdayLineups(matchday: number): Promise<MatchLineup[]> {
  const fixtureRows = await db
    .select()
    .from(fixtures)
    .where(eq(fixtures.matchday, matchday))
    .orderBy(asc(fixtures.kickoffAt));

  const result: MatchLineup[] = [];
  for (const fx of fixtureRows) {
    const [homeTeam] = await db.select().from(teams).where(eq(teams.id, fx.homeTeamId)).limit(1);
    const [awayTeam] = await db.select().from(teams).where(eq(teams.id, fx.awayTeamId)).limit(1);
    if (!homeTeam || !awayTeam) continue;

    const homeLineups = await db
      .select()
      .from(teamLineups)
      .where(eq(teamLineups.fixtureId, fx.id));
    const homeLineup = homeLineups.find((l) => l.teamId === fx.homeTeamId) ?? null;
    const awayLineup = homeLineups.find((l) => l.teamId === fx.awayTeamId) ?? null;

    const homePlayers = homeLineup
      ? await db
          .select({
            playerId: lineupPlayers.playerId,
            rawName: lineupPlayers.rawName,
            status: lineupPlayers.status,
            probability: lineupPlayers.probability,
            note: lineupPlayers.note,
          })
          .from(lineupPlayers)
          .where(eq(lineupPlayers.teamLineupId, homeLineup.id))
      : [];
    const awayPlayers = awayLineup
      ? await db
          .select({
            playerId: lineupPlayers.playerId,
            rawName: lineupPlayers.rawName,
            status: lineupPlayers.status,
            probability: lineupPlayers.probability,
            note: lineupPlayers.note,
          })
          .from(lineupPlayers)
          .where(eq(lineupPlayers.teamLineupId, awayLineup.id))
      : [];

    result.push({
      fixtureId: fx.id,
      matchday: fx.matchday,
      kickoffAt: fx.kickoffAt,
      venue: fx.venue,
      home: {
        teamCode: homeTeam.code,
        teamName: homeTeam.name,
        formation: homeLineup?.formation ?? null,
        players: homePlayers,
      },
      away: {
        teamCode: awayTeam.code,
        teamName: awayTeam.name,
        formation: awayLineup?.formation ?? null,
        players: awayPlayers,
      },
    });
  }

  return result;
}

export async function getPlayerLineupStatus(playerId: number): Promise<LineupPlayerEntry[]> {
  return db
    .select({
      playerId: lineupPlayers.playerId,
      rawName: lineupPlayers.rawName,
      status: lineupPlayers.status,
      probability: lineupPlayers.probability,
      note: lineupPlayers.note,
    })
    .from(lineupPlayers)
    .where(eq(lineupPlayers.playerId, playerId));
}
