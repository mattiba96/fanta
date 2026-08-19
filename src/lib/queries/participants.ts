import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { leagueParticipants, auctionPicks, players, teams } from "@/db/schema";
import { nowIso } from "@/lib/scraping/normalize";
import { getAuctionSettings } from "./auction";

export type ParticipantSummary = {
  id: number;
  name: string;
  isMe: boolean;
  budgetSpent: number;
  budgetRemaining: number;
  maxBid: number; // budget residuo meno 1 credito riservato per ogni slot ancora da riempire
  slotsFilled: Record<"P" | "D" | "C" | "A", number>;
  rosterCount: number;
  totalSlots: number;
  pctBudgetSpent: number; // 0-100
  pctSlotsFilled: number; // 0-100
  /** pctBudgetSpent - pctSlotsFilled: positivo = sta spendendo più in fretta
   * di quanto stia riempiendo la rosa (rischia di restare senza budget per
   * gli slot rimasti), negativo = procede con acquisti relativamente
   * economici e ha margine per rilanciare più avanti nell'asta. */
  spendPace: number;
};

async function ensureAtLeastOneParticipant() {
  const existing = await db.select({ id: leagueParticipants.id }).from(leagueParticipants).limit(1);
  if (existing.length > 0) return;
  await db.insert(leagueParticipants).values({
    name: "Io",
    isMe: 1,
    displayOrder: 0,
    createdAt: nowIso(),
  });
}

export async function getParticipantSummaries(): Promise<ParticipantSummary[]> {
  await ensureAtLeastOneParticipant();
  const settings = await getAuctionSettings();
  const totalSlots = settings.slotsGk + settings.slotsDef + settings.slotsMid + settings.slotsFwd;

  const participants = await db
    .select()
    .from(leagueParticipants)
    .orderBy(asc(leagueParticipants.displayOrder), asc(leagueParticipants.id));

  const picks = await db
    .select({
      participantId: auctionPicks.participantId,
      price: auctionPicks.price,
      roleSlot: auctionPicks.roleSlot,
    })
    .from(auctionPicks);

  return participants.map((p) => {
    const mine = picks.filter((pick) => pick.participantId === p.id);
    const budgetSpent = mine.reduce((sum, pick) => sum + pick.price, 0);
    const slotsFilled: ParticipantSummary["slotsFilled"] = { P: 0, D: 0, C: 0, A: 0 };
    for (const pick of mine) {
      if (pick.roleSlot && pick.roleSlot in slotsFilled) {
        slotsFilled[pick.roleSlot as keyof typeof slotsFilled]++;
      }
    }
    const budgetRemaining = settings.totalBudget - budgetSpent;
    const slotsRemaining = Math.max(0, totalSlots - mine.length);
    // Se resta ancora almeno 1 slot da riempire dopo questo acquisto, va tenuto
    // da parte almeno 1 credito per ciascuno: la puntata massima sensata è il
    // residuo meno quella riserva.
    const maxBid = Math.max(0, budgetRemaining - Math.max(0, slotsRemaining - 1));

    const pctBudgetSpent = settings.totalBudget > 0 ? Math.round((budgetSpent / settings.totalBudget) * 100) : 0;
    const pctSlotsFilled = totalSlots > 0 ? Math.round((mine.length / totalSlots) * 100) : 0;

    return {
      id: p.id,
      name: p.name,
      isMe: p.isMe === 1,
      budgetSpent,
      budgetRemaining,
      maxBid,
      slotsFilled,
      rosterCount: mine.length,
      totalSlots,
      pctBudgetSpent,
      pctSlotsFilled,
      spendPace: pctBudgetSpent - pctSlotsFilled,
    };
  });
}

export async function getParticipantRoster(participantId: number) {
  return db
    .select({
      pickId: auctionPicks.id,
      playerId: auctionPicks.playerId,
      name: players.name,
      teamCode: teams.code,
      roleClassic: players.roleClassic,
      price: auctionPicks.price,
      pickedAt: auctionPicks.pickedAt,
      fvmClassic: players.fvmClassic,
      quotCurrentClassic: players.quotCurrentClassic,
    })
    .from(auctionPicks)
    .innerJoin(players, eq(players.id, auctionPicks.playerId))
    .innerJoin(teams, eq(teams.id, players.teamId))
    .where(eq(auctionPicks.participantId, participantId));
}

export type ParticipantRosterEntry = Awaited<ReturnType<typeof getParticipantRoster>>[number];

/** Rosa di TUTTI i partecipanti in un colpo solo (non solo la mia): serve per
 * vedere durante l'asta chi ha preso chi, non solo budget/slot aggregati. */
export async function getAllParticipantRosters(): Promise<Map<number, ParticipantRosterEntry[]>> {
  const rows = await db
    .select({
      participantId: auctionPicks.participantId,
      pickId: auctionPicks.id,
      playerId: auctionPicks.playerId,
      name: players.name,
      teamCode: teams.code,
      roleClassic: players.roleClassic,
      price: auctionPicks.price,
      pickedAt: auctionPicks.pickedAt,
      fvmClassic: players.fvmClassic,
      quotCurrentClassic: players.quotCurrentClassic,
    })
    .from(auctionPicks)
    .innerJoin(players, eq(players.id, auctionPicks.playerId))
    .innerJoin(teams, eq(teams.id, players.teamId))
    .orderBy(asc(players.roleClassic), asc(players.name));

  const byParticipant = new Map<number, ParticipantRosterEntry[]>();
  for (const r of rows) {
    const arr = byParticipant.get(r.participantId) ?? [];
    arr.push(r);
    byParticipant.set(r.participantId, arr);
  }
  return byParticipant;
}

export type RoleBudget = { role: "P" | "D" | "C" | "A"; spent: number; count: number; pct: number };

/** Spesa per reparto (ruolo) di un partecipante, in crediti e in % sul suo
 * budget totale — utile in asta per capire dove ha già impegnato i soldi e
 * dove ha ancora margine. */
export function budgetByRole(entries: ParticipantRosterEntry[], totalBudget: number): RoleBudget[] {
  const roles: Array<"P" | "D" | "C" | "A"> = ["P", "D", "C", "A"];
  const byRole = new Map<string, { spent: number; count: number }>();
  for (const e of entries) {
    if (!e.roleClassic) continue;
    const cur = byRole.get(e.roleClassic) ?? { spent: 0, count: 0 };
    cur.spent += e.price;
    cur.count += 1;
    byRole.set(e.roleClassic, cur);
  }
  return roles.map((role) => {
    const cur = byRole.get(role) ?? { spent: 0, count: 0 };
    return {
      role,
      spent: cur.spent,
      count: cur.count,
      pct: totalBudget > 0 ? Math.round((cur.spent / totalBudget) * 100) : 0,
    };
  });
}
