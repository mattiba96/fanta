import type Anthropic from "@anthropic-ai/sdk";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { players, teams } from "@/db/schema";
import { normalizeName } from "@/lib/scraping/normalize";
import { getAdviceForAvailablePlayers, getAdviceForPlayer } from "@/lib/queries/advice";
import { getPlayerBySlug } from "@/lib/queries/players";
import { getPlayerLineupStatus } from "@/lib/queries/lineups";
import { getTeamSetPieces } from "@/lib/queries/setPieces";
import { bandLabel, type Role } from "@/lib/advice/engine";

/**
 * Tool "di sola lettura" per la chat AI: ognuno è un wrapper sottile sulle
 * stesse query usate dalla UI, così la chat ragiona sugli stessi numeri
 * visibili nell'app — mai SQL scritto dal modello, limiti sempre clampati
 * lato server. Nessun tool scrive nel database: questa è un'app di
 * consultazione/scouting, non gestisce l'asta dal vivo.
 */

const ROLES: Role[] = ["P", "D", "C", "A"];

type PlayerMatchRow = {
  id: number;
  slug: string;
  name: string;
  teamCode: string;
  roleClassic: string | null;
  normalizedName: string;
  isActive: number;
};

type ResolveResult =
  | { status: "found"; player: PlayerMatchRow }
  | { status: "ambiguous"; candidates: Array<{ name: string; teamCode: string; roleClassic: string | null }> }
  | { status: "not_found" };

/**
 * Il modello riceve nomi in linguaggio naturale ("Lautaro Martinez", "il
 * portiere del Napoli"), ma i giocatori in DB sono salvati col cognome nel
 * formato fantacalcio.it ("Martinez L."). Prova prima un match esatto/di
 * contenimento sul nome normalizzato, poi ripiega su un punteggio a parole
 * condivise — se il migliore non è netto, restituisce candidati invece di
 * indovinare (stessa cautela usata per il matching degli import storici).
 */
