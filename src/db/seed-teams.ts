import { db } from "./client";
import { teams } from "./schema";
import { count } from "drizzle-orm";

// Le 20 squadre di Serie A 2026/27 (fonte: Wikipedia, verificato 17/08/2026).
// `externalId` è l'id numerico interno di fantacalcio.it (da data-filter-team-id
// e dal filtro Squadra su /statistiche-serie-a, verificato via fetch reale) — è la
// chiave di join più robusta. `code` (sigla 3 lettere) verificato sugli stessi dati
// per 17/20 squadre; per le 3 neopromosse (Frosinone/Monza/Venezia, assenti dalle
// statistiche 2025/26 perché in Serie B l'anno scorso) è la sigla standard attesa,
// da confermare al primo scraping reale (finiscono in "nomi non riconosciuti" se sbagliata).
const SERIE_A_TEAMS_2026_27 = [
  { externalId: 1, code: "ATA", name: "Atalanta", slug: "atalanta" },
  { externalId: 2, code: "BOL", name: "Bologna", slug: "bologna" },
  { externalId: 21, code: "CAG", name: "Cagliari", slug: "cagliari" },
  { externalId: 153, code: "COM", name: "Como", slug: "como" },
  { externalId: 6, code: "FIO", name: "Fiorentina", slug: "fiorentina" },
  { externalId: 7, code: "FRO", name: "Frosinone", slug: "frosinone" },
  { externalId: 8, code: "GEN", name: "Genoa", slug: "genoa" },
  { externalId: 9, code: "INT", name: "Inter", slug: "inter" },
  { externalId: 10, code: "JUV", name: "Juventus", slug: "juventus" },
  { externalId: 11, code: "LAZ", name: "Lazio", slug: "lazio" },
  { externalId: 119, code: "LEC", name: "Lecce", slug: "lecce" },
  { externalId: 12, code: "MIL", name: "Milan", slug: "milan" },
  { externalId: 143, code: "MON", name: "Monza", slug: "monza" },
  { externalId: 13, code: "NAP", name: "Napoli", slug: "napoli" },
  { externalId: 107, code: "PAR", name: "Parma", slug: "parma" },
  { externalId: 15, code: "ROM", name: "Roma", slug: "roma" },
  { externalId: 17, code: "SAS", name: "Sassuolo", slug: "sassuolo" },
  { externalId: 18, code: "TOR", name: "Torino", slug: "torino" },
  { externalId: 19, code: "UDI", name: "Udinese", slug: "udinese" },
  { externalId: 138, code: "VEN", name: "Venezia", slug: "venezia" },
];

async function main() {
  for (const team of SERIE_A_TEAMS_2026_27) {
    await db
      .insert(teams)
      .values(team)
      .onConflictDoUpdate({
        target: teams.slug,
        set: { code: team.code, name: team.name, externalId: team.externalId },
      });
  }
  const [{ n }] = await db.select({ n: count() }).from(teams);
  console.log(`Squadre seedate: ${n}`);
}

main();
