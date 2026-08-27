import { eq, and, inArray, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { teams, players, playerSeasonStats } from "@/db/schema";
import { getAdviceForAvailablePlayers } from "./advice";
import { getLatestFormationByTeam } from "./formations";
import { DEFAULT_STATS_SEASON, HISTORICAL_STATS_SEASONS } from "./players";
import type { Advice } from "@/lib/advice/engine";

export type TeamBasic = {
  teamId: number;
  teamCode: string;
  teamName: string;
  slug: string;
  formation: string | null;
};

export async function getAllTeamsBasic(): Promise<TeamBasic[]> {
  const [rows, formationByTeam] = await Promise.all([
    db
      .select({ teamId: teams.id, teamCode: teams.code, teamName: teams.name, slug: teams.slug })
      .from(teams)
      .orderBy(asc(teams.name)),
    getLatestFormationByTeam(),
  ]);
  return rows.map((r) => ({ ...r, formation: formationByTeam.get(r.teamId) ?? null }));
}

export type TeamSeasonAggregate = {
  season: string;
  goals: number;
  assists: number;
  goalsConceded: number;
  avgFantamedia: number | null;
};

export type TeamRosterPlayer = {
  playerId: number;
  slug: string;
  name: string;
  externalId: string | null;
  roleClassic: string | null;
  quotCurrentClassic: number | null;
  pv: number | null;
  mv: number | null;
  fm: number | null;
  advice: Advice | null;
  recommendation: "consigliato" | "da_evitare" | null;
};

export type TeamDetail = TeamBasic & {
  seasons: TeamSeasonAggregate[];
  byRole: Record<"P" | "D" | "C" | "A", TeamRosterPlayer[]>;
};

// Sopra questa soglia un giocatore è un acquisto consigliato, sotto quella
// successiva è da evitare: le stesse fasce di "score" già usate altrove
// nell'app (Top/Semi-top partono attorno a qui), non una nuova scala.
const RECOMMEND_SCORE_THRESHOLD = 60;
const AVOID_SCORE_THRESHOLD = 35;
// Lo score è un indice di VALORE (fantamedia per credito spesso), non di
// qualità assoluta: un big Top-price come Lautaro può avere uno score basso
// solo perché costa tanto, non perché sia da evitare. Per i giocatori di
// fascia Top serve un campanello d'allarme più severo, non lo stesso taglio
// usato per Centrale/Scommessa dove "poco valore" è un segnale più affidabile.
const AVOID_SCORE_THRESHOLD_TOP_BAND = 15;

function classifyRecommendation(advice: Advice | null): TeamRosterPlayer["recommendation"] {
  if (!advice) return null;
  if (advice.score >= RECOMMEND_SCORE_THRESHOLD) return "consigliato";
  const avoidThreshold = advice.band === "top" ? AVOID_SCORE_THRESHOLD_TOP_BAND : AVOID_SCORE_THRESHOLD;
  if (advice.score < avoidThreshold) return "da_evitare";
  return null;
}

export async function getTeamBySlug(slug: string): Promise<TeamDetail | null> {
  const [team] = await db.select().from(teams).where(eq(teams.slug, slug)).limit(1);
  if (!team) return null;

  const allSeasons = [DEFAULT_STATS_SEASON, ...HISTORICAL_STATS_SEASONS];
  const [statsRows, rosterRows, adviceByPlayer, formationByTeam] = await Promise.all([
    db
      .select({
        season: playerSeasonStats.season,
        goals: playerSeasonStats.goals,
        assists: playerSeasonStats.assists,
        goalsConceded: playerSeasonStats.goalsConceded,
        fm: playerSeasonStats.fm,
      })
      .from(playerSeasonStats)
      .innerJoin(players, eq(players.id, playerSeasonStats.playerId))
      .where(and(eq(players.teamId, team.id), inArray(playerSeasonStats.season, allSeasons))),
    db
      .select({
        playerId: players.id,
        slug: players.slug,
        name: players.name,
        externalId: players.externalId,
        roleClassic: players.roleClassic,
        quotCurrentClassic: players.quotCurrentClassic,
        pv: playerSeasonStats.pv,
        mv: playerSeasonStats.mv,
        fm: playerSeasonStats.fm,
      })
      .from(players)
      .leftJoin(
        playerSeasonStats,
        and(eq(playerSeasonStats.playerId, players.id), eq(playerSeasonStats.season, DEFAULT_STATS_SEASON)),
      )
      .where(and(eq(players.teamId, team.id), eq(players.isActive, 1))),
    getAdviceForAvailablePlayers(),
    getLatestFormationByTeam(),
  ]);

  const bySeasonMap = new Map<string, { goals: number; assists: number; goalsConceded: number; fmSum: number; fmCount: number }>();
  for (const season of allSeasons) bySeasonMap.set(season, { goals: 0, assists: 0, goalsConceded: 0, fmSum: 0, fmCount: 0 });
  for (const r of statsRows) {
    const bucket = bySeasonMap.get(r.season);
    if (!bucket) continue;
    bucket.goals += r.goals ?? 0;
    bucket.assists += r.assists ?? 0;
    bucket.goalsConceded += r.goalsConceded ?? 0;
    if (r.fm != null) {
      bucket.fmSum += r.fm;
      bucket.fmCount += 1;
    }
  }
  const seasons: TeamSeasonAggregate[] = allSeasons.map((season) => {
    const b = bySeasonMap.get(season)!;
    return {
      season,
      goals: b.goals,
      assists: b.assists,
      goalsConceded: b.goalsConceded,
      avgFantamedia: b.fmCount > 0 ? Math.round((b.fmSum / b.fmCount) * 100) / 100 : null,
    };
  });

  const byRole: TeamDetail["byRole"] = { P: [], D: [], C: [], A: [] };
  for (const r of rosterRows) {
    const role = r.roleClassic as keyof TeamDetail["byRole"] | null;
    if (!role || !(role in byRole)) continue;
    const advice = adviceByPlayer.get(r.playerId) ?? null;
    byRole[role].push({
      playerId: r.playerId,
      slug: r.slug,
      name: r.name,
      externalId: r.externalId,
      roleClassic: r.roleClassic,
      quotCurrentClassic: r.quotCurrentClassic,
      pv: r.pv,
      mv: r.mv,
      fm: r.fm,
      advice,
      recommendation: classifyRecommendation(advice),
    });
  }
  for (const role of Object.keys(byRole) as Array<keyof TeamDetail["byRole"]>) {
    byRole[role].sort((a, b) => (b.advice?.score ?? -1) - (a.advice?.score ?? -1));
  }

  return {
    teamId: team.id,
    teamCode: team.code,
    teamName: team.name,
    slug: team.slug,
    formation: formationByTeam.get(team.id) ?? null,
    seasons,
    byRole,
  };
}
