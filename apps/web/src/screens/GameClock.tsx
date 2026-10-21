import { useEffect, useState } from 'react';
import type { GamePhase } from '@puzzle/shared';
import { formatDuration } from '../format';
import { TimerIcon } from '../ui/icons';

interface GameClockProps {
  phase: GamePhase;
  /** Último valor recebido do servidor (atualizado a cada ~1 s). */
  elapsedMs: number;
  durationMs: number;
  /** Bullet: conta para trás a partir deste tempo. */
  limitMs?: number;
}

/**
 * O servidor é quem mede o tempo; aqui só preenchemos o intervalo entre as atualizações
 * contando a partir do instante em que a última chegou. Assim o relógio do PC não interfere.
 */
export function GameClock({ phase, elapsedMs, durationMs, limitMs }: GameClockProps) {
  const [interpolated, setInterpolated] = useState(elapsedMs);

  useEffect(() => {
    if (phase !== 'playing') return;
    const receivedAt = performance.now();
    const timer = setInterval(() => {
      setInterpolated(elapsedMs + performance.now() - receivedAt);
    }, 200);
    return () => clearInterval(timer);
  }, [phase, elapsedMs]);

  const elapsed =
    phase === 'completed'
      ? durationMs
      : phase === 'playing'
        ? Math.max(elapsedMs, interpolated) // nunca volta para trás quando chega o valor novo
        : elapsedMs; // lobby: 0 numa sala nova, o tempo acumulado numa partida retomada
  // Contagem regressiva arredonda para cima: começa em 3:00 e só mostra 0:00 quando acabou.
  const left = limitMs === undefined ? 0 : Math.max(0, limitMs - elapsed);
  const shown = limitMs === undefined ? elapsed : Math.ceil(left / 1000) * 1000;
  const urgent = limitMs !== undefined && phase === 'playing' && left < 10_000;

  return (
    <span
      className={urgent ? 'clock urgent' : 'clock'}
      title={limitMs === undefined ? 'Tempo de montagem (medido no servidor)' : 'Tempo restante'}
    >
      <TimerIcon size={18} />
      <span className="sr-only">Tempo:</span>
      {formatDuration(shown)}
    </span>
  );
}
