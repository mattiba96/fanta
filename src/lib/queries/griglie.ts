import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { players, teams, playerSeasonStats, fixtures, fcpRatings, goalkeeperGrids } from "@/db/schema";
import { getAdviceForAvailablePlayers } from "./advice";
import { bandLabel } from "@/lib/advice/engine";
import { DEFAULT_STATS_SEASON } from "@/lib/seasons";

const CALENDAR_SEASON = "2026-27";
const DEFAULT_WINDOW_SIZE = 6;

export type TeamStrength = {
  teamId: number;
  goalsScored: number;
  goalsConceded: number;
  /** 0-100, percentile tra le 20 squadre: più alto = attacco più prolifico
   * (usato come "difficoltà" per il portiere avversario). */
  attackScore: number;
  /** 0-100, percentile tra le 20 squadre: più alto = difesa più debole
   * (usato come "opportunità" per l'attaccante avversario). */
  defenseWeaknessScore: number;
};

/**
 * Forza offensiva/difensiva per squadra dalla stagione di riferimento: somma
 * i "gol fatti" e "gol subiti" di tutti i giocatori di quella squadra (i gol
 * subiti sono valorizzati solo sui portieri dalla fonte statistiche, quindi
 * la somma per squadra coincide con il totale reale subito in stagione).
 * Zero scraping aggiuntivo: stessi dati già usati in "Statistiche di squadra".
 */
export async function getAllTeamsStrength(season = DEFAULT_STATS_SEASON): Promise<Map<number, TeamStrength>> {
  const rows = await db
    .select({
      teamId: players.teamId,
      goals: playerSeasonStats.goals,
      goalsConceded: playerSeasonStats.goalsConceded,
    })
    .from(playerSeasonStats)
    .innerJoin(players, eq(players.id, playerSeasonStats.playerId))
    .where(eq(playerSeasonStats.season, season));

  const byTeam = new Map<number, { goals: number; goalsConceded: number }>();
  for (const r of rows) {
    if (r.teamId == null) continue;
    const bucket = byTeam.get(r.teamId) ?? { goals: 0, goalsConceded: 0 };
    bucket.goals += r.goals ?? 0;
    bucket.goalsConceded += r.goalsConceded ?? 0;
    byTeam.set(r.teamId, bucket);
  }

  const entries = [...byTeam.entries()];
  const goalsList = entries.map(([, v]) => v.goals);
  const concededList = entries.map(([, v]) => v.goalsConceded);
  const minGoals = Math.min(...goalsList);
  const maxGoals = Math.max(...goalsList);
  const minConceded = Math.min(...concededList);
  const maxConceded = Math.max(...concededList);

  const percentile = (value: number, min: number, max: number) =>
    max > min ? Math.round(((value - min) / (max - min)) * 100) : 50;

  const result = new Map<number, TeamStrength>();
  for (const [teamId, v] of entries) {
    result.set(teamId, {
      teamId,
      goalsScored: v.goals,
      goalsConceded: v.goalsConceded,
      attackScore: percentile(v.goals, minGoals, maxGoals),
      defenseWeaknessScore: percentile(v.goalsConceded, minConceded, maxConceded),
    });
  }
  return result;
}

/**
 * Le prossime `windowSize` giornate a partire da quella corrente (la prima
 * con una partita non ancora giocata, per data) — se il calendario non è
 * ancora stato scaricato o la stagione non è iniziata, riparte dalla prima
 * giornata disponibile.
 */
export async function getUpcomingMatchdayWindow(
  windowSize = DEFAULT_WINDOW_SIZE,
): Promise<number[]> {
  const rows = await db
    .select({ matchday: fixtures.matchday, kickoffAt: fixtures.kickoffAt })
    .from(fixtures)
    .where(eq(fixtures.season, CALENDAR_SEASON));
  if (rows.length === 0) return [];

  const todayIso = new Date().toISOString().slice(0, 10);
  const future = rows.filter((r) => r.kickoffAt != null && r.kickoffAt >= todayIso);
  const allMatchdays = rows.map((r) => r.matchday);
  const startMatchday =
    future.length > 0 ? Math.min(...future.map((r) => r.matchday)) : Math.min(...allMatchdays);
  const maxMatchday = Math.max(...allMatchdays);
  const end = Math.min(startMatchday + windowSize - 1, maxMatchday);

  const result: number[] = [];
  for (let m = startMatchday; m <= end; m++) result.push(m);
  return result;
}