async function resolvePlayer(rawName: string): Promise<ResolveResult> {
  const query = normalizeName(rawName);
  if (query.length < 2) return { status: "not_found" };

  const rows: PlayerMatchRow[] = await db
    .select({
      id: players.id,
      slug: players.slug,
      name: players.name,
      teamCode: teams.code,
      roleClassic: players.roleClassic,
      normalizedName: players.normalizedName,
      isActive: players.isActive,
    })
    .from(players)
    .innerJoin(teams, eq(teams.id, players.teamId))
    .where(eq(players.isActive, 1));

  const exact = rows.filter((r) => r.normalizedName === query);
  if (exact.length === 1) return { status: "found", player: exact[0] };

  const contains = rows.filter(
    (r) => r.normalizedName.includes(query) || query.includes(r.normalizedName),
  );
  if (contains.length === 1) return { status: "found", player: contains[0] };

  const words = query.split(" ").filter((w) => w.length >= 3);
  if (words.length === 0) return { status: "not_found" };

  const scored = rows
    .map((r) => ({ row: r, score: words.filter((w) => r.normalizedName.includes(w)).length }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { status: "not_found" };
  if (scored.length === 1 || scored[0].score > scored[1].score) {
    return { status: "found", player: scored[0].row };
  }

  const topScore = scored[0].score;
  return {
    status: "ambiguous",
    candidates: scored
      .filter((s) => s.score === topScore)
      .slice(0, 6)
      .map((s) => ({ name: s.row.name, teamCode: s.row.teamCode, roleClassic: s.row.roleClassic })),
  };
}

type PlayerSummary = {
  name: string;
  teamCode: string;
  role: string | null;
  quotCurrentClassic: number | null;
  fvmClassic: number | null;
  score: number | null;
  bandLabel: string | null;
  suggestedPrice: number | null;
};

async function summarizePlayers(
  rows: Array<{
    id: number;
    name: string;
    teamCode: string;
    roleClassic: string | null;
    quotCurrentClassic: number | null;
    fvmClassic: number | null;
  }>,
): Promise<PlayerSummary[]> {
  const adviceByPlayer = await getAdviceForAvailablePlayers();
  return rows.map((r) => {
    const advice = adviceByPlayer.get(r.id) ?? null;
    return {
      name: r.name,
      teamCode: r.teamCode,
      role: r.roleClassic,
      quotCurrentClassic: r.quotCurrentClassic,
      fvmClassic: r.fvmClassic,
      score: advice?.score ?? null,
      bandLabel: advice ? bandLabel(advice.band) : null,
      suggestedPrice: advice?.suggestedPrice ?? null,
    };
  });
}

async function baseSearch(opts: { query?: string; role?: string }) {
  const conditions = [eq(players.isActive, 1)];
  if (opts.role && ROLES.includes(opts.role as Role)) {
    conditions.push(eq(players.roleClassic, opts.role));
  }
  if (opts.query && opts.query.trim().length >= 2) {
    const q = normalizeName(opts.query);
    conditions.push(like(players.normalizedName, `%${q}%`));
  }

  return db
    .select({
      id: players.id,
      name: players.name,
      teamCode: teams.code,
      roleClassic: players.roleClassic,
      quotCurrentClassic: players.quotCurrentClassic,
      fvmClassic: players.fvmClassic,
    })
    .from(players)
    .innerJoin(teams, eq(teams.id, players.teamId))
    .where(and(...conditions));
}

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_players",
    description:
      "Cerca giocatori di Serie A per nome (anche parziale) e/o ruolo, con indice/fascia/prezzo consigliato. Usa questo per rispondere a domande come 'chi ci sono tra i difensori del Napoli' o per trovare un giocatore di cui non sai il cognome esatto.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Testo libero da cercare nel nome del giocatore (anche solo nome o cognome parziale)." },
        role: { type: "string", enum: ROLES, description: "Filtra per ruolo Classic: P=portiere, D=difensore, C=centrocampista, A=attaccante." },
        limit: { type: "integer", description: "Numero massimo di risultati (default 10, max 20)." },
      },
    },
  },
  {
    name: "get_player_detail",
    description:
      "Dettaglio completo di UN giocatore per nome: quotazione/FVM, statistiche stagione corrente e storiche, indice/fascia/prezzo consigliato, tag (rigorista, in dubbio, ecc.), calci piazzati, stato probabile formazione, storico di quanto pagato in aste passate dell'utente.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome o cognome del giocatore, anche parziale o in formato esteso (es. 'Lautaro Martinez')." },
      },
      required: ["name"],
    },
  },
  {
    name: "get_lineup_info",
    description:
      "Stato probabile formazione più recente per un giocatore (titolare/panchina/infortunato/squalificato/diffidato, con probabilità e note) nelle giornate per cui è stato scaricato il dato.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome o cognome del giocatore." },
      },
      required: ["name"],
    },
  },
  {
    name: "compare_players",
    description:
      "Mette a confronto 2-4 giocatori fianco a fianco: quotazione, FVM, indice, fascia, prezzo consigliato, statistiche stagione corrente. Usalo quando l'utente è indeciso tra più nomi specifici.",
    input_schema: {
      type: "object",
      properties: {
        names: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 4,
          description: "2-4 nomi di giocatori da confrontare.",
        },
      },
      required: ["names"],
    },
  },
  {
    name: "list_best_value",
    description:
      "I migliori giocatori per indice di valore (qualità/affidabilità rispetto al prezzo), opzionalmente filtrati per ruolo. Usalo per 'chi conviene di più' o 'i migliori scommessa a basso costo'.",
    input_schema: {
      type: "object",
      properties: {
        role: { type: "string", enum: ROLES },
        limit: { type: "integer", description: "Default 10, max 20." },
      },
    },
  },
];

export type ToolResult = { ok: boolean; [key: string]: unknown };

