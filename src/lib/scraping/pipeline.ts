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
 * better-sqlite3 esegue le transazioni in modo sincrono: la callback passata
 * a `db.transaction()` NON deve contenere `await` (altrimenti la trans. commit
 * prima che le operazioni asincrone completino). Per questo la fase di
 * matching/risoluzione (che ha bisogno di query async) va fatta PRIMA, fuori
 * da qui: questo helper esegue solo le scritture pure, in un'unica transazione.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function runWriteTransaction<T>(fn: (tx: Tx) => T): T {
  return db.transaction((tx) => fn(tx));
}