type FixtureRow = { matchday: number; homeTeamId: number; awayTeamId: number };

async function getFixturesForMatchdays(matchdays: number[]): Promise<FixtureRow[]> {
  if (matchdays.length === 0) return [];
  return db
    .select({ matchday: fixtures.matchday, homeTeamId: fixtures.homeTeamId, awayTeamId: fixtures.awayTeamId })
    .from(fixtures)
    .where(and(eq(fixtures.season, CALENDAR_SEASON), inArray(fixtures.matchday, matchdays)));
}

export type TeamRef = { teamId: number; teamCode: string; teamName: string };

export type TeamGoalkeeper = {
  playerId: number;
  slug: string;
  name: string;
  quotCurrentClassic: number | null;
};

/**
 * Portiere titolare per squadra: il taggato "Titolare" da FantaCalcioPedia
 * con quotazione più alta, altrimenti il portiere di quotazione più alta
 * della squadra (stessa euristica di "Formazione tipo").
 */
async function getStartingGoalkeepers(): Promise<Map<number, TeamGoalkeeper>> {
  const rows = await db
    .select({
      teamId: players.teamId,
      playerId: players.id,
      slug: players.slug,
      name: players.name,
      quotCurrentClassic: players.quotCurrentClassic,
      tags: fcpRatings.tags,
    })
    .from(players)
    .leftJoin(fcpRatings, eq(fcpRatings.playerId, players.id))
    .where(and(eq(players.isActive, 1), eq(players.roleClassic, "P")));

  const byTeam = new Map<number, typeof rows>();
  for (const r of rows) {
    if (r.teamId == null) continue;
    const arr = byTeam.get(r.teamId) ?? [];
    arr.push(r);
    byTeam.set(r.teamId, arr);
  }

  const result = new Map<number, TeamGoalkeeper>();
  for (const [teamId, candidates] of byTeam) {
    const titolari = candidates.filter((c) => (c.tags ?? "").includes("Titolare"));
    const pool = titolari.length > 0 ? titolari : candidates;
    const best = pool.slice().sort((a, b) => (b.quotCurrentClassic ?? 0) - (a.quotCurrentClassic ?? 0))[0];
    if (best) {
      result.set(teamId, {
        playerId: best.playerId,
        slug: best.slug,
        name: best.name,
        quotCurrentClassic: best.quotCurrentClassic,
      });
    }
  }
  return result;
}

export type GoalkeeperGridCategory = "coppie" | "coppie_low_cost" | "terzetti";

export type GoalkeeperGridEntry = {
  score: number;
  teams: Array<TeamRef & { keeper: TeamGoalkeeper | null }>;
};

/**
 * Griglia portieri curata editorialmente da SOS Fanta/FantaLab (alternanza
 * partite facili/difficili secondo la loro redazione), preferita a un calcolo
 * in proprio sulla sola forza offensiva dell'anno scorso — più affidabile,
 * specie a inizio stagione. Ogni squadra della fonte è arricchita col
 * portiere titolare che l'app già conosce.
 */
export async function getGoalkeeperPairingGrid(): Promise<{
  coppie: GoalkeeperGridEntry[];
  coppieLowCost: GoalkeeperGridEntry[];
  terzetti: GoalkeeperGridEntry[];
  sourceUrl: string | null;
}> {
  const [rows, keeperByTeam, teamRows] = await Promise.all([
    db.select().from(goalkeeperGrids).where(eq(goalkeeperGrids.season, CALENDAR_SEASON)),
    getStartingGoalkeepers(),
    db.select({ teamId: teams.id, teamCode: teams.code, teamName: teams.name }).from(teams),
  ]);
  const teamById = new Map(teamRows.map((t) => [t.teamId, t]));

  const entries: Array<{ category: GoalkeeperGridCategory; entry: GoalkeeperGridEntry }> = [];
  for (const row of rows) {
    const teamIds = row.teamIds.split("|").map(Number);
    const rowTeams = teamIds.map((id) => teamById.get(id)).filter((t): t is TeamRef => t != null);
    if (rowTeams.length !== teamIds.length) continue; // squadra sconosciuta, riga scartata
    entries.push({
      category: row.category as GoalkeeperGridCategory,
      entry: {
        score: row.score,
        teams: rowTeams.map((t) => ({ ...t, keeper: keeperByTeam.get(t.teamId) ?? null })),
      },
    });
  }

  const byCategory = (category: GoalkeeperGridCategory) =>
    entries
      .filter((e) => e.category === category)
      .map((e) => e.entry)
      .sort((a, b) => b.score - a.score);

  return {
    coppie: byCategory("coppie"),
    coppieLowCost: byCategory("coppie_low_cost"),
    terzetti: byCategory("terzetti"),
    sourceUrl: rows[0]?.sourceUrl ?? null,
  };
}

