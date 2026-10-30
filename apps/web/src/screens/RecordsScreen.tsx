import { findCatalogImage, type RankingQuery } from '@puzzle/shared';
import { communityPuzzleOf } from '../net/community';
import { puzzleImageInfo, puzzleThumbUrl } from '../board/images';
import { formatDuration } from '../format';
import type { Library } from '../net/library';
import { TrophyIcon } from '../ui/icons';
import { locale, t } from '../i18n';

interface RecordsScreenProps {
  library: Library;
  signedIn: boolean;
  googleLogin: boolean;
  onShowRanking: (query: RankingQuery) => void;
}

const TEAM_LABELS: Record<number, string> = {
  1: 'Solo',
  2: t('Dupla'),
  3: t('Trio'),
  4: t('Quarteto'),
};
const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'short' });

/** Seus melhores tempos: um por foto + tamanho + modalidade, da partida mais recente para trás. */
export function RecordsScreen({
  library,
  signedIn,
  googleLogin,
  onShowRanking,
}: RecordsScreenProps) {
  const { records } = library;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{t('Meus records')}</h1>
          <p>{t('Seu melhor tempo em cada quebra-cabeça que você já montou.')}</p>
        </div>
      </div>

      {!signedIn && (
        <div className="empty">
          <strong>{t('Entre para ver seus records')}</strong>
          <p>{t('Com a conta, suas partidas ficam guardadas em qualquer aparelho.')}</p>
          {googleLogin && (
            <a className="btn" href="/auth/google">
              {t('Entrar com Google')}
            </a>
          )}
        </div>
      )}

      {signedIn && records.length === 0 && (
        <div className="empty">
          <strong>{t('Nenhum record ainda')}</strong>
          <p>{t('Monte um quebra-cabeça do catálogo e o seu tempo aparece aqui.')}</p>
        </div>
      )}

      {records.length > 0 && (
        <ol className="records-list">
          {records.map((record) => {
            // Ranking existe para o catálogo e para fotos publicadas (que ainda estão no ar).
            const ranked =
              !!findCatalogImage(record.imageId) || !!communityPuzzleOf(record.imageId);
            const image = puzzleImageInfo(record.imageId);
            const key = `${record.imageId}:${record.pieceCount}:${record.teamSize}`;
            return (
              <li key={key}>
                <img src={puzzleThumbUrl(record.imageId)} alt="" loading="lazy" />
                <span className="records-title">
                  <strong>{image?.title ?? t('Foto enviada')}</strong>
                  <small>
                    {t('{n} peças', { n: record.pieceCount })} ·{' '}
                    {TEAM_LABELS[record.teamSize] ?? record.teamSize}
                  </small>
                </span>
                <span className="records-time">
                  <strong>{formatDuration(record.bestMs)}</strong>
                  <small>
                    {record.plays === 1
                      ? t('1 vez · última em {date}', {
                          date: dateFormat.format(new Date(record.lastPlayedAt)),
                        })
                      : t('{n} vezes · última em {date}', {
                          n: record.plays,
                          date: dateFormat.format(new Date(record.lastPlayedAt)),
                        })}
                  </small>
                </span>
                {image && ranked && (
                  <button
                    type="button"
                    className="btn"
                    aria-label={t('Ranking de {title}', { title: image.title })}
                    onClick={() =>
                      onShowRanking({
                        image: record.imageId,
                        pieces: record.pieceCount,
                        players: record.teamSize,
                        period: 'all',
                      })
                    }
                  >
                    <TrophyIcon size={16} />
                    Ranking
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
