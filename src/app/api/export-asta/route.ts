import { db } from "@/db/client";
import {
  auctionSettings,
  auctionPicks,
  leagueParticipants,
  watchlist,
  players,
} from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const [settings] = await db.select().from(auctionSettings);
  const participants = await db.select().from(leagueParticipants);

  const picksRaw = await db
    .select({
      playerSlug: players.slug,
      participantId: auctionPicks.participantId,
      price: auctionPicks.price,
      roleSlot: auctionPicks.roleSlot,
      pickedAt: auctionPicks.pickedAt,
    })
    .from(auctionPicks)
    .innerJoin(players, eq(players.id, auctionPicks.playerId));

  const participantById = new Map(participants.map((p) => [p.id, p.name]));
  const picks = picksRaw.map((p) => ({
    playerSlug: p.playerSlug,
    participantName: participantById.get(p.participantId) ?? null,
    price: p.price,
    roleSlot: p.roleSlot,
    pickedAt: p.pickedAt,
  }));

  const watchlistRaw = await db
    .select({
      playerSlug: players.slug,
      targetPrice: watchlist.targetPrice,
      priority: watchlist.priority,
      note: watchlist.note,
    })
    .from(watchlist)
    .innerJoin(players, eq(players.id, watchlist.playerId));

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: settings
      ? {
          leagueName: settings.leagueName,
          mode: settings.mode,
          totalBudget: settings.totalBudget,
          slotsGk: settings.slotsGk,
          slotsDef: settings.slotsDef,
          slotsMid: settings.slotsMid,
          slotsFwd: settings.slotsFwd,
          participants: settings.participants,
        }
      : null,
    participants: participants.map((p) => ({
      name: p.name,
      isMe: p.isMe === 1,
      displayOrder: p.displayOrder,
    })),
    picks,
    watchlist: watchlistRaw,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="fantasta-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
