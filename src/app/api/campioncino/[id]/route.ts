import { downloadPlayerImage, readCachedImage } from "@/lib/playerImageCache";

/**
 * Proxy con cache su disco per i "campioncini" (illustrazioni giocatore) di
 * fantacalcio.it: la prima richiesta per un id li scarica e li salva in
 * data/campioncini/, le successive li servono dal filesystem locale — niente
 * più dipendenza dalla rete una volta visti, e i file restano lì come veri
 * PNG scaricabili, non solo un link remoto.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return new Response(null, { status: 400 });
  }

  const ok = await downloadPlayerImage(id);
  if (!ok) return new Response(null, { status: 404 });

  const buf = readCachedImage(id);
  if (!buf) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
