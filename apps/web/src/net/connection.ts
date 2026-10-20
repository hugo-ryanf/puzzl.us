import { Client, type Room } from '@colyseus/sdk';
import { ROOM_NAME, RoomState, type CreateRoomOptions, type JoinOptions } from '@puzzle/shared';

export type PuzzleRoom = Room<unknown, RoomState>;

/**
 * Em dev o servidor roda na porta 2567 da mesma máquina que serviu a página. Usar o hostname
 * da página (em vez de "localhost") permite um amigo na mesma rede entrar pelo IP do PC.
 */
export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ?? `${location.protocol}//${location.hostname}:2567`;

const client = new Client(SERVER_URL);

/** sessionStorage sobrevive ao F5 mas não a fechar a aba — exatamente a janela de reconexão. */
const SESSION_KEY = 'quebra-cabeca:sessao';
/** localStorage: o mesmo convidado entre sessões, para o ranking reconhecer a equipe. */
const GUEST_KEY = 'quebra-cabeca:convidado';

interface SavedSession {
  roomId: string;
  token: string;
}

type WithoutGuest<T> = Omit<T, 'guestId'>;

export async function createRoom(options: WithoutGuest<CreateRoomOptions>): Promise<PuzzleRoom> {
  const room = await client.create(ROOM_NAME, { ...options, guestId: guestId() }, RoomState);
  return track(room);
}

export async function joinRoom(
  code: string,
  options: WithoutGuest<JoinOptions>,
): Promise<PuzzleRoom> {
  return track(await client.joinById(code, { ...options, guestId: guestId() }, RoomState));
}

/**
 * Identidade de convidado deste navegador. Sem storage (aba anônima bloqueada), cada sessão
 * vira um convidado novo: o jogo funciona, só o ranking não junta as partidas da mesma pessoa.
 */
let fallbackGuestId: string | undefined;
function guestId(): string {
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
      return null;
    }
  })();
  return resuming;
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
  // `?.`: antes do primeiro estado a referência `config` ainda não foi decodificada.
  if (!room.state.config?.seed) {
    await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));
  }
  const save = () => writeSession({ roomId: room.roomId, token: room.reconnectionToken });
  save();
  room.onReconnect(save);
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
