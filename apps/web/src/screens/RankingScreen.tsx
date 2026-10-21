import { useEffect, useState } from 'react';
import {
  CATALOG,
  MAX_PLAYERS,
  PIECE_COUNT_PRESETS,
  RANKING_PERIODS,
  BULLET_MINUTES,
  BULLET_PIECES,
  type BulletRankingEntry,
  type BulletRankingQuery,
  type CommunityPuzzle,
  type GeneralRankingEntry,
  type RankingEntry,
  type RankingPeriod,
  type RankingQuery,
} from '@puzzle/shared';
import { catalogThumbUrl, puzzleImageInfo } from '../board/images';
import { formatDuration } from '../format';
import {
  fetchBulletRanking,
  fetchGeneralRanking,
  fetchPopularImages,
  fetchRanking,
} from '../net/ranking';
import { SearchIcon } from '../ui/icons';
import { Pips, difficultyOf } from '../ui/difficulty';

/** O que abre o ranking: a categoria de uma foto e, vindo de um Bullet, a categoria dele. */
export type RankingOpen = Partial<RankingQuery> & { bullet?: BulletRankingQuery };

interface RankingScreenProps {
  initial: RankingQuery & { bullet?: BulletRankingQuery };
  /** Fotos publicadas também têm ranking (depois do catálogo nos filtros). */
  community: CommunityPuzzle[];
}

/**
 * Por quebra-cabeça (melhor tempo numa foto), geral (peças somadas de todas as fotos) ou Bullet
 * (quantos quebra-cabeças em X minutos).
 */
type Tab = 'puzzle' | 'general' | 'bullet';

interface Loaded {
  /** De qual consulta é este resultado: se não bate com a atual, ainda está carregando. */
  key: string;
  entries?: RankingEntry[];
  general?: GeneralRankingEntry[];
  bullet?: BulletRankingEntry[];
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
/** Quantas fotos aparecem para escolher (busca ou mais jogadas). */
const IMAGE_CHOICES = 12;

/** Busca sem acento e sem caixa: "patio" acha "Pátio com chafariz". */
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

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
  const [tab, setTab] = useState<Tab>(initial.bullet ? 'bullet' : 'puzzle');
  const [query, setQuery] = useState<RankingQuery>(() => ({
    ...initial,
    players: initial.bullet?.players ?? initial.players,
    period: initial.bullet?.period ?? initial.period,
  }));
  const [bulletCategory, setBulletCategory] = useState(() => ({
    minutes: initial.bullet?.minutes ?? BULLET_MINUTES[1],
    pieces: initial.bullet?.pieces ?? BULLET_PIECES[0],
  }));
  const [loaded, setLoaded] = useState<Loaded>();
  const { players, period } = query;
  const key =
    tab === 'puzzle'
      ? `foto:${query.image}:${query.pieces}:${players}:${period}`
      : tab === 'bullet'
        ? `bullet:${bulletCategory.minutes}:${bulletCategory.pieces}:${players}:${period}`
        : `geral:${players}:${period}`;

