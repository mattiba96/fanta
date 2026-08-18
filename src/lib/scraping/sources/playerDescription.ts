import * as cheerio from "cheerio";
import { eq } from "drizzle-orm";
import { fetchHtml, readCachedHtml } from "../http";
import { nowIso } from "../normalize";
import { db } from "@/db/client";
import { players } from "@/db/schema";

const MAX_AGE_DAYS = 30; // la descrizione editoriale cambia raramente

export type PlayerDescription = {
  generalDescription: string | null;
  proDescription: string | null;
  contraDescription: string | null;
};

/**
 * Funzione pura: HTML della pagina profilo fantacalcio.it -> descrizione.
 * Struttura osservata: dentro #player-description .card.tipography c'è
 * talvolta un paragrafo tattico/fisico libero, poi un <h2>"{Nome} in chiave
 * Fantacalcio"</h2> seguito da <li><strong>PRO</strong>: ...</li> e
 * <li><strong>CONTRO</strong>: ...</li>. Non tutti i giocatori hanno il
 * paragrafo iniziale (in quel caso l'h2 è il primo figlio del contenitore).
 */
export function parseDescriptionPage(html: string): PlayerDescription {
  const $ = cheerio.load(html);
  const container = $("#player-description .card.tipography").first();
  if (container.length === 0) {
    return { generalDescription: null, proDescription: null, contraDescription: null };
  }

  const chiaveHeading = container
    .find("h2")
    .filter((_, h) => /in chiave fantacalcio/i.test($(h).text()))
    .first();

  let generalDescription: string | null = null;
  if (chiaveHeading.length > 0) {
    const before = chiaveHeading
      .prevAll()
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .reverse()
      .join(" ")
      .trim();
    generalDescription = before || null;
  }

  let proDescription: string | null = null;
  let contraDescription: string | null = null;
  container.find("li").each((_, li) => {
    const $li = $(li);
    const strongText = $li.find("strong").first().text();
    const label = strongText.trim().toUpperCase();
    const text = $li.text().replace(strongText, "").replace(/^[:\s]+/, "").trim();
    if (label.startsWith("PRO")) proDescription = text || null;
    else if (label.startsWith("CONTRO")) contraDescription = text || null;
  });

  return { generalDescription, proDescription, contraDescription };
}

type PlayerRow = typeof players.$inferSelect;

function rowToDescription(row: PlayerRow): PlayerDescription {
  return {
    generalDescription: row.generalDescription,
    proDescription: row.proDescription,
    contraDescription: row.contraDescription,
  };
}

/**
 * Fetch pigro chiamato dalla scheda giocatore, non da un job in blocco.
 * Timeout breve (4s) e nessun retry: lo stesso errore già commesso con
 * FantaCalcioPedia (retry pazienti da scraper in blocco riusati in un fetch
 * dentro il rendering di una pagina) ha già causato una scheda che si
 * bloccava per 30+ secondi — qui evitato dall'inizio.
 */
export async function getOrFetchDescription(playerId: number): Promise<PlayerDescription | null> {
  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!player?.sourceUrl) return null;

  if (player.descriptionUpdatedAt) {
    const ageDays = (Date.now() - new Date(player.descriptionUpdatedAt).getTime()) / 86_400_000;
    if (ageDays < MAX_AGE_DAYS) return rowToDescription(player);
  }

  const cacheKey = `fc-profile-${playerId}`;
  try {
    const { html } = await fetchHtml(player.sourceUrl, {
      cacheKey,
      maxAgeMinutes: MAX_AGE_DAYS * 1440,
      maxAttempts: 1,
      timeoutMs: 4000,
    });
    const parsed = parseDescriptionPage(html);

    await db
      .update(players)
      .set({ ...parsed, descriptionUpdatedAt: nowIso() })
      .where(eq(players.id, playerId));

    return parsed;
  } catch {
    const cached = readCachedHtml(cacheKey);
    if (cached) {
      try {
        return parseDescriptionPage(cached);
      } catch {
        return null;
      }
    }
    return player.proDescription || player.contraDescription || player.generalDescription
      ? rowToDescription(player)
      : null;
  }
}
