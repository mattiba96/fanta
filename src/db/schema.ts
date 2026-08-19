import { sql } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  text,
  real,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

export const teams = sqliteTable("teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  externalId: integer("external_id").unique(), // id numerico fantacalcio.it (es. Inter=9) — join più robusto di code/name
  code: text("code").notNull().unique(), // es. "INT", "ATA" — join da listone/statistiche
  name: text("name").notNull().unique(), // es. "Inter" — join dalle probabili formazioni
  slug: text("slug").notNull().unique(),
});

export const players = sqliteTable(
  "players",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    externalId: text("external_id").unique(),
    slug: text("slug").notNull().unique(), // chiave naturale per l'upsert
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    teamId: integer("team_id").references(() => teams.id),
    roleClassic: text("role_classic"), // P | D | C | A
    rolesMantra: text("roles_mantra"), // CSV, es. "Dc;Ds"
    quotInitialClassic: integer("quot_initial_classic"),
    quotCurrentClassic: integer("quot_current_classic"),
    quotInitialMantra: integer("quot_initial_mantra"),
    quotCurrentMantra: integer("quot_current_mantra"),
    fvmClassic: integer("fvm_classic"),
    fvmMantra: integer("fvm_mantra"),
    isActive: integer("is_active").notNull().default(1),
    sourceUrl: text("source_url"), // pagina profilo su fantacalcio.it, per la descrizione (fetch pigro)
    generalDescription: text("general_description"), // paragrafo tattico/fisico, non sempre presente
    proDescription: text("pro_description"),
    contraDescription: text("contra_description"),
    descriptionUpdatedAt: text("description_updated_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("ix_players_team").on(t.teamId),
    index("ix_players_role").on(t.roleClassic),
    index("ix_players_normalized_name").on(t.normalizedName),
    index("ix_players_quot_classic").on(t.quotCurrentClassic),
  ],
);

export const playerAliases = sqliteTable(
  "player_aliases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    source: text("source"),
  },
  (t) => [uniqueIndex("ux_player_aliases_alias").on(t.alias)],
);

export const playerSeasonStats = sqliteTable(
  "player_season_stats",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    season: text("season").notNull(), // "2025-26"
    pv: integer("pv"), // partite a voto
    mv: real("mv"), // media voto
    fm: real("fm"), // fantamedia
    goals: integer("goals"),
    goalsConceded: integer("goals_conceded"), // portieri
    penaltiesScored: integer("penalties_scored"),
    penaltiesTaken: integer("penalties_taken"),
    penaltiesSaved: integer("penalties_saved"),
    assists: integer("assists"),
    yellowCards: integer("yellow_cards"),
    redCards: integer("red_cards"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("ux_player_season").on(t.playerId, t.season),
    index("ix_stats_season").on(t.season),
  ],
);

export const fixtures = sqliteTable(
  "fixtures",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    season: text("season").notNull(),
    matchday: integer("matchday").notNull(),
    homeTeamId: integer("home_team_id")
      .notNull()
      .references(() => teams.id),
    awayTeamId: integer("away_team_id")
      .notNull()
      .references(() => teams.id),
    kickoffAt: text("kickoff_at"),
    venue: text("venue"),
    sourceUrl: text("source_url"),
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => [
    uniqueIndex("ux_fixture").on(
      t.season,
      t.matchday,
      t.homeTeamId,
      t.awayTeamId,
    ),
  ],
);

export const teamLineups = sqliteTable(
  "team_lineups",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fixtureId: integer("fixture_id")
      .notNull()
      .references(() => fixtures.id, { onDelete: "cascade" }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id),
    formation: text("formation"), // "3-5-2"
    coach: text("coach"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("ux_team_lineup").on(t.fixtureId, t.teamId)],
);

export const lineupPlayers = sqliteTable(
  "lineup_players",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamLineupId: integer("team_lineup_id")
      .notNull()
      .references(() => teamLineups.id, { onDelete: "cascade" }),
    playerId: integer("player_id").references(() => players.id), // NULL se non matchato
    rawName: text("raw_name").notNull(),
    status: text("status").notNull(), // starter|bench|doubt|injured|suspended|warned
    probability: integer("probability"), // 0-100
    note: text("note"),
    ballotGroup: text("ballot_group"),
  },
  (t) => [index("ix_lineup_players_player").on(t.playerId)],
);

export const auctionSettings = sqliteTable("auction_settings", {
  id: integer("id").primaryKey().default(1),
  leagueName: text("league_name"),
  mode: text("mode").notNull().default("classic"), // classic | mantra
  totalBudget: integer("total_budget").notNull().default(500),
  slotsGk: integer("slots_gk").notNull().default(3),
  slotsDef: integer("slots_def").notNull().default(8),
  slotsMid: integer("slots_mid").notNull().default(8),
  slotsFwd: integer("slots_fwd").notNull().default(6),
  participants: integer("participants").default(8),
  activeSeason: text("active_season"),
  statsSeason: text("stats_season"),
  // Strategia d'asta dichiarata dall'utente in linguaggio libero (es. "punto
  // tutto su 2 top attaccanti e risparmio in difesa", "priorità ai giovani in
  // crescita"): il consiglio AI deve seguire questa, non solo l'indice di
  // valore generico calcolato dal motore deterministico.
  auctionStrategy: text("auction_strategy"),
  // Ultimo consiglio AI generato automaticamente (ogni volta che un'assegnazione
  // cambia, non solo su richiesta manuale) — persistito così resta visibile
  // anche dopo un refresh/navigazione, senza dover rigenerarlo a comando.
  lastAiAdvice: text("last_ai_advice"),
  lastAiAdviceAt: text("last_ai_advice_at"),
  updatedAt: text("updated_at").notNull(),
});