  useEffect(() => {
    let current = true; // ignora respostas de consultas antigas (troca rápida de filtro)
    const request: Promise<Loaded> =
      tab === 'puzzle'
        ? fetchRanking(query).then((entries) => ({ key, entries }))
        : tab === 'bullet'
          ? fetchBulletRanking({ ...bulletCategory, players, period }).then((bullet) => ({
              key,
              bullet,
            }))
          : fetchGeneralRanking({ players, period }).then((general) => ({ key, general }));
    request
      .then((result) => current && setLoaded(result))
      .catch(
        (e: unknown) =>
          current && setLoaded({ key, error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      current = false;
    };
  }, [tab, query, key, bulletCategory, players, period]);

  const result = loaded?.key === key ? loaded : undefined;
  const imageTitle = puzzleImageInfo(query.image)?.title;

  // Escolher a foto: com busca, as que batem com o título; sem busca, as mais jogadas.
  const [search, setSearch] = useState('');
  const [popular, setPopular] = useState<string[]>();
  useEffect(() => {
    if (tab !== 'puzzle') return;
    let current = true;
    fetchPopularImages({ players, period })
      .then((list) => current && setPopular(list.map((entry) => entry.imageId)))
      .catch(() => current && setPopular([]));
    return () => {
      current = false;
    };
  }, [tab, players, period]);
  const byId = new Map(images.map((image) => [image.id, image]));
  const q = normalize(search);
  const candidates = q
    ? images.filter((image) => normalize(image.title).includes(q))
    : (popular ?? []).flatMap((id) => byId.get(id) ?? []);
  // A foto escolhida aparece sempre, primeiro.
  const selected = byId.get(query.image);
  const choices = [
    ...(selected ? [selected] : []),
    ...candidates.filter((image) => image.id !== query.image),
  ].slice(0, IMAGE_CHOICES);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Ranking</h1>
          <p>
            {tab === 'puzzle'
              ? 'Melhor tempo de cada equipe em cada foto, medido pelo servidor.'
              : tab === 'bullet'
                ? 'Quantos quebra-cabeças cada equipe montou no tempo. Empate: peças do último.'
                : 'Pontos somados no período: peças × velocidade, a melhor partida de cada foto.'}
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
            Pontos
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={tab === 'bullet'}
            onClick={() => setTab('bullet')}
          >
            Bullet
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
            <label className="search ranking-search">
              <SearchIcon size={18} />
              <span className="sr-only">Buscar foto</span>
              <input
                type="search"
                placeholder="Buscar foto pelo título…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {!q && popular?.length === 0 && (
              <p className="result-note">
                Ninguém jogou em {teamLabel(players).toLowerCase()} {PERIOD_PHRASES[period]}: busque
                uma foto pelo título.
              </p>
            )}
            {!q && !!popular?.length && <small className="field-hint">Mais jogadas</small>}
            {q && candidates.length === 0 && (
              <p className="result-note">Nenhuma foto com esse título.</p>
            )}
            <div className="chips">
              {choices.map((image) => (
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

      {tab === 'bullet' && (
        <>
          <div className="filter-group" role="radiogroup" aria-labelledby="filter-minutes">
            <span id="filter-minutes">Tempo</span>
            <div className="chips">
              {BULLET_MINUTES.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  role="radio"
                  aria-checked={minutes === bulletCategory.minutes}
                  className="chip"
                  onClick={() => setBulletCategory({ ...bulletCategory, minutes })}
                >
                  {minutes} min
                </button>
              ))}
            </div>
          </div>
          <div className="filter-group" role="radiogroup" aria-labelledby="filter-bullet-pieces">
            <span id="filter-bullet-pieces">Peças</span>
            <div className="chips">
              {BULLET_PIECES.map((pieces) => (
                <button
                  key={pieces}
                  type="button"
                  role="radio"
                  aria-checked={pieces === bulletCategory.pieces}
                  className="chip"
                  onClick={() => setBulletCategory({ ...bulletCategory, pieces })}
                >
                  {pieces}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {!result && <p className="loading">Carregando…</p>}
      {result?.error && <p className="error">{result.error}</p>}
      {(result?.entries?.length === 0 ||
        result?.general?.length === 0 ||
        result?.bullet?.length === 0) && (
        <div className="empty">
          <strong>Ninguém no pódio {PERIOD_PHRASES[period]}</strong>
          <p>
            {tab === 'puzzle'
              ? `Ninguém montou “${imageTitle}” com ${query.pieces} peças em ${teamLabel(players)} ${PERIOD_PHRASES[period]}. `
              : tab === 'bullet'
                ? `Nenhum Bullet de ${bulletCategory.minutes} min com ${bulletCategory.pieces} peças em ${teamLabel(players)} ${PERIOD_PHRASES[period]}. `
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
      {!!result?.bullet?.length && (
        <ol className="ranking-list" aria-label={`Ranking do Bullet: ${teamLabel(players)}`}>
          {result.bullet.map((entry) => (
            <li key={entry.position}>
              <span className={entry.position <= 3 ? 'position podium' : 'position'}>
                {entry.position}º
              </span>
              <span>{entry.players.join(' & ')}</span>
              <span className="time">
                {entry.solved === 1 ? '1 montado' : `${entry.solved} montados`}
              </span>
              <span className="date">
                {entry.partial > 0 && `+${entry.partial} peças · `}
                {dateFormat.format(new Date(entry.finishedAt))}
              </span>
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
              <span className="time">{entry.points.toLocaleString('pt-BR')} pts</span>
              <span className="date">
                {entry.puzzles === 1 ? '1 quebra-cabeça' : `${entry.puzzles} quebra-cabeças`}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
