import { useEffect, useState } from 'react';
import type { GamePhase } from '@puzzle/shared';
import { formatDuration } from '../format';
import { TimerIcon } from '../ui/icons';

interface GameClockProps {
  phase: GamePhase;
  /** Último valor recebido do servidor (atualizado a cada ~1 s). */
  elapsedMs: number;
  durationMs: number;
}

/**
 * O servidor é quem mede o tempo; aqui só preenchemos o intervalo entre as atualizações
 * contando a partir do instante em que a última chegou. Assim o relógio do PC não interfere.
 */
export function GameClock({ phase, elapsedMs, durationMs }: GameClockProps) {
  const [interpolated, setInterpolated] = useState(elapsedMs);

  useEffect(() => {
    if (phase !== 'playing') return;
    const receivedAt = performance.now();
    const timer = setInterval(() => {
      setInterpolated(elapsedMs + performance.now() - receivedAt);
    }, 200);
    return () => clearInterval(timer);
  }, [phase, elapsedMs]);

  const shown =
    phase === 'completed'
      ? durationMs
      : phase === 'playing'
        ? Math.max(elapsedMs, interpolated) // nunca volta para trás quando chega o valor novo
        : elapsedMs; // lobby: 0 numa sala nova, o tempo acumulado numa partida retomada

  return (
    <span className="clock" title="Tempo de montagem (medido no servidor)">
      <TimerIcon size={18} />
      <span className="sr-only">Tempo:</span>
      {formatDuration(shown)}
    </span>
  );
}
