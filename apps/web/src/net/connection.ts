import { Client, type Room } from '@colyseus/sdk';
import {
  BATTLE_ROOM,
  BULLET_ROOM,
  PRESENCE_ROOM,
  ROOM_NAME,
  RoomState,
  type CreateBattleOptions,
  type CreateBulletOptions,
  type CreateRoomOptions,
  type JoinOptions,
  type RestoreRoomOptions,
  type ResumeRoomOptions,
} from '@puzzle/shared';
import { loadPlayerName } from './playerName';

export type PuzzleRoom = Room<unknown, RoomState>;

/**
 * Endereço das salas (Colyseus). A API (/api, /auth) é sempre relativa ao próprio site: em
 * produção o mesmo servidor entrega tudo; em dev o Vite repassa ao servidor.
 * Em produção é o próprio endereço. Em dev o servidor roda na porta 2567 da mesma máquina que
 * serviu a página; usar o hostname da página (em vez de "localhost") permite um amigo na mesma
 * rede entrar pelo IP do PC.
 */
export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ??
  (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2567` : location.origin);

const client = new Client(SERVER_URL);

/** sessionStorage sobrevive ao F5 mas não a fechar a aba — exatamente a janela de reconexão. */
const SESSION_KEY = 'quebra-cabeca:sessao';
/** localStorage: o mesmo convidado entre sessões, para o ranking reconhecer a equipe. */
const GUEST_KEY = 'quebra-cabeca:convidado';
/**
 * Esperas entre tentativas de voltar para a sala quando a conexão cai de vez: cobre um deploy
 * (segundos) e o Render acordando (~1 min).
 */
const REJOIN_DELAYS_MS = [0, 1000, 2000, 3000, 5000, 5000, 10_000, 10_000, 15_000, 15_000];

interface SavedSession {
  roomId: string;
  token: string;
}

type WithoutGuest<T> = Omit<T, 'guestId'>;

export async function createRoom(options: WithoutGuest<CreateRoomOptions>): Promise<PuzzleRoom> {
  const room = await client.create(ROOM_NAME, { ...options, guestId: guestId() }, RoomState);
  return track(room);
}

/** Bullet: contra o relógio, quebra-cabeças pequenos um atrás do outro. */
export async function createBulletRoom(
  options: WithoutGuest<CreateBulletOptions>,
): Promise<PuzzleRoom> {
  return track(await client.create(BULLET_ROOM, { ...options, guestId: guestId() }, RoomState));
}

/** Batalha: dois lados montando o mesmo quebra-cabeça. */
export async function createBattleRoom(
  options: WithoutGuest<CreateBattleOptions>,
): Promise<PuzzleRoom> {
  return track(await client.create(BATTLE_ROOM, { ...options, guestId: guestId() }, RoomState));
}

/**
 * Continua uma partida salva ("Em andamento") numa sala nova. O servidor só deixa a conta que
 * salvou (o cookie da sessão vai junto no WebSocket).
 */
export async function resumeSavedGame(
  savedId: string,
  options: WithoutGuest<JoinOptions>,
): Promise<PuzzleRoom> {
  const resume: ResumeRoomOptions = { ...options, guestId: guestId(), resume: savedId };
  return track(await client.create(ROOM_NAME, resume, RoomState));
}

/**
 * Entra pelo código. Se a sala não está no ar, ela pode ter sumido num reinício do servidor:
 * pede para trazê-la de volta do último snapshot (o servidor recusa se não houver).
 */
export async function joinRoom(
  code: string,
  options: WithoutGuest<JoinOptions>,
): Promise<PuzzleRoom> {
  const joinOptions = { ...options, guestId: guestId() };
  try {
    return track(await client.joinById(code, joinOptions, RoomState));
  } catch (error) {
    if (!/not found/i.test(errorMessage(error))) throw error;
    const restore: RestoreRoomOptions = { ...joinOptions, restore: code };
    return track(await client.joinOrCreate(ROOM_NAME, restore, RoomState));
  }
}

/**
 * Volta para a sala depois que a conexão caiu de vez (servidor reiniciou ou a reconexão
 * automática desistiu), entrando de novo pelo código. Desiste na hora se a sala acabou
 * (terminada, cheia ou sem snapshot); erro de rede tenta de novo.
 */
export async function rejoinRoom(code: string, name: string): Promise<PuzzleRoom | null> {
  for (const delay of REJOIN_DELAYS_MS) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      return await joinRoom(code, { name });
    } catch (error) {
      if (/not found|locked|full/i.test(errorMessage(error))) return null;
    }
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Identidade de convidado deste navegador. Sem storage (aba anônima bloqueada), cada sessão
 * vira um convidado novo: o jogo funciona, só o ranking não junta as partidas da mesma pessoa.
 */
let fallbackGuestId: string | undefined;
export function guestId(): string {
  try {
    const saved = localStorage.getItem(GUEST_KEY);
    if (saved) return saved;
    const created = crypto.randomUUID();
    localStorage.setItem(GUEST_KEY, created);
    return created;
  } catch {
    return (fallbackGuestId ??= crypto.randomUUID());
  }
}

export function hasSavedSession(code: string): boolean {
  return readSession()?.roomId === code;
}

let resuming: Promise<PuzzleRoom | null> | undefined;

/**
 * Volta para a sala depois de um F5, usando o token de reconexão. Memorizado porque o
 * StrictMode roda efeitos duas vezes em dev, e o mesmo token não pode ser usado em dobro.
 */
export function resumeRoom(code: string): Promise<PuzzleRoom | null> {
  resuming ??= (async () => {
    const saved = readSession();
    if (saved?.roomId !== code) return null;
    try {
      return track(await client.reconnect(saved.token, RoomState));
    } catch {
      forgetSession();
      // O token morre junto quando o servidor reinicia: entra de novo pelo código (que também
      // restaura a sala do snapshot). Sem nome lembrado, cai no "Entrar com código".
      const name = loadPlayerName();
      return name ? joinRoom(code, { name }).catch(() => null) : null;
    }
  })();
  return resuming;
}

/** Sala de presença (só logado): mantém a pessoa "online" e entrega convites e avisos. */
export function joinPresence(): Promise<Room> {
  return client.joinOrCreate(PRESENCE_ROOM);
}

export function leaveRoom(room: PuzzleRoom): void {
  forgetSession();
  void room.leave();
}

/**
 * Espera o primeiro estado (o create/join resolve antes dele chegar) e guarda o token agora e
 * a cada reconexão automática (o token muda quando reconecta).
 */
async function track(room: PuzzleRoom): Promise<PuzzleRoom> {
  // `?.`: antes do primeiro estado a referência `config` ainda não foi decodificada. Todo modo
  // preenche o `config` da raiz (no Bullet e na Batalha, com o quebra-cabeça da vez).
  if (!room.state.config?.seed) {
    await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));
  }
  const save = () => writeSession({ roomId: room.roomId, token: room.reconnectionToken });
  save();
  room.onReconnect(save);
  // Só no `pnpm dev`: a sala exposta para scripts de teste e gravação (os robôs do vídeo de demonstração).
  if (import.meta.env.DEV) (window as unknown as { __puzzleRoom?: PuzzleRoom }).__puzzleRoom = room;
  return room;
}

// O storage pode estar bloqueado (aba anônima, política do navegador): tudo aqui é opcional.
function readSession(): SavedSession | undefined {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SavedSession) : undefined;
  } catch {
    return undefined;
  }
}

function writeSession(session: SavedSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // sem storage, só não haverá reconexão após F5
  }
}

function forgetSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // idem
  }
}
