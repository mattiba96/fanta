import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { teamLineups, fixtures } from "@/db/schema";

/** Modulo più recente per squadra, dedotto dall'ultima giornata di probabili
 * formazioni scaricata (stesso dato mostrato nella scheda giocatore). */
export async function getLatestFormationByTeam(): Promise<Map<number, string>> {
  const rows = await db
    .select({
      teamId: teamLineups.teamId,
      formation: teamLineups.formation,
      matchday: fixtures.matchday,
    })
    .from(teamLineups)
    .innerJoin(fixtures, eq(fixtures.id, teamLineups.fixtureId))
    .where(isNotNull(teamLineups.formation));

  const byTeam = new Map<number, { formation: string; matchday: number }>();
  for (const r of rows) {
    if (!r.formation) continue;
    const current = byTeam.get(r.teamId);
    if (!current || r.matchday > current.matchday) {
      byTeam.set(r.teamId, { formation: r.formation, matchday: r.matchday });
    }
  }
  return new Map([...byTeam].map(([teamId, v]) => [teamId, v.formation]));
}
