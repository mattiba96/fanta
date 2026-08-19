"use server";

import { and, eq, isNull, like, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { players, teams, auctionPicks, leagueParticipants, historicalAuctionPrices } from "@/db/schema";
import { getAdviceForAvailablePlayers } from "@/lib/queries/advice";
import { bandLabel, type Role } from "@/lib/advice/engine";

export type PlayerSearchResult = {
  id: number;
  slug: string;
  name: string;
  teamCode: string;
  roleClassic: string | null;
  quotCurrentClassic: number | null;
  isAvailable: boolean;
  ownedByName: string | null;
  ownedByIsMe: boolean;
  pricePaid: number | null;
};

/**
 * Ricerca leggera per la console live durante l'asta: chiamata a ogni
 * digitazione (con debounce lato client), quindi tiene il payload minimo
 * invece di spedire l'intero listone come fa la dashboard.
 */
export async function searchPlayersForAuction(query: string): Promise<PlayerSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const rows = await db
    .select({
      id: players.id,
      slug: players.slug,
      name: players.name,
      teamCode: teams.code,
      roleClassic: players.roleClassic,
      quotCurrentClassic: players.quotCurrentClassic,
      pricePaid: auctionPicks.price,
      ownedByParticipantId: leagueParticipants.id,
      ownedByName: leagueParticipants.name,
      ownedByIsMe: leagueParticipants.isMe,
    })
    .from(players)
    .innerJoin(teams, eq(teams.id, players.teamId))
    .leftJoin(auctionPicks, eq(auctionPicks.playerId, players.id))
    .leftJoin(leagueParticipants, eq(leagueParticipants.id, auctionPicks.participantId))
    .where(and(eq(players.isActive, 1), like(players.normalizedName, `%${q.toLowerCase()}%`)))
    .limit(12);

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    teamCode: r.teamCode,
    roleClassic: r.roleClassic,
    quotCurrentClassic: r.quotCurrentClassic,
    isAvailable: r.ownedByParticipantId == null,
    ownedByName: r.ownedByName,
    ownedByIsMe: r.ownedByIsMe === 1,
    pricePaid: r.pricePaid,
  }));
}

export type PlayerAuctionAlternative = {
  playerId: number;
  slug: string;
  name: string;
  teamCode: string;
  quotCurrentClassic: number | null;
  score: number;
  bandLabel: string;
  suggestedPrice: number | null;
};

export type PlayerAuctionDetails = {
  id: number;
  slug: string;
  name: string;
  teamCode: string;
  teamName: string;
  roleClassic: string | null;
  quotCurrentClassic: number | null;
  fvmClassic: number | null;
  quotCurrentMantra: number | null;
  fvmMantra: number | null;
  isAvailable: boolean;
  ownedByParticipantId: number | null;
  ownedByName: string | null;
  ownedByIsMe: boolean;
  pricePaid: number | null;
  score: number | null;
  bandLabel: string | null;
  suggestedPrice: number | null;
  tags: string[];
  historicalPrices: Array<{ season: string; price: number }>;
  /** Altri giocatori dello stesso ruolo ancora disponibili, per capire se
   * conviene puntare su questo o aspettare un'alternativa migliore/più
   * economica — utile quando si è indecisi durante la chiamata dal vivo. */
  alternatives: PlayerAuctionAlternative[];
};

export async function getPlayerAuctionDetails(playerId: number): Promise<PlayerAuctionDetails | null> {
  const [row] = await db
    .select({
      id: players.id,
      slug: players.slug,
      name: players.name,
      teamCode: teams.code,
      teamName: teams.name,
      roleClassic: players.roleClassic,
      quotCurrentClassic: players.quotCurrentClassic,
      fvmClassic: players.fvmClassic,
      quotCurrentMantra: players.quotCurrentMantra,
      fvmMantra: players.fvmMantra,
      pricePaid: auctionPicks.price,
      ownedByParticipantId: leagueParticipants.id,
      ownedByName: leagueParticipants.name,
      ownedByIsMe: leagueParticipants.isMe,
    })
    .from(players)
    .innerJoin(teams, eq(teams.id, players.teamId))
    .leftJoin(auctionPicks, eq(auctionPicks.playerId, players.id))
    .leftJoin(leagueParticipants, eq(leagueParticipants.id, auctionPicks.participantId))
    .where(eq(players.id, playerId))
    .limit(1);
  if (!row) return null;

  const [adviceByPlayer, historyRows] = await Promise.all([
    getAdviceForAvailablePlayers(),
    db
      .select({ season: historicalAuctionPrices.seasonLabel, price: historicalAuctionPrices.price })
      .from(historicalAuctionPrices)
      .where(eq(historicalAuctionPrices.playerId, playerId)),
  ]);

  const advice = adviceByPlayer.get(playerId) ?? null;
  const historicalPrices = historyRows.slice().sort((a, b) => b.season.localeCompare(a.season));

  const role = row.roleClassic as Role | null;
  let alternatives: PlayerAuctionAlternative[] = [];
  if (role) {
    const sameRoleRows = await db
      .select({
        id: players.id,
        slug: players.slug,
        name: players.name,
        teamCode: teams.code,
        quotCurrentClassic: players.quotCurrentClassic,
      })
      .from(players)
      .innerJoin(teams, eq(teams.id, players.teamId))
      .leftJoin(auctionPicks, eq(auctionPicks.playerId, players.id))
      .where(
        and(
          eq(players.isActive, 1),
          eq(players.roleClassic, role),
          isNull(auctionPicks.id),
          ne(players.id, playerId),
        ),
      );

    alternatives = sameRoleRows
      .map((r) => {
        const a = adviceByPlayer.get(r.id);
        return a
          ? {
              playerId: r.id,
              slug: r.slug,
              name: r.name,
              teamCode: r.teamCode,
              quotCurrentClassic: r.quotCurrentClassic,
              score: a.score,
              bandLabel: bandLabel(a.band),
              suggestedPrice: a.suggestedPrice,
            }
          : null;
      })
      .filter((a): a is PlayerAuctionAlternative => a != null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    teamCode: row.teamCode,
    teamName: row.teamName,
    roleClassic: row.roleClassic,
    quotCurrentClassic: row.quotCurrentClassic,
    fvmClassic: row.fvmClassic,
    quotCurrentMantra: row.quotCurrentMantra,
    fvmMantra: row.fvmMantra,
    isAvailable: row.ownedByParticipantId == null,
    ownedByParticipantId: row.ownedByParticipantId,
    ownedByName: row.ownedByName,
    ownedByIsMe: row.ownedByIsMe === 1,
    pricePaid: row.pricePaid,
    score: advice?.score ?? null,
    bandLabel: advice ? bandLabel(advice.band) : null,
    suggestedPrice: advice?.suggestedPrice ?? null,
    tags: advice?.tags ?? [],
    historicalPrices,
    alternatives,
  };
}
