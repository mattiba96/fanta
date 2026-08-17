import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { watchlist, players, teams, auctionPicks, leagueParticipants } from "@/db/schema";

export type WatchlistEntry = {
  playerId: number;
  name: string;
  slug: string;
  teamCode: string;
  roleClassic: string | null;
  quotCurrentClassic: number | null;
  targetPrice: number | null;
  priority: number | null;
  note: string | null;
  isAvailable: boolean;
  ownedByName: string | null;
};

export async function getWatchlist(): Promise<WatchlistEntry[]> {
  const rows = await db
    .select({
      playerId: watchlist.playerId,
      name: players.name,
      slug: players.slug,
      teamCode: teams.code,
      roleClassic: players.roleClassic,
      quotCurrentClassic: players.quotCurrentClassic,
      targetPrice: watchlist.targetPrice,
      priority: watchlist.priority,
      note: watchlist.note,
      ownedByParticipantId: auctionPicks.participantId,
      ownedByName: leagueParticipants.name,
    })
    .from(watchlist)
    .innerJoin(players, eq(players.id, watchlist.playerId))
    .innerJoin(teams, eq(teams.id, players.teamId))
    .leftJoin(auctionPicks, eq(auctionPicks.playerId, watchlist.playerId))
    .leftJoin(leagueParticipants, eq(leagueParticipants.id, auctionPicks.participantId))
    .orderBy(asc(watchlist.priority));

  return rows.map((r) => ({ ...r, isAvailable: r.ownedByParticipantId == null }));
}

export async function getWatchlistedPlayerIds(): Promise<Set<number>> {
  const rows = await db.select({ playerId: watchlist.playerId }).from(watchlist);
  return new Set(rows.map((r) => r.playerId));
}

export type WatchlistMapEntry = { targetPrice: number | null; priority: number | null };

export async function getWatchlistMap(): Promise<Map<number, WatchlistMapEntry>> {
  const rows = await db
    .select({
      playerId: watchlist.playerId,
      targetPrice: watchlist.targetPrice,
      priority: watchlist.priority,
    })
    .from(watchlist);
  return new Map(rows.map((r) => [r.playerId, { targetPrice: r.targetPrice, priority: r.priority }]));
}

export async function getWatchlistEntryForPlayer(playerId: number) {
  const [row] = await db.select().from(watchlist).where(eq(watchlist.playerId, playerId)).limit(1);
  return row ?? null;
}
