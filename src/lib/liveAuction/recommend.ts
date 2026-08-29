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
  affordable: boolean;
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
  selectedPlayer: PlayerSpotlight | null;
  verdict: Verdict | null;
};

// Non serve mostrare più di questo per ruolo: la lista è comunque ordinata
// per punteggio, quindi i migliori restano sempre in cima.
const MAX_PICKS_PER_ROLE = 30;

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
  const externalIds = availablePlayers.map((p) => String(p.id));

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

  const grouped = EMPTY_ROLE_RECORD<{ input: AdviceInput; fantaAstaPlayer: FantaAstaPlayer; slug: string }>();

  for (const fap of availablePlayers) {
    const dbRow = dbRowByExternalId.get(String(fap.id));
    if (!dbRow) continue;
    const role = ZONE_TO_ROLE_CLASSIC[fap.zone];
    if (!role) continue;

    const input: AdviceInput = {
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
    };
    grouped[role].push({ input, fantaAstaPlayer: fap, slug: dbRow.slug });
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
      const affordable =
        advice.suggestedPrice == null || advice.suggestedPrice <= roleBudget[role].maxOfferForRole;

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
        )
      : null;

  return {
    settings: state.data.settings,
    myTeam,
    otherTeams,
    bestPicksByRole,
    roleBudget,
    selectedPlayer,
    verdict,
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
): Verdict | null {
  if (!selected.advice) return null;
  const { score, suggestedPrice: fvmPrice } = selected.advice;

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
  // formula ha chiaramente premiato una stagione outlier): altrimenti, con
  // uno storico vicino alla formula o assente, resta la formula FVM.
  const priceDivergesALot = historicalAvg != null && fvmPrice != null && fvmPrice > historicalAvg * 1.8;
  let referencePrice = priceDivergesALot ? historicalAvg : (fvmPrice ?? historicalAvg);

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
  // qualità assoluta: un giocatore economico con buone statistiche può avere
  // lo stesso punteggio di uno molto più costoso e forte, perché il prezzo
  // basso gonfia il rapporto. Confrontare per solo punteggio metterebbe sullo
  // stesso piano fasce di mercato completamente diverse (visto dal vivo:
  // Bremer, quotazione alta, vs De Winter, quotazione bassa) — le alternative
  // vanno quindi confrontate solo dentro la stessa fascia (o quella subito
  // sopra), mai ignorando del tutto la fascia.
  const sameTierOrAbove = alternatives.filter((a) => BAND_RANK[a.advice.band] >= BAND_RANK[selected.advice!.band] - 1);

  const similarCheaper = sameTierOrAbove.find(
    (a) =>
      a.advice.score >= score - 8 &&
      referencePrice != null &&
      a.advice.suggestedPrice != null &&
      a.advice.suggestedPrice < referencePrice - 3,
  );
  if (similarCheaper) {
    return {
      action: "aspetta",
      headline: "Puoi aspettare",
      detail: `${similarCheaper.player.name} (${bandLabel(similarCheaper.advice.band)}) vale quasi altrettanto (punteggio ${similarCheaper.advice.score}) probabilmente a un prezzo più basso (~${similarCheaper.advice.suggestedPrice}).`,
      ceiling,
    };
  }

  const better = sameTierOrAbove.find((a) => a.advice.score > score + 5);
  if (better) {
    return {
      action: "aspetta",
      headline: "C'è di meglio ancora libero",
      detail: `${better.player.name} ha un punteggio più alto (${better.advice.score}) tra i liberi in questo ruolo.`,
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
