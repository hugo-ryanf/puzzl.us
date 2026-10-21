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

/** Modo da sala: clássico (um quebra-cabeça), Bullet (contra o relógio) ou Batalha (lados). */
export type GameMode = 'classic' | 'bullet' | 'battle';

/** Andamento da partida: lobby (esperando o anfitrião) → playing → completed. */
export type GamePhase = 'lobby' | 'playing' | 'completed';

/**
 * Situação do registro no ranking depois que o puzzle termina.
 * 'unranked': foto enviada e não publicada — única, então não há com quem comparar.
 */
export type RankStatus = '' | 'saving' | 'saved' | 'unavailable' | 'unranked';

// ── Fotos enviadas ──────────────────────────────────────────────────────────

/** Na sala, fotos enviadas usam imageId = "upload:<id aleatório de 22 caracteres>". */
export const UPLOAD_PREFIX = 'upload:';
export const UPLOAD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const UPLOAD_IMAGE_PATTERN = new RegExp(`^${UPLOAD_PREFIX}[A-Za-z0-9_-]{22}$`);

const uploadImageId = z.string().regex(UPLOAD_IMAGE_PATTERN, 'Foto inválida');
/** Catálogo ou foto enviada ("upload:<id>"); a existência do upload é checada no servidor. */
const imageId = z.union([catalogImageId, uploadImageId]);

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

/** Código da sala (é também o roomId no Colyseus): 5 caracteres, sem O/0, I/1/L. */
export const ROOM_CODE_PATTERN = /^[A-HJKMNP-Z2-9]{5}$/;

/**
 * Trazer de volta uma sala que sumiu num reinício do servidor (ver "Snapshot da sala" na
 * arquitetura). Vai por joinOrCreate filtrado por `restore`: se dois amigos pedem ao mesmo
 * tempo, o matchmaker cria uma sala só e coloca os dois nela.
 */
export const RestoreRoomOptions = JoinOptions.extend({
  restore: z.string().regex(ROOM_CODE_PATTERN),
});
export type RestoreRoomOptions = z.infer<typeof RestoreRoomOptions>;

/** Retomar uma partida salva ("Em andamento"): só quem salvou consegue (o servidor confere). */
export const ResumeRoomOptions = JoinOptions.extend({ resume: z.uuid() });
export type ResumeRoomOptions = z.infer<typeof ResumeRoomOptions>;

// ── Cliente → servidor durante o jogo ───────────────────────────────────────

/** Tabuleiro da mensagem nos modos novos ('main', 'a' ou 'b'); ausente no clássico. */
const boardKey = z.enum(['main', 'a', 'b']).optional();

export const GrabMessage = z.object({ groupId, board: boardKey });
export type GrabMessage = z.infer<typeof GrabMessage>;

/** Usado tanto para mover quanto para soltar (o drop leva a posição final). */
export const MoveMessage = z.object({ groupId, x: coordinate, y: coordinate, board: boardKey });
export type MoveMessage = z.infer<typeof MoveMessage>;

export const CursorMessage = z.object({ x: coordinate, y: coordinate, board: boardKey });
export type CursorMessage = z.infer<typeof CursorMessage>;

// ── Servidor → cliente ──────────────────────────────────────────────────────

/** Cursores não ficam no estado sincronizado: são efêmeros e repassados direto aos outros. */
export interface CursorBroadcast {
  sessionId: string;
  x: number;
  y: number;
  /** Em qual tabuleiro o cursor está (modos novos). */
  board?: string;
}

/**
 * Resposta do request `voiceToken`: credenciais para entrar na chamada do LiveKit da sala.
 * O token é pedido pela conexão do jogo, então só quem está na sala consegue um.
 */
export type VoiceTokenResponse =
  { available: false } | { available: true; url: string; token: string };

// ── Contas (login com Google) ───────────────────────────────────────────────

/** A conta logada, como o site a vê. */
export interface AccountView {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** Código que um amigo digita para te adicionar. */
  friendCode: string;
  isAdmin: boolean;
}

