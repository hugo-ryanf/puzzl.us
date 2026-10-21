import { z } from 'zod';
import { findCatalogImage } from './catalog';
import { PIECE_COUNT_PRESETS } from './grid';

/** Nome do tipo de sala registrado no servidor Colyseus. */
export const ROOM_NAME = 'puzzle';

/** Solo, dupla, trio ou quarteto: as quatro modalidades do ranking. */
export const MAX_PLAYERS = 4;

/** imageId especial ao criar a sala: o servidor sorteia uma foto do catálogo. */
export const RANDOM_IMAGE = 'random';

/** Uma cor por jogador, na ordem em que entram (borda da peça segurada e cursor). */
export const PLAYER_COLORS = [
  '#ff6b6b',
  '#4dabf7',
  '#51cf66',
  '#fcc419',
  '#cc5de8',
  '#ff922b',
  '#20c997',
  '#f06595',
] as const;

const playerName = z.string().trim().min(1, 'Digite seu nome').max(20);
const pieceCount = z
  .number()
  .refine((n) => (PIECE_COUNT_PRESETS as readonly number[]).includes(n), 'Tamanho inválido');
/** Imagem do catálogo: o id também vira caminho de arquivo no cliente. */
const catalogImageId = z
  .string()
  .refine((id) => findCatalogImage(id) !== undefined, 'Imagem inválida');
/** 1 = solo (começa na hora, sem sala de espera); 2–4 = multiplayer, trava quando enche. */
const maxPlayers = z.number().int().min(1).max(MAX_PLAYERS);
const groupId = z.number().int().nonnegative();
/** Limite generoso: a mesa ocupa ~2× a imagem; só barramos valores absurdos. */
const coordinate = z.number().min(-100_000).max(100_000);

/** Andamento da partida: lobby (esperando o anfitrião) → playing → completed. */
export type GamePhase = 'lobby' | 'playing' | 'completed';

/**
 * Situação do registro no ranking depois que o puzzle termina.
 * 'unranked': foto enviada pelos jogadores — única, então não há com quem comparar.
 */
export type RankStatus = '' | 'saving' | 'saved' | 'unavailable' | 'unranked';

// ── Fotos enviadas ──────────────────────────────────────────────────────────

/** Na sala, fotos enviadas usam imageId = "upload:<id aleatório de 22 caracteres>". */
export const UPLOAD_PREFIX = 'upload:';
export const UPLOAD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const UPLOAD_IMAGE_PATTERN = new RegExp(`^${UPLOAD_PREFIX}[A-Za-z0-9_-]{22}$`);

/** Catálogo ou foto enviada ("upload:<id>"); a existência do upload é checada no servidor. */
const imageId = z.union([catalogImageId, z.string().regex(UPLOAD_IMAGE_PATTERN)]);

/** O id do upload, se o imageId da sala for de uma foto enviada. */
export function uploadIdOf(imageId: string): string | undefined {
  return UPLOAD_IMAGE_PATTERN.test(imageId) ? imageId.slice(UPLOAD_PREFIX.length) : undefined;
}

/** Limites do upload (o cliente já reduz antes de enviar; o servidor confere de novo). */
export const UPLOAD_LIMITS = {
  /** Tamanho máximo do arquivo enviado. */
  maxBytes: 15 * 1024 * 1024,
  /** Menor lado aceito: abaixo disso as peças ficam borradas demais. */
  minSide: 400,
  /** Proporção máxima (lado maior / menor): panorâmicas extremas viram peças esticadas. */
  maxAspect: 3,
} as const;

/** Resposta de POST /api/uploads. */
export interface UploadResponse {
  imageId: string;
  width: number;
  height: number;
}

// ── Cliente → servidor ao criar/entrar ──────────────────────────────────────

export const JoinOptions = z.object({
  name: playerName,
  /** Identidade de convidado, gerada e guardada no navegador. Nunca vai para o estado público. */
  guestId: z.uuid(),
});
export type JoinOptions = z.infer<typeof JoinOptions>;

export const CreateRoomOptions = JoinOptions.extend({
  pieceCount,
  imageId: z.union([imageId, z.literal(RANDOM_IMAGE)]),
  maxPlayers: maxPlayers.default(MAX_PLAYERS),
});
export type CreateRoomOptions = z.infer<typeof CreateRoomOptions>;

// ── Cliente → servidor durante o jogo ───────────────────────────────────────

export const GrabMessage = z.object({ groupId });
export type GrabMessage = z.infer<typeof GrabMessage>;

/** Usado tanto para mover quanto para soltar (o drop leva a posição final). */
export const MoveMessage = z.object({ groupId, x: coordinate, y: coordinate });
export type MoveMessage = z.infer<typeof MoveMessage>;

export const CursorMessage = z.object({ x: coordinate, y: coordinate });
export type CursorMessage = z.infer<typeof CursorMessage>;

// ── Servidor → cliente ──────────────────────────────────────────────────────

/** Cursores não ficam no estado sincronizado: são efêmeros e repassados direto aos outros. */
export interface CursorBroadcast {
  sessionId: string;
  x: number;
  y: number;
}

/**
 * Resposta do request `voiceToken`: credenciais para entrar na chamada do LiveKit da sala.
 * O token é pedido pela conexão do jogo, então só quem está na sala consegue um.
 */
export type VoiceTokenResponse =
  { available: false } | { available: true; url: string; token: string };

// ── API REST de ranking ─────────────────────────────────────────────────────

/**
 * GET /api/ranking?image=praia&pieces=100&players=2
 * Categoria = imagem + tamanho escolhido + tamanho da equipe (só compara partidas iguais).
 */
export const RankingQuery = z.object({
  image: catalogImageId, // fotos enviadas não têm ranking
  pieces: z.coerce.number().pipe(pieceCount),
  players: z.coerce.number().int().min(1).max(MAX_PLAYERS),
});
export type RankingQuery = z.infer<typeof RankingQuery>;

/** Uma linha do ranking: o melhor tempo de cada equipe na categoria. */
export interface RankingEntry {
  position: number;
  players: string[];
  durationMs: number;
  /** ISO 8601. */
  finishedAt: string;
}
