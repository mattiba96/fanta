import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auctionSettings, auctionPicks, players, teams } from "@/db/schema";
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
};

export type AuctionState = {
  settings: AuctionSettings;
  budgetSpent: number;
  budgetRemaining: number;
  slotsFilled: Record<"P" | "D" | "C" | "A", number>;
  slotsTotal: Record<"P" | "D" | "C" | "A", number>;
  roster: RosterEntry[];
};

export async function getAuctionState(): Promise<AuctionState> {
  const settings = await getAuctionSettings();

  const myPicks = await db
    .select({
      pickId: auctionPicks.id,
      playerId: auctionPicks.playerId,
      name: players.name,
      teamCode: teams.code,
      roleClassic: players.roleClassic,
      price: auctionPicks.price,
      pickedAt: auctionPicks.pickedAt,
    })
    .from(auctionPicks)
    .innerJoin(players, eq(players.id, auctionPicks.playerId))
    .innerJoin(teams, eq(teams.id, players.teamId))
    .where(eq(auctionPicks.owner, "me"))
    .orderBy(desc(auctionPicks.pickedAt));

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
