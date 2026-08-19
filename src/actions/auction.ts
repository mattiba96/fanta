"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auctionPicks, auctionSettings } from "@/db/schema";
import { nowIso } from "@/lib/scraping/normalize";
import { refreshAiAdviceSilently } from "./aiAdvisor";

export type ActionResult = { ok: boolean; message?: string };

export async function assignPlayer(input: {
  playerId: number;
  participantId: number;
  price: number;
  roleSlot?: string | null;
}): Promise<ActionResult> {
  if (!Number.isFinite(input.playerId) || !Number.isFinite(input.participantId) || input.price < 0) {
    return { ok: false, message: "Dati non validi." };
  }

  try {
    await db
      .insert(auctionPicks)
      .values({
        playerId: input.playerId,
        participantId: input.participantId,
        price: input.price,
        roleSlot: input.roleSlot ?? null,
        pickedAt: nowIso(),
      })
      .onConflictDoUpdate({
        target: auctionPicks.playerId,
        set: {
          participantId: input.participantId,
          price: input.price,
          roleSlot: input.roleSlot ?? null,
          pickedAt: nowIso(),
        },
      });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  revalidatePath("/");
  revalidatePath("/asta");
  revalidatePath("/sfoglia");
  revalidatePath("/giocatori/[slug]", "page");
  // "Ogni volta che succede qualcosa" durante l'asta (assegnazione mia o di
  // un altro partecipante) il consiglio va ricalcolato: non aspetta un click.
  await refreshAiAdviceSilently();
  return { ok: true };
}

export async function undoPick(playerId: number): Promise<ActionResult> {
  await db.delete(auctionPicks).where(eq(auctionPicks.playerId, playerId));
  revalidatePath("/");
  revalidatePath("/asta");
  revalidatePath("/sfoglia");
  revalidatePath("/giocatori/[slug]", "page");
  await refreshAiAdviceSilently();
  return { ok: true };
}

export async function saveAuctionSettings(input: {
  totalBudget: number;
  slotsGk: number;
  slotsDef: number;
  slotsMid: number;
  slotsFwd: number;
  mode: "classic" | "mantra";
  leagueName?: string;
}): Promise<ActionResult> {
  await db
    .update(auctionSettings)
    .set({
      totalBudget: input.totalBudget,
      slotsGk: input.slotsGk,
      slotsDef: input.slotsDef,
      slotsMid: input.slotsMid,
      slotsFwd: input.slotsFwd,
      mode: input.mode,
      leagueName: input.leagueName || null,
      updatedAt: nowIso(),
    })
    .where(eq(auctionSettings.id, 1));

  revalidatePath("/asta");
  revalidatePath("/impostazioni");
  return { ok: true };
}

export async function saveAuctionStrategy(strategy: string): Promise<ActionResult> {
  await db
    .update(auctionSettings)
    .set({ auctionStrategy: strategy.trim() || null, updatedAt: nowIso() })
    .where(eq(auctionSettings.id, 1));

  revalidatePath("/asta");
  return { ok: true };
}