export const leagueParticipants = sqliteTable("league_participants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  isMe: integer("is_me").notNull().default(0), // esattamente un partecipante rappresenta l'utente
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const auctionPicks = sqliteTable("auction_picks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  playerId: integer("player_id")
    .notNull()
    .unique()
    .references(() => players.id, { onDelete: "cascade" }),
  participantId: integer("participant_id")
    .notNull()
    .references(() => leagueParticipants.id, { onDelete: "cascade" }),
  price: integer("price").notNull().default(0),
  roleSlot: text("role_slot"), // P/D/C/A
  pickedAt: text("picked_at").notNull(),
});

export const watchlist = sqliteTable("watchlist", {
  playerId: integer("player_id")
    .primaryKey()
    .references(() => players.id, { onDelete: "cascade" }),
  targetPrice: integer("target_price"),
  priority: integer("priority"),
  note: text("note"),
});

// Prezzi realmente pagati in aste passate dell'utente, importati da file
// Excel/csv esterni una tantum (non uno scraping): servono da riferimento
// concreto ("quanto ho pagato l'ultima volta questo giocatore") e per
// calibrare il motore di consigli sui prezzi reali del proprio gruppo,
// invece che solo sull'FVM ufficiale. playerId nullable: un nome non
// riconosciuto va comunque conservato, non deve far fallire l'importazione.
export const historicalAuctionPrices = sqliteTable("historical_auction_prices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  playerId: integer("player_id").references(() => players.id, { onDelete: "cascade" }),
  rawName: text("raw_name").notNull(),
  role: text("role"),
  price: integer("price").notNull(),
  seasonLabel: text("season_label").notNull(),
  sourceFile: text("source_file").notNull(),
  createdAt: text("created_at").notNull(),
});

export const fcpRatings = sqliteTable(
  "fcp_ratings",
  {
    playerId: integer("player_id")
      .primaryKey()
      .references(() => players.id, { onDelete: "cascade" }),
    rawName: text("raw_name").notNull(),
    fcpUrl: text("fcp_url"), // pagina individuale, per il commento (fetch pigro)
    algScore: integer("alg_score"), // "ALG FCP", 0-100 — indice di appetibilità dalla lista
    trend: real("trend"), // percentuale, es. 30.1
    tags: text("tags"), // CSV: Titolare;Rigorista;Fuoriclasse;...
    appealScore: integer("appeal_score"), // "Punteggio FantaCalcioPedia" (0-100), dalla pagina individuale
    injuryResistance: integer("injury_resistance"), // 0-100, dalla pagina individuale
    investmentSolidity: integer("investment_solidity"), // 0-100, dalla pagina individuale
    comment: text("comment"), // paragrafo "SCHEDA FANTACALCIO": ruolo/stile di gioco, stabile nel tempo
    predictedAppearancesMin: integer("predicted_appearances_min"),
    predictedAppearancesMax: integer("predicted_appearances_max"),
    predictedGoalsMin: integer("predicted_goals_min"),
    predictedGoalsMax: integer("predicted_goals_max"),
    predictedAssistsMin: integer("predicted_assists_min"),
    predictedAssistsMax: integer("predicted_assists_max"),
    commentUpdatedAt: text("comment_updated_at"), // null finché non richiesta la pagina individuale
    updatedAt: text("updated_at").notNull(),
  },
);

export const setPieceRoles = sqliteTable(
  "set_piece_roles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // penalty | free_kick | corner
    priority: integer("priority").notNull(), // 1 = primo rigorista/tiratore, 2 = alternativa, ...
    playerId: integer("player_id").references(() => players.id), // NULL se non matchato
    rawName: text("raw_name").notNull(),
    season: text("season").notNull(),
    sourceUrl: text("source_url"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("ux_set_piece_role").on(
      t.teamId,
      t.kind,
      t.priority,
      t.season,
    ),
    index("ix_set_piece_player").on(t.playerId),
  ],
);

export const unmatchedNames = sqliteTable(
  "unmatched_names",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source").notNull(), // statistiche | listone | probabili | set_piece_roles
    rawName: text("raw_name").notNull(),
    teamId: integer("team_id").references(() => teams.id),
    seenCount: integer("seen_count").notNull().default(1),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (t) => [uniqueIndex("ux_unmatched").on(t.source, t.rawName, t.teamId)],
);

export const newsArticles = sqliteTable(
  "news_articles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source").notNull(), // sosfanta
    url: text("url").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    author: text("author"),
    imageUrl: text("image_url"),
    publishedAt: text("published_at"),
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => [uniqueIndex("ux_news_url").on(t.url)],
);

export const scrapeRuns = sqliteTable("scrape_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(), // listone | statistiche | probabili
  status: text("status").notNull(), // running | ok | error
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  rowsInserted: integer("rows_inserted"),
  rowsUpdated: integer("rows_updated"),
  rowsUnmatched: integer("rows_unmatched"),
  message: text("message"),
  contentHash: text("content_hash"),
  url: text("url"),
});

export const sqlNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
