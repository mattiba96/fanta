"use server";

import { revalidatePath } from "next/cache";
import * as statistiche from "@/lib/scraping/sources/statistiche";
import * as listone from "@/lib/scraping/sources/listone";
import * as setPieces from "@/lib/scraping/sources/setPieces";
import * as probabiliFormazioni from "@/lib/scraping/sources/probabiliFormazioni";
import * as calendario from "@/lib/scraping/sources/calendario";
import * as goalkeeperGrid from "@/lib/scraping/sources/goalkeeperGrid";
import * as news from "@/lib/scraping/sources/news";
import * as fcNews from "@/lib/scraping/sources/fcNews";
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

export async function refreshFcNews(): Promise<RefreshOutcome> {
  try {
    const result = await fcNews.run();
    revalidatePath("/notizie");
    revalidatePath("/giocatori/[slug]", "page");
    return {
      ok: result.ok,
      message: result.ok
        ? `Notizie Fantacalcio.it: ${result.inserted} nuove, ${result.updated} aggiornate.`
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
    revalidatePath("/formazione-tipo");
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

export async function refreshGoalkeeperGrid(): Promise<RefreshOutcome> {
  try {
    const result = await goalkeeperGrid.run();
    revalidatePath("/griglie");
    return {
      ok: result.ok,
      message: result.ok
        ? `Griglia portieri: ${result.rowsInserted} righe salvate, ${result.rowsUnmatched} non abbinate.`
        : `Aggiornamento interrotto: solo ${result.rowsSeen} righe trovate.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function refreshCalendario(): Promise<RefreshOutcome> {
  try {
    const result = await calendario.run();
    revalidatePath("/griglie");
    return {
      ok: result.ok,
      message: result.ok
        ? `Calendario: ${result.rowsInserted} partite salvate, ${result.rowsUnmatched} non abbinate.`
        : `Aggiornamento interrotto: solo ${result.rowsSeen} partite trovate.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export type RefreshAllStep = { label: string; outcome: RefreshOutcome };

/**
 * Un solo bottone che aggiorna tutto, nell'ordine giusto: prima le fonti
 * "roster-authoritative" (listone/statistiche, possono creare giocatori),
 * poi quelle di riferimento che devono abbinarsi a un roster già aggiornato
 * (altrimenti troverebbero più nomi non riconosciuti del necessario).
 * Ogni passo prosegue anche se uno fallisce, così un problema su una fonte
 * non blocca l'aggiornamento delle altre.
 *
 * Il calendario NON è incluso qui di proposito: scarica 38 pagine (60-90s)
 * per un dato che cambia raramente una volta pubblicato, quindi ha un suo
 * bottone separato invece di rallentare "Aggiorna tutto" ad ogni click.
 *
 * Descrizioni/commenti FantaCalcioPedia NON sono incluse: sono un fetch per
 * ogni giocatore attivo (500+, con lo stesso throttle da 1.5s di http.ts),
 * quindi anche solo il backfill iniziale richiede 10+ minuti — ben oltre il
 * limite di 60s di una funzione serverless Vercel (piano Hobby). Vanno
 * lanciate da locale, senza limiti di tempo: `npm run scrape -- descrizioni`
 * e `npm run scrape -- fcp-commenti`. Sulla scheda giocatore restano comunque
 * disponibili on-demand (getOrFetchDescription/getOrFetchComment), che fanno
 * un solo fetch alla volta con timeout corto.
 */
export async function refreshAll(): Promise<RefreshAllStep[]> {
  const steps: Array<{ label: string; run: () => Promise<RefreshOutcome> }> = [
    { label: "Listone quotazioni", run: refreshListone },
    { label: "Statistiche", run: refreshStatistiche },
    { label: "Rigoristi/tiratori", run: refreshSetPieces },
    { label: "Probabili formazioni", run: refreshProbabiliFormazioni },
    { label: "Indice appetibilità", run: refreshFcpRatings },
    { label: "Notizie (SosFanta)", run: refreshNews },
    { label: "Notizie (Fantacalcio.it)", run: refreshFcNews },
    { label: "Griglia portieri (SOS Fanta)", run: refreshGoalkeeperGrid },
  ];

  const results: RefreshAllStep[] = [];
  for (const step of steps) {
    const outcome = await step.run();
    results.push({ label: step.label, outcome });
  }
  return results;
}