export async function runTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case "search_players": {
      const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 20);
      const rows = await baseSearch({
        query: typeof input.query === "string" ? input.query : undefined,
        role: typeof input.role === "string" ? input.role : undefined,
      });
      const summaries = await summarizePlayers(rows);
      summaries.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      return { ok: true, players: summaries.slice(0, limit), totalMatches: summaries.length };
    }

    case "get_player_detail": {
      const resolved = await resolvePlayer(String(input.name ?? ""));
      if (resolved.status === "not_found") return { ok: false, message: "Nessun giocatore trovato con questo nome." };
      if (resolved.status === "ambiguous") return { ok: false, ambiguous: true, candidates: resolved.candidates };

      const data = await getPlayerBySlug(resolved.player.slug);
      if (!data) return { ok: false, message: "Giocatore non trovato." };

      const [advice, lineupStatus, setPieces] = await Promise.all([
        getAdviceForPlayer(data.player.id),
        getPlayerLineupStatus(data.player.id),
        getTeamSetPieces(data.team.id),
      ]);
      const mySetPieces = setPieces.filter((sp) => sp.playerId === data.player.id);

      return {
        ok: true,
        name: data.player.name,
        team: data.team.name,
        role: data.player.roleClassic,
        quotCurrentClassic: data.player.quotCurrentClassic,
        fvmClassic: data.player.fvmClassic,
        quotCurrentMantra: data.player.quotCurrentMantra,
        fvmMantra: data.player.fvmMantra,
        statsCurrentSeason: data.stats,
        statsHistory: data.statsHistory,
        score: advice?.score ?? null,
        bandLabel: advice ? bandLabel(advice.band) : null,
        suggestedPrice: advice?.suggestedPrice ?? null,
        tags: advice?.tags ?? [],
        setPieceRoles: mySetPieces.map((sp) => ({ kind: sp.kind, priority: sp.priority })),
        priceHistoryPastAuctions: data.priceHistory,
        lineupStatus,
      };
    }

    case "get_lineup_info": {
      const resolved = await resolvePlayer(String(input.name ?? ""));
      if (resolved.status === "not_found") return { ok: false, message: "Nessun giocatore trovato con questo nome." };
      if (resolved.status === "ambiguous") return { ok: false, ambiguous: true, candidates: resolved.candidates };
      const status = await getPlayerLineupStatus(resolved.player.id);
      return { ok: true, name: resolved.player.name, lineupStatus: status };
    }

    case "compare_players": {
      const names = Array.isArray(input.names) ? input.names.map(String).slice(0, 4) : [];
      if (names.length < 2) return { ok: false, message: "Servono almeno 2 nomi da confrontare." };

      const resolvedRows: PlayerMatchRow[] = [];
      const unresolved: string[] = [];
      for (const n of names) {
        const r = await resolvePlayer(n);
        if (r.status === "found") resolvedRows.push(r.player);
        else unresolved.push(n);
      }
      if (resolvedRows.length < 2) {
        return { ok: false, message: "Meno di 2 giocatori riconosciuti.", unresolved };
      }

      const adviceByPlayer = await getAdviceForAvailablePlayers();
      const rows = await Promise.all(
        resolvedRows.map(async (p) => {
          const data = await getPlayerBySlug(p.slug);
          const advice = adviceByPlayer.get(p.id) ?? null;
          return {
            name: p.name,
            team: p.teamCode,
            role: p.roleClassic,
            quotCurrentClassic: data?.player.quotCurrentClassic ?? null,
            fvmClassic: data?.player.fvmClassic ?? null,
            score: advice?.score ?? null,
            bandLabel: advice ? bandLabel(advice.band) : null,
            suggestedPrice: advice?.suggestedPrice ?? null,
            statsCurrentSeason: data?.stats ?? null,
          };
        }),
      );

      return { ok: true, players: rows, unresolved };
    }

    case "list_best_value": {
      const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 20);
      const rows = await baseSearch({
        role: typeof input.role === "string" ? input.role : undefined,
      });
      const summaries = await summarizePlayers(rows);
      summaries.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      return { ok: true, players: summaries.slice(0, limit) };
    }

    default:
      return { ok: false, message: `Tool sconosciuto: ${name}` };
  }
}
