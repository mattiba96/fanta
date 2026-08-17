import * as statistiche from "@/lib/scraping/sources/statistiche";
import * as listone from "@/lib/scraping/sources/listone";

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
    default:
      console.error(
        `Comando sconosciuto: "${command}".\nUso: npm run scrape -- <statistiche|listone> [--season=2025-26] [--force]`,
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
