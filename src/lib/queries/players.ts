import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { players, teams, playerSeasonStats, auctionPicks } from "@/db/schema";

// TODO(task #6 - gestione asta): leggere da auction_settings.statsSeason una volta
// che le impostazioni sono configurabili; per ora la stagione di riferimento per
// le statistiche pre-asta è fissa (l'unica stagione completa disponibile oggi).
export const DEFAULT_STATS_SEASON = "2025-26";

export type PlayerRow = {
  id: number;
  slug: string;
  name: string;
  teamCode: string;
  teamName: string;
  roleClassic: string | null;
  rolesMantra: string | null;
  quotCurrentClassic: number | null;
  fvmClassic: number | null;
  quotCurrentMantra: number | null;
  fvmMantra: number | null;
  pv: number | null;
  mv: number | null;
  fm: number | null;
  goals: number | null;
  assists: number | null;
  isAvailable: boolean;
  ownedBy: "me" | "other" | null;
  pricePaid: number | null;
};

export async function getAllPlayersFull(
  season = DEFAULT_STATS_SEASON,
): Promise<PlayerRow[]> {
  const rows = await db
    .select({
      id: players.id,
      slug: players.slug,
      name: players.name,
      teamCode: teams.code,
      teamName: teams.name,
      roleClassic: players.roleClassic,
      rolesMantra: players.rolesMantra,
      quotCurrentClassic: players.quotCurrentClassic,
      fvmClassic: players.fvmClassic,
      quotCurrentMantra: players.quotCurrentMantra,
      fvmMantra: players.fvmMantra,
      pv: playerSeasonStats.pv,
      mv: playerSeasonStats.mv,
      fm: playerSeasonStats.fm,
      goals: playerSeasonStats.goals,
      assists: playerSeasonStats.assists,
      owner: auctionPicks.owner,
      pricePaid: auctionPicks.price,
    })
    .from(players)
    .innerJoin(teams, eq(teams.id, players.teamId))
    .leftJoin(
      playerSeasonStats,
      and(
        eq(playerSeasonStats.playerId, players.id),
        eq(playerSeasonStats.season, season),
      ),
    )
    .leftJoin(auctionPicks, eq(auctionPicks.playerId, players.id))
    .where(eq(players.isActive, 1));

  return rows.map((r) => ({
    ...r,
    isAvailable: r.owner == null,
    ownedBy: (r.owner as "me" | "other" | null) ?? null,
  }));
}

export async function getPlayerBySlug(slug: string) {
  const [row] = await db
    .select()
    .from(players)
    .innerJoin(teams, eq(teams.id, players.teamId))
    .where(and(eq(players.slug, slug), eq(players.isActive, 1)))
    .limit(1);
  if (!row) return null;

  const [stats] = await db
    .select()
    .from(playerSeasonStats)
    .where(
      and(
        eq(playerSeasonStats.playerId, row.players.id),
        eq(playerSeasonStats.season, DEFAULT_STATS_SEASON),
      ),
    )
    .limit(1);

  const [pick] = await db
    .select()
    .from(auctionPicks)
    .where(eq(auctionPicks.playerId, row.players.id))
    .limit(1);

  return { player: row.players, team: row.teams, stats: stats ?? null, pick: pick ?? null };
}