/** GET /api/me — `user: null` = convidado; `googleLogin: false` = servidor sem login. */
export interface MeResponse {
  user: AccountView | null;
  googleLogin: boolean;
}

/**
 * Melhor marca da pessoa numa categoria (foto + peças + modalidade). Ter um record numa foto =
 * já montou aquele quebra-cabeça (o selo "✓ Montado" do card).
 */
export interface PuzzleRecord {
  imageId: string;
  pieceCount: number;
  teamSize: number;
  bestMs: number;
  /** Quantas vezes completou nessa categoria. */
  plays: number;
  /** ISO 8601 da última vez. */
  lastPlayedAt: string;
}

/** GET /api/me/library — o que é só da conta: records (concluídos) e favoritos. */
export interface LibraryResponse {
  records: PuzzleRecord[];
  favorites: string[];
}

/** Uma partida salva para continuar depois (GET /api/me/saved). */
export interface SavedGameSummary {
  id: string;
  imageId: string;
  pieceCount: number;
  maxPlayers: number;
  /** Total de peças e quantas já estão encaixadas (o progresso). */
  pieces: number;
  placed: number;
  elapsedMs: number;
  /** ISO 8601 de quando foi salva. */
  savedAt: string;
}

/** Quantas partidas salvas cabem por conta; salvar mais apaga a mais antiga. */
export const MAX_SAVED_GAMES = 20;

/** DELETE /api/me/saved/:id */
export const SavedGameId = z.uuid();

/** PUT/DELETE /api/me/favorites/:imageId — foto do catálogo ou enviada. */
export const FavoriteImageId = imageId;

/** POST /api/me/link-guest — passa para a conta o histórico do convidado deste navegador. */
export const LinkGuestRequest = z.object({ guestId: z.uuid() });
export type LinkGuestRequest = z.infer<typeof LinkGuestRequest>;

// ── API REST de ranking ─────────────────────────────────────────────────────

/**
 * Janela do ranking: hoje, esta semana (começa na segunda), este mês ou desde sempre. Dias,
 * semanas e meses viram no horário de Brasília, não no UTC do servidor.
 */
export const RANKING_PERIODS = ['day', 'week', 'month', 'all'] as const;
export type RankingPeriod = (typeof RANKING_PERIODS)[number];
export const RANKING_TIME_ZONE = 'America/Sao_Paulo';

const teamSize = z.coerce.number().int().min(1).max(MAX_PLAYERS);
const period = z.enum(RANKING_PERIODS).default('all');

/**
 * GET /api/ranking?image=praia&pieces=100&players=2&period=week
 * Categoria = imagem + tamanho escolhido + tamanho da equipe (só compara partidas iguais).
 */
export const RankingQuery = z.object({
  // Foto enviada só tem partidas no ranking depois de publicada (o servidor só grava aí).
  image: imageId,
  pieces: z.coerce.number().pipe(pieceCount),
  players: teamSize,
  period,
});
export type RankingQuery = z.infer<typeof RankingQuery>;

/**
 * GET /api/ranking/general?players=2&period=month
 * Ranking geral de uma modalidade (solo, dupla, trio, quarteto): soma de todas as fotos.
 */
export const GeneralRankingQuery = z.object({ players: teamSize, period });
export type GeneralRankingQuery = z.infer<typeof GeneralRankingQuery>;

/**
 * Pontos de uma partida: peças × fator de velocidade. O fator compara o tempo com o tempo típico
 * (mediana) das partidas com o mesmo número de peças e a mesma modalidade, em qualquer foto, e
 * fica entre POINTS_MIN_FACTOR e POINTS_MAX_FACTOR. Com menos de POINTS_MIN_SAMPLES partidas para
 * comparar, vale 1×.
 */
export const POINTS_MIN_FACTOR = 0.5;
export const POINTS_MAX_FACTOR = 2;
export const POINTS_MIN_SAMPLES = 5;

