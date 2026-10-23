import { useEffect, useRef } from 'react';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';
import { playSound, preloadCountdown, type GameSound } from '../../sound/sounds';

/**
 * Sons do que acontece na mesa: encaixe (da minha mesa: na batalha, só do meu lado), quebra-
 * cabeça montado (Bullet e batalha por tempo) e o fim da partida. A contagem tem os dela
 * (StartCountdown e FinalSeconds). Só toca o que muda depois de entrar, nunca o que já estava.
 */
export function useGameSounds(selfId: string, snapshot: RoomSnapshot) {
  const { mode, phase, players, winner, timeLimitMs } = snapshot;
  const myTeam = players.find((p) => p.sessionId === selfId)?.team ?? '';
  const battle = mode === 'battle';
  const solved = battle ? (myTeam ? (snapshot.boards[myTeam]?.solved ?? 0) : 0) : snapshot.solved;
  // Encaixes de quem está na minha mesa, por jogador (quem entra ou sai não conta como encaixe).
  const snaps = new Map(
    players.filter((p) => !battle || p.team === myTeam).map((p) => [p.sessionId, p.snaps]),
  );
  const last = useRef({ snaps, solved, phase });

  useEffect(() => {
    if (timeLimitMs > 0) preloadCountdown();
  }, [timeLimitMs]);

  useEffect(() => {
    const before = last.current;
    last.current = { snaps, solved, phase };
    if (phase === 'completed' && before.phase === 'playing') {
      playSound(endSound(mode, winner, myTeam));
      return;
    }
    if (phase !== 'playing') return;
    if (solved > before.solved) {
      playSound('solved');
      return;
    }
    const snapped = [...snaps].some(([id, count]) => count > (before.snaps.get(id) ?? count));
    if (snapped) playSound('snap');
  });
}

function endSound(mode: RoomSnapshot['mode'], winner: string, myTeam: string): GameSound {
  if (mode === 'bullet') return 'end';
  if (mode !== 'battle') return 'win'; // clássico: montou
  if (winner === 'draw') return 'draw';
  if (!myTeam) return 'end';
  return winner === myTeam ? 'win' : 'lose';
}
