import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { players, playerSeasonStats, setPieceRoles, lineupPlayers, historicalAuctionPrices } from "@/db/schema";
import {
  buildAdviceForRoleGroup,
  bandLabel,
  type AdviceInput,
  type Advice,
  type Role,
  type SetPiecePriority,
  type LineupStatusInput,
} from "@/lib/advice/engine";
import { DEFAULT_STATS_SEASON, HISTORICAL_STATS_SEASONS } from "@/lib/seasons";
import {
  readFantaAstaState,
  deriveTeams,
  transactedPlayerIds,
  getSelectedPlayer,
  ZONE_TO_ROLE_CLASSIC,
  type FantaAstaPlayer,
  type FantaAstaRosterHash,
  type FantaAstaSettings,
  type FantaAstaTeamSnapshot,
} from "@/lib/liveAuction/fantaAstaReader";
import { getPlayerSpotlight, type PlayerSpotlight } from "@/lib/liveAuction/spotlight";

// Ordine delle fasce di mercato (band), dalla più alta alla più bassa —
// serve a evitare di confrontare per solo "punteggio" (indice di VALORE,
// non di qualità assoluta) giocatori di fasce di prezzo troppo diverse.
const BAND_RANK: Record<Advice["band"], number> = { top: 3, "semi-top": 2, centrale: 1, scommessa: 0 };

// keyof FantaAstaRosterHash risulterebbe "string" (l'interfaccia ha anche un
// index signature per campi non ancora osservati): la union esplicita qui
// mantiene i literal type, così l'indicizzazione sotto resta tipizzata.
const ROLE_TO_ZONE: Record<Role, "gk" | "def" | "mid" | "atk"> = {
  P: "gk",
  D: "def",
  C: "mid",
  A: "atk",
};

export type LiveAdvice = {
  player: {
    id: number;
    externalId: string;
    slug: string;
    name: string;
    team: string | null;
    roleClassic: Role;
    zone: FantaAstaPlayer["zone"];
  };
  advice: Advice;
  // suggestedPrice puro FVM * roleInflationFactor del ruolo (vedi
  // marketTrend più sotto): null quando suggestedPrice stesso è null. Questo
  // è il prezzo usato per "affordable" e per i confronti nel verdetto —
  // advice.suggestedPrice resta invariato per mostrare sempre anche il dato
  // FVM puro.
  adjustedPrice: number | null;
  affordable: boolean;
};

// Quanto il mercato di QUESTA asta si sta discostando dalla formula FVM per
// ciascun ruolo: factor = media di (costo realmente pagato / prezzo che la
// formula avrebbe suggerito per quel giocatore) sulle transazioni già
// avvenute in questa asta con un prezzo suggerito valido; 1 = nessun
// aggiustamento (ruolo senza abbastanza transazioni valide per fidarsi).
export type MarketTrendInfo = {
  factor: number;
  sampleSize: number;
};

// Quante squadre (tra le "altre") possono ancora competere per il ruolo del
// giocatore attualmente in visione: hanno slot liberi in quel ruolo E
// credits sufficienti per un'offerta minima.
export type CompetingTeamsInfo = {
  canStillBid: number;
  total: number;
  message: string;
};

// Confronto tra quanto budget ho già speso e quanti slot ho già riempito per
// la mia squadra: un forte scarto tra i due segnala un ritmo di spesa
// squilibrato rispetto agli slot rimanenti. Le percentuali sono frazioni
// 0..1 (stessa convenzione di RoleBudgetInfo.share).
export type SpendingPaceInfo = {
  budgetSpentPct: number;
  slotsFilledPct: number;
  message: string | null;
};

