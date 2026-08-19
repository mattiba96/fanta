import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { lineupPlayers, teamLineups, fixtures, teams } from "@/db/schema";

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
