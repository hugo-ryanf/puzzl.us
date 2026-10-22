import { useEffect, useState } from 'react';
import { Callbacks } from '@colyseus/sdk';
import type { BattleTeam, GameMode, GamePhase, RankStatus } from '@puzzle/shared';
import type { PuzzleRoom } from './connection';

export interface PlayerView {
  sessionId: string;
  name: string;
  color: string;
  connected: boolean;
  /** Encaixes feitos por este jogador (contribuição no resultado). */
  snaps: number;
  /** Lado na Batalha ('' nos outros modos). */
  team: BattleTeam | '';
}

/** Progresso de um tabuleiro dos modos novos ('main' no Bullet; 'a' e 'b' na Batalha). */
export interface BoardView {
  imageId: string;
  /** Muda a cada quebra-cabeça novo nesta mesa (Bullet e batalha por tempo). */
  seed: string;
  /** Batalha por tempo: quantos este lado já montou. */
  solved: number;
  pieces: number;
  placed: number;
  done: boolean;
  durationMs: number;
}

/** Fotografia do estado da sala em objetos simples, para o React renderizar a interface. */
export interface RoomSnapshot {
  mode: GameMode;
  players: PlayerView[];
  hostId: string;
  /** sessionId de quem criou a sala logado (pode salvar a partida); vazio se não estiver. */
  ownerId: string;
  phase: GamePhase;
  /** Foto do catálogo e tamanho escolhido (juntos com teamSize, a categoria do ranking). */
  imageId: string;
  pieceCount: number;
  /** Vagas: 1 = solo, 2–4 = multiplayer. */
  maxPlayers: number;
  /** Total real de peças (rows × cols; pode diferir um pouco do tamanho escolhido). */
  pieces: number;
  groups: number;
  /** Peças já encaixadas em alguma outra (em grupos de 2 ou mais). */
  placed: number;
  elapsedMs: number;
  durationMs: number;
  rankStatus: RankStatus;
  rank: number;
  /** Posição só entre as partidas de hoje, na mesma categoria. */
  rankToday: number;
  /** Pontos que a partida valeu no ranking por pontos. */
  points: number;
  teamSize: number;
  boards: Partial<Record<string, BoardView>>;
  /** Bullet: duração, tempo que falta, quebra-cabeça da vez, montados e o que ficou pela metade. */
  timeLimitMs: number;
  remainingMs: number;
  round: number;
  solved: number;
  partial: number;
  /** Batalha: lado vencedor ('' até alguém terminar) e se foi por W.O. */
  /** Batalha: o lado vencedor, ou 'draw' (empate na batalha por tempo). */
  winner: BattleTeam | 'draw' | '';
  walkover: boolean;
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
  const boards: RoomSnapshot['boards'] = {};
  for (const [key, board] of state.boards ?? []) {
    boards[key] = {
      imageId: board.config.imageId,
      seed: board.config.seed,
      solved: board.solved,
      pieces: board.pieceGroup.length,
      placed: countPlaced(board.pieceGroup),
      done: board.done,
      durationMs: board.durationMs,
    };
  }
  // Bullet: o progresso mostrado é o do quebra-cabeça da vez; Batalha: o do meu lado.
  const myTeam = state.players.get(room.sessionId)?.team;
  const main = state.boards?.get('main') ?? (myTeam ? state.boards?.get(myTeam) : undefined);
  const pieceGroup = main?.pieceGroup ?? state.pieceGroup;
  return {
    mode: (state.mode || 'classic') as GameMode,
    players: [...state.players.entries()].map(([sessionId, p]) => ({
      sessionId,
      name: p.name,
      color: p.color,
      connected: p.connected,
      snaps: p.snaps,
      team: p.team as BattleTeam | '',
    })),
    hostId: state.hostId,
    ownerId: state.ownerId,
    phase: state.phase as GamePhase,
    // Batalha por tempo: cada lado pode estar numa foto; o título mostra a do meu lado.
    imageId: main?.config.imageId ?? state.config.imageId,
    pieceCount: state.config.pieceCount,
    maxPlayers: state.config.maxPlayers,
    pieces: pieceGroup.length,
    groups: (main?.groups ?? state.groups).size,
    placed: countPlaced(pieceGroup),
    elapsedMs: state.elapsedMs,
    durationMs: state.durationMs,
    rankStatus: state.rankStatus as RankStatus,
    rank: state.rank,
    rankToday: state.rankToday,
    points: state.points,
    teamSize: state.teamSize,
    boards,
    timeLimitMs: state.timeLimitMs,
    remainingMs: state.remainingMs,
    round: state.round,
    solved: state.solved,
    partial: state.partial,
    winner: state.winner as BattleTeam | 'draw' | '',
    walkover: state.walkover,
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
      // Modos novos: o progresso de cada tabuleiro (e o tabuleiro trocado no Bullet).
      callbacks.onAdd('boards', (board) => {
        unsubscribers.push(
          callbacks.onRemove(board, 'groups', refresh),
          callbacks.listen(board, 'done', refresh),
          callbacks.listen(board, 'solved', refresh),
        );
        refresh();
      }),
      callbacks.onRemove('boards', refresh),
      ...(
        [
          'phase',
          'hostId',
          'ownerId',
          'elapsedMs',
          'durationMs',
          'rankStatus',
          'rank',
          'rankToday',
          'points',
          'teamSize',
          'remainingMs',
          'round',
          'solved',
          'partial',
          'winner',
          'walkover',
        ] as const
      ).map((field) => callbacks.listen(field, refresh)),
    );
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [room]);

  return snapshot;
}
