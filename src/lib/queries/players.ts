import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import {
  players,
  teams,
  playerSeasonStats,
  auctionPicks,
  leagueParticipants,
  historicalAuctionPrices,
  fcpRatings,
} from "@/db/schema";
import { getAdviceForAvailablePlayers } from "./advice";
import type { Advice } from "@/lib/advice/engine";
import { DEFAULT_STATS_SEASON, HISTORICAL_STATS_SEASONS } from "@/lib/seasons";

export { DEFAULT_STATS_SEASON, HISTORICAL_STATS_SEASONS };

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
  band: Advice["band"] | null;
  fcpTags: string[];
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
      fcpTags: fcpRatings.tags,
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
    .leftJoin(fcpRatings, eq(fcpRatings.playerId, players.id))
    .where(eq(players.isActive, 1));

  // La fascia (band) è un percentile relativo al gruppo di ruolo tra i
  // disponibili: va calcolata una volta sola su tutti i giocatori insieme
  // (stesso motore usato in "Consigli"/scheda giocatore), non per riga.
  const adviceByPlayer = await getAdviceForAvailablePlayers();

  return rows.map((r) => ({
    ...r,
    isAvailable: r.ownedByParticipantId == null,
    ownedByIsMe: r.ownedByIsMe === 1,
    band: adviceByPlayer.get(r.id)?.band ?? null,
    fcpTags: r.fcpTags ? r.fcpTags.split(";").filter(Boolean) : [],
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
  const statsHistory = [DEFAULT_STATS_SEASON, ...HISTORICAL_STATS_SEASONS]
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

  const priceHistory = await db
    .select({ seasonLabel: historicalAuctionPrices.seasonLabel, price: historicalAuctionPrices.price })
    .from(historicalAuctionPrices)
    .where(eq(historicalAuctionPrices.playerId, row.players.id));

  return {
    player: row.players,
    team: row.teams,
    stats,
    statsHistory,
    pick: pick ?? null,
    priceHistory,
  };
}
