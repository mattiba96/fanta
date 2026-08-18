import { eq, like, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { fcpRatings, players, teams } from "@/db/schema";

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
  byRole: Record<"P" | "D" | "C" | "A", TypicalPlayer[]>;
};

/**
 * Formazione "tipo": chi ci si aspetta giochi con continuità durante TUTTA la
 * stagione (tag "Titolare" da FantaCalcioPedia), non i titolari di una
 * singola giornata (quello lo fa già /formazioni con le probabili formazioni).
 */
export async function getTypicalLineups(): Promise<TeamTypicalLineup[]> {
  const rows = await db
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
    .where(like(fcpRatings.tags, "%Titolare%"))
    .orderBy(asc(teams.name));

  const byTeam = new Map<number, TeamTypicalLineup>();
  for (const r of rows) {
    let team = byTeam.get(r.teamId);
    if (!team) {
      team = {
        teamId: r.teamId,
        teamCode: r.teamCode,
        teamName: r.teamName,
        byRole: { P: [], D: [], C: [], A: [] },
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
    for (const role of Object.keys(team.byRole) as Array<keyof TeamTypicalLineup["byRole"]>) {
      team.byRole[role].sort((a, b) => (b.quotCurrentClassic ?? 0) - (a.quotCurrentClassic ?? 0));
    }
  }

  return [...byTeam.values()];
}
