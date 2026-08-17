import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { newsArticles } from "@/db/schema";
import { normalizeName } from "@/lib/scraping/normalize";

export type NewsArticle = typeof newsArticles.$inferSelect;

export async function getLatestNews(limit = 30): Promise<NewsArticle[]> {
  return db.select().from(newsArticles).orderBy(desc(newsArticles.publishedAt)).limit(limit);
}

/**
 * Notizie che citano il giocatore: matching testuale sul cognome (il token
 * più lungo del nome normalizzato) dentro titolo+estratto. Nessuna tabella di
 * join da mantenere: con poche decine di articoli il confronto a ogni
 * caricamento della scheda giocatore costa nulla, e resta sempre coerente
 * con l'ultimo scraping senza bisogno di ri-processare le notizie passate.
 */
export async function getNewsForPlayer(playerName: string, limit = 5): Promise<NewsArticle[]> {
  const tokens = normalizeName(playerName)
    .split(" ")
    .filter((t) => t.length >= 4);
  if (tokens.length === 0) return [];

  const all = await getLatestNews(200);
  const matches = all.filter((a) => {
    const haystack = normalizeName(`${a.title} ${a.excerpt ?? ""}`);
    return tokens.some((t) => new RegExp(`\\b${t}\\b`).test(haystack));
  });
  return matches.slice(0, limit);
}
