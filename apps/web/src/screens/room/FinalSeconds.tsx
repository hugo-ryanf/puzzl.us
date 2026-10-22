import type { RoomSnapshot } from '../../net/useRoomSnapshot';
import { secondsLeft, useGameTime } from '../GameClock';

/** A partir de quantos segundos o relógio grande aparece. */
const FINAL_SECONDS = 10;

/**
 * Últimos 10 segundos do Bullet e da batalha por tempo: o relógio cresce, em vermelho, no meio
 * da mesa (na batalha, em cima da linha que divide as duas mesas).
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
  if (phase !== 'playing' || countdown > 0 || left === 0 || left > FINAL_SECONDS) return null;
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
