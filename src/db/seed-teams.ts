import { db, rawDb } from "./client";
import { teams } from "./schema";
import { sql } from "drizzle-orm";

// Le 20 squadre di Serie A 2026/27 (fonte: Wikipedia, verificato 17/08/2026).
// `code` è la sigla a 3 lettere usata da fantacalcio.it in listone/statistiche;
// se lo scraper trova sigle diverse, normalize.ts deve risolverle comunque
// per nome (le probabili formazioni usano il nome pieno).
const SERIE_A_TEAMS_2026_27 = [
  { code: "ATA", name: "Atalanta", slug: "atalanta" },
  { code: "BOL", name: "Bologna", slug: "bologna" },
  { code: "CAG", name: "Cagliari", slug: "cagliari" },
  { code: "COM", name: "Como", slug: "como" },
  { code: "FIO", name: "Fiorentina", slug: "fiorentina" },
  { code: "FRO", name: "Frosinone", slug: "frosinone" },
  { code: "GEN", name: "Genoa", slug: "genoa" },
  { code: "INT", name: "Inter", slug: "inter" },
  { code: "JUV", name: "Juventus", slug: "juventus" },
  { code: "LAZ", name: "Lazio", slug: "lazio" },
  { code: "LEC", name: "Lecce", slug: "lecce" },
  { code: "MIL", name: "Milan", slug: "milan" },
  { code: "MON", name: "Monza", slug: "monza" },
  { code: "NAP", name: "Napoli", slug: "napoli" },
  { code: "PAR", name: "Parma", slug: "parma" },
  { code: "ROM", name: "Roma", slug: "roma" },
  { code: "SAS", name: "Sassuolo", slug: "sassuolo" },
  { code: "TOR", name: "Torino", slug: "torino" },
  { code: "UDI", name: "Udinese", slug: "udinese" },
  { code: "VEN", name: "Venezia", slug: "venezia" },
];

async function main() {
  for (const team of SERIE_A_TEAMS_2026_27) {
    await db
      .insert(teams)
      .values(team)
      .onConflictDoUpdate({
        target: teams.slug,
        set: { code: team.code, name: team.name },
      });
  }
  const count = rawDb.prepare("SELECT COUNT(*) as n FROM teams").get() as {
    n: number;
  };
  console.log(`Squadre seedate: ${count.n}`);
}

main();
