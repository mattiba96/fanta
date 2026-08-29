import { buildLiveAuctionSnapshot } from "@/lib/liveAuction/recommend";
import { FantaAstaConnectionError, FantaAstaUnsupportedEnvironmentError } from "@/lib/liveAuction/fantaAstaReader";

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
    // Distinguiamo tre casi: problema strutturale (server remoto, es. Vercel,
    // che non potrà mai raggiungere l'app sul Mac dell'utente — riprovare o
    // riaprire l'app non serve a nulla), problema di comunicazione con
    // FantaAsta Desktop (per cui ha senso proporre di riaprire l'app), e
    // altri errori (es. query al DB di Fantacucciolo) che non hanno nulla a
    // che fare con l'app desktop.
    const source =
      err instanceof FantaAstaUnsupportedEnvironmentError
        ? "unsupported-environment"
        : err instanceof FantaAstaConnectionError
          ? "fantaasta"
          : "internal";
    return Response.json({ error: message, source }, { status: source === "internal" ? 500 : 503 });
  }
}
