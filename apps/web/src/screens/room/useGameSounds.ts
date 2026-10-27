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
  const atMyTable = players.filter((p) => !battle || p.team === myTeam);
  const snaps = new Map(atMyTable.map((p) => [p.sessionId, p.snaps]));
  const combos = new Map(atMyTable.map((p) => [p.sessionId, p.combo]));
  // Relâmpago de deslizar: começou, e as casas da minha grade andando.
  const lightning = Object.keys(snapshot.slides).length > 0;
  const slideMoves = snapshot.slides[battle ? myTeam || 'a' : 'main']?.moves ?? 0;
  const { bonusMs, helpers, suddenDeath, record } = snapshot;
  const last = useRef({
    snaps,
    solved,
    phase,
    lightning,
    slideMoves,
    bonusMs,
    helpers,
    suddenDeath,
    record,
  });

  useEffect(() => {
    if (timeLimitMs > 0) preloadCountdown();
  }, [timeLimitMs]);

  useEffect(() => {
    const before = last.current;
    last.current = {
      snaps,
      solved,
      phase,
      lightning,
      slideMoves,
      bonusMs,
      helpers,
      suddenDeath,
      record,
    };
    // O recorde chega depois do fim (quando o ranking grava a corrida).
    if (record && !before.record) {
      playSound('record');
      return;
    }
    if (phase === 'completed' && before.phase === 'playing') {
      playSound(endSound(mode, winner, myTeam));
      return;
    }
    if (phase !== 'playing') return;
    if (suddenDeath && !before.suddenDeath) {
      playSound('suddenDeath');
      return;
    }
    if (helpers < before.helpers) playSound('magnet');
    if (bonusMs > before.bonusMs) playSound('bonus');
    if (lightning && !before.lightning) playSound('lightning');
    if (slideMoves > before.slideMoves) playSound('snap');
    if (solved > before.solved) {
      playSound('solved');
      return;
    }
    // Quem encaixou (de preferência eu): o tom sobe com o combo dele.
    const snappers = [...snaps]
      .filter(([id, count]) => count > (before.snaps.get(id) ?? count))
      .map(([id]) => id);
    if (snappers.length === 0) return;
    const who = snappers.includes(selfId) ? selfId : snappers[0]!;
    playSound('snap', { combo: combos.get(who) });
  });
}

function endSound(mode: RoomSnapshot['mode'], winner: string, myTeam: string): GameSound {
  if (mode === 'bullet') return 'end';
  if (mode !== 'battle') return 'win'; // clássico: montou
  if (winner === 'draw') return 'draw';
  if (!myTeam) return 'end';
  return winner === myTeam ? 'win' : 'lose';
}
