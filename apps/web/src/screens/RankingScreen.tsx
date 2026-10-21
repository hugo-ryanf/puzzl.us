import { useEffect, useState } from 'react';
import {
  CATALOG,
  MAX_PLAYERS,
  PIECE_COUNT_PRESETS,
  findCatalogImage,
  type RankingEntry,
  type RankingQuery,
} from '@puzzle/shared';
import { catalogThumbUrl } from '../board/images';
import { formatDuration } from '../format';
import { fetchRanking } from '../net/ranking';
import { Pips, difficultyOf } from '../ui/difficulty';

interface RankingScreenProps {
  initial: RankingQuery;
}

interface Loaded {
  /** De qual consulta é este resultado: se não bate com a atual, ainda está carregando. */
  key: string;
  entries?: RankingEntry[];
  error?: string;
}

const TEAM_LABELS: Record<number, string> = { 1: 'Solo', 2: 'Duplas', 3: 'Trios', 4: 'Quartetos' };
const teamLabel = (n: number) => TEAM_LABELS[n] ?? `${n} jogadores`;
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

export function RankingScreen({ initial }: RankingScreenProps) {
  const [query, setQuery] = useState(initial);
  const [loaded, setLoaded] = useState<Loaded>();
  const key = `${query.image}:${query.pieces}:${query.players}`;

  useEffect(() => {
    let current = true; // ignora respostas de consultas antigas (troca rápida de filtro)
    fetchRanking(query)
      .then((entries) => current && setLoaded({ key, entries }))
      .catch(
        (e: unknown) =>
          current && setLoaded({ key, error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      current = false;
    };
  }, [query, key]);

  const result = loaded?.key === key ? loaded : undefined;
  const imageTitle = findCatalogImage(query.image)?.title;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Ranking</h1>
          <p>Melhor tempo de cada equipe, medido pelo servidor.</p>
        </div>
      </div>

      <div className="filter-group" role="radiogroup" aria-labelledby="filter-image">
        <span id="filter-image">Imagem</span>
        <div className="chips">
          {CATALOG.map((image) => (
            <button
              key={image.id}
              type="button"
              role="radio"
              aria-checked={image.id === query.image}
              className="chip image-chip"
              onClick={() => setQuery({ ...query, image: image.id })}
            >
              <img src={catalogThumbUrl(image.id)} alt="" />
              {image.title}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group" role="radiogroup" aria-labelledby="filter-pieces">
        <span id="filter-pieces">Peças</span>
        <div className="chips">
          {PIECE_COUNT_PRESETS.map((count) => (
            <button
              key={count}
              type="button"
              role="radio"
              aria-checked={count === query.pieces}
              className="chip"
              onClick={() => setQuery({ ...query, pieces: count })}
            >
              <Pips level={difficultyOf(count)} />
              {count}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group" role="radiogroup" aria-labelledby="filter-team">
        <span id="filter-team">Equipe</span>
        <div className="chips">
          {Array.from({ length: MAX_PLAYERS }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={n === query.players}
              className="chip"
              onClick={() => setQuery({ ...query, players: n })}
            >
              {teamLabel(n)}
            </button>
          ))}
        </div>
      </div>

      {!result && <p className="loading">Carregando…</p>}
      {result?.error && <p className="error">{result.error}</p>}
      {result?.entries?.length === 0 && (
        <div className="empty">
          <strong>Ninguém no pódio ainda</strong>
          <p>
            Ninguém montou “{imageTitle}” com {query.pieces} peças em {teamLabel(query.players)}
            {'. '}
            Seja o primeiro!
          </p>
        </div>
      )}
      {!!result?.entries?.length && (
        <ol className="ranking-list" aria-label={`Ranking de ${imageTitle}`}>
          {result.entries.map((entry) => (
            <li key={entry.position}>
              <span className={entry.position <= 3 ? 'position podium' : 'position'}>
                {entry.position}º
              </span>
              <span>{entry.players.join(' & ')}</span>
              <span className="time">{formatDuration(entry.durationMs)}</span>
              <span className="date">{dateFormat.format(new Date(entry.finishedAt))}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
