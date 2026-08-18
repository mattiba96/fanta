import * as statistiche from "@/lib/scraping/sources/statistiche";
import * as listone from "@/lib/scraping/sources/listone";
import * as setPieces from "@/lib/scraping/sources/setPieces";
import * as probabiliFormazioni from "@/lib/scraping/sources/probabiliFormazioni";
import * as news from "@/lib/scraping/sources/news";
import * as fcpRatings from "@/lib/scraping/sources/fcpRatings";
import { db } from "@/db/client";
import { players } from "@/db/schema";
import { eq, isNotNull, and } from "drizzle-orm";
import { downloadPlayerImage } from "@/lib/playerImageCache";

const DEFAULT_STATS_SEASON = "2025-26";

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const force = rest.includes("--force");

  switch (command) {
    case "statistiche": {
      const seasonArg = rest.find((a) => a.startsWith("--season="));
      const season = seasonArg ? seasonArg.split("=")[1] : DEFAULT_STATS_SEASON;
      console.log(`Scraping statistiche stagione ${season}...`);
      const result = await statistiche.run(season, { force });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "listone": {
      console.log("Scraping listone quotazioni...");
      const result = await listone.run({ force });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "rigoristi": {
      console.log("Scraping rigoristi/tiratori...");
      const result = await setPieces.run({ force });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "probabili": {
      console.log("Scraping probabili formazioni...");
      const result = await probabiliFormazioni.run({ force });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "news": {
      console.log("Scraping notizie...");
      const result = await news.run({ force });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "fcp": {
      console.log("Scraping indice appetibilità (FantaCalcioPedia)...");
      const result = await fcpRatings.run({ force });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "images": {
      const rows = await db
        .select({ id: players.id, externalId: players.externalId })
        .from(players)
        .where(and(eq(players.isActive, 1), isNotNull(players.externalId)));
      console.log(`Scarico ${rows.length} immagini in data/campioncini/...`);
      let ok = 0;
      let failed = 0;
      for (const row of rows) {
        const success = await downloadPlayerImage(row.externalId!);
        if (success) ok++;
        else failed++;
        await new Promise((r) => setTimeout(r, 150));
      }
      console.log(JSON.stringify({ total: rows.length, downloaded: ok, failed }, null, 2));
      break;
    }
    default:
      console.error(
        `Comando sconosciuto: "${command}".\nUso: npm run scrape -- <statistiche|listone|rigoristi|probabili|news|fcp|images> [--season=2025-26] [--force]`,
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
