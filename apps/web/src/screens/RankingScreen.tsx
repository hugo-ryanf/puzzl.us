import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BULLET_MINUTES,
  BULLET_PIECES,
  CATALOG,
  MAX_PLAYERS,
  PIECE_COUNT_PRESETS,
  RANKING_PERIODS,
  isTrending,
  playsTrend,
  type BulletRankingEntry,
  type BulletRankingQuery,
  type CommunityPuzzle,
  type GeneralRankingEntry,
  type PopularImage,
  type RankingEntry,
  type RankingPage,
  type RankingPeriod,
  type RankingQuery,
  type RankingRowBase,
} from '@puzzle/shared';
import { catalogThumbUrl, puzzleImageInfo } from '../board/images';
import { formatDuration } from '../format';
import {
  fetchBulletRanking,
  fetchGeneralRanking,
  fetchPopularImages,
  fetchRanking,
} from '../net/ranking';
import { avatarColor, initials } from '../ui/avatar';
import {
  ChevronDownIcon,
  CrownIcon,
  FlameIcon,
  PlusIcon,
  SearchIcon,
  TrophyIcon,
} from '../ui/icons';

/** O que abre o ranking: a categoria de uma foto e, vindo de um Bullet, a categoria dele. */
export type RankingOpen = Partial<RankingQuery> & { bullet?: BulletRankingQuery };

interface RankingScreenProps {
  /** `tab: 'general'`: aberto pelo menu (começa em Pontos). */
  initial: RankingQuery & { bullet?: BulletRankingQuery; tab?: 'general' };
  /** Fotos publicadas também têm ranking (depois do catálogo). */
  community: CommunityPuzzle[];
  /** "Criar sala" do pódio vazio (sem ele, o botão não aparece). */
  onCreateRoom?: () => void;
}

/**
 * Pontos (soma das melhores partidas de cada foto), por quebra-cabeça (melhor tempo numa foto)
 * ou Bullet (quantos quebra-cabeças em X minutos).
 */
type Tab = 'general' | 'puzzle' | 'bullet';

/** Uma linha do placar, seja qual for o tipo de ranking. */
interface Row {
  position: number;
  players: string[];
  value: string;
  sub: string;
  change?: number | null;
  streak: number;
  /** O valor em número (tempo, pontos, montados): calcula o "Rumo ao Nº". */
  score: number;
}

interface Loaded {
  /** De qual consulta é este resultado: se não bate com a atual, ainda está carregando. */
  key: string;
  rows?: Row[];
  /** Quantas equipes há no ranking (a tabela mostra só o topo). */
  total?: number;
  /** A melhor posição de quem está vendo, e quem está logo à frente. */
  me?: Row & { ahead?: Row };
  error?: string;
}

/** Converte a resposta da API em linhas do placar (topo, total e "Sua posição"). */
function toRows<T extends RankingRowBase>(
  key: string,
  page: RankingPage<T>,
  format: (entry: T) => Pick<Row, 'value' | 'sub' | 'score'>,
): Loaded {
  const row = (entry: T): Row => ({
    position: entry.position,
    players: entry.players,
    change: entry.change,
    streak: entry.streak,
    ...format(entry),
  });
  return {
    key,
    rows: page.entries.map(row),
    total: page.total,
    me: page.me && { ...row(page.me), ahead: page.me.ahead && row(page.me.ahead) },
  };
}

const formatPuzzle = (entry: RankingEntry) => ({
  value: formatDuration(entry.durationMs),
  sub: dateFormat.format(new Date(entry.finishedAt)),
  score: entry.durationMs,
});
const formatGeneral = (entry: GeneralRankingEntry) => ({
  value: `${entry.points.toLocaleString('pt-BR')} pts`,
  sub: entry.puzzles === 1 ? '1 quebra-cabeça' : `${entry.puzzles} quebra-cabeças`,
  score: entry.points,
});
const formatBullet = (entry: BulletRankingEntry) => ({
  value: entry.solved === 1 ? '1 montado' : `${entry.solved} montados`,
  sub: `${entry.partial > 0 ? `+${entry.partial} peças · ` : ''}${dateFormat.format(
    new Date(entry.finishedAt),
  )}`,
  // Montados valem mais que qualquer número de peças do que ficou pela metade.
  score: entry.solved * 10_000 + entry.partial,
});

