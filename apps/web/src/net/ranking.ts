import {
  GUEST_HEADER,
  type BulletRankingEntry,
  type BulletRankingQuery,
  type GeneralRankingEntry,
  type GeneralRankingQuery,
  type PopularImage,
  type PopularQuery,
  type RankingEntry,
  type RankingPage,
  type RankingQuery,
} from '@puzzle/shared';
import { guestId } from './connection';

async function getRanking<T>(
  path: string,
  params: Partial<Record<string, string | number>>,
): Promise<T> {
  const search = new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, String(value)]],
    ),
  );
  // O convidado deste navegador vai no cabeçalho: assim o ranking acha "Sua posição" sem login
  // (logado, o cookie da conta já basta).
  const response = await fetch(`${path}?${search}`, { headers: { [GUEST_HEADER]: guestId() } });
  if (response.status === 503) throw new Error('O ranking está indisponível (servidor sem banco).');
  if (!response.ok) throw new Error(`Erro ${response.status} ao carregar o ranking.`);
  return (await response.json()) as T;
}

/** Melhor tempo de cada equipe numa categoria (foto + peças + modalidade) no período. */
export function fetchRanking(query: RankingQuery): Promise<RankingPage<RankingEntry>> {
  return getRanking('/api/ranking', query);
}

/** Ranking por pontos da modalidade no período. */
export function fetchGeneralRanking(
  query: GeneralRankingQuery,
): Promise<RankingPage<GeneralRankingEntry>> {
  return getRanking('/api/ranking/general', query);
}

/** Bullet: melhor corrida de cada equipe (minutos + peças + modalidade) no período. */
export function fetchBulletRanking(
  query: BulletRankingQuery,
): Promise<RankingPage<BulletRankingEntry>> {
  return getRanking('/api/ranking/bullet', query);
}

/** Bullet: a melhor corrida de quem está vendo na categoria (null = nunca jogou nela). */
export async function fetchBulletBest(
  query: Omit<BulletRankingQuery, 'period'>,
): Promise<{ solved: number; partial: number } | null> {
  const { best } = await getRanking<{ best: { solved: number; partial: number } | null }>(
    '/api/ranking/bullet/me',
    query,
  );
  return best;
}

/** Fotos mais jogadas no período, com as do período anterior (tendência). */
export function fetchPopularImages(query: Partial<PopularQuery>): Promise<PopularImage[]> {
  return getRanking('/api/ranking/popular', query);
}
