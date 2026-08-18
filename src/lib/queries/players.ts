import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { players, teams, playerSeasonStats, auctionPicks, leagueParticipants } from "@/db/schema";

// TODO(task #6 - gestione asta): leggere da auction_settings.statsSeason una volta
// che le impostazioni sono configurabili; per ora la stagione di riferimento per
// le statistiche pre-asta è fissa (l'unica stagione completa disponibile oggi).
export const DEFAULT_STATS_SEASON = "2025-26";
// Stagione aggiuntiva mostrata in scheda giocatore per dare un minimo di
// storico oltre all'ultima stagione completa (richiesta esplicita: "le
// statistiche di 2 anni di fantacalcio"). Non è la stagione di riferimento
// per l'advice engine, solo contesto in più.
export const SECONDARY_STATS_SEASON = "2024-25";

export type PlayerRow = {
  id: number;
  slug: string;
  externalId: string | null;
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
  ownedByParticipantId: number | null;
  ownedByName: string | null;
  ownedByIsMe: boolean;
  pricePaid: number | null;
};

export async function getAllPlayersFull(
  season = DEFAULT_STATS_SEASON,
): Promise<PlayerRow[]> {
  const rows = await db
    .select({
      id: players.id,
      slug: players.slug,
      externalId: players.externalId,
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
      pricePaid: auctionPicks.price,
      ownedByParticipantId: leagueParticipants.id,
      ownedByName: leagueParticipants.name,
      ownedByIsMe: leagueParticipants.isMe,
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
    .leftJoin(leagueParticipants, eq(leagueParticipants.id, auctionPicks.participantId))
    .where(eq(players.isActive, 1));

  return rows.map((r) => ({
    ...r,
    isAvailable: r.ownedByParticipantId == null,
    ownedByIsMe: r.ownedByIsMe === 1,
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

  const statsRows = await db
    .select()
    .from(playerSeasonStats)
    .where(eq(playerSeasonStats.playerId, row.players.id));
  const statsBySeason = new Map(statsRows.map((s) => [s.season, s]));
  const stats = statsBySeason.get(DEFAULT_STATS_SEASON) ?? null;
  const statsHistory = [DEFAULT_STATS_SEASON, SECONDARY_STATS_SEASON]
    .map((season) => statsBySeason.get(season))
    .filter((s): s is NonNullable<typeof s> => s != null);

  const [pick] = await db
    .select({
      id: auctionPicks.id,
      price: auctionPicks.price,
      participantId: auctionPicks.participantId,
      participantName: leagueParticipants.name,
      participantIsMe: leagueParticipants.isMe,
    })
    .from(auctionPicks)
    .innerJoin(leagueParticipants, eq(leagueParticipants.id, auctionPicks.participantId))
    .where(eq(auctionPicks.playerId, row.players.id))
    .limit(1);

  return {
    player: row.players,
    team: row.teams,
    stats,
    statsHistory,
    pick: pick ?? null,
  };
}