export function gamePoints(pieceCount: number, durationMs: number, typicalMs?: number): number {
  const factor =
    typicalMs && durationMs > 0
      ? Math.min(POINTS_MAX_FACTOR, Math.max(POINTS_MIN_FACTOR, typicalMs / durationMs))
      : 1;
  return Math.round(pieceCount * factor);
}

/**
 * Uma linha do ranking por pontos: soma, no período, da melhor partida da equipe em cada foto e
 * tamanho (repetir o mesmo quebra-cabeça não acumula). Empate: mais quebra-cabeças diferentes.
 */
export interface GeneralRankingEntry {
  position: number;
  players: string[];
  points: number;
  puzzles: number;
}

/** GET /api/ranking/popular?players=2&period=week — fotos mais jogadas (para escolher no ranking). */
export interface PopularImage {
  imageId: string;
  plays: number;
}

/** Uma linha do ranking: o melhor tempo de cada equipe na categoria. */
export interface RankingEntry {
  position: number;
  players: string[];
  durationMs: number;
  /** ISO 8601. */
  finishedAt: string;
}

// ── Quebra-cabeças da comunidade ────────────────────────────────────────────

/** Denúncias (de contas diferentes) que tiram a foto do ar até o admin decidir. */
export const COMMUNITY_HIDE_REPORTS = 3;

/** POST /api/puzzles — publica uma foto enviada pela própria conta. */
export const PublishPuzzleRequest = z.object({
  imageId: uploadImageId,
  title: z.string().trim().min(2, 'Dê um título').max(60),
  authorName: z.string().trim().min(1, 'Diga quem é o autor').max(40),
  /** "A foto é minha / tenho direito de compartilhar": sem isso, não publica. */
  rights: z.literal(true, 'Confirme que pode compartilhar a foto'),
});
export type PublishPuzzleRequest = z.infer<typeof PublishPuzzleRequest>;

/** Id de um quebra-cabeça publicado (rotas /api/puzzles/:id). */
export const CommunityPuzzleId = z.uuid();

/** Um quebra-cabeça publicado, como o Explorar mostra (GET /api/puzzles). */
export interface CommunityPuzzle {
  id: string;
  /** "upload:<id>": é com ele que a sala é criada (e o ranking agrupado). */
  imageId: string;
  title: string;
  authorName: string;
  width: number;
  height: number;
  /** ISO 8601 da publicação. */
  createdAt: string;
  /** "hidden" só aparece para o admin (denunciado demais, esperando a decisão). */
  status: 'published' | 'hidden';
  /** Quantas denúncias (só o admin vê o número; para os outros, 0). */
  reports: number;
  /** Publicado pela conta que pediu a lista (pode remover). */
  mine: boolean;
  /** A conta que pediu a lista já denunciou. */
  reported: boolean;
}

// ── Amigos, presença e convites ─────────────────────────────────────────────

/** Sala Colyseus que todo cliente logado mantém aberta: status online e convites chegam por ela. */
export const PRESENCE_ROOM = 'presence';

/** Código de amigo "K7QF-2M9D"; aceita digitado sem hífen e em minúsculas. */
export const FriendCode = z
  .string()
  .transform((code) => code.toUpperCase().replace(/[^A-Z0-9]/g, ''))
  .pipe(z.string().length(8, 'O código tem 8 letras e números'))
  .transform((code) => `${code.slice(0, 4)}-${code.slice(4)}`);

/** POST /api/me/friends — pede amizade pelo código (se a outra pessoa já pediu, aceita). */
export const AddFriendRequest = z.object({ code: FriendCode });

/** Id da outra conta nas rotas /api/me/friends/:id. */
export const FriendId = z.uuid();

/** Online = com o site aberto; jogando = numa sala; offline = nenhum dos dois. */
export type FriendStatus = 'online' | 'playing' | 'offline';

export interface FriendView {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** Só para amigos aceitos; pedidos pendentes vêm sempre 'offline'. */
  status: FriendStatus;
}

