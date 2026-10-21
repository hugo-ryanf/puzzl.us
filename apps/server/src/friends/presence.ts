import type { FriendStatus } from '@puzzle/shared';

type Send = (type: string, payload: unknown) => void;

/** Onde a pessoa está jogando agora (para o convite saber se ela está mesmo na sala). */
export interface PlayingAt {
  roomCode: string;
  imageId: string;
}

/**
 * Quem está online e onde, só em memória: o Render roda uma instância só, e reiniciar zera tudo
 * (os clientes reconectam e o estado se refaz sozinho).
 */
export interface PresenceHub {
  /** Uma aba aberta na sala de presença. Devolve a função que a desconecta. */
  connect(userId: string, send: Send): () => void;
  /** A pessoa entrou numa sala do jogo (`key` distingue abas/conexões). */
  enterRoom(userId: string, key: string, at: PlayingAt): void;
  leaveRoom(userId: string, key: string): void;
  status(userId: string): FriendStatus;
  /** Salas em que a pessoa está agora. */
  rooms(userId: string): PlayingAt[];
  /** Manda para todas as abas da pessoa; false se ela não está com o site aberto. */
  send(userId: string, type: string, payload: unknown): boolean;
  /** Chamado quando o status de alguém muda (para avisar os amigos dele). */
  onChange(listener: (userId: string) => void): void;
}

export function createPresenceHub(): PresenceHub {
  const connections = new Map<string, Set<Send>>();
  const playing = new Map<string, Map<string, PlayingAt>>();
  const listeners: Array<(userId: string) => void> = [];

  const status = (userId: string): FriendStatus =>
    playing.get(userId)?.size ? 'playing' : connections.get(userId)?.size ? 'online' : 'offline';

  /** Roda a mudança e avisa só se o status visível mudou. */
  const changing = (userId: string, change: () => void) => {
    const before = status(userId);
    change();
    if (status(userId) !== before) for (const listener of listeners) listener(userId);
  };

  return {
    connect(userId, send) {
      changing(userId, () => {
        const set = connections.get(userId) ?? new Set();
        set.add(send);
        connections.set(userId, set);
      });
      return () =>
        changing(userId, () => {
          const set = connections.get(userId);
          set?.delete(send);
          if (set?.size === 0) connections.delete(userId);
        });
    },

    enterRoom(userId, key, at) {
      changing(userId, () => {
        const rooms = playing.get(userId) ?? new Map();
        rooms.set(key, at);
        playing.set(userId, rooms);
      });
    },

    leaveRoom(userId, key) {
      changing(userId, () => {
        const rooms = playing.get(userId);
        rooms?.delete(key);
        if (rooms?.size === 0) playing.delete(userId);
      });
    },

    status,

    rooms(userId) {
      return [...(playing.get(userId)?.values() ?? [])];
    },

    send(userId, type, payload) {
      const set = connections.get(userId);
      if (!set?.size) return false;
      for (const send of set) send(type, payload);
      return true;
    },

    onChange(listener) {
      listeners.push(listener);
    },
  };
}
