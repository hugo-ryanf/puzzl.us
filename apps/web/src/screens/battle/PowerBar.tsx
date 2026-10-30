import { useEffect } from 'react';
import {
  BATTLE_POWERS,
  FOG_MS,
  FREEZE_MS,
  MAX_ENERGY,
  POWER_COST,
  type BattlePower,
} from '@puzzle/shared';
import type { PuzzleRoom } from '../../net/connection';
import type { BoardView } from '../../net/useRoomSnapshot';
import { CloudFogIcon, ShieldIcon, ShuffleIcon, SnowflakeIcon } from '../../ui/icons';
import { t } from '../../i18n';

export const POWER_LABELS: Record<BattlePower, string> = {
  shield: t('Escudo'),
  fog: t('Neblina'),
  freeze: t('Congelar'),
  shuffle: t('Embaralhar'),
};

const POWER_HINTS: Record<BattlePower, string> = {
  shield: t('Protege o seu lado: anula o próximo poder do adversário'),
  fog: t('Desfoca a mesa do adversário por {n} s', { n: FOG_MS / 1000 }),
  freeze: t('O adversário não pega peças nem usa poderes por {n} s', { n: FREEZE_MS / 1000 }),
  shuffle: t('Espalha de novo as peças soltas do adversário'),
};

const POWER_ICONS: Record<BattlePower, typeof ShieldIcon> = {
  shield: ShieldIcon,
  fog: CloudFogIcon,
  freeze: SnowflakeIcon,
  shuffle: ShuffleIcon,
};

/** Barrinha de energia de um lado (no cabeçalho dele), com o escudo quando armado. */
export function EnergyMeter({ board }: { board: BoardView | undefined }) {
  const energy = board?.energy ?? 0;
  return (
    <span
      className="energy-meter"
      title={t('Energia: {energy} de {max}', { energy, max: MAX_ENERGY })}
    >
      {board?.shield && (
        <span className="energy-shield" aria-label={t('Escudo armado!')}>
          <ShieldIcon size={14} />
        </span>
      )}
      <span className="energy-track" aria-hidden="true">
        <span style={{ width: `${(energy / MAX_ENERGY) * 100}%` }} />
      </span>
      <span className="sr-only">{t('Energia {energy}', { energy })}</span>
    </span>
  );
}

/**
 * Poderes do meu lado, embaixo da minha mesa: cada botão mostra o custo e fica apagado sem
 * energia ou na recarga. Teclas 1 a 4. Quem decide se vale é o servidor.
 */
export function PowerBar({
  room,
  board,
  now,
  active,
}: {
  room: PuzzleRoom;
  board: BoardView | undefined;
  /** Relógio da partida agora (ms), para a recarga. */
  now: number;
  /** Partida valendo (sem contagem, sem fim). */
  active: boolean;
}) {
  const energy = board?.energy ?? 0;
  const cooling = Math.max(0, (board?.powerReadyAt ?? 0) - now);
  // Congelado pelo adversário: os poderes também ficam travados.
  const frozen = (board?.frozenUntil ?? 0) > now;
  const usable = (power: BattlePower) =>
    active && !frozen && cooling === 0 && energy >= POWER_COST[power];

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const power = BATTLE_POWERS[Number(event.key) - 1];
      if (power) room.send('usePower', { power });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, room]);

  return (
    <div className="power-bar" role="toolbar" aria-label={t('Poderes')}>
      <span
        className="power-energy"
        title={t('Energia: {energy} de {max}', { energy, max: MAX_ENERGY })}
      >
        <span className="power-energy-track" aria-hidden="true">
          <span style={{ width: `${(energy / MAX_ENERGY) * 100}%` }} />
        </span>
        <strong>{energy}</strong>
      </span>
      {BATTLE_POWERS.map((power, index) => {
        const Icon = POWER_ICONS[power];
        return (
          <button
            key={power}
            type="button"
            className="power-btn"
            disabled={!usable(power)}
            title={`${POWER_LABELS[power]} (${index + 1}): ${POWER_HINTS[power]}`}
            onClick={() => room.send('usePower', { power })}
          >
            <Icon size={18} />
            <span className="power-name">{POWER_LABELS[power]}</span>
            <small>{POWER_COST[power]}</small>
          </button>
        );
      })}
      {cooling > 0 && active && (
        <span className="power-cooldown" aria-live="off">
          {Math.ceil(cooling / 1000)} s
        </span>
      )}
    </div>
  );
}
