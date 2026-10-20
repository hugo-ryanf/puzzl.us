import {
  customType,
  index,
  integer,
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

/** Um navegador = um convidado (guestId no localStorage). Contas de verdade vêm depois. */
export const players = pgTable('players', {
  id: uuid('id').primaryKey().defaultRandom(),
  guestId: uuid('guest_id').notNull().unique(),
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
