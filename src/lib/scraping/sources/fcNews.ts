import * as cheerio from "cheerio";
import { fetchHtml } from "../http";
import { nowIso } from "../normalize";
import { startRun, finishRunOk, finishRunError, runWriteTransaction } from "../pipeline";
import { newsArticles } from "@/db/schema";
import type { ParsedArticle } from "./news";

const URL = "https://www.fantacalcio.it/news";
const SITE_BASE = "https://www.fantacalcio.it";
const MIN_EXPECTED_ARTICLES = 10;

export async function fetch(opts: { force?: boolean } = {}) {
  return fetchHtml(URL, { cacheKey: "news-fantacalcio", force: opts.force, maxAgeMinutes: 60 });
}

/**
 * Funzione pura: HTML -> articoli tipizzati. Stessa forma di news.ts
 * (sosfanta.com), fonte diversa: fantacalcio.it è lo stesso dominio già
 * usato per listone/statistiche/probabili/descrizioni, quindi zero nuovo
 * dominio da valutare per affidabilità.
 */
export function parseHtml(html: string): ParsedArticle[] {
  const $ = cheerio.load(html);
  const articles: ParsedArticle[] = [];

  $("article.article-card").each((_, el) => {
    const $article = $(el);
    const link = $article.find("a.inner").first();
    const href = link.attr("href");
    const title = link.find("h2.title, h3.title").first().text().trim();
    if (!title || !href) return;

    const url = href.startsWith("http") ? href : `${SITE_BASE}${href}`;
    const excerpt = link.find("p, .incipit").first().text().trim() || null;
    const imageUrl = link.find("img").first().attr("src") ?? null;
    const author = link.find(".author").first().text().trim() || null;

    articles.push({ url, title, excerpt, author, imageUrl, publishedAt: null });
  });

  return articles;
}

export type FcNewsRunResult = { ok: boolean; articlesSeen: number; inserted: number; updated: number };

export async function run(opts: { force?: boolean } = {}): Promise<FcNewsRunResult> {
  const runId = await startRun("fc_news", URL);

  try {
    const { html } = await fetch(opts);
    const articles = parseHtml(html);

    if (articles.length < MIN_EXPECTED_ARTICLES) {
      await finishRunError(
        runId,
        `Solo ${articles.length} articoli trovati (attesi >= ${MIN_EXPECTED_ARTICLES}): probabile cambio di struttura della pagina, dati non toccati.`,
      );
      return { ok: false, articlesSeen: articles.length, inserted: 0, updated: 0 };
    }

    const now = nowIso();
    const counters = await runWriteTransaction(async (tx) => {
      let inserted = 0;
      let updated = 0;
      for (const a of articles) {
        const values = {
          source: "fantacalcio",
          url: a.url,
          title: a.title,
          excerpt: a.excerpt,
          author: a.author,
          imageUrl: a.imageUrl,
          // fantacalcio.it/news mostra date relative ("un minuto fa") non
          // parsabili in modo affidabile in una data assoluta: si usa il
          // momento dello scraping come approssimazione — la pagina elenca
          // solo gli articoli più recenti, quindi è comunque una data vicina
          // alla pubblicazione reale, e mantiene l'ordinamento coerente con
          // le notizie di sosfanta.com (che hanno una data vera).
          publishedAt: now,
          fetchedAt: now,
        };
        const result = await tx
          .insert(newsArticles)
          .values(values)
          .onConflictDoUpdate({
            target: newsArticles.url,
            set: { title: a.title, excerpt: a.excerpt, fetchedAt: now },
          });
        if (result.rowsAffected > 0 && result.lastInsertRowid) inserted++;
        else updated++;
      }
      return { rowsInserted: inserted, rowsUpdated: updated, rowsUnmatched: 0 };
    });

    await finishRunOk(
      runId,
      counters,
      `${articles.length} articoli letti, ${counters.rowsInserted} nuovi.`,
    );

    return { ok: true, articlesSeen: articles.length, inserted: counters.rowsInserted, updated: counters.rowsUpdated };
  } catch (err) {
    await finishRunError(runId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
