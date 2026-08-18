// URL del "campioncino" (illustrazione giocatore) di fantacalcio.it, servito
// tramite /api/campioncino/[id] che lo scarica e lo mette in cache su disco
// al primo utilizzo (vedi src/app/api/campioncino/[id]/route.ts) — non un
// hotlink diretto al CDN esterno, così le immagini restano disponibili anche
// offline una volta viste. L'id è quello numerico esterno già salvato in
// players.external_id.
export function getPlayerImageUrl(externalId: string | null): string | null {
  if (!externalId) return null;
  return `/api/campioncino/${externalId}`;
}
