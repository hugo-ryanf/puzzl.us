import type { BattleTeam } from '@puzzle/shared';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';

export const otherTeam = (team: BattleTeam): BattleTeam => (team === 'a' ? 'b' : 'a');

/**
 * Quanto um lado já fez, para comparar com o outro: na corrida, a fração da mesa montada; por
 * tempo, os montados mais a fração do que está na mesa agora.
 */
export function battleScore(snapshot: RoomSnapshot, team: BattleTeam): number {
  const board = snapshot.boards[team];
  if (!board) return 0;
  const fraction = board.done ? 1 : board.pieces > 0 ? board.placed / board.pieces : 0;
  if (snapshot.timeLimitMs === 0) return fraction;
  // Por tempo, o que acabou de montar já está em `solved` (a mesa nova ainda não chegou).
  return board.solved + (board.done ? 0 : fraction);
}

/** Nomes de quem está no lado ("Ana & Bia"). */
export function teamNames(snapshot: RoomSnapshot, team: BattleTeam): string {
  return snapshot.players
    .filter((p) => p.team === team)
    .map((p) => p.name)
    .join(' & ');
}
