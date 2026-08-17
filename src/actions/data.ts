"use server";

import { revalidatePath } from "next/cache";
import * as statistiche from "@/lib/scraping/sources/statistiche";
import * as listone from "@/lib/scraping/sources/listone";
import { DEFAULT_STATS_SEASON } from "@/lib/queries/players";

export type RefreshOutcome = {
  ok: boolean;
  message: string;
};

export async function refreshStatistiche(): Promise<RefreshOutcome> {
  try {
    const result = await statistiche.run(DEFAULT_STATS_SEASON);
    revalidatePath("/");
    revalidatePath("/giocatori/[slug]", "page");
    return {
      ok: result.ok,
      message: result.ok
        ? `Statistiche ${DEFAULT_STATS_SEASON}: ${result.rowsInserted} creati, ${result.rowsUpdated} aggiornati.`
        : `Aggiornamento interrotto: solo ${result.rowsSeen} righe trovate.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function refreshListone(): Promise<RefreshOutcome> {
  try {
    const result = await listone.run();
    revalidatePath("/");
    revalidatePath("/giocatori/[slug]", "page");
    return {
      ok: result.ok,
      message: result.ok
        ? `Listone: ${result.rowsInserted} creati, ${result.rowsUpdated} aggiornati.`
        : `Aggiornamento interrotto: solo ${result.rowsSeen} righe trovate.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
