import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { scrapeRuns } from "@/db/schema";
import { nowIso } from "./normalize";

export type RunCounters = {
  rowsInserted: number;
  rowsUpdated: number;
  rowsUnmatched: number;
};

export async function startRun(source: string, url: string): Promise<number> {
  const [row] = await db
    .insert(scrapeRuns)
    .values({ source, status: "running", startedAt: nowIso(), url })
    .returning({ id: scrapeRuns.id });
  return row.id;
}

export async function finishRunOk(runId: number, counters: RunCounters, message?: string) {
  await db
    .update(scrapeRuns)
    .set({
      status: "ok",
      finishedAt: nowIso(),
      rowsInserted: counters.rowsInserted,
      rowsUpdated: counters.rowsUpdated,
      rowsUnmatched: counters.rowsUnmatched,
      message,
    })
    .where(eq(scrapeRuns.id, runId));
}

export async function finishRunError(runId: number, message: string) {
  await db
    .update(scrapeRuns)
    .set({ status: "error", finishedAt: nowIso(), message })
    .where(eq(scrapeRuns.id, runId));
}

/**
 * Il driver libSQL è asincrono (anche in locale, per restare compatibile col
 * trasporto remoto di Turso in produzione): a differenza di better-sqlite3,
 * `db.transaction()` accetta una callback async e ogni `.run()`/`.insert()`
 * al suo interno va awaitato. La fase di matching/risoluzione (query async
 * di lettura) va comunque fatta PRIMA, fuori da qui: questo helper esegue
 * solo le scritture pure, in un'unica transazione.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function runWriteTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction((tx) => fn(tx));
}
