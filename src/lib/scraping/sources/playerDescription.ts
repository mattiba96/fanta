import * as cheerio from "cheerio";
import { eq, and, isNotNull } from "drizzle-orm";
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
 * Due sezioni distinte e indipendenti sulla stessa pagina:
 * - `.description` (dentro una section.card a parte): paragrafo tattico/fisico
 *   libero (stile/ruolo del giocatore), sempre presente. Prima si tentava di
 *   ricavare un paragrafo simile dentro #player-description (il testo prima
 *   dell'h2 "in chiave Fantacalcio"), ma lì l'h2 è sempre il primo figlio:
 *   quella logica non ha mai prodotto nulla, la sezione giusta è questa.
 * - `#player-description .card.tipography`: <h2>"{Nome} in chiave
 *   Fantacalcio"</h2> seguito da <li><strong>PRO</strong>: ...</li> e
 *   <li><strong>CONTRO</strong>: ...</li> — non tutti i giocatori la hanno.
 */
export function parseDescriptionPage(html: string): PlayerDescription {
  const $ = cheerio.load(html);

  const generalDescription = $(".description").first().text().trim() || null;

  let proDescription: string | null = null;
  let contraDescription: string | null = null;
  const container = $("#player-description .card.tipography").first();
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

export type DescriptionRunResult = {
  ok: boolean;
  playersSeen: number;
  playersUpdated: number;
  playersFailed: number;
};

/**
 * Backfill in blocco: girando come job in background può permettersi i retry
 * pazienti di default di fetchHtml, a differenza di getOrFetchDescription (un
 * solo tentativo, timeout corto, pensato per non bloccare il rendering di una
 * scheda aperta dal vivo). Recupera anche i giocatori il cui unico tentativo
 * lazy finora è fallito (descriptionUpdatedAt mai impostato).
 */
export async function run(opts: { force?: boolean } = {}): Promise<DescriptionRunResult> {
  const rows = await db
    .select({
      id: players.id,
      sourceUrl: players.sourceUrl,
      descriptionUpdatedAt: players.descriptionUpdatedAt,
    })
    .from(players)
    .where(and(eq(players.isActive, 1), isNotNull(players.sourceUrl)));

  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    if (!opts.force && row.descriptionUpdatedAt) {
      const ageDays = (Date.now() - new Date(row.descriptionUpdatedAt).getTime()) / 86_400_000;
      if (ageDays < MAX_AGE_DAYS) continue;
    }
    try {
      const { html } = await fetchHtml(row.sourceUrl!, {
        cacheKey: `fc-profile-${row.id}`,
        maxAgeMinutes: MAX_AGE_DAYS * 1440,
        force: opts.force,
      });
      const parsed = parseDescriptionPage(html);
      await db
        .update(players)
        .set({ ...parsed, descriptionUpdatedAt: nowIso() })
        .where(eq(players.id, row.id));
      updated++;
    } catch {
      failed++;
    }
  }

  return { ok: true, playersSeen: rows.length, playersUpdated: updated, playersFailed: failed };
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
