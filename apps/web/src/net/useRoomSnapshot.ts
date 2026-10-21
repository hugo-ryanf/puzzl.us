import { useEffect, useState } from 'react';
import { Callbacks } from '@colyseus/sdk';
import type { GamePhase, RankStatus } from '@puzzle/shared';
import type { PuzzleRoom } from './connection';

export interface PlayerView {
  sessionId: string;
  name: string;
  color: string;
  connected: boolean;
  /** Encaixes feitos por este jogador (contribuição no resultado). */
  snaps: number;
}

/** Fotografia do estado da sala em objetos simples, para o React renderizar a interface. */
export interface RoomSnapshot {
  players: PlayerView[];
  hostId: string;
  phase: GamePhase;
  /** Foto do catálogo e tamanho escolhido (juntos com teamSize, a categoria do ranking). */
  imageId: string;
  pieceCount: number;
  /** Total real de peças (rows × cols; pode diferir um pouco do tamanho escolhido). */
  pieces: number;
  groups: number;
  /** Peças já encaixadas em alguma outra (em grupos de 2 ou mais). */
  placed: number;
  elapsedMs: number;
  durationMs: number;
  rankStatus: RankStatus;
  rank: number;
  teamSize: number;
}

/** Soma as peças de todo grupo com 2+ peças (peça sozinha ainda não foi encaixada). */
function countPlaced(pieceGroup: Iterable<number>): number {
  const sizes = new Map<number, number>();
  for (const groupId of pieceGroup) sizes.set(groupId, (sizes.get(groupId) ?? 0) + 1);
  let placed = 0;
  for (const size of sizes.values()) if (size > 1) placed += size;
  return placed;
}

function readSnapshot(room: PuzzleRoom): RoomSnapshot {
  const { state } = room;
  return {
    players: [...state.players.entries()].map(([sessionId, p]) => ({
      sessionId,
      name: p.name,
      color: p.color,
      connected: p.connected,
      snaps: p.snaps,
    })),
    hostId: state.hostId,
    phase: state.phase as GamePhase,
    imageId: state.config.imageId,
    pieceCount: state.config.pieceCount,
    pieces: state.pieceGroup.length,
    groups: state.groups.size,
    placed: countPlaced(state.pieceGroup),
    elapsedMs: state.elapsedMs,
    durationMs: state.durationMs,
    rankStatus: state.rankStatus as RankStatus,
    rank: state.rank,
    teamSize: state.teamSize,
  };
}

/** Re-renderiza quando muda algo que a interface mostra (jogadores, encaixes, relógio, fim). */
export function useRoomSnapshot(room: PuzzleRoom): RoomSnapshot {
  const [snapshot, setSnapshot] = useState(() => readSnapshot(room));

  useEffect(() => {
    const callbacks = Callbacks.get(room);
    const refresh = () => setSnapshot(readSnapshot(room));
    // Declarado antes de registrar: o onAdd dispara na hora para os jogadores que já existem,
    // e esse handler já precisa do array.
    const unsubscribers: Array<() => void> = [];
    unsubscribers.push(
      callbacks.onAdd('players', (player) => {
        unsubscribers.push(callbacks.onChange(player, refresh));
        refresh();
      }),
      callbacks.onRemove('players', refresh),
      // `false`: não dispara para os grupos que já existem (seriam centenas de refresh à toa).
      callbacks.onAdd('groups', refresh, false),
      callbacks.onRemove('groups', refresh),
      ...(
        ['phase', 'hostId', 'elapsedMs', 'durationMs', 'rankStatus', 'rank', 'teamSize'] as const
      ).map((field) => callbacks.listen(field, refresh)),
    );
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [room]);

  return snapshot;
}
