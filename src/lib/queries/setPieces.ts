import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { setPieceRoles, players } from "@/db/schema";

export type SetPieceEntry = {
  kind: "penalty" | "free_kick" | "corner";
  priority: number;
  playerId: number | null;
  playerName: string | null;
  rawName: string;
};

export async function getTeamSetPieces(teamId: number): Promise<SetPieceEntry[]> {
  const rows = await db
    .select({
      kind: setPieceRoles.kind,
      priority: setPieceRoles.priority,
      playerId: setPieceRoles.playerId,
      rawName: setPieceRoles.rawName,
      playerName: players.name,
    })
    .from(setPieceRoles)
    .leftJoin(players, eq(players.id, setPieceRoles.playerId))
    .where(eq(setPieceRoles.teamId, teamId))
    .orderBy(asc(setPieceRoles.kind), asc(setPieceRoles.priority));

  return rows as SetPieceEntry[];
}
