import { useEffect, useRef } from 'react';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';
import { playCountdown } from '../../sound/sounds';
import { secondsLeft, useGameTime } from '../GameClock';

/** A partir de quantos segundos o relógio grande aparece. */
const FINAL_SECONDS = 10;

/**
 * Últimos 10 segundos do Bullet e da batalha por tempo: o relógio cresce, em vermelho, no meio
 * da mesa (na batalha, em cima da linha que divide as duas mesas), e o som da contagem toca até
 * o zero.
 */
export function FinalSeconds({
  snapshot,
  onDivider = false,
}: {
  snapshot: RoomSnapshot;
  onDivider?: boolean;
}) {
  const { phase, elapsedMs, durationMs, timeLimitMs, countdown } = snapshot;
  const elapsed = useGameTime(phase, elapsedMs, durationMs, countdown > 0);
  const left = secondsLeft(timeLimitMs, elapsed);
  const visible = phase === 'playing' && countdown === 0 && left > 0 && left <= FINAL_SECONDS;
  const leftMs = timeLimitMs - elapsed;

  // Uma vez por partida, quando o relógio grande aparece; sair da sala no meio corta o som.
  const stopSound = useRef<() => void>(undefined);
  useEffect(() => {
    if (!visible) {
      stopSound.current = undefined;
      return;
    }
    stopSound.current ??= playCountdown(leftMs);
  }, [visible, leftMs]);
  useEffect(() => {
    const sound = stopSound;
    return () => sound.current?.();
  }, []);

  if (!visible) return null;
  return (
    <div
      className={onDivider ? 'final-seconds on-divider' : 'final-seconds'}
      role="timer"
      aria-live="off"
    >
      {/* key: cada segundo novo refaz a batida. */}
      <span key={left}>{left}</span>
    </div>
  );
}