/** GET /api/me/friends */
export interface FriendsResponse {
  /** O código desta conta, para passar adiante. */
  friendCode: string;
  friends: FriendView[];
  /** Pedidos recebidos (esperando aceitar). */
  incoming: FriendView[];
  /** Pedidos enviados (esperando a outra pessoa). */
  outgoing: FriendView[];
}

/** POST /api/me/invites — chama um amigo online para a sala em que você está. */
export const InviteRequest = z.object({
  friendId: FriendId,
  roomCode: z.string().regex(/^[A-Z2-9]{5}$/),
});
export type InviteRequest = z.infer<typeof InviteRequest>;

/** Mensagem 'invite' da sala de presença: aparece como aviso para o amigo. */
export interface InviteMessage {
  fromId: string;
  fromName: string;
  fromAvatarUrl: string | null;
  roomCode: string;
  /** Foto da sala (para o aviso dizer o que vão montar). */
  imageId: string;
}

// ── Modo Bullet ─────────────────────────────────────────────────────────────

/** Nome das salas de cada modo no Colyseus (o clássico é ROOM_NAME). */
export const BULLET_ROOM = 'bullet';
export const BATTLE_ROOM = 'battle';

/** Durações do Bullet, em minutos. */
export const BULLET_MINUTES = [3, 5, 10] as const;
/** Tamanhos do Bullet: quebra-cabeças pequenos, um atrás do outro. */
export const BULLET_PIECES = [12, 24] as const;

const bulletMinutes = z.union(BULLET_MINUTES.map((n) => z.literal(n)));
const bulletPieces = z.union(BULLET_PIECES.map((n) => z.literal(n)));

/** Criar sala de Bullet: as fotos são sorteadas do catálogo a cada quebra-cabeça. */
export const CreateBulletOptions = JoinOptions.extend({
  minutes: bulletMinutes,
  pieces: bulletPieces,
  maxPlayers: maxPlayers.default(MAX_PLAYERS),
});
export type CreateBulletOptions = z.infer<typeof CreateBulletOptions>;

/** GET /api/ranking/bullet?minutes=5&pieces=12&players=2&period=week */
export const BulletRankingQuery = z.object({
  minutes: z.coerce.number().pipe(bulletMinutes),
  pieces: z.coerce.number().pipe(bulletPieces),
  players: teamSize,
  period,
});
export type BulletRankingQuery = z.infer<typeof BulletRankingQuery>;

/** Melhor corrida de cada equipe: mais montados; empate, mais peças no que ficou pela metade. */
export interface BulletRankingEntry {
  position: number;
  players: string[];
  solved: number;
  partial: number;
  /** ISO 8601. */
  finishedAt: string;
}

// ── Modo Batalha ────────────────────────────────────────────────────────────

/** Os dois lados da Batalha. */
export const BATTLE_TEAMS = ['a', 'b'] as const;
export type BattleTeam = (typeof BATTLE_TEAMS)[number];

/** 1v1 (2 vagas) ou 2v2 (4 vagas). */
export const BATTLE_FORMATS = { '1v1': 2, '2v2': 4 } as const;
export type BattleFormat = keyof typeof BATTLE_FORMATS;

/** Criar sala de Batalha: os dois lados montam a mesma foto, do mesmo tamanho. */
export const CreateBattleOptions = JoinOptions.extend({
  pieceCount,
  imageId: z.union([imageId, z.literal(RANDOM_IMAGE)]),
  format: z.enum(['1v1', '2v2']),
});
export type CreateBattleOptions = z.infer<typeof CreateBattleOptions>;

/** Lobby da Batalha: trocar de lado. */
export const ChooseTeamMessage = z.object({ team: z.enum(BATTLE_TEAMS) });

/** "Espalhar" dos modos novos diz o tabuleiro. */
export const ScatterMessage = z.object({ board: z.enum(['main', 'a', 'b']).optional() });
