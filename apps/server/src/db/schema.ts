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
import type { AvatarPreset } from '@puzzle/shared';

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
  /** Nickname escolhido no perfil (null: o primeiro nome do Google). */
  nickname: text('nickname'),
  bio: text('bio'),
  /** 'google' (a foto do Google) ou 'initials' (iniciais na cor escolhida). */
  avatarStyle: text('avatar_style', { enum: ['google', 'initials', 'preset'] })
    .notNull()
    .default('google'),
  /** Cor das iniciais (null: automática pelo nome). */
  avatarColor: text('avatar_color'),
  /** Camaleão escolhido (AVATAR_PRESETS), quando avatar_style = 'preset'. */
  avatarPreset: text('avatar_preset').$type<AvatarPreset>(),
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
    /** Pontos do ranking por pontos, calculados ao gravar (peças × fator de velocidade). */
    points: integer('points').notNull().default(0),
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
 * Apagadas depois de 7 dias sem nenhuma sala usar (last_used_at), publicadas ou não.
 */
export const uploads = pgTable(
  'uploads',
  {
    id: text('id').primaryKey(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    data: bytea('data').notNull(),
    /** Conta de quem enviou, se estava logado: só ela pode publicar a foto para todos. */
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
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

/**
 * Fotos enviadas que o dono publicou para todos (aparecem no Explorar e entram no ranking).
 * `hidden`: denunciada demais, fora do ar até o admin decidir. `removed`: tirada pelo autor ou
 * pelo admin (a linha fica para o mesmo upload não ser publicado de novo sem revisão).
 */
export const communityPuzzles = pgTable(
  'community_puzzles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    uploadId: text('upload_id')
      .notNull()
      .unique()
      .references(() => uploads.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    authorName: text('author_name').notNull(),
    status: text('status', { enum: ['published', 'hidden', 'removed'] })
      .notNull()
      .default('published'),
    /** Miniatura (WebP, 480 px) para o card: a foto inteira pesaria demais na grade. */
    mini: bytea('mini').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('community_puzzles_status_idx').on(table.status, table.createdAt)],
);

/** Uma denúncia por conta e quebra-cabeça; COMMUNITY_HIDE_REPORTS delas ocultam a foto. */
export const puzzleReports = pgTable(
  'puzzle_reports',
  {
    puzzleId: uuid('puzzle_id')
      .notNull()
      .references(() => communityPuzzles.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.puzzleId, table.userId] })],
);

/**
 * Amizade entre duas contas, guardada uma vez só: `user_low` é o menor dos dois ids. `pending`
 * espera quem não pediu aceitar; `accepted` vale para os dois lados.
 */
export const friendships = pgTable(
  'friendships',
  {
    userLow: uuid('user_low')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userHigh: uuid('user_high')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'accepted'] })
      .notNull()
      .default('pending'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userLow, table.userHigh] }),
    index('friendships_high_idx').on(table.userHigh),
  ],
);

/**
 * Uma corrida de Bullet terminada: quantos quebra-cabeças a equipe montou no tempo. O ranking
 * compara corridas da mesma categoria (minutos + peças + equipe); `team_key` como em `games`.
 */
export const bulletRuns = pgTable(
  'bullet_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomCode: text('room_code').notNull(),
    minutes: integer('minutes').notNull(),
    pieceCount: integer('piece_count').notNull(),
    teamSize: integer('team_size').notNull(),
    teamKey: text('team_key').notNull(),
    solved: integer('solved').notNull(),
    /** Peças encaixadas no quebra-cabeça que ficou pela metade (desempate). */
    partial: integer('partial').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('bullet_runs_category_idx').on(
      table.minutes,
      table.pieceCount,
      table.teamSize,
      table.finishedAt,
    ),
  ],
);

/**
 * Uma batalha terminada (com vencedor: a morte súbita desempata a batalha por tempo). Sem
 * ranking: alimenta o placar de vitórias e as conquistas do perfil. `comeback` = o vencedor
 * estava atrás a 10 s do fim (batalha por tempo).
 */
export const battleResults = pgTable(
  'battle_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomCode: text('room_code').notNull(),
    /** '1v1' | '2v2'. */
    format: text('format').notNull(),
    timed: boolean('timed').notNull(),
    /** 'a' | 'b'. */
    winner: text('winner').notNull(),
    walkover: boolean('walkover').notNull().default(false),
    comeback: boolean('comeback').notNull().default(false),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('battle_results_finished_idx').on(table.finishedAt)],
);

export const battleResultPlayers = pgTable(
  'battle_result_players',
  {
    resultId: uuid('result_id')
      .notNull()
      .references(() => battleResults.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    /** Lado em que jogou ('a' ou 'b'). */
    team: text('team').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.resultId, table.playerId] }),
    index('battle_result_players_player_idx').on(table.playerId),
  ],
);
