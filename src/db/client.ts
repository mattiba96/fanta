import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

const DATABASE_PATH = process.env.DATABASE_PATH ?? "./data/fanta.db";
const resolvedPath = path.resolve(process.cwd(), DATABASE_PATH);

fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

declare global {
  // eslint-disable-next-line no-var
  var __fantaSqlite: Database.Database | undefined;
}

function openConnection() {
  const sqlite = new Database(resolvedPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return sqlite;
}

// Singleton su globalThis: l'HMR di Next in dev ricrea i moduli ad ogni edit,
// senza questo si accumulano connessioni aperte sullo stesso file.
const sqlite = globalThis.__fantaSqlite ?? openConnection();
if (process.env.NODE_ENV !== "production") {
  globalThis.__fantaSqlite = sqlite;
}

export const db = drizzle(sqlite, { schema });
export const rawDb = sqlite;
