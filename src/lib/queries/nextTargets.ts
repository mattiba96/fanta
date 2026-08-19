import { eq, and, isNull, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { players, teams, auctionPicks, historicalAuctionPrices } from "@/db/schema";
import { getAuctionState } from "./auction";
import { getParticipantSummaries } from "./participants";
import { getAdviceForAvailablePlayers } from "./advice";
import { bandLabel, type Role } from "@/lib/advice/engine";

export type NextTargetSuggestion = {
  playerId: number;
  slug: string;
  name: string;
  teamCode: string;
  role: Role;
  quotCurrentClassic: number | null;
  score: number;
  bandLabel: string;
  suggestedPrice: number | null;
  affordable: boolean;
  /** Media dei prezzi realmente pagati per questo giocatore nelle aste
   * passate dell'utente (se disponibile) — un riferimento più concreto
   * dell'FVM per capire quanto potrebbe davvero costare stasera. */
  historicalAvgPrice: number | null;
  /** Storico per singola stagione (più recente prima): una media piatta
   * nasconde un giocatore esploso dopo essere stato pagato pochissimo, o
   * crollato dopo essere stato pagato caro — il trend conta più della
   * media, va letto stagione per stagione. */
  historicalPrices: Array<{ season: string; price: number }>;
};

export type NextTargets = {
  byRole: Record<Role, NextTargetSuggestion[]>;
  myMaxBid: number;
};

const ROLES: Role[] = ["P", "D", "C", "A"];

/**
 * Chi puntare adesso, in base a slot che mi mancano davvero (non ruoli in
 * generale, ma quelli dove la MIA rosa ha ancora posti liberi) e al budget
 * massimo che posso davvero permettermi ora — non solo all'indice/fascia
 * "in astratto" già mostrato altrove. Logica deterministica sullo stesso
 * motore di consigli, nessun modello linguistico coinvolto.
 */
export async function getNextTargetSuggestions(limitPerRole = 3): Promise<NextTargets> {
  const [state, participants, adviceByPlayer] = await Promise.all([
    getAuctionState(),
    getParticipantSummaries(),
    getAdviceForAvailablePlayers(),
  ]);

  const me = participants.find((p) => p.isMe);
  const myMaxBid = me?.maxBid ?? 0;

  const rolesNeeded = ROLES.filter((role) => state.slotsFilled[role] < state.slotsTotal[role]);
  const byRole: NextTargets["byRole"] = { P: [], D: [], C: [], A: [] };
  if (rolesNeeded.length === 0) return { byRole, myMaxBid };

  const rows = await db
    .select({
      playerId: players.id,
      slug: players.slug,
      name: players.name,
      teamCode: teams.code,
      roleClassic: players.roleClassic,
      quotCurrentClassic: players.quotCurrentClassic,
    })
    .from(players)
    .innerJoin(teams, eq(teams.id, players.teamId))
    .leftJoin(auctionPicks, eq(auctionPicks.playerId, players.id))
    .where(
      and(
        eq(players.isActive, 1),
        isNull(auctionPicks.id),
        inArray(players.roleClassic, rolesNeeded),
      ),
    );

  for (const r of rows) {
    const role = r.roleClassic as Role | null;
    if (!role) continue;
    const advice = adviceByPlayer.get(r.playerId);
    if (!advice) continue;
    byRole[role].push({
      playerId: r.playerId,
      slug: r.slug,
      name: r.name,
      teamCode: r.teamCode,
      role,
      quotCurrentClassic: r.quotCurrentClassic,
      score: advice.score,
      bandLabel: bandLabel(advice.band),
      suggestedPrice: advice.suggestedPrice,
      affordable: (advice.suggestedPrice ?? r.quotCurrentClassic ?? 0) <= myMaxBid,
      historicalAvgPrice: null,
      historicalPrices: [],
    });
  }

  for (const role of ROLES) {
    byRole[role].sort((a, b) => b.score - a.score);
    byRole[role] = byRole[role].slice(0, limitPerRole);
  }

  // Storico solo per i candidati finali (poche decine al massimo): evita di
  // calcolarlo per tutti i ~500 giocatori disponibili.
  const finalistIds = ROLES.flatMap((role) => byRole[role].map((s) => s.playerId));
  if (finalistIds.length > 0) {
    const histRows = await db
      .select({
        playerId: historicalAuctionPrices.playerId,
        season: historicalAuctionPrices.seasonLabel,
        price: historicalAuctionPrices.price,
      })
      .from(historicalAuctionPrices)
      .where(inArray(historicalAuctionPrices.playerId, finalistIds));

    const histByPlayer = new Map<number, Array<{ season: string; price: number }>>();
    for (const h of histRows) {
      if (h.playerId == null) continue;
      const arr = histByPlayer.get(h.playerId) ?? [];
      arr.push({ season: h.season, price: h.price });
      histByPlayer.set(h.playerId, arr);
    }
    for (const arr of histByPlayer.values()) {
      arr.sort((a, b) => b.season.localeCompare(a.season));
    }

    for (const role of ROLES) {
      for (const s of byRole[role]) {
        const hist = histByPlayer.get(s.playerId) ?? [];
        s.historicalPrices = hist;
        s.historicalAvgPrice =
          hist.length > 0 ? Math.round(hist.reduce((sum, h) => sum + h.price, 0) / hist.length) : null;
      }
    }
  }

  return { byRole, myMaxBid };
}
