import { useEffect, useState } from 'react';
import {
  CATALOG,
  MAX_PLAYERS,
  PIECE_COUNT_PRESETS,
  RANKING_PERIODS,
  type CommunityPuzzle,
  type GeneralRankingEntry,
  type RankingEntry,
  type RankingPeriod,
  type RankingQuery,
} from '@puzzle/shared';
import { catalogThumbUrl, puzzleImageInfo } from '../board/images';
import { formatDuration } from '../format';
import { fetchGeneralRanking, fetchRanking } from '../net/ranking';
import { Pips, difficultyOf } from '../ui/difficulty';

interface RankingScreenProps {
  initial: RankingQuery;
  /** Fotos publicadas também têm ranking (depois do catálogo nos filtros). */
  community: CommunityPuzzle[];
}

/** Por quebra-cabeça (melhor tempo numa foto) ou geral (peças somadas de todas as fotos). */
type Tab = 'puzzle' | 'general';

interface Loaded {
  /** De qual consulta é este resultado: se não bate com a atual, ainda está carregando. */
  key: string;
  entries?: RankingEntry[];
  general?: GeneralRankingEntry[];
  error?: string;
}

const PERIOD_LABELS: Record<RankingPeriod, string> = {
  day: 'Hoje',
  week: 'Esta semana',
  month: 'Este mês',
  all: 'Sempre',
};
/** "Ninguém no pódio hoje / esta semana / este mês / ainda" */
const PERIOD_PHRASES: Record<RankingPeriod, string> = {
  day: 'hoje',
  week: 'esta semana',
  month: 'este mês',
  all: 'ainda',
};
const TEAM_LABELS: Record<number, string> = { 1: 'Solo', 2: 'Duplas', 3: 'Trios', 4: 'Quartetos' };
const teamLabel = (n: number) => TEAM_LABELS[n] ?? `${n} jogadores`;
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

export function RankingScreen({ initial, community }: RankingScreenProps) {
  const images = [
    ...CATALOG.map((image) => ({
      id: image.id,
      title: image.title,
      thumb: catalogThumbUrl(image.id),
    })),
    ...community
      .filter((puzzle) => puzzle.status === 'published')
      .map((puzzle) => ({
        id: puzzle.imageId,
        title: puzzle.title,
        thumb: `/api/puzzles/${puzzle.id}/mini`,
      })),
  ];
  const [tab, setTab] = useState<Tab>('puzzle');
  const [query, setQuery] = useState(initial);
  const [loaded, setLoaded] = useState<Loaded>();
  const { players, period } = query;
  const key =
    tab === 'puzzle'
      ? `foto:${query.image}:${query.pieces}:${players}:${period}`
      : `geral:${players}:${period}`;

  useEffect(() => {
    let current = true; // ignora respostas de consultas antigas (troca rápida de filtro)
    const request: Promise<Loaded> =
      tab === 'puzzle'
        ? fetchRanking(query).then((entries) => ({ key, entries }))
        : fetchGeneralRanking({ players: query.players, period: query.period }).then((general) => ({
            key,
            general,
          }));
    request
      .then((result) => current && setLoaded(result))
      .catch(
        (e: unknown) =>
          current && setLoaded({ key, error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      current = false;
    };
  }, [tab, query, key]);

  const result = loaded?.key === key ? loaded : undefined;
  const imageTitle = puzzleImageInfo(query.image)?.title;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Ranking</h1>
          <p>
            {tab === 'puzzle'
              ? 'Melhor tempo de cada equipe em cada foto, medido pelo servidor.'
              : 'Peças montadas somando todas as fotos. Empate: menos tempo no total.'}
          </p>
        </div>
        <div className="chips" role="group" aria-label="Tipo de ranking">
          <button
            type="button"
            className="chip"
            aria-pressed={tab === 'puzzle'}
            onClick={() => setTab('puzzle')}
          >
            Por quebra-cabeça
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={tab === 'general'}
            onClick={() => setTab('general')}
          >
            Geral
          </button>
        </div>
      </div>

      <div className="filter-group" role="radiogroup" aria-labelledby="filter-period">
        <span id="filter-period">Período</span>
        <div className="chips">
          {RANKING_PERIODS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={value === period}
              className="chip"
              onClick={() => setQuery({ ...query, period: value })}
            >
              {PERIOD_LABELS[value]}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group" role="radiogroup" aria-labelledby="filter-modality">
        <span id="filter-modality">Modalidade</span>
        <div className="chips">
          {Array.from({ length: MAX_PLAYERS }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={n === players}
              className="chip"
              onClick={() => setQuery({ ...query, players: n })}
            >
              {teamLabel(n)}
            </button>
          ))}
        </div>
      </div>

      {tab === 'puzzle' && (
        <>
          <div className="filter-group" role="radiogroup" aria-labelledby="filter-image">
            <span id="filter-image">Imagem</span>
            <div className="chips">
              {images.map((image) => (
                <button
                  key={image.id}
                  type="button"
                  role="radio"
                  aria-checked={image.id === query.image}
                  className="chip image-chip"
                  onClick={() => setQuery({ ...query, image: image.id })}
                >
                  <img src={image.thumb} alt="" />
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
        </>
      )}

      {!result && <p className="loading">Carregando…</p>}
      {result?.error && <p className="error">{result.error}</p>}
      {(result?.entries?.length === 0 || result?.general?.length === 0) && (
        <div className="empty">
          <strong>Ninguém no pódio {PERIOD_PHRASES[period]}</strong>
          <p>
            {tab === 'puzzle'
              ? `Ninguém montou “${imageTitle}” com ${query.pieces} peças em ${teamLabel(players)} ${PERIOD_PHRASES[period]}. `
              : `Nenhum quebra-cabeça completado em ${teamLabel(players)} ${PERIOD_PHRASES[period]}. `}
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
      {!!result?.general?.length && (
        <ol className="ranking-list" aria-label={`Ranking geral: ${teamLabel(players)}`}>
          {result.general.map((entry) => (
            <li key={entry.position}>
              <span className={entry.position <= 3 ? 'position podium' : 'position'}>
                {entry.position}º
              </span>
              <span>{entry.players.join(' & ')}</span>
              <span className="time">{entry.points.toLocaleString('pt-BR')} peças</span>
              <span className="date">
                {entry.puzzles === 1 ? '1 quebra-cabeça' : `${entry.puzzles} quebra-cabeças`} ·{' '}
                {formatDuration(entry.totalMs)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
