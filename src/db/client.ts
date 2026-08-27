import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

// libSQL invece di better-sqlite3: stesso file SQLite in locale (nessuna
// differenza per lo sviluppo), ma può anche puntare a un database Turso
// remoto in produzione — a differenza di better-sqlite3 (modulo nativo con
// filesystem locale) è compatibile con l'ambiente serverless di Vercel.
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

function resolveUrl(): string {
  if (TURSO_DATABASE_URL) return TURSO_DATABASE_URL;
  const databasePath = process.env.DATABASE_PATH ?? "./data/fanta.db";
  const resolvedPath = path.resolve(process.cwd(), databasePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  return `file:${resolvedPath}`;
}

declare global {
  // eslint-disable-next-line no-var
  var __fantaLibsql: ReturnType<typeof createClient> | undefined;
}

const isLocalFile = !TURSO_DATABASE_URL;

function openConnection() {
  const client = createClient({ url: resolveUrl(), authToken: TURSO_AUTH_TOKEN });
  // Non awaitato di proposito: niente top-level await, per restare eseguibile
  // sia da Next.js (ESM) sia dagli script CLI lanciati con tsx (CJS). Non è
  // una race: è la stessa connessione a comando singolo, quindi ogni query
  // successiva viene comunque accodata DOPO questi PRAGMA nell'ordine in cui
  // sono stati emessi, anche senza attenderne qui il completamento.
  // foreign_keys è OFF di default su SQLite/libSQL: l'app conta su ON DELETE
  // CASCADE per players -> player_season_stats/auction_picks/ecc, quindi va
  // riattivato esplicitamente ad ogni apertura di connessione.
  void client.execute("PRAGMA foreign_keys = ON");
  if (isLocalFile) {
    void client.execute("PRAGMA journal_mode = WAL");
    void client.execute("PRAGMA busy_timeout = 5000");
  }
  return client;
}

// Singleton su globalThis: l'HMR di Next in dev ricrea i moduli ad ogni edit,
// senza questo si accumulano connessioni aperte sullo stesso file/DB.
const client = globalThis.__fantaLibsql ?? openConnection();
if (process.env.NODE_ENV !== "production") {
  globalThis.__fantaLibsql = client;
}

export const db = drizzle(client, { schema });
