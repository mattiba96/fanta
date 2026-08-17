"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { watchlist } from "@/db/schema";

function revalidateAll() {
  revalidatePath("/obiettivi");
  revalidatePath("/giocatori/[slug]", "page");
  revalidatePath("/sfoglia");
  revalidatePath("/");
}

export async function setWatchlistEntry(input: {
  playerId: number;
  targetPrice: number | null;
  priority: number;
  note?: string;
}) {
  await db
    .insert(watchlist)
    .values({
      playerId: input.playerId,
      targetPrice: input.targetPrice,
      priority: input.priority,
      note: input.note || null,
    })
    .onConflictDoUpdate({
      target: watchlist.playerId,
      set: {
        targetPrice: input.targetPrice,
        priority: input.priority,
        note: input.note || null,
      },
    });
  revalidateAll();
  return { ok: true };
}

export async function removeFromWatchlist(playerId: number) {
  await db.delete(watchlist).where(eq(watchlist.playerId, playerId));
  revalidateAll();
  return { ok: true };
}
