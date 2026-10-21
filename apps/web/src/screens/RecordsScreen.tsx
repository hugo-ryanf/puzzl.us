import { findCatalogImage, type RankingQuery } from '@puzzle/shared';
import { catalogThumbUrl } from '../board/images';
import { formatDuration } from '../format';
import type { Library } from '../net/library';
import { TrophyIcon } from '../ui/icons';

interface RecordsScreenProps {
  library: Library;
  signedIn: boolean;
  googleLogin: boolean;
  onShowRanking: (query: RankingQuery) => void;
}

const TEAM_LABELS: Record<number, string> = { 1: 'Solo', 2: 'Dupla', 3: 'Trio', 4: 'Quarteto' };
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

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
          <h1>Meus records</h1>
          <p>Seu melhor tempo em cada quebra-cabeça que você já montou.</p>
        </div>
      </div>

      {!signedIn && (
        <div className="empty">
          <strong>Entre para ver seus records</strong>
          <p>Com a conta, suas partidas ficam guardadas em qualquer aparelho.</p>
          {googleLogin && (
            <a className="btn" href="/auth/google">
              Entrar com Google
            </a>
          )}
        </div>
      )}

      {signedIn && records.length === 0 && (
        <div className="empty">
          <strong>Nenhum record ainda</strong>
          <p>Monte um quebra-cabeça do catálogo e o seu tempo aparece aqui.</p>
        </div>
      )}

      {records.length > 0 && (
        <ol className="records-list">
          {records.map((record) => {
            const image = findCatalogImage(record.imageId);
            const key = `${record.imageId}:${record.pieceCount}:${record.teamSize}`;
            return (
              <li key={key}>
                {image ? (
                  <img src={catalogThumbUrl(record.imageId)} alt="" loading="lazy" />
                ) : (
                  <span className="records-thumb" />
                )}
                <span className="records-title">
                  <strong>{image?.title ?? 'Foto enviada'}</strong>
                  <small>
                    {record.pieceCount} peças · {TEAM_LABELS[record.teamSize] ?? record.teamSize}
                  </small>
                </span>
                <span className="records-time">
                  <strong>{formatDuration(record.bestMs)}</strong>
                  <small>
                    {record.plays === 1 ? '1 vez' : `${record.plays} vezes`} · última em{' '}
                    {dateFormat.format(new Date(record.lastPlayedAt))}
                  </small>
                </span>
                {image && (
                  <button
                    type="button"
                    className="btn"
                    aria-label={`Ranking de ${image.title}`}
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
