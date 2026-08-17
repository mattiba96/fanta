"use server";

import { revalidatePath } from "next/cache";
import { eq, max } from "drizzle-orm";
import { db } from "@/db/client";
import { leagueParticipants, auctionPicks } from "@/db/schema";
import { nowIso } from "@/lib/scraping/normalize";

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/asta");
  revalidatePath("/sfoglia");
  revalidatePath("/impostazioni");
  revalidatePath("/giocatori/[slug]", "page");
}

export async function addParticipant(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: "Nome mancante." };

  const [{ value: maxOrder }] = await db
    .select({ value: max(leagueParticipants.displayOrder) })
    .from(leagueParticipants);

  await db.insert(leagueParticipants).values({
    name: trimmed,
    isMe: 0,
    displayOrder: (maxOrder ?? 0) + 1,
    createdAt: nowIso(),
  });

  revalidateAll();
  return { ok: true };
}

export async function renameParticipant(id: number, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: "Nome mancante." };
  await db.update(leagueParticipants).set({ name: trimmed }).where(eq(leagueParticipants.id, id));
  revalidateAll();
  return { ok: true };
}

export async function removeParticipant(id: number) {
  const [row] = await db.select().from(leagueParticipants).where(eq(leagueParticipants.id, id)).limit(1);
  if (row?.isMe) {
    return { ok: false, message: "Non puoi rimuovere la tua squadra." };
  }
  // Cascade su auction_picks: i suoi giocatori tornano disponibili.
  await db.delete(leagueParticipants).where(eq(leagueParticipants.id, id));
  revalidateAll();
  return { ok: true };
}

export async function resetRosters() {
  await db.delete(auctionPicks);
  revalidateAll();
  return { ok: true };
}
