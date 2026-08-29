import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { players, teams, playerSeasonStats, historicalAuctionPrices } from "@/db/schema";
import { getAdviceForPlayer } from "@/lib/queries/advice";
import { getPlayerLineupStatus, type PlayerLineupStatus } from "@/lib/queries/lineups";
import { getTeamSetPieces, type SetPieceEntry } from "@/lib/queries/setPieces";
import { getNewsForPlayer, type NewsArticle } from "@/lib/queries/news";
import { getWatchlistEntryForPlayer } from "@/lib/queries/watchlist";
import { DEFAULT_STATS_SEASON, HISTORICAL_STATS_SEASONS } from "@/lib/seasons";
import type { Advice } from "@/lib/advice/engine";

export type SpotlightWatchlistEntry = {
  targetPrice: number | null;
  priority: number | null;
  note: string | null;
};

export type PlayerSpotlight = {
  slug: string;
  name: string;
  teamName: string;
  roleClassic: string | null;
  quotCurrentClassic: number | null;
  fvmClassic: number | null;
  proDescription: string | null;
  contraDescription: string | null;
  advice: Advice | null;
  stats: typeof playerSeasonStats.$inferSelect | null;
  statsHistory: (typeof playerSeasonStats.$inferSelect)[];
  priceHistory: { seasonLabel: string; price: number }[];
  lineupStatuses: PlayerLineupStatus[];
  setPieces: SetPieceEntry[];
  news: NewsArticle[];
  // Non-null quando questo giocatore è presente nella watchlist dell'utente
  // (players.id in watchlist.player_id): usato in UI per un'evidenziazione
  // forte quando il giocatore "in visione ora" era un obiettivo segnato.
  watchlistEntry: SpotlightWatchlistEntry | null;
};

/**
 * Scheda completa di un giocatore identificato dal suo id FantaAsta
 * (players.external_id), per il pannello "in visione ora" di Asta Live —
 * stesso genere di dati della scheda giocatore normale, assemblati per un
 * singolo id invece che per slug.
 */
export async function getPlayerSpotlight(externalId: string): Promise<PlayerSpotlight | null> {
  const [row] = await db
    .select()
    .from(players)
    .innerJoin(teams, eq(teams.id, players.teamId))
    .where(and(eq(players.externalId, externalId), eq(players.isActive, 1)))
    .limit(1);
  if (!row) return null;

  const player = row.players;

  const statsRows = await db
    .select()
    .from(playerSeasonStats)
    .where(eq(playerSeasonStats.playerId, player.id));
  const statsBySeason = new Map(statsRows.map((s) => [s.season, s]));
  const stats = statsBySeason.get(DEFAULT_STATS_SEASON) ?? null;
  const statsHistory = HISTORICAL_STATS_SEASONS.map((season) => statsBySeason.get(season)).filter(
    (s): s is NonNullable<typeof s> => s != null,
  );

  const priceHistory = await db
    .select({ seasonLabel: historicalAuctionPrices.seasonLabel, price: historicalAuctionPrices.price })
    .from(historicalAuctionPrices)
    .where(eq(historicalAuctionPrices.playerId, player.id));

  const [advice, lineupStatuses, teamSetPieces, news, watchlistRow] = await Promise.all([
    getAdviceForPlayer(player.id),
    getPlayerLineupStatus(player.id),
    getTeamSetPieces(player.teamId!),
    getNewsForPlayer(player.name),
    getWatchlistEntryForPlayer(player.id),
  ]);

  return {
    slug: player.slug,
    name: player.name,
    teamName: row.teams.name,
    roleClassic: player.roleClassic,
    quotCurrentClassic: player.quotCurrentClassic,
    fvmClassic: player.fvmClassic,
    proDescription: player.proDescription,
    contraDescription: player.contraDescription,
    advice,
    stats,
    statsHistory,
    priceHistory,
    lineupStatuses,
    setPieces: teamSetPieces.filter((sp) => sp.playerId === player.id),
    news,
    watchlistEntry: watchlistRow
      ? { targetPrice: watchlistRow.targetPrice, priority: watchlistRow.priority, note: watchlistRow.note }
      : null,
  };
}
