import { buildLiveAuctionSnapshot } from "@/lib/liveAuction/recommend";
import { FantaAstaConnectionError } from "@/lib/liveAuction/fantaAstaReader";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawMyTeamIndex = searchParams.get("myTeamIndex");

  let myTeamIndex = 0;
  if (rawMyTeamIndex != null) {
    const parsed = Number(rawMyTeamIndex);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return Response.json(
        { error: "Indice squadra non valido: deve essere un numero intero maggiore o uguale a 0.", source: "input" },
        { status: 400 },
      );
    }
    myTeamIndex = parsed;
  }

  try {
    const snapshot = await buildLiveAuctionSnapshot(myTeamIndex);
    return Response.json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore sconosciuto durante la lettura dell'asta.";
    // Distinguiamo i problemi di comunicazione con FantaAsta Desktop (per cui
    // ha senso proporre di riaprire l'app) da altri errori, es. query al DB
    // di Fantacucciolo: non sono la stessa cosa e non si risolvono allo
    // stesso modo.
    const source = err instanceof FantaAstaConnectionError ? "fantaasta" : "internal";
    return Response.json({ error: message, source }, { status: source === "fantaasta" ? 503 : 500 });
  }
}
