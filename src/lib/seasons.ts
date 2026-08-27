// Stagione di riferimento per le statistiche: l'unica stagione completa
// disponibile oggi (2026-27 è appena iniziata, statistiche ancora a zero).
export const DEFAULT_STATS_SEASON = "2025-26";
// Stagioni storiche mostrate in scheda giocatore oltre a quella di riferimento
// (richiesta esplicita: "statistiche fino a 4 anni fa"). Non sono la stagione
// di riferimento per l'advice engine, solo contesto in più. Ordine dal più
// recente al più vecchio.
export const HISTORICAL_STATS_SEASONS = ["2024-25", "2023-24", "2022-23", "2021-22"];
