export type Role = "P" | "D" | "C" | "A";

export type SetPiecePriority = {
  penalty?: number;
  freeKick?: number;
  corner?: number;
};

export type LineupStatusInput = {
  status: string; // starter | bench | doubt | injured | suspended | warned
  probability: number | null;
  note: string | null;
};

export type AdviceInput = {
  playerId: number;
  role: Role | null;
  quotCurrentClassic: number | null;
  fvmClassic: number | null;
  pv: number | null;
  mv: number | null;
  fm: number | null;
  goals: number | null;
  assists: number | null;
  yellowCards: number | null;
  redCards: number | null;
  setPiece: SetPiecePriority;
  lineupStatuses: LineupStatusInput[];
  /** Fantamedia delle stagioni precedenti (escl. quella corrente), un valore
   * per stagione disponibile, in un ordine qualsiasi — serve solo la media. */
  historicalFm: number[];
};

export type Advice = {
  score: number; // 0-100, indice sintetico (valore + titolarità + affidabilità)
  band: "top" | "semi-top" | "centrale" | "scommessa";
  suggestedPrice: number | null;
  reliability: number | null; // 0-1, presenze sulle partite totali
  starterConfidence: number | null; // 0-100
  fmPerCredit: number | null;
  tags: string[];
};

const GAMES_PER_SEASON = 38;
// Convenzione fantacalcio.it: l'FVM ("Fantavalore di Mercato") pubblicato nel
// listone è calibrato assumendo un'asta classica da 500 crediti a manager.
// Se l'utente gioca con un budget diverso, il prezzo consigliato va riscalato
// proporzionalmente — altrimenti "prezzo consigliato" resterebbe legato a
// un'asta diversa dalla sua, non a quella reale configurata in Impostazioni.
const FVM_STANDARD_BUDGET = 500;
// Sotto questa soglia di presenze, il rapporto fantamedia/quotazione non è
// affidabile (un giocatore da 1 credito con 1 sola partita giocata avrebbe
// un rapporto enorme senza significato) — resta fuori dal ranking di valore.
const MIN_PV_FOR_VALUE_RANKING = 10;

// L'FVM premia il rendimento-bonus allo stesso modo per tutti i ruoli, ma il
// mercato reale (aste vere, non listino) realizza solo una FRAZIONE di quel
// premio per ruoli diversi dall'attacco — calibrato sui prezzi REALMENTE
// pagati in 3 aste passate dell'utente (una con lo stesso roster dell'attuale
// stagione): confrontando "prezzo pagato - quotazione" con "FVM - quotazione"
// per ~140 giocatori realmente venduti, il mercato realizza in media solo il
// 13-17% del premio FVM per centrocampisti/difensori, contro il 50-60% per
// attaccanti/portieri. Senza questo sconto, "prezzo consigliato" rispecchiava
// l'FVM 1:1 e proponeva cifre come 49 crediti per un difensore da quotazione
// 15 — mai realmente pagate in pratica.
const ROLE_PREMIUM_DAMPENING: Record<Role, number> = {
  A: 0.5,
  P: 0.55,
  D: 0.17,
  C: 0.13,
};

const BAND_LABELS: Record<Advice["band"], string> = {
  top: "Top",
  "semi-top": "Semi-top",
  centrale: "Centrale",
  scommessa: "Scommessa",
};

export function bandLabel(band: Advice["band"]): string {
  return BAND_LABELS[band];
}

function pickWorstLineupStatus(statuses: LineupStatusInput[]): LineupStatusInput | null {
  const priority: Record<string, number> = {
    injured: 5,
    suspended: 4,
    doubt: 3,
    warned: 2,
    bench: 1,
    starter: 0,
  };
  if (statuses.length === 0) return null;
  return statuses.slice().sort((a, b) => (priority[b.status] ?? 0) - (priority[a.status] ?? 0))[0];
}

