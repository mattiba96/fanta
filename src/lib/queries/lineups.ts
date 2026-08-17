import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { lineupPlayers, teamLineups, fixtures, teams } from "@/db/schema";

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
    .orderBy(desc(fixtures.matchday))
    .limit(1);
  return row?.matchday ?? null;
}

export async function getMatchdayLineups(matchday: number): Promise<MatchLineup[]> {
  const fixtureRows = await db
    .select()
    .from(fixtures)
    .where(eq(fixtures.matchday, matchday));

  const result: MatchLineup[] = [];
  for (const fx of fixtureRows) {
    const [homeTeam] = await db.select().from(teams).where(eq(teams.id, fx.homeTeamId)).limit(1);
    const [awayTeam] = await db.select().from(teams).where(eq(teams.id, fx.awayTeamId)).limit(1);
    if (!homeTeam || !awayTeam) continue;

    const teamLineupRows = await db
      .select()
      .from(teamLineups)
      .where(eq(teamLineups.fixtureId, fx.id));
    const homeLineup = teamLineupRows.find((l) => l.teamId === fx.homeTeamId) ?? null;
    const awayLineup = teamLineupRows.find((l) => l.teamId === fx.awayTeamId) ?? null;

    const playersFor = async (lineupId: number | undefined) =>
      lineupId
        ? db
            .select({
              playerId: lineupPlayers.playerId,
              rawName: lineupPlayers.rawName,
              status: lineupPlayers.status,
              probability: lineupPlayers.probability,
              note: lineupPlayers.note,
            })
            .from(lineupPlayers)
            .where(eq(lineupPlayers.teamLineupId, lineupId))
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
        players: await playersFor(homeLineup?.id),
      },
      away: {
        teamCode: awayTeam.code,
        teamName: awayTeam.name,
        formation: awayLineup?.formation ?? null,
        players: await playersFor(awayLineup?.id),
      },
    });
  }

  return result;
}

export type PlayerLineupStatus = {
  matchday: number;
  status: string;
  probability: number | null;
  note: string | null;
  opponentName: string;
  isHome: boolean;
};

/** Tutte le righe (titolare/panchina/infortunato/...) per un giocatore
 * nell'ultima giornata scaricata — un giocatore può comparire più volte
 * (es. titolare in un giro precedente e infortunato ora): la più recente vince. */
export async function getPlayerLineupStatus(
  playerId: number,
): Promise<PlayerLineupStatus[]> {
  const rows = await db
    .select({
      matchday: fixtures.matchday,
      status: lineupPlayers.status,
      probability: lineupPlayers.probability,
      note: lineupPlayers.note,
      homeTeamId: fixtures.homeTeamId,
      awayTeamId: fixtures.awayTeamId,
      lineupTeamId: teamLineups.teamId,
    })
    .from(lineupPlayers)
    .innerJoin(teamLineups, eq(teamLineups.id, lineupPlayers.teamLineupId))
    .innerJoin(fixtures, eq(fixtures.id, teamLineups.fixtureId))
    .where(eq(lineupPlayers.playerId, playerId))
    .orderBy(desc(fixtures.matchday));

  if (rows.length === 0) return [];

  const opponentIds = rows.map((r) =>
    r.lineupTeamId === r.homeTeamId ? r.awayTeamId : r.homeTeamId,
  );
  const opponents = await db.select().from(teams);
  const opponentById = new Map(opponents.map((t) => [t.id, t.name]));

  return rows.map((r, i) => ({
    matchday: r.matchday,
    status: r.status,
    probability: r.probability,
    note: r.note,
    opponentName: opponentById.get(opponentIds[i]) ?? "?",
    isHome: r.lineupTeamId === r.homeTeamId,
  }));
}
