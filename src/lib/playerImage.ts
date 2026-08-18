// URL del "campioncino" (foto/avatar) di fantacalcio.it, costruito dall'id
// numerico esterno del giocatore già salvato in players.external_id. Nessuno
// scraping necessario: il pattern è stabile (verificato su centinaia di
// giocatori nelle probabili formazioni già raccolte).
export function getPlayerImageUrl(externalId: string | null): string | null {
  if (!externalId) return null;
  return `https://content.fantacalcio.it/web/campioncini/21/small/${externalId}.png`;
}
