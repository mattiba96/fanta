import { distance } from "fastest-levenshtein";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { players, playerAliases, teams } from "@/db/schema";

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugifyPlayer(name: string, teamSlug: string): string {
  return `${normalizeName(name).replace(/\s+/g, "-")}-${teamSlug}`;
}

export function parseItalianNumber(
  raw: string | null | undefined,
): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "-") return null;
  const normalized = trimmed.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function parsePenalties(raw: string | null | undefined): {
  scored: number | null;
  taken: number | null;
} {
  if (!raw) return { scored: null, taken: null };
  const m = raw.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return { scored: null, taken: null };
  return { scored: Number(m[1]), taken: Number(m[2]) };
}

type Team = typeof teams.$inferSelect;

let teamsCache: Team[] | null = null;

export async function getAllTeams(): Promise<Team[]> {
  if (!teamsCache) teamsCache = await db.select().from(teams);
  return teamsCache;
}

export function invalidateTeamsCache() {
  teamsCache = null;
}

export async function resolveTeamByExternalId(
  externalId: number,
): Promise<Team | null> {
  const all = await getAllTeams();
  return all.find((t) => t.externalId === externalId) ?? null;
}

export async function resolveTeamByCode(code: string): Promise<Team | null> {
  const all = await getAllTeams();
  const norm = code.trim().toLowerCase();
  return all.find((t) => t.code.toLowerCase() === norm) ?? null;
}

export async function resolveTeamByName(name: string): Promise<Team | null> {
  const all = await getAllTeams();
  const norm = normalizeName(name);
  const exact = all.find((t) => normalizeName(t.name) === norm);
  if (exact) return exact;
  return (
    all.find(
      (t) =>
        norm.includes(normalizeName(t.name)) ||
        normalizeName(t.name).includes(norm),
    ) ?? null
  );
}

export type MatchMethod =
  | "external_id"
  | "alias"
  | "exact_team"
  | "exact"
  | "fuzzy"
  | "unmatched";
export type MatchResult = {
  playerId: number | null;
  method: MatchMethod;
  score?: number;
};

const FUZZY_THRESHOLD = 0.82;

/**
 * Cascata di matching per un nome grezzo proveniente da una fonte di scraping:
 * alias manuale -> match esatto (nome, squadra) -> match esatto senza squadra
 * (copre i trasferimenti) -> fuzzy tra i candidati della stessa squadra -> unmatched.
 * Read-only: non crea mai un giocatore. La creazione, dove ha senso, vive nel
 * modulo chiamante (solo listone/statistiche, non lineup/set-piece).
 */
export async function matchPlayer(opts: {
  rawName: string;
  teamId?: number | null;
  externalId?: number | null;
}): Promise<MatchResult> {
  if (opts.externalId != null) {
    const [byExternalId] = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.externalId, String(opts.externalId)))
      .limit(1);
    if (byExternalId) return { playerId: byExternalId.id, method: "external_id" };
  }

  const normalized = normalizeName(opts.rawName);
  if (!normalized) return { playerId: null, method: "unmatched" };

  const [aliasRow] = await db
    .select()
    .from(playerAliases)
    .where(eq(playerAliases.alias, normalized))
    .limit(1);
  if (aliasRow) return { playerId: aliasRow.playerId, method: "alias" };

  if (opts.teamId) {
    const [exactTeam] = await db
      .select()
      .from(players)
      .where(
        and(
          eq(players.normalizedName, normalized),
          eq(players.teamId, opts.teamId),
        ),
      )
      .limit(1);
    if (exactTeam) return { playerId: exactTeam.id, method: "exact_team" };
  }

  const exactAny = await db
    .select()
    .from(players)
    .where(eq(players.normalizedName, normalized));
  if (exactAny.length === 1) {
    return { playerId: exactAny[0].id, method: "exact" };
  }

  if (opts.teamId) {
    const candidates = await db
      .select()
      .from(players)
      .where(eq(players.teamId, opts.teamId));
    let best: { id: number; score: number } | null = null;
    for (const c of candidates) {
      const d = distance(normalized, c.normalizedName);
      const maxLen = Math.max(normalized.length, c.normalizedName.length, 1);
      const similarity = 1 - d / maxLen;
      if (similarity >= FUZZY_THRESHOLD && (!best || similarity > best.score)) {
        best = { id: c.id, score: similarity };
      }
    }
    if (best) return { playerId: best.id, method: "fuzzy", score: best.score };
  }

  return { playerId: null, method: "unmatched" };
}

/**
 * Usato SOLO dalle fonti "roster" (listone, statistiche): matchPlayer, e se non
 * trova nulla crea il giocatore. Sicuro perché il chiamante ha già verificato che
 * la squadra è una delle 20 correnti (altrimenti il giocatore non dovrebbe esistere
 * nel roster). Le fonti "di riferimento" (probabili formazioni, rigoristi/tiratori)
 * NON devono usarlo: per quelle un nome non riconosciuto va loggato, non creato.
 */
export async function resolveOrCreatePlayer(opts: {
  rawName: string;
  teamId: number;
  teamSlug: string;
  roleClassic?: string | null;
  rolesMantra?: string | null;
  externalId?: number | null;
}): Promise<{ playerId: number; created: boolean }> {
  const match = await matchPlayer({
    rawName: opts.rawName,
    teamId: opts.teamId,
    externalId: opts.externalId,
  });
  if (match.playerId) return { playerId: match.playerId, created: false };

  const now = nowIso();
  const normalized = normalizeName(opts.rawName);
  const slug = slugifyPlayer(opts.rawName, opts.teamSlug);

  const [inserted] = await db
    .insert(players)
    .values({
      externalId: opts.externalId != null ? String(opts.externalId) : null,
      slug,
      name: opts.rawName,
      normalizedName: normalized,
      teamId: opts.teamId,
      roleClassic: opts.roleClassic ?? null,
      rolesMantra: opts.rolesMantra ?? null,
      isActive: 1,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: players.slug })
    .returning({ id: players.id });

  if (inserted) return { playerId: inserted.id, created: true };

  // Slug già occupato per un motivo diverso dal match (raro: omonimo esatto
  // nella stessa squadra) -> rilegge l'id esistente invece di fallire.
  const [existing] = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.slug, slug))
    .limit(1);
  return { playerId: existing.id, created: false };
}