interface ImageOption {
  id: string;
  title: string;
  thumb: string;
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
const TAB_LABELS: Record<Tab, string> = {
  general: 'Pontos',
  puzzle: 'Por quebra-cabeça',
  bullet: 'Bullet',
};
const VALUE_HEADERS: Record<Tab, string> = {
  general: 'PONTOS',
  puzzle: 'TEMPO',
  bullet: 'MONTADOS',
};
const TEAM_LABELS: Record<number, string> = { 1: 'Solo', 2: 'Duplas', 3: 'Trios', 4: 'Quartetos' };
const teamLabel = (n: number) => TEAM_LABELS[n] ?? `${n} jogadores`;
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
/** "Ver todos" os mais jogados: até quantas fotos. */
const TRENDING_ALL = 48;
/** Quantas fotos o seletor mostra (busca ou mais jogadas). */
const IMAGE_CHOICES = 12;
/** Quantas fotos o destaque "Mais jogados da semana" mostra. */
const TRENDING = 8;
/** Pódio na ordem em que aparece: 2º, 1º, 3º. */
const PODIUM_ORDER = [1, 0, 2];

/** Busca sem acento e sem caixa: "patio" acha "Pátio com chafariz". */
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

const teamName = (players: string[]) =>
  players.length <= 1
    ? (players[0] ?? '')
    : `${players.slice(0, -1).join(', ')} & ${players[players.length - 1]}`;

export function RankingScreen({ initial, community, onCreateRoom }: RankingScreenProps) {
  const images: ImageOption[] = [
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
  const byId = new Map(images.map((image) => [image.id, image]));

  const [tab, setTab] = useState<Tab>(initial.bullet ? 'bullet' : (initial.tab ?? 'puzzle'));
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
        ? fetchRanking(query).then((page) => toRows(key, page, formatPuzzle))
        : tab === 'bullet'
          ? fetchBulletRanking({ ...bulletCategory, players, period }).then((page) =>
              toRows(key, page, formatBullet),
            )
          : fetchGeneralRanking({ players, period }).then((page) =>
              toRows(key, page, formatGeneral),
            );
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

  // Destaque do topo: as fotos mais jogadas da semana, em qualquer modalidade.
  const [trending, setTrending] = useState<TrendingItem[]>();
  const [showAllTrending, setShowAllTrending] = useState(false);
  useEffect(() => {
    let current = true;
    fetchPopularImages({ period: 'week', limit: showAllTrending ? TRENDING_ALL : TRENDING })
      .then((list) => {
        if (!current) return;
        setTrending(
          list.flatMap((popular) => {
            const image = byId.get(popular.imageId);
            return image ? [{ image, popular }] : [];
          }),
        );
      })
      .catch(() => current && setTrending([]));
    return () => {
      current = false;
    };
    // `byId` muda a cada render; a lista da comunidade é o que importa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community, showAllTrending]);

  // Fotos para o seletor do ranking por foto: as mais jogadas da modalidade no período.
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

  const result = loaded?.key === key ? loaded : undefined;
  const imageTitle = puzzleImageInfo(query.image)?.title;
  const rows = result?.rows;

  const hint =
    tab === 'puzzle'
      ? `Melhor tempo de cada equipe em “${imageTitle ?? 'esta foto'}” com ${query.pieces} peças, medido pelo servidor.`
      : tab === 'bullet'
        ? 'Quantos quebra-cabeças cada equipe montou no tempo. Empate: peças do último.'
        : 'Pontos somados no período: peças × velocidade, a melhor partida de cada foto.';
  const emptyText =
    tab === 'puzzle'
      ? `Ninguém montou “${imageTitle}” com ${query.pieces} peças em ${teamLabel(players).toLowerCase()} ${PERIOD_PHRASES[period]}. Seja o primeiro!`
      : tab === 'bullet'
        ? `Nenhum Bullet de ${bulletCategory.minutes} min com ${bulletCategory.pieces} peças em ${teamLabel(players).toLowerCase()} ${PERIOD_PHRASES[period]}. Seja o primeiro!`
        : `Ninguém jogou em ${teamLabel(players).toLowerCase()} ${PERIOD_PHRASES[period]}. Seja o primeiro!`;

  function pickImage(id: string) {
    setTab('puzzle');
    setQuery({ ...query, image: id });
  }

  return (
    <div className="rk">
      <h1 className="sr-only">Ranking</h1>

      {!!trending?.length && (
        <Trending
          items={trending}
          selected={tab === 'puzzle' ? query.image : undefined}
          onPick={pickImage}
          showAll={showAllTrending}
          onShowAll={setShowAllTrending}
        />
      )}

      <section className="rk-section" aria-labelledby="rk-title">
        <div className="rk-heading">
          <h2 id="rk-title">Ranking</h2>
          <p>{hint}</p>
        </div>

        <div className="rk-filters" role="group" aria-label="Filtros do ranking">
          <div className="rk-segmented" role="group" aria-label="Período">
            {RANKING_PERIODS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={value === period}
                onClick={() => setQuery({ ...query, period: value })}
              >
                {PERIOD_LABELS[value]}
              </button>
            ))}
          </div>

          <SelectBox
            label="Modalidade"
            value={String(players)}
            display={teamLabel(players)}
            onChange={(value) => setQuery({ ...query, players: Number(value) })}
            options={Array.from({ length: MAX_PLAYERS }, (_, i) => ({
              value: String(i + 1),
              label: teamLabel(i + 1),
            }))}
          />
          <SelectBox
            label="Tipo"
            value={tab}
            display={TAB_LABELS[tab]}
            onChange={(value) => setTab(value as Tab)}
            options={(['general', 'puzzle', 'bullet'] as const).map((value) => ({
              value,
              label: TAB_LABELS[value],
            }))}
          />

          {tab === 'puzzle' && (
            <>
              <ImagePicker
                images={images}
                popular={popular}
                selected={query.image}
                onPick={(id) => setQuery({ ...query, image: id })}
              />
              <SelectBox
                label="Peças"
                value={String(query.pieces)}
                display={query.pieces.toLocaleString('pt-BR')}
                onChange={(value) => setQuery({ ...query, pieces: Number(value) })}
                options={PIECE_COUNT_PRESETS.map((count) => ({
                  value: String(count),
                  label: count.toLocaleString('pt-BR'),
                }))}
              />
            </>
          )}
          {tab === 'bullet' && (
            <>
              <SelectBox
                label="Tempo"
                value={String(bulletCategory.minutes)}
                display={`${bulletCategory.minutes} min`}
                onChange={(value) =>
                  setBulletCategory({
                    ...bulletCategory,
                    minutes: Number(value) as (typeof BULLET_MINUTES)[number],
                  })
                }
                options={BULLET_MINUTES.map((minutes) => ({
                  value: String(minutes),
                  label: `${minutes} min`,
                }))}
              />
              <SelectBox
                label="Peças"
                value={String(bulletCategory.pieces)}
                display={String(bulletCategory.pieces)}
                onChange={(value) =>
                  setBulletCategory({
                    ...bulletCategory,
                    pieces: Number(value) as (typeof BULLET_PIECES)[number],
                  })
                }
                options={BULLET_PIECES.map((pieces) => ({
                  value: String(pieces),
                  label: String(pieces),
                }))}
              />
            </>
          )}
        </div>

        {!result && <p className="loading">Carregando…</p>}
        {result?.error && <p className="error">{result.error}</p>}
        {rows?.length === 0 && (
          <div className="rk-empty">
            <TrophyIcon size={36} />
            <p className="rk-empty-title">Pódio livre</p>
            <p>{emptyText}</p>
            {onCreateRoom && (
              <button type="button" className="btn btn-primary rk-square" onClick={onCreateRoom}>
                <PlusIcon size={16} />
                Criar sala
              </button>
            )}
          </div>
        )}
        {!!rows?.length && (
          <Board
            rows={rows}
            valueHeader={VALUE_HEADERS[tab]}
            more={(result?.total ?? rows.length) - rows.length}
            noun={players === 1 ? 'jogadores' : 'equipes'}
          />
        )}
        {result?.me && (
          <MyPosition
            me={result.me}
            higherIsBetter={tab !== 'puzzle'}
            gapLabel={(ahead, me) =>
              tab === 'puzzle'
                ? `Falta ${formatDuration(me.score - ahead.score)}`
                : tab === 'bullet'
                  ? Math.floor(ahead.score / 10_000) > Math.floor(me.score / 10_000)
                    ? `Falta${ahead.score - me.score >= 20_000 ? 'm' : ''} ${Math.floor(ahead.score / 10_000) - Math.floor(me.score / 10_000)} montado${Math.floor(ahead.score / 10_000) - Math.floor(me.score / 10_000) === 1 ? '' : 's'}`
                    : `Faltam ${ahead.score - me.score} peças`
                  : `Faltam ${(ahead.score - me.score).toLocaleString('pt-BR')} pts`
            }
          />
        )}
      </section>
    </div>
  );
}

/** Avatares quadrados com as iniciais, sobrepostos quando é uma equipe. */
function Avatars({ players, size }: { players: string[]; size: number }) {
  return (
    <span className="rk-avatars" aria-hidden="true">
      {players.map((name, index) => (
        <span
          key={`${name}:${index}`}
          style={{
            width: size,
            height: size,
            marginLeft: index === 0 ? 0 : -Math.round(size * 0.3),
            background: avatarColor(name),
          }}
        >
          {initials(name)}
        </span>
      ))}
    </span>
  );
}

/** "▲ 2", "▼ 1", "=" ou "NOVO": quanto a equipe subiu ou caiu desde o período anterior. */
function Change({ change }: { change?: number | null }) {
  if (change === undefined) return <span className="rk-change">—</span>;
  if (change === null) return <span className="rk-change new">NOVO</span>;
  if (change === 0) return <span className="rk-change">=</span>;
  return (
    <span className={change > 0 ? 'rk-change up' : 'rk-change down'}>
      <span className="sr-only">{change > 0 ? 'Subiu ' : 'Caiu '}</span>
      <span aria-hidden="true">{change > 0 ? '▲' : '▼'}</span> {Math.abs(change)}
    </span>
  );
}

/** Chama acesa a partir de 3 dias seguidos jogando. */
function Streak({ days }: { days: number }) {
  return (
    <span className={days >= 3 ? 'rk-streak hot' : 'rk-streak'}>
      <FlameIcon size={15} />
      <span className="sr-only">Sequência de </span>
      {days}
      <span className="sr-only"> {days === 1 ? 'dia' : 'dias'}</span>
    </span>
  );
}

/** Pódio dos três primeiros (2º, 1º, 3º) e a tabela do 4º em diante. */
function Board({
  rows,
  valueHeader,
  more,
  noun,
}: {
  rows: Row[];
  valueHeader: string;
  more: number;
  noun: string;
}) {
  const podium = PODIUM_ORDER.flatMap((index) => (rows[index] ? [rows[index]] : []));
  const rest = rows.slice(3);
  return (
    <div className="rk-board">
      <ol className="rk-podium" aria-label="Pódio">
        {podium.map((row) => (
          <li key={row.position} className={`rk-podium-${row.position}`}>
            {row.position === 1 && (
              <span className="rk-crown" role="img" aria-label="Campeão">
                <CrownIcon size={28} />
              </span>
            )}
            <Avatars players={row.players} size={row.position === 1 ? 60 : 52} />
            <span className="rk-podium-name">{teamName(row.players)}</span>
            <span className="rk-podium-meta">
              <Streak days={row.streak} />
              <span className="rk-mono rk-podium-value">{row.value}</span>
            </span>
            <span className="rk-podium-block">
              <span className="sr-only">Posição </span>
              {row.position}
            </span>
          </li>
        ))}
      </ol>

      {rest.length > 0 && (
        <>
          <div className="rk-row rk-row-header" aria-hidden="true">
            <span>POS</span>
            <span>±</span>
            <span>JOGADOR</span>
            <span className="rk-col-streak">SEQUÊNCIA</span>
            <span className="rk-value">{valueHeader}</span>
          </div>
          <ol className="rk-rows" start={4}>
            {rest.map((row) => (
              <li key={row.position} className="rk-row">
                <span className="rk-mono rk-pos">
                  <span className="sr-only">Posição </span>
                  {row.position}
                </span>
                <Change change={row.change} />
                <span className="rk-player">
                  <Avatars players={row.players} size={38} />
                  <span className="rk-player-text">
                    <strong>{teamName(row.players)}</strong>
                    <small>{row.sub}</small>
                  </span>
                </span>
                <span className="rk-col-streak">
                  <Streak days={row.streak} />
                </span>
                <span className="rk-mono rk-value">{row.value}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      {more > 0 && (
        <div className="rk-more" aria-hidden="true">
          <span />
          <span />
          <span />
          mais {more} {noun}
        </div>
      )}
    </div>
  );
}

/** "Sua posição": fixa no pé, com quanto falta para passar quem está logo à frente. */
function MyPosition({
  me,
  higherIsBetter,
  gapLabel,
}: {
  me: Row & { ahead?: Row };
  higherIsBetter: boolean;
  gapLabel: (ahead: Row, me: Row) => string;
}) {
  const { ahead } = me;
  const pct = !ahead
    ? 100
    : Math.max(
        0,
        Math.min(
          99,
          Math.round((higherIsBetter ? me.score / ahead.score : ahead.score / me.score) * 100),
        ),
      );
  return (
    <div className="rk-me">
      <span className="rk-mono rk-me-pos">
        <span className="sr-only">Sua posição: </span>
        {me.position}º
      </span>
      <span className="rk-me-who">
        <Avatars players={me.players} size={40} />
        <span className="rk-player-text">
          <span className="rk-me-name">
            <strong>{teamName(me.players)}</strong>
            <span className="rk-me-you">Você</span>
          </span>
          <small>
            {ahead ? `${gapLabel(ahead, me)} para o ${ahead.position}º lugar` : 'Você lidera!'}
          </small>
        </span>
      </span>
      {ahead && (
        <span className="rk-me-progress">
          <span className="rk-me-progress-label">
            <span>Rumo ao {ahead.position}º</span>
            <span className="rk-mono">{pct}%</span>
          </span>
          <span
            className="rk-me-bar"
            role="progressbar"
            aria-label="Progresso até a próxima posição"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <span style={{ width: `${pct}%` }} />
          </span>
        </span>
      )}
      <span className="rk-mono rk-me-value">{me.value}</span>
    </div>
  );
}

interface TrendingItem {
  image: ImageOption;
  popular: PopularImage;
}

/** "▲ 32%" verde / "▼ 4%" laranja, comparando com a semana passada. */
function Trend({ popular }: { popular: PopularImage }) {
  const trend = playsTrend(popular);
  if (trend === null) return null;
  return (
    <span className={trend >= 0 ? 'rk-mono rk-trend up' : 'rk-mono rk-trend down'}>
      <span className="sr-only">{trend >= 0 ? 'Subiu ' : 'Caiu '}</span>
      <span aria-hidden="true">{trend >= 0 ? '▲' : '▼'}</span>
      {Math.abs(trend)}%
    </span>
  );
}

/**
 * "Em alta · Mais jogados da semana": carrossel com as fotos (ou, em "Ver todos", a grade com
 * todas); clicar abre o ranking dela.
 */
function Trending({
  items,
  selected,
  onPick,
  showAll,
  onShowAll,
}: {
  items: TrendingItem[];
  selected?: string;
  onPick: (id: string) => void;
  showAll: boolean;
  onShowAll: (showAll: boolean) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ left: 0, width: 100, atStart: true, atEnd: true });

  const measure = () => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setScroll({
      left: max > 0 ? (el.scrollLeft / el.scrollWidth) * 100 : 0,
      width: el.scrollWidth > 0 ? (el.clientWidth / el.scrollWidth) * 100 : 100,
      atStart: el.scrollLeft <= 1,
      atEnd: el.scrollLeft >= max - 1,
    });
  };
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [items, showAll]);

  const page = (direction: 1 | -1) =>
    track.current?.scrollBy({ left: direction * track.current.clientWidth * 0.8 });

  return (
    <section className="rk-section rk-trending" aria-labelledby="rk-trending-title">
      <div className="rk-trending-header">
        <div>
          <span className="rk-eyebrow">EM ALTA</span>
          <h2 id="rk-trending-title">Mais jogados da semana</h2>
        </div>
        <div className="rk-trending-nav">
          <button
            type="button"
            className="btn-link rk-see-all"
            aria-expanded={showAll}
            onClick={() => onShowAll(!showAll)}
          >
            {showAll ? 'Mostrar menos' : 'Ver todos'}
          </button>
          {!showAll && (
            <>
              <button
                type="button"
                className="rk-square-btn"
                aria-label="Anteriores"
                disabled={scroll.atStart}
                onClick={() => page(-1)}
              >
                <ChevronDownIcon size={18} />
              </button>
              <button
                type="button"
                className="rk-square-btn next"
                aria-label="Próximos"
                disabled={scroll.atEnd}
                onClick={() => page(1)}
              >
                <ChevronDownIcon size={18} />
              </button>
            </>
          )}
        </div>
      </div>
      <div className={showAll ? 'rk-track all' : 'rk-track'} ref={track} onScroll={measure}>
        {items.map(({ image, popular }, index) => (
          <button
            key={image.id}
            type="button"
            className="rk-card"
            aria-pressed={image.id === selected}
            onClick={() => onPick(image.id)}
          >
            <span className="rk-card-thumb">
              <img src={image.thumb} alt="" loading="lazy" />
              <span className="rk-mono rk-card-rank">#{index + 1}</span>
              {isTrending(popular) && (
                <span className="rk-mono rk-card-hot">
                  <FlameIcon size={12} />
                  EM ALTA
                </span>
              )}
            </span>
            <span className="rk-card-body">
              <strong>{image.title}</strong>
              <span className="rk-card-meta">
                <small>{popular.plays === 1 ? '1 partida' : `${popular.plays} partidas`}</small>
                <Trend popular={popular} />
              </span>
            </span>
          </button>
        ))}
      </div>
      {!showAll && (
        <div className="rk-track-bar" aria-hidden="true">
          <span style={{ left: `${scroll.left}%`, width: `${scroll.width}%` }} />
        </div>
      )}
    </section>
  );
}

interface SelectBoxProps {
  label: string;
  value: string;
  display: ReactNode;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

/** Caixa de filtro: rótulo + valor, com um <select> nativo por cima (teclado e celular de graça). */
function SelectBox({ label, value, display, options, onChange }: SelectBoxProps) {
  return (
    <label className="rk-select">
      <span className="rk-select-label">{label}</span>
      <span className="rk-select-value">{display}</span>
      <ChevronDownIcon size={16} />
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Seletor da foto: busca pelo título; sem busca, as mais jogadas (milhares de fotos não cabem). */
function ImagePicker({
  images,
  popular,
  selected,
  onPick,
}: {
  images: ImageOption[];
  popular?: string[];
  selected: string;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const anchor = useRef<HTMLDivElement>(null);
  const byId = new Map(images.map((image) => [image.id, image]));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const q = normalize(search);
  const candidates = q
    ? images.filter((image) => normalize(image.title).includes(q))
    : (popular ?? []).flatMap((id) => byId.get(id) ?? []);
  const current = byId.get(selected);
  const choices = [
    ...(current ? [current] : []),
    ...candidates.filter((image) => image.id !== selected),
  ].slice(0, IMAGE_CHOICES);

  return (
    <div className="rk-picker" ref={anchor}>
      <button
        type="button"
        className="rk-select"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="rk-select-label">Imagem</span>
        <span className="rk-select-value">{current?.title ?? 'Escolher'}</span>
        <ChevronDownIcon size={16} />
      </button>
      {open && (
        <div className="rk-picker-panel" role="dialog" aria-label="Escolher a foto">
          <label className="search">
            <SearchIcon size={18} />
            <span className="sr-only">Buscar foto</span>
            <input
              type="search"
              placeholder="Buscar pelo título…"
              value={search}
              autoFocus
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <small className="field-hint">
            {q
              ? candidates.length === 0
                ? 'Nenhuma foto com esse título.'
                : 'Resultados'
              : popular?.length
                ? 'Mais jogadas'
                : 'Ninguém jogou nesta modalidade no período: busque pelo título.'}
          </small>
          <ul>
            {choices.map((image) => (
              <li key={image.id}>
                <button
                  type="button"
                  aria-pressed={image.id === selected}
                  onClick={() => {
                    onPick(image.id);
                    setOpen(false);
                    setSearch('');
                  }}
                >
                  <img src={image.thumb} alt="" />
                  {image.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
