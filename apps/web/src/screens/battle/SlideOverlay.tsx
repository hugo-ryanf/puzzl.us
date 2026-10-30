import type { BattleTeam } from '@puzzle/shared';
import type { PuzzleRoom } from '../../net/connection';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';
import { BoltIcon } from '../../ui/icons';
import { SlidingPuzzle } from '../room/SlidingPuzzle';
import { otherTeam, teamNames } from './score';
import { t } from '../../i18n';

/**
 * Relâmpago da batalha, por cima das duas mesas (pausadas): a minha grade à esquerda e a do
 * adversário à direita (no celular, só a minha). Quem montar primeiro leva energia cheia.
 */
export function SlideOverlay({
  room,
  snapshot,
  myTeam,
  narrow,
}: {
  room: PuzzleRoom;
  snapshot: RoomSnapshot;
  myTeam: BattleTeam;
  narrow: boolean;
}) {
  const other = otherTeam(myTeam);
  const mine = snapshot.slides[myTeam];
  const theirs = snapshot.slides[other];
  const winner = snapshot.slideWinner;
  const many = snapshot.players.filter((p) => p.team === other).length > 1;
  const result =
    winner === 'none'
      ? t('Ninguém montou a tempo')
      : winner === myTeam
        ? t('Vocês levaram! Energia cheia')
        : t(many ? '{names} levaram!' : '{names} levou!', {
            names: teamNames(snapshot, other) || t('Adversário'),
          });

  return (
    <div className="slide-overlay" role="dialog" aria-label={t('Relâmpago')}>
      <header
        className={
          winner === '' ? 'slide-head' : `slide-head ${winner === myTeam ? 'won' : 'lost'}`
        }
      >
        <BoltIcon size={20} />
        {winner === '' ? (
          <>
            {t('Relâmpago! Quem montar primeiro leva energia cheia')}
            <span className="slide-timer">{snapshot.slideSeconds} s</span>
          </>
        ) : (
          result
        )}
      </header>
      <div className="slide-boards">
        {mine && (
          <section className="slide-side">
            <h3>{t('Seu lado')}</h3>
            <SlidingPuzzle
              tiles={mine.tiles}
              label={t('Sua grade do relâmpago')}
              onSlide={winner === '' ? (index) => room.send('slide', { index }) : undefined}
            />
          </section>
        )}
        {!narrow && theirs && (
          <section className="slide-side theirs">
            <h3>{t('Adversário')}</h3>
            <SlidingPuzzle tiles={theirs.tiles} label={t('Grade do adversário')} />
          </section>
        )}
      </div>
    </div>
  );
}