function computeStarterConfidence(statuses: LineupStatusInput[]): number | null {
  const worst = pickWorstLineupStatus(statuses);
  if (!worst) return null;
  switch (worst.status) {
    case "injured":
    case "suspended":
      return 0;
    case "doubt":
    case "warned":
      return worst.probability ?? 40;
    case "bench":
      return worst.probability ?? 15;
    case "starter":
      return worst.probability ?? 75;
    default:
      return null;
  }
}

function setPieceTags(sp: SetPiecePriority): string[] {
  const tags: string[] = [];
  if (sp.penalty === 1) tags.push("Rigorista designato");
  else if (sp.penalty != null && sp.penalty <= 3) tags.push(`Rigorista (opzione ${sp.penalty})`);
  if (sp.freeKick === 1) tags.push("Tiratore punizioni");
  if (sp.corner === 1) tags.push("Tiratore corner");
  return tags;
}

const TREND_MIN_SEASONS = 1; // basta un anno di storico per un confronto di massima
const TREND_UP_RATIO = 1.08;
const TREND_DOWN_RATIO = 0.92;
const TREND_SCORE_ADJUSTMENT = 5;

/**
 * Confronta la fantamedia corrente con la media delle stagioni passate: chi è
 * in crescita rispetto al proprio storico merita un piccolo bonus (segnale di
 * un giocatore che sta crescendo, non solo "quotato alto"), chi è in calo un
 * piccolo malus — mai abbastanza da ribaltare da solo fascia/valore, è un
 * correttivo secondario esplicitamente richiesto in aggiunta alla sola
 * stagione corrente.
 */
function classifyTrend(
  currentFm: number | null,
  historicalFm: number[],
): { tag: string | null; adjustment: number } {
  const past = historicalFm.filter((v): v is number => v != null && Number.isFinite(v));
  if (currentFm == null || past.length < TREND_MIN_SEASONS) return { tag: null, adjustment: 0 };

  const avgPast = past.reduce((a, b) => a + b, 0) / past.length;
  if (avgPast <= 0) return { tag: null, adjustment: 0 };

  const ratio = currentFm / avgPast;
  if (ratio >= TREND_UP_RATIO) {
    return { tag: "In crescita sugli anni scorsi", adjustment: TREND_SCORE_ADJUSTMENT };
  }
  if (ratio <= TREND_DOWN_RATIO) {
    return { tag: "In calo sugli anni scorsi", adjustment: -TREND_SCORE_ADJUSTMENT };
  }
  return { tag: null, adjustment: 0 };
}

function lineupTags(statuses: LineupStatusInput[]): string[] {
  const worst = pickWorstLineupStatus(statuses);
  if (!worst) return [];
  const pct = worst.probability != null ? ` (${worst.probability}%)` : "";
  switch (worst.status) {
    case "injured":
      return [`Infortunato${worst.note ? ` — ${worst.note}` : ""}`];
    case "suspended":
      return ["Squalificato"];
    case "doubt":
      return [`In dubbio${pct}`];
    case "warned":
      return ["Diffidato"];
    case "bench":
      return [`Panchina${pct}`];
    case "starter":
      return [`Titolare${pct}`];
    default:
      return [];
  }
}

/**
 * Calcola i consigli per un gruppo di giocatori dello STESSO ruolo: fasce e
 * indice sono percentili relativi al gruppo, quindi vanno sempre passati
 * insieme tutti i giocatori disponibili di quel ruolo, non uno alla volta.
 */