// Backend stateless: nessuna chiamata "ricorda" quella precedente, quindi
// "cosa è cambiato dall'ultimo poll" (per i commenti automatici post-acquisto
// lato client) va rilevato confrontando gli id qui esposti tra un poll e il
// successivo. id è l'id transazione di FantaAsta (stabile e univoco).
// wasRecommended/wasTopPick/suggestedPrice sono ricostruiti con la STESSA
// logica di marketTrend sopra: un mini-gruppo "giocatore venduto + suoi pari
// ruolo ancora disponibili ORA" (non al momento reale della vendita, che non
// abbiamo modo di ricostruire senza tenere uno storico dei gruppi nel tempo).
// È quindi un'approssimazione che degrada in modo prevedibile quando il
// ruolo è quasi esaurito (pochi pari rimasti con cui confrontarsi, più
// facile risultare "il migliore libero" per pura scarsità di alternative).
export type RecentTransactionInfo = {
  id: number;
  playerName: string;
  teamName: string;
  cost: number;
  role: Role | null;
  wasRecommended: boolean;
  wasTopPick: boolean;
  suggestedPrice: number | null;
};

// Budget "reattivo" di reparto: quanto dovrebbe valere il ruolo (share del
// FVM totale sui giocatori attivi, applicata al budget d'asta), quanto ho
// speso finora sul ruolo, e quanto posso ancora offrire su quel ruolo
// tenendo conto sia dello sforamento/risparmio sia degli slot ancora liberi.
export type RoleBudgetInfo = {
  share: number;
  targetBudget: number;
  spent: number;
  remaining: number;
  maxOfferForRole: number;
};

export type Verdict = {
  action: "punta" | "aspetta" | "attenzione";
  headline: string;
  detail: string;
  ceiling: number | null;
};

export type LiveAuctionSnapshot = {
  settings: FantaAstaSettings;
  myTeam: FantaAstaTeamSnapshot | null;
  otherTeams: FantaAstaTeamSnapshot[];
  bestPicksByRole: Record<Role, LiveAdvice[]>;
  roleBudget: Record<Role, RoleBudgetInfo>;
  marketTrend: Record<Role, MarketTrendInfo>;
  selectedPlayer: PlayerSpotlight | null;
  verdict: Verdict | null;
  // Null quando non c'è un giocatore in visione con ruolo riconosciuto (es.
  // asta non ancora iniziata): non legato alla presenza di un verdict (che
  // richiede anche selected.advice), solo al ruolo del giocatore selezionato.
  competingTeams: CompetingTeamsInfo | null;
  spendingPace: SpendingPaceInfo;
  recentTransactions: RecentTransactionInfo[];
};

// Non serve mostrare più di questo per ruolo: la lista è comunque ordinata
// per punteggio, quindi i migliori restano sempre in cima.
const MAX_PICKS_PER_ROLE = 30;

// A fine asta le transazioni totali possono arrivare a qualche centinaio: il
// client si accorge comunque di ogni nuova vendita ad ogni poll (4s), non
// serve esporre l'intera storia per confrontare "cosa è cambiato dall'ultimo
// poll" — solo le più recenti.
const RECENT_TRANSACTIONS_LIMIT = 20;

// Soglia per "era tra i consigliati" nel commento post-acquisto: stesso
// criterio del taglio mostrato in bestPicksByRole (i migliori restano in
// cima alla lista ordinata per punteggio).
const TOP_N_FOR_RECOMMENDED = 5;

const ROLE_LIST = Object.keys(ROLE_TO_ZONE) as Role[];

const EMPTY_ROLE_RECORD = <T>(): Record<Role, T[]> => ({ P: [], D: [], C: [], A: [] });

