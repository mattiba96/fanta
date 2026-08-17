import * as cheerio from "cheerio";
import { fetchHtml } from "../http";
import { nowIso } from "../normalize";
import { startRun, finishRunOk, finishRunError, runWriteTransaction } from "../pipeline";
import { newsArticles } from "@/db/schema";

const URL = "https://www.sosfanta.com/news/";
const SITE_BASE = "https://www.sosfanta.com";
const MIN_EXPECTED_ARTICLES = 10;

export type ParsedArticle = {
  url: string;
  title: string;
  excerpt: string | null;
  author: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
};

export async function fetch(opts: { force?: boolean } = {}) {
  return fetchHtml(URL, { cacheKey: "news-sosfanta", force: opts.force, maxAgeMinutes: 60 });
}

/** Funzione pura: HTML -> articoli tipizzati. Zero I/O, zero DB. */
export function parseHtml(html: string): ParsedArticle[] {
  const $ = cheerio.load(html);
  const articles: ParsedArticle[] = [];

  $("article").each((_, el) => {
    const $article = $(el);
    const link = $article.find("h3 a[href], h2 a[href]").first();
    const title = link.text().trim();
    const href = link.attr("href");
    if (!title || !href) return;

    const url = href.startsWith("http") ? href : `${SITE_BASE}${href}`;
    const excerpt = $article.find("p").first().text().trim() || null;
    const imageUrl = $article.find("img").first().attr("src") ?? null;
    const publishedAt = $article.find("time[datetime]").first().attr("datetime") ?? null;

    // Il nome autore compare due volte (versione mobile abbreviata e desktop
    // estesa): prendiamo il testo più lungo tra le due.
    const authorCandidates = $article
      .find("span")
      .map((_, s) => $(s).text().trim())
      .get()
      .filter((t) => t && !t.match(/^\d/) && t.length < 60 && t !== title);
    const author = authorCandidates.sort((a, b) => b.length - a.length)[0] ?? null;

    articles.push({ url, title, excerpt, author, imageUrl, publishedAt });
  });

  return articles;
}

export type NewsRunResult = { ok: boolean; articlesSeen: number; inserted: number; updated: number };

export async function run(opts: { force?: boolean } = {}): Promise<NewsRunResult> {
  const runId = await startRun("news", URL);

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
    const counters = runWriteTransaction((tx) => {
      let inserted = 0;
      let updated = 0;
      for (const a of articles) {
        const values = {
          source: "sosfanta",
          url: a.url,
          title: a.title,
          excerpt: a.excerpt,
          author: a.author,
          imageUrl: a.imageUrl,
          publishedAt: a.publishedAt,
          fetchedAt: now,
        };
        const result = tx
          .insert(newsArticles)
          .values(values)
          .onConflictDoUpdate({
            target: newsArticles.url,
            set: { title: a.title, excerpt: a.excerpt, fetchedAt: now },
          })
          .run();
        if (result.changes > 0 && result.lastInsertRowid) inserted++;
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
