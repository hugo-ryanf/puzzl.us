import { useEffect, useRef, useState } from 'react';
import { MAGNET_PIECES, MAX_HELPERS } from '@puzzle/shared';
import type { PuzzleRoom } from '../../net/connection';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';
import { BoltIcon, MagnetIcon } from '../../ui/icons';
import { t } from '../../i18n';

/** Quanto tempo o "+5 s" fica na tela. */
const BONUS_MS = 1300;

/** "+5 s" no alto da mesa a cada bônus de tempo (peça dourada, montar rápido). */
export function BonusBurst({ bonusMs }: { bonusMs: number }) {
  const [shown, setShown] = useState<{ ms: number; key: number }>();
  const previous = useRef(bonusMs);

  useEffect(() => {
    const gained = bonusMs - previous.current;
    previous.current = bonusMs;
    if (gained <= 0) return;
    setShown({ ms: gained, key: bonusMs });
    const timer = setTimeout(() => setShown(undefined), BONUS_MS);
    return () => clearTimeout(timer);
  }, [bonusMs]);

  if (!shown) return null;
  return (
    <div key={shown.key} className="bonus-burst" aria-live="polite">
      +{Math.round(shown.ms / 1000)} s
    </div>
  );
}

/** Faixa da rodada relâmpago, no alto da mesa enquanto ela durar. */
export function LightningBanner() {
  return (
    <div className="lightning-banner" role="status">
      <BoltIcon size={18} /> {t('Relâmpago! Deslize as peças para montar: vale um Ímã')}
    </div>
  );
}

/**
 * Botão do Ímã (e a tecla M): gasta uma ajuda e o servidor encaixa sozinho algumas peças da mesa.
 * Sem ímã guardado, fica desabilitado e explica como ganhar.
 */
export function MagnetButton({ room, snapshot }: { room: PuzzleRoom; snapshot: RoomSnapshot }) {
  const { helpers, phase, countdown } = snapshot;
  const ready = helpers > 0 && phase === 'playing' && countdown === 0;

  useEffect(() => {
    if (!ready) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (event.key.toLowerCase() === 'm' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        room.send('magnet');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ready, room]);

  const title = ready
    ? t('Encaixa {n} peças sozinho (tecla M)', { n: MAGNET_PIECES })
    : t('Monte uma rodada relâmpago para ganhar um Ímã');
  return (
    <button
      type="button"
      className={helpers > 0 ? 'magnet-btn charged' : 'magnet-btn'}
      disabled={!ready}
      title={title}
      aria-label={t('Ímã: {helpers} de {max}. {title}', { helpers, max: MAX_HELPERS, title })}
      onClick={() => room.send('magnet')}
    >
      <MagnetIcon size={18} />
      {t('Ímã')} <strong>{helpers}</strong>
    </button>
  );
}
