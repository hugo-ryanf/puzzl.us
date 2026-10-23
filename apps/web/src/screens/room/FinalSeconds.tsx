import { useEffect, useRef } from 'react';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';
import { playCountdown } from '../../sound/sounds';
import { secondsLeft, useGameTime } from '../GameClock';

/** A partir de quantos segundos o relógio grande aparece. */
const FINAL_SECONDS = 10;
/** Brasas subindo do relógio (posição horizontal e atraso de cada uma). */
const EMBERS = [
  { left: '22%', delay: '0s' },
  { left: '48%', delay: '0.45s' },
  { left: '70%', delay: '0.9s' },
  { left: '36%', delay: '1.2s' },
];

/** Últimos 10 s do relógio regressivo: se está neles, quantos segundos (inteiros) e em ms. */
export function useFinalSeconds(snapshot: RoomSnapshot) {
  const { phase, elapsedMs, durationMs, timeLimitMs, bonusMs, countdown } = snapshot;
  const elapsed = useGameTime(phase, elapsedMs, durationMs, countdown > 0);
  // Bônus de tempo (Bullet) entram no limite: o relógio grande pode sumir e voltar.
  const limitMs = timeLimitMs + bonusMs;
  const left = secondsLeft(limitMs, elapsed);
  const active =
    timeLimitMs > 0 && phase === 'playing' && countdown === 0 && left > 0 && left <= FINAL_SECONDS;
  return { active, left, leftMs: limitMs - elapsed, limitMs };
}

/**
 * Últimos 10 segundos do Bullet e da batalha por tempo: o relógio cresce, em vermelho e pegando
 * fogo, no meio da mesa (na batalha, em cima da linha que divide as duas mesas), a borda da mesa
 * pulsa e o som da contagem toca até o zero.
 */
export function FinalSeconds({
  snapshot,
  onDivider = false,
}: {
  snapshot: RoomSnapshot;
  onDivider?: boolean;
}) {
  const { active, left, leftMs, limitMs } = useFinalSeconds(snapshot);

  // Uma vez por partida, quando o relógio grande aparece; sair da sala no meio corta o som.
  const stopSound = useRef<() => void>(undefined);
  // Ganhou tempo no meio da contagem: o som para e recomeça do ponto certo (se ainda couber).
  useEffect(() => {
    stopSound.current?.();
    stopSound.current = undefined;
  }, [limitMs]);
  useEffect(() => {
    if (!active) {
      stopSound.current = undefined;
      return;
    }
    stopSound.current ??= playCountdown(leftMs);
  }, [active, leftMs]);
  useEffect(() => {
    const sound = stopSound;
    return () => sound.current?.();
  }, []);

  if (!active) return null;
  return (
    <>
      <div className="final-glow" aria-hidden="true" />
      <div
        className={onDivider ? 'final-seconds-wrap on-divider' : 'final-seconds-wrap'}
        role="timer"
        aria-live="off"
      >
        <span className="final-flame" aria-hidden="true" />
        {EMBERS.map(({ left: x, delay }) => (
          <span
            key={x}
            className="final-ember"
            style={{ left: x, animationDelay: delay }}
            aria-hidden="true"
          />
        ))}
        <span className="final-seconds">
          {/* key: cada segundo novo refaz a batida. */}
          <span key={left}>{left}</span>
        </span>
      </div>
    </>
  );
}
