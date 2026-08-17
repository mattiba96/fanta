import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { players, playerSeasonStats, setPieceRoles, lineupPlayers, auctionPicks } from "@/db/schema";
import {
  buildAdviceForRoleGroup,
  type AdviceInput,
  type Advice,
  type Role,
  type SetPiecePriority,
  type LineupStatusInput,
} from "@/lib/advice/engine";
import { DEFAULT_STATS_SEASON } from "./players";

/**
 * Consigli per tutti i giocatori ancora disponibili, raggruppati per ruolo
 * (le fasce/indice sono percentili relativi al gruppo di ruolo). Fa poche
 * query e tiene tutto in memoria: per ~500-600 giocatori è questione di
 * millisecondi, non serve altra ottimizzazione per un uso personale.
 */
export async function getAdviceForAvailablePlayers(): Promise<Map<number, Advice>> {
  const rows = await db
    .select({
      id: players.id,
      role: players.roleClassic,
      quotCurrentClassic: players.quotCurrentClassic,
      fvmClassic: players.fvmClassic,
      pv: playerSeasonStats.pv,
      mv: playerSeasonStats.mv,
      fm: playerSeasonStats.fm,
      goals: playerSeasonStats.goals,
      assists: playerSeasonStats.assists,
      yellowCards: playerSeasonStats.yellowCards,
      redCards: playerSeasonStats.redCards,
    })
    .from(players)
    .leftJoin(
      playerSeasonStats,
      and(
        eq(playerSeasonStats.playerId, players.id),
        eq(playerSeasonStats.season, DEFAULT_STATS_SEASON),
      ),
    )
    .leftJoin(auctionPicks, eq(auctionPicks.playerId, players.id))
    .where(and(eq(players.isActive, 1), isNull(auctionPicks.id)));

  const allSetPieces = await db.select().from(setPieceRoles);
  const setPieceByPlayer = new Map<number, SetPiecePriority>();
  for (const sp of allSetPieces) {
    if (!sp.playerId) continue;
    const entry = setPieceByPlayer.get(sp.playerId) ?? {};
    if (sp.kind === "penalty") entry.penalty = sp.priority;
    if (sp.kind === "free_kick") entry.freeKick = sp.priority;
    if (sp.kind === "corner") entry.corner = sp.priority;
    setPieceByPlayer.set(sp.playerId, entry);
  }

  const allLineups = await db.select().from(lineupPlayers);
  const lineupByPlayer = new Map<number, LineupStatusInput[]>();
  for (const lp of allLineups) {
    if (!lp.playerId) continue;
    const arr = lineupByPlayer.get(lp.playerId) ?? [];
    arr.push({ status: lp.status, probability: lp.probability, note: lp.note });
    lineupByPlayer.set(lp.playerId, arr);
  }

  const byRole = new Map<Role, AdviceInput[]>();
  for (const r of rows) {
    const role = r.role as Role | null;
    if (!role) continue;
    const input: AdviceInput = {
      playerId: r.id,
      role,
      quotCurrentClassic: r.quotCurrentClassic,
      fvmClassic: r.fvmClassic,
      pv: r.pv,
      mv: r.mv,
      fm: r.fm,
      goals: r.goals,
      assists: r.assists,
      yellowCards: r.yellowCards,
      redCards: r.redCards,
      setPiece: setPieceByPlayer.get(r.id) ?? {},
      lineupStatuses: lineupByPlayer.get(r.id) ?? [],
    };
    const arr = byRole.get(role) ?? [];
    arr.push(input);
    byRole.set(role, arr);
  }

  const combined = new Map<number, Advice>();
  for (const [, inputs] of byRole) {
    const adviceMap = buildAdviceForRoleGroup(inputs);
    for (const [id, advice] of adviceMap) combined.set(id, advice);
  }
  return combined;
}

export async function getAdviceForPlayer(playerId: number): Promise<Advice | null> {
  const all = await getAdviceForAvailablePlayers();
  return all.get(playerId) ?? null;
}
