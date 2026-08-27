import { getOrFetchPlayerImage } from "@/lib/playerImageCache";

/**
 * Proxy per i "campioncini" (illustrazioni giocatore) di fantacalcio.it: in
 * locale li mette in cache su data/campioncini/ al primo utilizzo (niente più
 * dipendenza dalla rete una volta visti); in produzione (filesystem di sola
 * lettura) serve comunque l'immagine ad ogni richiesta, affidandosi
 * all'header Cache-Control per la cache lato browser/CDN.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return new Response(null, { status: 400 });
  }

  const buf = await getOrFetchPlayerImage(id);
  if (!buf) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
