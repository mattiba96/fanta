"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auctionSettings,
  auctionPicks,
  leagueParticipants,
  watchlist,
  players,
} from "@/db/schema";
import { nowIso } from "@/lib/scraping/normalize";
import { runWriteTransaction } from "@/lib/scraping/pipeline";

type BackupPayload = {
  version: number;
  settings: {
    leagueName: string | null;
    mode: string;
    totalBudget: number;
    slotsGk: number;
    slotsDef: number;
    slotsMid: number;
    slotsFwd: number;
    participants: number | null;
  } | null;
  participants: { name: string; isMe: boolean; displayOrder: number }[];
  picks: {
    playerSlug: string;
    participantName: string | null;
    price: number;
    roleSlot: string | null;
    pickedAt: string;
  }[];
  watchlist: {
    playerSlug: string;
    targetPrice: number | null;
    priority: number | null;
    note: string | null;
  }[];
};

function isValidPayload(value: unknown): value is BackupPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.version === "number" &&
    Array.isArray(v.participants) &&
    Array.isArray(v.picks) &&
    Array.isArray(v.watchlist)
  );
}

export async function importAuctionState(
  jsonText: string,
): Promise<{ ok: boolean; message: string }> {
  let payload: unknown;
  try {
    payload = JSON.parse(jsonText);
  } catch {
    return { ok: false, message: "File non valido: non è un JSON leggibile." };
  }

  if (!isValidPayload(payload)) {
    return { ok: false, message: "File non valido: formato del backup non riconosciuto." };
  }

  const allPlayers = await db.select({ id: players.id, slug: players.slug }).from(players);
  const playerIdBySlug = new Map(allPlayers.map((p) => [p.slug, p.id]));

  const now = nowIso();

  // better-sqlite3 esegue le transazioni in modo sincrono: niente await
  // dentro la callback (vedi lib/scraping/pipeline.ts), solo .run()/.get().
  const { picksRestored, picksSkipped, watchlistRestored } = runWriteTransaction((tx) => {
    tx.delete(auctionPicks).run();
    tx.delete(watchlist).run();
    tx.delete(leagueParticipants).run();

    const participantIdByName = new Map<string, number>();
    for (const p of payload.participants) {
      const inserted = tx
        .insert(leagueParticipants)
        .values({
          name: p.name,
          isMe: p.isMe ? 1 : 0,
          displayOrder: p.displayOrder ?? 0,
          createdAt: now,
        })
        .returning({ id: leagueParticipants.id })
        .get();
      participantIdByName.set(p.name, inserted.id);
    }

    if (!payload.participants.some((p) => p.isMe)) {
      const me = tx
        .insert(leagueParticipants)
        .values({ name: "Io", isMe: 1, displayOrder: 0, createdAt: now })
        .returning({ id: leagueParticipants.id })
        .get();
      participantIdByName.set("Io", me.id);
    }

    let picksRestored = 0;
    let picksSkipped = 0;
    for (const pick of payload.picks) {
      const playerId = playerIdBySlug.get(pick.playerSlug);
      const participantId = pick.participantName
        ? participantIdByName.get(pick.participantName)
        : undefined;
      if (!playerId || !participantId) {
        picksSkipped++;
        continue;
      }
      tx
        .insert(auctionPicks)
        .values({
          playerId,
          participantId,
          price: pick.price,
          roleSlot: pick.roleSlot,
          pickedAt: pick.pickedAt || now,
        })
        .run();
      picksRestored++;
    }

    let watchlistRestored = 0;
    for (const w of payload.watchlist) {
      const playerId = playerIdBySlug.get(w.playerSlug);
      if (!playerId) continue;
      tx
        .insert(watchlist)
        .values({
          playerId,
          targetPrice: w.targetPrice,
          priority: w.priority,
          note: w.note,
        })
        .run();
      watchlistRestored++;
    }

    if (payload.settings) {
      tx
        .update(auctionSettings)
        .set({ ...payload.settings, updatedAt: now })
        .where(eq(auctionSettings.id, 1))
        .run();
    }

    return { picksRestored, picksSkipped, watchlistRestored };
  });

  revalidatePath("/");
  revalidatePath("/asta");
  revalidatePath("/sfoglia");
  revalidatePath("/obiettivi");
  revalidatePath("/impostazioni");
  revalidatePath("/giocatori/[slug]", "page");

  return {
    ok: true,
    message: `Ripristinati: ${payload.participants.length} squadre, ${picksRestored} giocatori assegnati (${picksSkipped} ignorati perché non trovati), ${watchlistRestored} obiettivi.`,
  };
}
