import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Coluna binária do Postgres. O Drizzle 0.45 não tem `bytea` pronto; os drivers devolvem
 * Buffer (pg) ou Uint8Array (PGlite), então normalizamos para Buffer.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (value) => Buffer.from(value),
});

/**
 * Conta de verdade (login com Google). O e-mail não é guardado: no login ele só é comparado com
 * ADMIN_EMAILS para marcar `is_admin`. `friend_code` é o código que um amigo digita para adicionar.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Identificador estável da conta no Google (o "sub" do id_token). */
  googleSub: text('google_sub').notNull().unique(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  friendCode: text('friend_code').notNull().unique(),
  isAdmin: boolean('is_admin').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Sessão de login. O cookie leva um token aleatório; aqui fica só o hash SHA-256 dele, então um
 * vazamento do banco não entrega sessões válidas.
 */
export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sessions_user_idx').on(table.userId)],
);

/**
 * Quem aparece nas partidas. Convidado: um navegador (guestId no localStorage). Com conta, o
 * jogador fica ligado a ela (`user_id`) e vale em qualquer aparelho.
 */
export const players = pgTable('players', {
  id: uuid('id').primaryKey().defaultRandom(),
  guestId: uuid('guest_id').notNull().unique(),
  /** A conta dona deste jogador (no máximo um jogador por conta). */
  userId: uuid('user_id')
    .unique()
    .references(() => users.id, { onDelete: 'set null' }),
  nickname: text('nickname').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Uma partida terminada. O ranking compara partidas da mesma categoria (peças + equipe). */
export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomCode: text('room_code').notNull(),
    /** Imagem do catálogo. Partidas da fase 3 (imagem gerada por código) ficaram como 'gerada'. */
    imageId: text('image_id').notNull(),
    /** Tamanho escolhido (categoria); rows × cols é o tamanho real gerado. */
    pieceCount: integer('piece_count').notNull(),
    rows: integer('rows').notNull(),
    cols: integer('cols').notNull(),
    seed: text('seed').notNull(),
    teamSize: integer('team_size').notNull(),
    /** Ids dos jogadores ordenados e unidos: identifica "a mesma equipe" entre partidas. */
    teamKey: text('team_key').notNull(),
    durationMs: integer('duration_ms').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // A consulta do ranking filtra por categoria (imagem, peças, equipe) e ordena por tempo.
    index('games_ranking_idx').on(
      table.imageId,
      table.pieceCount,
      table.teamSize,
      table.durationMs,
    ),
    // Ranking geral e filtros de hoje/semana/mês: por modalidade e data de fim.
    index('games_period_idx').on(table.teamSize, table.finishedAt),
  ],
);

export const gamePlayers = pgTable(
  'game_players',
  {
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    /** Apelido no momento da partida (o jogador pode trocar depois). */
    nickname: text('nickname').notNull(),
  },
  (table) => [primaryKey({ columns: [table.gameId, table.playerId] })],
);

/**
 * Fotos enviadas pelos jogadores, já reprocessadas (WebP ≤ 2048 px, sem metadados). O id é
 * aleatório e impossível de adivinhar: quem tem o id da sala tem a foto, e mais ninguém.
 * Apagadas depois de 7 dias sem nenhuma sala usar (last_used_at).
 */
export const uploads = pgTable(
  'uploads',
  {
    id: text('id').primaryKey(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    data: bytea('data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('uploads_last_used_idx').on(table.lastUsedAt)],
);

/**
 * Última foto de cada sala em andamento, para ela sobreviver a um reinício do servidor (deploy,
 * Render dormindo, queda). Some quando a partida termina ou todo mundo sai; as esquecidas são
 * apagadas depois de SNAPSHOT_TTL_HOURS sem atualização.
 */
export const roomSnapshots = pgTable(
  'room_snapshots',
  {
    roomCode: text('room_code').primaryKey(),
    /** RoomSnapshot (rooms/snapshot.ts) em JSON; o campo `version` protege contra formatos antigos. */
    data: jsonb('data').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('room_snapshots_updated_idx').on(table.updatedAt)],
);

/** Quebra-cabeças que a pessoa marcou para montar depois (só com conta). */
export const favorites = pgTable(
  'favorites',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    imageId: text('image_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.imageId] })],
);

/**
 * Partidas salvas para continuar depois ("Em andamento"). Só o dono (quem criou a sala, logado)
 * vê e retoma. `data` é o mesmo RoomSnapshot usado para sobreviver a reinícios; as colunas soltas
 * servem só para listar sem abrir o JSON.
 */
export const savedGames = pgTable(
  'saved_games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    imageId: text('image_id').notNull(),
    pieceCount: integer('piece_count').notNull(),
    maxPlayers: integer('max_players').notNull(),
    pieces: integer('pieces').notNull(),
    placed: integer('placed').notNull(),
    elapsedMs: integer('elapsed_ms').notNull(),
    data: jsonb('data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('saved_games_owner_idx').on(table.ownerUserId, table.updatedAt)],
);
