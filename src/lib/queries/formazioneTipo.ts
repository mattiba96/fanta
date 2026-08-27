import { and, eq, like, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { fcpRatings, players, teams } from "@/db/schema";
import { getLatestFormationByTeam } from "./formations";

export type TypicalPlayer = {
  playerId: number;
  slug: string;
  name: string;
  externalId: string | null;
  roleClassic: string | null;
  quotCurrentClassic: number | null;
};

export type TeamTypicalLineup = {
  teamId: number;
  teamCode: string;
  teamName: string;
  formation: string | null;
  byRole: Record<"P" | "D" | "C" | "A", TypicalPlayer[]>;
  ballottaggi: Record<"P" | "D" | "C" | "A", TypicalPlayer[]>;
};

const ROLE_KEYS = ["P", "D", "C", "A"] as const;

// Modulo di default se non ne abbiamo ancora scaricato uno reale per la squadra.
const DEFAULT_OUTFIELD_COUNTS = { D: 4, C: 4, A: 2 };

/**
 * "4-3-3" -> {D:4, C:3, A:3}; "4-2-3-1" -> {D:4, C:5, A:1} (i numeri centrali,
 * mediana + trequarti, si sommano nel ruolo classic "C"). Il primo numero è
 * sempre la difesa, l'ultimo l'attacco, per convenzione di notazione del modulo.
 */
function parseFormationCounts(formation: string | null): { D: number; C: number; A: number } {
  const parts = (formation ?? "").split("-").map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (parts.length < 2) return DEFAULT_OUTFIELD_COUNTS;
  const D = parts[0];
  const A = parts[parts.length - 1];
  const C = parts.slice(1, -1).reduce((a, b) => a + b, 0);
  return C > 0 ? { D, C, A } : DEFAULT_OUTFIELD_COUNTS;
}

/**
 * Formazione "tipo": chi ci si aspetta giochi con continuità durante TUTTA la
 * stagione (tag "Titolare" da FantaCalcioPedia), non i titolari di una
 * singola giornata (quello lo fanno le probabili formazioni giornata per
 * giornata, i cui dati grezzi restano usati anche qui solo per il modulo).
 */
export async function getTypicalLineups(teamId?: number): Promise<TeamTypicalLineup[]> {
  const [rows, formationByTeam] = await Promise.all([
    db
      .select({
        teamId: teams.id,
        teamCode: teams.code,
        teamName: teams.name,
        playerId: players.id,
        slug: players.slug,
        name: players.name,
        externalId: players.externalId,
        roleClassic: players.roleClassic,
        quotCurrentClassic: players.quotCurrentClassic,
      })
      .from(fcpRatings)
      .innerJoin(players, eq(players.id, fcpRatings.playerId))
      .innerJoin(teams, eq(teams.id, players.teamId))
      .where(
        teamId != null
          ? and(like(fcpRatings.tags, "%Titolare%"), eq(teams.id, teamId))
          : like(fcpRatings.tags, "%Titolare%"),
      )
      .orderBy(asc(teams.name)),
    getLatestFormationByTeam(),
  ]);

  const byTeam = new Map<number, TeamTypicalLineup>();
  for (const r of rows) {
    let team = byTeam.get(r.teamId);
    if (!team) {
      team = {
        teamId: r.teamId,
        teamCode: r.teamCode,
        teamName: r.teamName,
        formation: formationByTeam.get(r.teamId) ?? null,
        byRole: { P: [], D: [], C: [], A: [] },
        ballottaggi: { P: [], D: [], C: [], A: [] },
      };
      byTeam.set(r.teamId, team);
    }
    const role = r.roleClassic as keyof TeamTypicalLineup["byRole"] | null;
    if (role && role in team.byRole) {
      team.byRole[role].push({
        playerId: r.playerId,
        slug: r.slug,
        name: r.name,
        externalId: r.externalId,
        roleClassic: r.roleClassic,
        quotCurrentClassic: r.quotCurrentClassic,
      });
    }
  }

  for (const team of byTeam.values()) {
    for (const role of ROLE_KEYS) {
      team.byRole[role].sort((a, b) => (b.quotCurrentClassic ?? 0) - (a.quotCurrentClassic ?? 0));
    }

    // Taglia ogni reparto agli slot reali del modulo: gli 11 migliori per
    // quotazione sono i "titolari", chi resta fuori per un pelo è ballottaggio,
    // non semplicemente scartato.
    const counts = parseFormationCounts(team.formation);
    const slots = { P: 1, D: counts.D, C: counts.C, A: counts.A };
    for (const role of ROLE_KEYS) {
      team.ballottaggi[role] = team.byRole[role].slice(slots[role]);
      team.byRole[role] = team.byRole[role].slice(0, slots[role]);
    }
  }

  return [...byTeam.values()];
}

export async function getTypicalLineupForTeam(teamId: number): Promise<TeamTypicalLineup | null> {
  const [lineup] = await getTypicalLineups(teamId);
  return lineup ?? null;
}
