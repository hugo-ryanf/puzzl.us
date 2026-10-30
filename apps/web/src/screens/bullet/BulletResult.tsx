import { useEffect, useState } from 'react';
import type { BulletRankingEntry, BulletRankingQuery } from '@puzzle/shared';
import type { PuzzleRoom } from '../../net/connection';
import { fetchBulletRanking } from '../../net/ranking';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';
import { PartyIcon, TrophyIcon } from '../../ui/icons';
import { PlayAgainButton } from '../room/PlayAgainButton';
import { ordinal, t } from '../../i18n';

interface BulletResultProps {
  room: PuzzleRoom;
  snapshot: RoomSnapshot;
  onShowRanking: (query: BulletRankingQuery) => void;
  onLeave: () => void;
}

/** Quantas posições do ranking cabem no resumo; a da equipe aparece mesmo se ficar abaixo. */
const RANKING_PREVIEW = 5;

/** Fim do Bullet: quantos foram montados, o que ficou pela metade e a posição no ranking. */
export function BulletResult({ room, snapshot, onShowRanking, onLeave }: BulletResultProps) {
  const { solved, partial, pieceCount, timeLimitMs, teamSize, rankStatus, rank, rankToday } =
    snapshot;
  const query: BulletRankingQuery = {
    minutes: (timeLimitMs / 60_000) as BulletRankingQuery['minutes'],
    pieces: pieceCount as BulletRankingQuery['pieces'],
    players: teamSize,
    period: 'all',
  };
  const [ranking, setRanking] = useState<BulletRankingEntry[]>();

  const { minutes, pieces, players } = query;
  useEffect(() => {
    if (rankStatus !== 'saved') return;
    let cancelled = false;
    fetchBulletRanking({ minutes, pieces, players, period: 'all' })
      .then((page) => !cancelled && setRanking(page.entries))
      .catch(() => !cancelled && setRanking([]));
    return () => {
      cancelled = true;
    };
  }, [rankStatus, minutes, pieces, players]);

  const top = ranking?.slice(0, RANKING_PREVIEW) ?? [];
  const mine = ranking?.find((entry) => entry.position === rank);
  const rows = mine && !top.includes(mine) ? [...top, mine] : top;
  const category = `${query.minutes} min · ${t('{n} peças', { n: pieceCount })} · ${
    teamSize === 1 ? 'solo' : t('{n} jogadores', { n: teamSize })
  }`;

  return (
    <div className="overlay result-overlay">
      <section className="result" role="dialog" aria-labelledby="bullet-title">
        <header className="result-header">
          <span className="result-badge" aria-hidden="true">
            <PartyIcon size={26} />
          </span>
          <h2 id="bullet-title">{t('Tempo esgotado!')}</h2>
          {snapshot.record && (
            <p className="record-badge" role="status">
              <TrophyIcon size={16} /> {t('Novo recorde!')}
            </p>
          )}
          <p className="bullet-score">
            <strong>{solved}</strong>{' '}
            {solved === 1 ? t('quebra-cabeça montado') : t('quebra-cabeças montados')}
          </p>
          {partial > 0 && (
            <p className="caption">
              {partial === 1
                ? t('+ 1 peça encaixada no último')
                : t('+ {n} peças encaixadas no último', { n: partial })}
            </p>
          )}
        </header>

        <section className="result-section">
          <h3>{t('Ranking · {category}', { category })}</h3>
          {rankStatus === 'saving' && <p className="result-note">{t('Registrando no ranking…')}</p>}
          {rankStatus === 'unavailable' && (
            <p className="result-note">{t('O ranking está indisponível neste servidor.')}</p>
          )}
          {rankStatus === 'saved' && (
            <>
              <p className="result-rank">
                <TrophyIcon size={18} />
                <strong>{t('{place} lugar', { place: ordinal(rank) })}</strong> {t('na categoria')}
                {rankToday > 0 && (
                  <span className="result-rank-today">
                    {t('· {place} hoje', { place: ordinal(rankToday) })}
                  </span>
                )}
              </p>
              {rows.length > 0 && (
                <ol className="result-ranking">
                  {rows.map((entry) => (
                    <li
                      key={entry.position}
                      className={entry.position === rank ? 'mine' : undefined}
                    >
                      <span className="position">{ordinal(entry.position)}</span>
                      <span className="players">{entry.players.join(' & ')}</span>
                      <span className="time">
                        {entry.solved}
                        {entry.partial > 0 && <small> +{entry.partial}</small>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </section>

        <div className="result-actions">
          {rankStatus === 'saved' && (
            <button type="button" className="btn" onClick={() => onShowRanking(query)}>
              <TrophyIcon size={18} />
              {t('Ranking completo')}
            </button>
          )}
          <PlayAgainButton room={room} snapshot={snapshot} />
          <button type="button" className="btn btn-primary" onClick={onLeave}>
            {t('Voltar ao início')}
          </button>
        </div>
      </section>
    </div>
  );
}
