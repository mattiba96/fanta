"use server";

import { revalidatePath } from "next/cache";
import * as statistiche from "@/lib/scraping/sources/statistiche";
import * as listone from "@/lib/scraping/sources/listone";
import * as setPieces from "@/lib/scraping/sources/setPieces";
import * as probabiliFormazioni from "@/lib/scraping/sources/probabiliFormazioni";
import * as news from "@/lib/scraping/sources/news";
import * as fcpRatings from "@/lib/scraping/sources/fcpRatings";
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

export async function refreshSetPieces(): Promise<RefreshOutcome> {
  try {
    const result = await setPieces.run();
    revalidatePath("/");
    revalidatePath("/giocatori/[slug]", "page");
    return {
      ok: result.ok,
      message: result.ok
        ? `Rigoristi/tiratori: ${result.rowsInserted} righe inserite, ${result.rowsUnmatched} non abbinate.`
        : `Aggiornamento interrotto: solo ${result.rowsSeen} righe trovate.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function refreshNews(): Promise<RefreshOutcome> {
  try {
    const result = await news.run();
    revalidatePath("/notizie");
    revalidatePath("/giocatori/[slug]", "page");
    return {
      ok: result.ok,
      message: result.ok
        ? `Notizie: ${result.inserted} nuove, ${result.updated} aggiornate.`
        : `Aggiornamento interrotto: solo ${result.articlesSeen} articoli trovati.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function refreshFcpRatings(): Promise<RefreshOutcome> {
  try {
    const result = await fcpRatings.run();
    revalidatePath("/");
    revalidatePath("/giocatori/[slug]", "page");
    return {
      ok: result.ok,
      message: result.ok
        ? `Indice appetibilità: ${result.rowsInserted} abbinati, ${result.rowsUnmatched} non riconosciuti.`
        : `Aggiornamento interrotto: solo ${result.rowsSeen} righe trovate.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function refreshProbabiliFormazioni(): Promise<RefreshOutcome> {
  try {
    const result = await probabiliFormazioni.run();
    revalidatePath("/");
    revalidatePath("/formazioni");
    revalidatePath("/giocatori/[slug]", "page");
    return {
      ok: result.ok,
      message: result.ok
        ? `Probabili formazioni: ${result.matchesSeen} partite, ${result.playersInserted} righe, ${result.playersUnmatched} non abbinate.`
        : `Aggiornamento interrotto: solo ${result.matchesSeen} partite trovate.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