export function buildAdviceForRoleGroup(
  inputs: AdviceInput[],
  totalBudget: number = FVM_STANDARD_BUDGET,
): Map<number, Advice> {
  const result = new Map<number, Advice>();
  if (inputs.length === 0) return result;

  type Raw = {
    input: AdviceInput;
    fmPerCredit: number | null;
    reliability: number | null;
    starterConfidence: number | null;
  };

  const raw: Raw[] = inputs.map((input) => ({
    input,
    fmPerCredit:
      input.fm != null &&
      input.quotCurrentClassic &&
      (input.pv ?? 0) >= MIN_PV_FOR_VALUE_RANKING
        ? input.fm / input.quotCurrentClassic
        : null,
    reliability: input.pv != null ? Math.min(1, input.pv / GAMES_PER_SEASON) : null,
    starterConfidence: computeStarterConfidence(input.lineupStatuses),
  }));

  // Fasce di prezzo: percentile di quotazione all'interno del ruolo (fra i
  // disponibili), non delle prestazioni — rispecchia le fasce da guida
  // all'asta (Top/Semi-top/Centrale/Scommessa).
  const byPrice = raw
    .filter((r) => r.input.quotCurrentClassic != null)
    .slice()
    .sort((a, b) => (b.input.quotCurrentClassic ?? 0) - (a.input.quotCurrentClassic ?? 0));
  const priceRank = new Map<number, number>(); // playerId -> percentile 0..1 (0 = più caro)
  byPrice.forEach((r, i) => priceRank.set(r.input.playerId, i / Math.max(1, byPrice.length - 1)));

  // Indice di valore: percentile di fm/quotazione all'interno del ruolo.
  const byValue = raw
    .filter((r) => r.fmPerCredit != null)
    .slice()
    .sort((a, b) => (b.fmPerCredit ?? 0) - (a.fmPerCredit ?? 0));
  const valueRank = new Map<number, number>(); // playerId -> percentile 0..1 (0 = miglior valore)
  byValue.forEach((r, i) => valueRank.set(r.input.playerId, i / Math.max(1, byValue.length - 1)));

  for (const r of raw) {
    const pricePercentile = priceRank.get(r.input.playerId);
    const band: Advice["band"] =
      pricePercentile == null
        ? "scommessa"
        : pricePercentile <= 0.1
          ? "top"
          : pricePercentile <= 0.35
            ? "semi-top"
            : pricePercentile <= 0.75
              ? "centrale"
              : "scommessa";

    const valuePercentile = valueRank.get(r.input.playerId) ?? 0.5;
    const valueScore100 = (1 - valuePercentile) * 100;
    const starterScore100 = r.starterConfidence ?? 50;
    const reliabilityScore100 = (r.reliability ?? 0.5) * 100;
    const baseScore = valueScore100 * 0.55 + starterScore100 * 0.3 + reliabilityScore100 * 0.15;

    const trend = classifyTrend(r.input.fm, r.input.historicalFm);
    const score = Math.round(Math.min(100, Math.max(0, baseScore + trend.adjustment)));

    let suggestedPrice: number | null = null;
    const quot = r.input.quotCurrentClassic;
    const fvm = r.input.fvmClassic;
    if (quot != null || fvm != null) {
      const baseQuot = quot ?? fvm!;
      const baseFvm = fvm ?? baseQuot;
      const dampening = r.input.role != null ? ROLE_PREMIUM_DAMPENING[r.input.role] : 1;
      const dampenedBase = baseQuot + Math.max(0, baseFvm - baseQuot) * dampening;

      let multiplier = totalBudget / FVM_STANDARD_BUDGET;
      const worst = pickWorstLineupStatus(r.input.lineupStatuses);
      if (worst?.status === "injured") multiplier *= 0.6;
      else if (worst?.status === "suspended") multiplier *= 0.9;
      else if (worst?.status === "doubt") multiplier *= 0.95;
      if (r.input.setPiece.penalty === 1) multiplier *= 1.1;
      suggestedPrice = Math.max(1, Math.round(dampenedBase * multiplier));
    }

    const tags = [...lineupTags(r.input.lineupStatuses), ...setPieceTags(r.input.setPiece)];
    if (r.reliability != null && r.reliability < 0.5) {
      tags.push("Poche presenze la scorsa stagione");
    }
    if (trend.tag) tags.push(trend.tag);

    result.set(r.input.playerId, {
      score,
      band,
      suggestedPrice,
      reliability: r.reliability,
      starterConfidence: r.starterConfidence,
      fmPerCredit: r.fmPerCredit,
      tags,
    });
  }

  return result;
}
