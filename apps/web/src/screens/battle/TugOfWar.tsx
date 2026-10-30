import type { BattleTeam } from '@puzzle/shared';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';
import { battleScore, otherTeam } from './score';
import { t } from '../../i18n';

/**
 * Cabo de guerra em cima da linha do meio: o nó pende para quem está na frente (o meu lado à
 * esquerda, como as mesas). Por tempo, 2 montados de vantagem já é o máximo; na corrida, metade
 * da mesa. Nos últimos 10 s (`hot`) o nó pega fogo.
 */
export function TugOfWar({
  snapshot,
  myTeam,
  hot,
}: {
  snapshot: RoomSnapshot;
  myTeam: BattleTeam;
  hot: boolean;
}) {
  const diff = battleScore(snapshot, myTeam) - battleScore(snapshot, otherTeam(myTeam));
  const range = snapshot.timeLimitMs > 0 ? 2 : 0.5;
  const lead = Math.max(-1, Math.min(1, diff / range));
  const side = Math.abs(lead) < 0.02 ? 'even' : lead > 0 ? 'mine' : 'theirs';
  const label =
    side === 'even'
      ? t('Empatados')
      : side === 'mine'
        ? t('Seu lado na frente')
        : t('Adversário na frente');
  return (
    <div className={hot ? `tug ${side} hot` : `tug ${side}`} role="img" aria-label={label}>
      <span className="tug-rope" />
      <span className="tug-center" />
      <span className="tug-knot" style={{ left: `${50 - lead * 42}%` }} />
    </div>
  );
}
