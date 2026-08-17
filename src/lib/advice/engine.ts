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
// Sotto questa soglia di presenze, il rapporto fantamedia/quotazione non è
// affidabile (un giocatore da 1 credito con 1 sola partita giocata avrebbe
// un rapporto enorme senza significato) — resta fuori dal ranking di valore.
const MIN_PV_FOR_VALUE_RANKING = 10;

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
export function buildAdviceForRoleGroup(inputs: AdviceInput[]): Map<number, Advice> {
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
    const score = Math.round(valueScore100 * 0.55 + starterScore100 * 0.3 + reliabilityScore100 * 0.15);

    let suggestedPrice: number | null = null;
    const base = r.input.fvmClassic ?? r.input.quotCurrentClassic;
    if (base != null) {
      let multiplier = 1;
      const worst = pickWorstLineupStatus(r.input.lineupStatuses);
      if (worst?.status === "injured") multiplier *= 0.6;
      else if (worst?.status === "suspended") multiplier *= 0.9;
      else if (worst?.status === "doubt") multiplier *= 0.95;
      if (r.input.setPiece.penalty === 1) multiplier *= 1.1;
      suggestedPrice = Math.max(1, Math.round(base * multiplier));
    }

    const tags = [...lineupTags(r.input.lineupStatuses), ...setPieceTags(r.input.setPiece)];
    if (r.reliability != null && r.reliability < 0.5) {
      tags.push("Poche presenze la scorsa stagione");
    }

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