export async function buildLiveAuctionSnapshot(myTeamName: string): Promise<LiveAuctionSnapshot> {
  const state = await readFantaAstaState();
  const teams = deriveTeams(state);
  const normalizedName = myTeamName.trim().toLowerCase();
  const myTeam = teams.find((t) => t.name.trim().toLowerCase() === normalizedName) ?? null;
  const otherTeams = teams.filter((t) => t !== myTeam);

  // Finché la mia squadra non ha ancora vinto un giocatore, non esiste uno
  // snapshot per lei in `transactions` (deriveTeams si basa solo su quello):
  // myTeam è quindi null nel normalissimo caso "asta in corso, ancora nessun
  // acquisto mio", non solo per un nome che non corrisponde a nessuna
  // squadra. In questo caso
  // usiamo i valori di default dell'asta (budget/slot iniziali) invece di
  // trattare la mia squadra come "senza alcun limite di budget o di ruolo".
  const rosterComposition = state.data.settings.rosterComposition;
  const totalRosterSlots =
    rosterComposition.gk + rosterComposition.def + rosterComposition.mid + rosterComposition.atk;
  const defaultMaxOffer = state.data.settings.startingBudget - (totalRosterSlots - 1);
  const effectiveMaxOffer = myTeam?.maxOffer ?? defaultMaxOffer;
  const effectiveRosterHash: FantaAstaRosterHash = myTeam?.rosterHash ?? {
    gk: rosterComposition.gk,
    def: rosterComposition.def,
    mid: rosterComposition.mid,
    atk: rosterComposition.atk,
  };

  // Ritmo di spesa: confronta quanto budget ho già bruciato con quanti slot
  // ho già riempito. Stessi default usati sopra per il caso "asta appena
  // iniziata, ancora nessun acquisto mio" (myTeam null): 0% speso, 0% slot
  // riempiti, ritmo per definizione equilibrato.
  const effectiveCredits = myTeam?.credits ?? state.data.settings.startingBudget;
  const effectivePlayersToBuy = myTeam?.playersToBuy ?? totalRosterSlots;
  const budgetSpentPct = 1 - effectiveCredits / state.data.settings.startingBudget;
  const slotsFilledPct = 1 - effectivePlayersToBuy / totalRosterSlots;
  const spendingPaceDiff = budgetSpentPct - slotsFilledPct;
  const SPENDING_PACE_MARGIN = 0.15;
  const spendingPace: SpendingPaceInfo = {
    budgetSpentPct,
    slotsFilledPct,
    message:
      spendingPaceDiff > SPENDING_PACE_MARGIN
        ? "Stai spendendo più in fretta di quanto riempi la rosa: attenzione al budget per gli slot rimanenti."
        : spendingPaceDiff < -SPENDING_PACE_MARGIN
          ? "Stai riempiendo la rosa più in fretta di quanto spendi: hai margine per spendere di più sui prossimi acquisti."
          : null,
  };

  // Quote di budget per reparto scelte dall'utente in base alla sua
  // strategia dichiarata (portiere top, difesa low cost/bonus, centrocampo
  // super-top, attacco 2 semitop + 1 discreto) — non una quota di mercato
  // neutra: P e C sopra la quota che avrebbero per solo valore FVM, D sotto.
  const roleShare: Record<Role, number> = { P: 0.08, D: 0.12, C: 0.45, A: 0.35 };

  // Tetto storico per ruolo: il massimo REALMENTE pagato in 5 stagioni di
  // aste (tabella historical_auction_prices) per QUALSIASI giocatore di quel
  // ruolo — un limite di realtà indipendente dal singolo giocatore, per i
  // casi (come Malen) in cui non esiste storico player-specific ma la
  // formula FVM suggerisce comunque un prezzo mai visto nella pratica.
  const roleMaxRows = await db
    .select({ role: historicalAuctionPrices.role, maxPrice: sql<number>`max(${historicalAuctionPrices.price})` })
    .from(historicalAuctionPrices)
    .groupBy(historicalAuctionPrices.role);
  const roleHistoricalMax: Partial<Record<Role, number>> = {};
  for (const r of roleMaxRows) {
    if (r.role && r.role in ROLE_TO_ZONE) roleHistoricalMax[r.role as Role] = r.maxPrice;
  }

  // Quanto la mia squadra ha già speso per ruolo finora: stesso criterio di
  // corrispondenza usato sopra per individuare myTeam (nome normalizzato),
  // applicato alla squadra registrata su ciascuna transazione.
  const spentByRole: Record<Role, number> = { P: 0, D: 0, C: 0, A: 0 };
  for (const tx of state.data.transactions ?? []) {
    if (tx.team.name.trim().toLowerCase() !== normalizedName) continue;
    const role = ZONE_TO_ROLE_CLASSIC[tx.player.zone];
    if (!role) continue;
    spentByRole[role] += tx.cost;
  }

  const roleBudget = {} as Record<Role, RoleBudgetInfo>;
  for (const role of ROLE_LIST) {
    const targetBudget = Math.round(roleShare[role] * state.data.settings.startingBudget);
    const spent = spentByRole[role];
    const remaining = targetBudget - spent;
    // Riserva 1 credito per ciascuno degli ALTRI slot ancora da riempire in
    // questo ruolo (non per quello che sto eventualmente per comprare ora).
    const slotsLeftForRole = effectiveRosterHash[ROLE_TO_ZONE[role]];
    const reserve = Math.max(0, slotsLeftForRole - 1);
    const roleMaxOffer = Math.max(1, remaining - reserve);
    roleBudget[role] = {
      share: roleShare[role],
      targetBudget,
      spent,
      remaining,
      // Non può comunque superare il tetto globale già calcolato sopra
      // (basato su TUTTI gli slot rimanenti, non solo di questo ruolo).
      maxOfferForRole: Math.min(effectiveMaxOffer, roleMaxOffer),
    };
  }

  // players[].sold da solo non è affidabile (visto dal vivo disallinearsi
  // dalle transazioni reali in entrambe le direzioni): un giocatore è preso
  // se risulta venduto O se compare in almeno una transazione, a scapito di
  // qualche falso "non disponibile" — meglio che consigliare un giocatore
  // già assegnato durante un'asta dal vivo.
  const takenIds = transactedPlayerIds(state);
  const availablePlayers = state.data.players.filter((p) => p.sold !== true && !takenIds.has(p.id));

  // Per i "prezzi reattivi" (marketTrend, sotto) serve anche il dato DB dei
  // giocatori GIÀ transati in questa asta, non solo quelli ancora
  // disponibili: la query sotto quindi copre l'unione dei due insiemi, così
  // da fare un solo giro di query invece di duplicarle.
  const transactions = state.data.transactions ?? [];
  const externalIds = Array.from(
    new Set([...availablePlayers.map((p) => String(p.id)), ...transactions.map((tx) => String(tx.player.id))]),
  );

  const rows =
    externalIds.length === 0
      ? []
      : await db
          .select({
            id: players.id,
            externalId: players.externalId,
            slug: players.slug,
            quotCurrentClassic: players.quotCurrentClassic,
            fvmClassic: players.fvmClassic,
            pv: playerSeasonStats.pv,
            mv: playerSeasonStats.mv,
            fm: playerSeasonStats.fm,
            goals: playerSeasonStats.goals,
            assists: playerSeasonStats.assists,
            yellowCards: playerSeasonStats.yellowCards,
            redCards: playerSeasonStats.redCards,
          })
          .from(players)
          .leftJoin(
            playerSeasonStats,
            and(
              eq(playerSeasonStats.playerId, players.id),
              eq(playerSeasonStats.season, DEFAULT_STATS_SEASON),
            ),
          )
          .where(inArray(players.externalId, externalIds));

  const dbIds = rows.map((r) => r.id);

  const historicalRows =
    dbIds.length === 0
      ? []
      : await db
          .select({ playerId: playerSeasonStats.playerId, fm: playerSeasonStats.fm })
          .from(playerSeasonStats)
          .where(
            and(
              inArray(playerSeasonStats.playerId, dbIds),
              inArray(playerSeasonStats.season, HISTORICAL_STATS_SEASONS),
            ),
          );
  const historicalFmByPlayer = new Map<number, number[]>();
  for (const r of historicalRows) {
    if (r.fm == null) continue;
    const arr = historicalFmByPlayer.get(r.playerId) ?? [];
    arr.push(r.fm);
    historicalFmByPlayer.set(r.playerId, arr);
  }

  const setPieceRows =
    dbIds.length === 0
      ? []
      : await db.select().from(setPieceRoles).where(inArray(setPieceRoles.playerId, dbIds));
  const setPieceByPlayer = new Map<number, SetPiecePriority>();
  for (const sp of setPieceRows) {
    if (!sp.playerId) continue;
    const entry = setPieceByPlayer.get(sp.playerId) ?? {};
    if (sp.kind === "penalty") entry.penalty = sp.priority;
    if (sp.kind === "free_kick") entry.freeKick = sp.priority;
    if (sp.kind === "corner") entry.corner = sp.priority;
    setPieceByPlayer.set(sp.playerId, entry);
  }

  const lineupRows =
    dbIds.length === 0
      ? []
      : await db.select().from(lineupPlayers).where(inArray(lineupPlayers.playerId, dbIds));
  const lineupByPlayer = new Map<number, LineupStatusInput[]>();
  for (const lp of lineupRows) {
    if (!lp.playerId) continue;
    const arr = lineupByPlayer.get(lp.playerId) ?? [];
    arr.push({ status: lp.status, probability: lp.probability, note: lp.note });
    lineupByPlayer.set(lp.playerId, arr);
  }

  const dbRowByExternalId = new Map(rows.map((r) => [r.externalId, r]));

  // Estratto in funzione perché serve in due punti: per costruire il gruppo
  // dei disponibili (sotto) e per costruire, a parte, l'AdviceInput di un
  // giocatore GIÀ transato quando calcoliamo cosa la formula avrebbe
  // suggerito per lui (marketTrend, sotto).
  const toAdviceInput = (dbRow: (typeof rows)[number], role: Role): AdviceInput => ({
    playerId: dbRow.id,
    role,
    quotCurrentClassic: dbRow.quotCurrentClassic,
    fvmClassic: dbRow.fvmClassic,
    pv: dbRow.pv,
    mv: dbRow.mv,
    fm: dbRow.fm,
    goals: dbRow.goals,
    assists: dbRow.assists,
    yellowCards: dbRow.yellowCards,
    redCards: dbRow.redCards,
    setPiece: setPieceByPlayer.get(dbRow.id) ?? {},
    lineupStatuses: lineupByPlayer.get(dbRow.id) ?? [],
    historicalFm: historicalFmByPlayer.get(dbRow.id) ?? [],
  });

  const grouped = EMPTY_ROLE_RECORD<{ input: AdviceInput; fantaAstaPlayer: FantaAstaPlayer; slug: string }>();

  for (const fap of availablePlayers) {
    const dbRow = dbRowByExternalId.get(String(fap.id));
    if (!dbRow) continue;
    const role = ZONE_TO_ROLE_CLASSIC[fap.zone];
    if (!role) continue;

    grouped[role].push({ input: toAdviceInput(dbRow, role), fantaAstaPlayer: fap, slug: dbRow.slug });
  }

  // Prezzi reattivi: per ogni transazione già avvenuta in QUESTA asta,
  // calcola cosa la formula FVM avrebbe suggerito per quel giocatore se
  // fosse ancora disponibile (mini-gruppo: lui + i suoi pari ruolo tra i
  // disponibili), poi confronta col prezzo REALMENTE pagato. roleInflation
  // è la media di questo rapporto per ruolo, usata sotto per adjustedPrice.
  const inflationRatiosByRole: Record<Role, number[]> = { P: [], D: [], C: [], A: [] };
  const recentTransactionsAll: RecentTransactionInfo[] = [];
  for (const tx of transactions) {
    const role = ZONE_TO_ROLE_CLASSIC[tx.player.zone] ?? null;
    const dbRow = role ? dbRowByExternalId.get(String(tx.player.id)) : undefined;

    let wasRecommended = false;
    let wasTopPick = false;
    let suggestedPriceForTx: number | null = null;

    if (role && dbRow) {
      const soldInput = toAdviceInput(dbRow, role);
      const peers = grouped[role].map((g) => g.input);
      const miniGroupAdvice = buildAdviceForRoleGroup([soldInput, ...peers], state.data.settings.startingBudget);
      const soldAdvice = miniGroupAdvice.get(soldInput.playerId)!;
      const formulaPrice = soldAdvice.suggestedPrice;
      suggestedPriceForTx = formulaPrice;

      if (formulaPrice != null && Number.isFinite(formulaPrice) && formulaPrice > 0) {
        inflationRatiosByRole[role].push(tx.cost / formulaPrice);
      }

      // Rank per punteggio nel mini-gruppo (0 = migliore): conta quanti pari
      // ruolo hanno un punteggio strettamente più alto, invece di ordinare
      // l'intero gruppo — evita di materializzare/ordinare l'array per ogni
      // singola transazione.
      const rank = Array.from(miniGroupAdvice.values()).filter((a) => a.score > soldAdvice.score).length;
      wasTopPick = rank === 0;
      wasRecommended = rank < TOP_N_FOR_RECOMMENDED;
    }

    recentTransactionsAll.push({
      id: tx.id,
      playerName: tx.player.name,
      teamName: tx.team.name,
      cost: tx.cost,
      role,
      wasRecommended,
      wasTopPick,
      suggestedPrice: suggestedPriceForTx,
    });
  }

  // Ordinate per id (assunto crescente nel tempo, come tipico di un id
  // transazione) invece di fidarsi dell'ordine di stato.data.transactions:
  // solo le più recenti servono al client per il confronto "cosa è cambiato
  // dall'ultimo poll".
  const recentTransactions = recentTransactionsAll
    .slice()
    .sort((a, b) => a.id - b.id)
    .slice(-RECENT_TRANSACTIONS_LIMIT);

  // Sotto le 4 transazioni valide il fattore non è affidabile: si lascia a 1
  // (nessun aggiustamento) invece di derivare un trend da un campione troppo
  // piccolo. Si usa la MEDIANA (non la media) dei rapporti: con la media,
  // una coppia di vendite atipiche (es. due riserve svendute a inizio asta)
  // può da sola spostare il fattore per l'intero ruolo senza alcuna
  // protezione dagli outlier; la mediana pesa molto meno un singolo dato
  // estremo.
  const MIN_SAMPLE_FOR_MARKET_TREND = 4;
  const median = (values: number[]): number => {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const marketTrend = {} as Record<Role, MarketTrendInfo>;
  for (const role of ROLE_LIST) {
    const ratios = inflationRatiosByRole[role];
    const sampleSize = ratios.length;
    marketTrend[role] = {
      factor: sampleSize >= MIN_SAMPLE_FOR_MARKET_TREND ? median(ratios) : 1,
      sampleSize,
    };
  }

  const bestPicksByRole = EMPTY_ROLE_RECORD<LiveAdvice>();

  for (const role of Object.keys(grouped) as Role[]) {
    const group = grouped[role];

    // Ruolo già completo per la mia squadra (0 slot rimanenti): niente da
    // consigliare, altrimenti si suggerirebbero acquisti non più necessari
    // (o non consentiti da FantaAsta stesso).
    if (effectiveRosterHash[ROLE_TO_ZONE[role]] <= 0) {
      bestPicksByRole[role] = [];
      continue;
    }

    const adviceMap = buildAdviceForRoleGroup(
      group.map((g) => g.input),
      state.data.settings.startingBudget,
    );

    const list: LiveAdvice[] = group.map(({ input, fantaAstaPlayer, slug }) => {
      const advice = adviceMap.get(input.playerId)!;
      const adjustedPrice =
        advice.suggestedPrice != null ? Math.round(advice.suggestedPrice * marketTrend[role].factor) : null;
      const affordable = adjustedPrice == null || adjustedPrice <= roleBudget[role].maxOfferForRole;

      return {
        player: {
          id: input.playerId,
          externalId: String(fantaAstaPlayer.id),
          slug,
          name: fantaAstaPlayer.name,
          team: fantaAstaPlayer.team ?? null,
          roleClassic: role,
          zone: fantaAstaPlayer.zone,
        },
        advice,
        adjustedPrice,
        affordable,
      };
    });

    list.sort((a, b) => b.advice.score - a.advice.score);
    bestPicksByRole[role] = list.slice(0, MAX_PICKS_PER_ROLE);
  }

  const selectedFantaAstaPlayer = getSelectedPlayer(state);
  const selectedPlayer = selectedFantaAstaPlayer
    ? await getPlayerSpotlight(String(selectedFantaAstaPlayer.id))
    : null;

  const selectedRole =
    selectedPlayer?.roleClassic && ROLE_LIST.includes(selectedPlayer.roleClassic as Role)
      ? (selectedPlayer.roleClassic as Role)
      : null;
  const verdict =
    selectedPlayer && selectedRole
      ? buildVerdict(
          selectedPlayer,
          bestPicksByRole[selectedRole].filter((p) => p.player.slug !== selectedPlayer.slug),
          roleBudget[selectedRole],
          roleHistoricalMax[selectedRole] ?? null,
          marketTrend[selectedRole],
        )
      : null;

  // Scouting avversari: quante delle ALTRE squadre sono ancora "in gioco" per
  // il ruolo del giocatore in visione (slot liberi in quel ruolo E credits
  // sufficienti per un'offerta minima) contro quante sono già "sazie". Non
  // dipende dal verdetto (che richiede anche selected.advice): basta
  // conoscere il ruolo del giocatore selezionato.
  const competingTeams: CompetingTeamsInfo | null = selectedRole
    ? (() => {
        const zone = ROLE_TO_ZONE[selectedRole];
        const total = otherTeams.length;
        const canStillBid = otherTeams.filter(
          (t) => t.rosterHash[zone] > 0 && (t.maxOffer ?? 0) > 0,
        ).length;
        return {
          canStillBid,
          total,
          message: `${canStillBid} squadre su ${total} possono ancora puntare su questo ruolo`,
        };
      })()
    : null;

  return {
    settings: state.data.settings,
    myTeam,
    otherTeams,
    bestPicksByRole,
    roleBudget,
    marketTrend,
    selectedPlayer,
    verdict,
    competingTeams,
    spendingPace,
    recentTransactions,
  };
}

/**
 * "Punta / aspetta / attenzione" per il giocatore in visione ora, confrontato
 * con le altre alternative ancora libere nello STESSO ruolo e col budget
 * rimasto per quel ruolo — non solo il suo valore in isolamento.
 */
function buildVerdict(
  selected: PlayerSpotlight,
  alternatives: LiveAdvice[],
  budget: RoleBudgetInfo,
  roleHistoricalMax: number | null,
  marketTrend: MarketTrendInfo,
): Verdict | null {
  if (!selected.advice) return null;
  const { suggestedPrice: fvmPrice } = selected.advice;

  // Prezzo storico reale (aste passate di questo utente, tabella
  // historical_auction_prices), quando disponibile: più affidabile della
  // sola formula FVM per giocatori con un divario enorme tra FVM e
  // quotazione (es. una stagione da fenomeno con poche presenze, come
  // osservato dal vivo su Malen: FVM implicava ~225, mai realmente pagato).
  const historicalPrices = selected.priceHistory.map((p) => p.price).filter((p) => Number.isFinite(p));
  const historicalAvg =
    historicalPrices.length > 0
      ? Math.round(historicalPrices.reduce((a, b) => a + b, 0) / historicalPrices.length)
      : null;

  // Ci fidiamo dello storico solo quando diverge MOLTO dalla formula (la
  // formula ha chiaramente premiato una stagione outlier): il confronto usa
  // il prezzo FVM puro (non quello aggiustato sotto), perché qui si valuta
  // uno scarto di carriera, non l'andamento di QUESTA asta. Altrimenti, con
  // uno storico vicino alla formula o assente, resta la formula FVM — ma
  // moltiplicata per marketTrend.factor: senza questo aggiustamento
  // referencePrice resterebbe un prezzo "di formula" mentre alternatives
  // sotto usa adjustedPrice (già moltiplicato per lo stesso factor), col
  // rischio di confrontare due basi di prezzo incoerenti tra loro e col
  // budget di reparto.
  const priceDivergesALot = historicalAvg != null && fvmPrice != null && fvmPrice > historicalAvg * 1.8;
  const adjustedFvmPrice = fvmPrice != null ? Math.round(fvmPrice * marketTrend.factor) : null;
  let referencePrice = priceDivergesALot ? historicalAvg : (adjustedFvmPrice ?? historicalAvg);

  // Tetto di realtà indipendente dal singolo giocatore: anche senza storico
  // player-specific, il prezzo di riferimento non dovrebbe mai sforare di
  // molto il massimo REALMENTE pagato per QUALSIASI giocatore di questo
  // ruolo in 5 stagioni di aste (es. Malen: nessuno storico personale, ma
  // 248 contro un massimo mai visto di 175 per un attaccante era comunque
  // irrealistico) — margine del 15% per ammettere una normale crescita del
  // mercato di anno in anno.
  const cappedByRoleHistory =
    roleHistoricalMax != null && referencePrice != null && referencePrice > roleHistoricalMax * 1.15;
  if (cappedByRoleHistory) referencePrice = Math.round(roleHistoricalMax! * 1.15);

  const historicalNote = cappedByRoleHistory
    ? ` (il massimo mai pagato per un giocatore di questo ruolo in 5 stagioni è ${roleHistoricalMax}: la formula da sola suggeriva molto di più)`
    : historicalAvg != null
      ? ` (storicamente pagato in media ${historicalAvg} nelle aste passate${
          priceDivergesALot ? ", molto meno di quanto suggerirebbe la sola formula" : ""
        })`
      : "";

  const ceiling =
    referencePrice != null
      ? Math.min(budget.maxOfferForRole, Math.round(referencePrice * 1.25))
      : budget.maxOfferForRole;

  if (referencePrice != null && referencePrice > budget.maxOfferForRole) {
    return {
      action: "attenzione",
      headline: "Attenzione al budget di reparto",
      detail: `Il prezzo di riferimento (${referencePrice}${historicalNote}) supera quello che ti resta per questo ruolo (${budget.maxOfferForRole}).`,
      ceiling: budget.maxOfferForRole,
    };
  }

  // "punteggio" è un indice di VALORE (fantamedia rispetto al prezzo), non di
  // qualità assoluta: un giocatore economico con buone statistiche ha quasi
  // sempre un punteggio più alto di uno costoso e più forte, perché il
  // prezzo basso gonfia il rapporto (visto dal vivo due volte: Bremer contro
  // De Winter, poi Calhanoglu "Top" punteggio 40 contro Karlstrom
  // "Semi-top" punteggio 73 — un solo scalino di fascia di tolleranza non
  // bastava). Confrontare "conviene aspettare" per punteggio, anche solo tra
  // fasce adiacenti, mette sullo stesso piano giocatori di qualità/prezzo di
  // mercato molto diversi. Le due verifiche restano quindi rigide sulla
  // fascia: "c'è un pari livello a meno" guarda SOLO la stessa fascia
  // esatta, "c'è di meglio" SOLO fasce più alte — mai un punteggio più alto
  // in una fascia uguale o inferiore, che è proprio il pattern fuorviante.
  const sameBand = alternatives.filter((a) => a.advice.band === selected.advice!.band);
  const higherBand = alternatives.filter((a) => BAND_RANK[a.advice.band] > BAND_RANK[selected.advice!.band]);

  // adjustedPrice (non suggestedPrice puro) per riflettere come sta andando
  // QUESTA asta: un'alternativa "a meno" lo è per il mercato reale osservato
  // finora in questo ruolo, non solo per la formula FVM in isolamento.
  const similarCheaper = sameBand.find(
    (a) => referencePrice != null && a.adjustedPrice != null && a.adjustedPrice < referencePrice - 3,
  );
  if (similarCheaper) {
    return {
      action: "aspetta",
      headline: "Puoi aspettare",
      detail: `${similarCheaper.player.name} è nella stessa fascia (${bandLabel(similarCheaper.advice.band)}) probabilmente a un prezzo più basso (~${similarCheaper.adjustedPrice}).`,
      ceiling,
    };
  }

  const better = higherBand[0];
  if (better) {
    return {
      action: "aspetta",
      headline: "C'è una fascia più alta ancora libera",
      detail: `${better.player.name} (${bandLabel(better.advice.band)}) è di fascia superiore tra i liberi in questo ruolo.`,
      ceiling,
    };
  }

  return {
    action: "punta",
    headline: "Tra i migliori ancora liberi nel ruolo",
    detail: `Nessuna alternativa chiaramente migliore ancora libera. Puoi puntare fino a circa ${ceiling} crediti${historicalNote}.`,
    ceiling,
  };
}