export type AttackerTeamOutlook = {
  team: TeamRef;
  avgOpportunity: number;
  perMatchday: Array<{ matchday: number; opponent: TeamRef; opportunity: number }>;
  topAttackers: Array<{ playerId: number; slug: string; name: string; score: number; bandLabel: string }>;
};

/**
 * Per ogni squadra, quanto sono favorevoli le prossime giornate per i suoi
 * attaccanti (avversari con difesa debole = più occasioni/gol attesi), con i
 * migliori attaccanti di quella squadra per indice di valore.
 */
export async function getAttackerFixtureOutlook(windowSize = DEFAULT_WINDOW_SIZE): Promise<{
  matchdays: number[];
  teams: AttackerTeamOutlook[];
}> {
  const matchdays = await getUpcomingMatchdayWindow(windowSize);
  if (matchdays.length === 0) return { matchdays: [], teams: [] };

  const [fixtureRows, strengthByTeam, teamRows, attackerRows, adviceByPlayer] = await Promise.all([
    getFixturesForMatchdays(matchdays),
    getAllTeamsStrength(),
    db.select({ teamId: teams.id, teamCode: teams.code, teamName: teams.name }).from(teams),
    db
      .select({ teamId: players.teamId, playerId: players.id, slug: players.slug, name: players.name })
      .from(players)
      .where(and(eq(players.isActive, 1), eq(players.roleClassic, "A"))),
    getAdviceForAvailablePlayers(),
  ]);
  const teamById = new Map(teamRows.map((t) => [t.teamId, t]));

  const opportunityByTeam = new Map<number, Array<{ matchday: number; opponent: TeamRef; opportunity: number }>>();
  for (const f of fixtureRows) {
    const homeOpportunity = strengthByTeam.get(f.awayTeamId)?.defenseWeaknessScore ?? 50;
    const awayOpportunity = strengthByTeam.get(f.homeTeamId)?.defenseWeaknessScore ?? 50;
    const homeArr = opportunityByTeam.get(f.homeTeamId) ?? [];
    homeArr.push({ matchday: f.matchday, opponent: teamById.get(f.awayTeamId)!, opportunity: homeOpportunity });
    opportunityByTeam.set(f.homeTeamId, homeArr);
    const awayArr = opportunityByTeam.get(f.awayTeamId) ?? [];
    awayArr.push({ matchday: f.matchday, opponent: teamById.get(f.homeTeamId)!, opportunity: awayOpportunity });
    opportunityByTeam.set(f.awayTeamId, awayArr);
  }

  const attackersByTeam = new Map<number, typeof attackerRows>();
  for (const a of attackerRows) {
    if (a.teamId == null) continue;
    const arr = attackersByTeam.get(a.teamId) ?? [];
    arr.push(a);
    attackersByTeam.set(a.teamId, arr);
  }

  const result: AttackerTeamOutlook[] = [];
  for (const [teamId, perMatchday] of opportunityByTeam) {
    const team = teamById.get(teamId);
    if (!team || perMatchday.length === 0) continue;
    const avgOpportunity =
      Math.round((perMatchday.reduce((s, p) => s + p.opportunity, 0) / perMatchday.length) * 10) / 10;

    const topAttackers = (attackersByTeam.get(teamId) ?? [])
      .map((p) => {
        const advice = adviceByPlayer.get(p.playerId);
        return advice ? { ...p, score: advice.score, bandLabel: bandLabel(advice.band) } : null;
      })
      .filter((p): p is NonNullable<typeof p> => p != null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    result.push({
      team,
      avgOpportunity,
      perMatchday: perMatchday.sort((a, b) => a.matchday - b.matchday),
      topAttackers,
    });
  }

  result.sort((a, b) => b.avgOpportunity - a.avgOpportunity);
  return { matchdays, teams: result };
}
