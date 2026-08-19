"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auctionSettings } from "@/db/schema";
import { nowIso } from "@/lib/scraping/normalize";
import { getAnthropicClient, getAnthropicModel } from "@/lib/ai/client";
import { getAuctionState, getMarketInflation, getAuctionSettings } from "@/lib/queries/auction";
import { getParticipantSummaries } from "@/lib/queries/participants";
import { getNextTargetSuggestions } from "@/lib/queries/nextTargets";

export type AiAdviceResult = { ok: true; text: string } | { ok: false; message: string };

const SYSTEM_PROMPT = `Sei un assistente personale per un'asta LIVE di fantacalcio (Serie A, modalità Classic).
L'utente sta partecipando all'asta dal vivo con amici e deve decidere IN FRETTA chi puntare adesso.
Ricevi dati già calcolati deterministicamente (non inventare numeri, usa solo quelli forniti):
- "strategiaUtente": se presente, è la strategia d'asta che l'utente ha dichiarato lui stesso (es. "punto
  tutto su 2 top attaccanti e risparmio in difesa", "priorità ai giovani in crescita"). Questa strategia ha
  SEMPRE la priorità sui criteri generici sotto: se un candidato ad alto indice non rispetta la strategia
  dichiarata (es. è un giocatore anziano quando l'utente ha chiesto di puntare su giovani), NON consigliarlo
  come priorità anche se il suo score è alto — spiega perché lo scarti o lo derubrichi ad alternativa.
- "byRole": per ogni ruolo dove all'utente manca ancora almeno uno slot, i migliori candidati disponibili
  con "score" (0-100, indice di valore/titolarità/affidabilità/trend pluriennale), "bandLabel" (fascia di
  prezzo Top/Semi-top/Centrale/Scommessa), "suggestedPrice", "affordable" (se rientra nel budget massimo
  puntabile ora dall'utente), "historicalAvgPrice" (media di quanto l'utente ha REALMENTE pagato quel
  giocatore in aste passate sue) e "historicalPrices" (lo stesso storico ma stagione per stagione, dalla più
  recente alla più vecchia). USA SEMPRE "historicalPrices" per leggere il TREND, non fermarti alla media:
  una media piatta nasconde la storia vera. Se i prezzi salgono andando verso l'ultima stagione (es. pagato
  1 credito due anni fa, poi 90 l'anno scorso), il giocatore è probabilmente esploso: aspettati di pagarlo
  quanto l'ULTIMO prezzo osservato o anche di più, non la media. Se invece i prezzi scendono (es. pagato 100
  in passato, poi solo 10 l'anno scorso), il giocatore è probabilmente calato/cambiato ruolo: fidati del
  prezzo più RECENTE, non di quelli vecchi e ormai superati. In generale la stagione più recente conta
  sempre più delle vecchie. Quando lo storico esiste, resta comunque più affidabile del "suggestedPrice"
  teorico basato solo su FVM, specialmente per difensori/centrocampisti dove l'FVM tende a sovrastimare.
- "marketInflation": quanto i partecipanti di QUESTA specifica asta stanno pagando sopra/sotto l'FVM
  ufficiale, in generale e per ruolo — un mercato "gonfiato" in un ruolo suggerisce di aspettare o cambiare
  target lì.
- "myMaxBid": il budget massimo che l'utente può davvero permettersi di puntare ora senza compromettere gli
  slot ancora da riempire.
Rispondi in italiano, in un paragrafo breve (massimo 4-5 frasi), dando UNA priorità chiara (quale giocatore
o ruolo puntare per primo e perché, incrociando strategia dichiarata, indice, fascia, storico prezzi reali,
inflazione di mercato e urgenza degli slot mancanti) più un'alternativa di riserva se il primo target sfuma.
Niente markdown, niente elenchi, tono diretto da consulente che deve farsi capire in pochi secondi durante
un'asta dal vivo.`;

async function persistAdvice(result: AiAdviceResult) {
  await db
    .update(auctionSettings)
    .set({
      lastAiAdvice: result.ok ? result.text : `Non disponibile: ${result.message}`,
      lastAiAdviceAt: nowIso(),
      updatedAt: nowIso(),
    })
    .where(eq(auctionSettings.id, 1));
}

export async function getNextTargetAiAdvice(): Promise<AiAdviceResult> {
  const result = await computeNextTargetAiAdvice();
  // Persistito sempre (anche il fallimento): così il pannello mostra lo
  // stato reale dell'ultimo tentativo invece di restare vuoto in silenzio.
  await persistAdvice(result).catch(() => {});
  return result;
}

/**
 * Rigenera il consiglio senza che l'utente prema nulla: va chiamata dopo ogni
 * assegnazione/annullamento di un giocatore ("ogni volta che succede
 * qualcosa"). Non deve MAI far fallire l'azione che la chiama: eventuali
 * errori (chiave assente, rete, ecc.) restano solo nel testo persistito.
 */
export async function refreshAiAdviceSilently(): Promise<void> {
  try {
    const result = await computeNextTargetAiAdvice();
    await persistAdvice(result);
  } catch {
    // mai propagare: l'assegnazione del giocatore deve riuscire comunque
  }
}

export async function getStoredAiAdvice(): Promise<{ text: string | null; generatedAt: string | null }> {
  const settings = await getAuctionSettings();
  return { text: settings.lastAiAdvice, generatedAt: settings.lastAiAdviceAt };
}

async function computeNextTargetAiAdvice(): Promise<AiAdviceResult> {
  try {
    const [state, marketInflation, nextTargets, participants, settings] = await Promise.all([
      getAuctionState(),
      getMarketInflation(),
      getNextTargetSuggestions(),
      getParticipantSummaries(),
      getAuctionSettings(),
    ]);

    const rolesNeeded = (Object.keys(state.slotsTotal) as Array<"P" | "D" | "C" | "A">).filter(
      (role) => state.slotsFilled[role] < state.slotsTotal[role],
    );
    if (rolesNeeded.length === 0) {
      return { ok: true, text: "Rosa già completa in tutti i ruoli: nessun obiettivo da puntare." };
    }

    const me = participants.find((p) => p.isMe);
    const context = {
      strategiaUtente: settings.auctionStrategy || null,
      myMaxBid: me?.maxBid ?? 0,
      slotsNeeded: rolesNeeded,
      marketInflation,
      byRole: Object.fromEntries(rolesNeeded.map((role) => [role, nextTargets.byRole[role]])),
    };

    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: getAnthropicModel(),
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(context) }],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return text ? { ok: true, text } : { ok: false, message: "Risposta vuota dal modello." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
