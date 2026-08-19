import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auctionSettings, auctionPicks, players, teams, leagueParticipants } from "@/db/schema";
import { nowIso } from "@/lib/scraping/normalize";

export type AuctionSettings = typeof auctionSettings.$inferSelect;

const DEFAULT_SETTINGS: Omit<AuctionSettings, "id" | "updatedAt"> = {
  leagueName: null,
  mode: "classic",
  totalBudget: 500,
  slotsGk: 3,
  slotsDef: 8,
  slotsMid: 8,
  slotsFwd: 6,
  participants: 8,
  activeSeason: "2026-27",
  statsSeason: "2025-26",
  auctionStrategy: null,
  lastAiAdvice: null,
  lastAiAdviceAt: null,
};

export async function getAuctionSettings(): Promise<AuctionSettings> {
  const [row] = await db.select().from(auctionSettings).where(eq(auctionSettings.id, 1)).limit(1);
  if (row) return row;

  const [created] = await db
    .insert(auctionSettings)
    .values({ id: 1, ...DEFAULT_SETTINGS, updatedAt: nowIso() })
    .onConflictDoNothing({ target: auctionSettings.id })
    .returning();

  if (created) return created;

  const [existing] = await db.select().from(auctionSettings).where(eq(auctionSettings.id, 1)).limit(1);
  return existing;
}

export type RosterEntry = {
  pickId: number;
  playerId: number;
  name: string;
  teamCode: string;
  roleClassic: string | null;
  price: number;
  pickedAt: string;
  fvmClassic: number | null;
  /** (price - fvm) / fvm * 100: quanto ho pagato sopra/sotto l'FVM ufficiale. */
  pctVsFvm: number | null;
};

export type AuctionState = {
  settings: AuctionSettings;
  budgetSpent: number;
  budgetRemaining: number;
  slotsFilled: Record<"P" | "D" | "C" | "A", number>;
  slotsTotal: Record<"P" | "D" | "C" | "A", number>;
  roster: RosterEntry[];
};

export type MarketInflation = {
  /** % media (prezzo - fvm) / fvm sui picks con FVM noto: positivo = il
   * mercato di questa asta sta pagando sopra le quotazioni ufficiali. */
  overall: number | null;
  byRole: Record<"P" | "D" | "C" | "A", number | null>;
  picksConsidered: number;
};

/**
 * Indice di inflazione del mercato dell'asta IN CORSO: confronta i prezzi
 * realmente pagati da TUTTI i partecipanti (non solo i miei) con l'FVM
 * ufficiale, per calibrare le prossime puntate sul prezzo che il gruppo sta
 * davvero facendo, non su quello "di listino".
 */
export async function getMarketInflation(): Promise<MarketInflation> {
  const rows = await db
    .select({
      price: auctionPicks.price,
      roleSlot: auctionPicks.roleSlot,
      fvmClassic: players.fvmClassic,
    })
    .from(auctionPicks)
    .innerJoin(players, eq(players.id, auctionPicks.playerId));

  const valid = rows.filter((r) => r.fvmClassic != null && r.fvmClassic > 0);
  const pctOf = (r: (typeof valid)[number]) => ((r.price - r.fvmClassic!) / r.fvmClassic!) * 100;

  const overall =
    valid.length > 0 ? Math.round(valid.reduce((sum, r) => sum + pctOf(r), 0) / valid.length) : null;

  const byRole: MarketInflation["byRole"] = { P: null, D: null, C: null, A: null };
  for (const role of Object.keys(byRole) as Array<keyof typeof byRole>) {
    const roleRows = valid.filter((r) => r.roleSlot === role);
    byRole[role] =
      roleRows.length > 0 ? Math.round(roleRows.reduce((sum, r) => sum + pctOf(r), 0) / roleRows.length) : null;
  }

  return { overall, byRole, picksConsidered: valid.length };
}

export async function getOrCreateMyParticipantId(): Promise<number> {
  const [me] = await db
    .select({ id: leagueParticipants.id })
    .from(leagueParticipants)
    .where(eq(leagueParticipants.isMe, 1))
    .limit(1);
  if (me) return me.id;

  const [created] = await db
    .insert(leagueParticipants)
    .values({ name: "Io", isMe: 1, displayOrder: 0, createdAt: nowIso() })
    .returning({ id: leagueParticipants.id });
  return created.id;
}

export async function getAuctionState(): Promise<AuctionState> {
  const settings = await getAuctionSettings();
  const myParticipantId = await getOrCreateMyParticipantId();

  const myPicksRaw = await db
    .select({
      pickId: auctionPicks.id,
      playerId: auctionPicks.playerId,
      name: players.name,
      teamCode: teams.code,
      roleClassic: players.roleClassic,
      price: auctionPicks.price,
      pickedAt: auctionPicks.pickedAt,
      fvmClassic: players.fvmClassic,
    })
    .from(auctionPicks)
    .innerJoin(players, eq(players.id, auctionPicks.playerId))
    .innerJoin(teams, eq(teams.id, players.teamId))
    .where(eq(auctionPicks.participantId, myParticipantId))
    .orderBy(desc(auctionPicks.pickedAt));

  const myPicks: RosterEntry[] = myPicksRaw.map((p) => ({
    ...p,
    pctVsFvm:
      p.fvmClassic != null && p.fvmClassic > 0
        ? Math.round(((p.price - p.fvmClassic) / p.fvmClassic) * 100)
        : null,
  }));

  const slotsFilled: AuctionState["slotsFilled"] = { P: 0, D: 0, C: 0, A: 0 };
  let budgetSpent = 0;
  for (const pick of myPicks) {
    budgetSpent += pick.price;
    if (pick.roleClassic && pick.roleClassic in slotsFilled) {
      slotsFilled[pick.roleClassic as keyof typeof slotsFilled]++;
    }
  }

  return {
    settings,
    budgetSpent,
    budgetRemaining: settings.totalBudget - budgetSpent,
    slotsFilled,
    slotsTotal: {
      P: settings.slotsGk,
      D: settings.slotsDef,
      C: settings.slotsMid,
      A: settings.slotsFwd,
    },
    roster: myPicks,
  };
}
