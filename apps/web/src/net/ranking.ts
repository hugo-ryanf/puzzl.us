import type {
  BulletRankingEntry,
  BulletRankingQuery,
  GeneralRankingEntry,
  GeneralRankingQuery,
  RankingEntry,
  RankingQuery,
} from '@puzzle/shared';

async function getRanking<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const search = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  );
  const response = await fetch(`${path}?${search}`);
  if (response.status === 503) throw new Error('O ranking está indisponível (servidor sem banco).');
  if (!response.ok) throw new Error(`Erro ${response.status} ao carregar o ranking.`);
  return (await response.json()) as T;
}

/** Melhor tempo de cada equipe numa categoria (foto + peças + modalidade) no período. */
export function fetchRanking(query: RankingQuery): Promise<RankingEntry[]> {
  return getRanking('/api/ranking', query);
}

/** Ranking geral da modalidade no período: peças somadas de todas as fotos. */
export function fetchGeneralRanking(query: GeneralRankingQuery): Promise<GeneralRankingEntry[]> {
  return getRanking('/api/ranking/general', query);
}

/** Bullet: melhor corrida de cada equipe (minutos + peças + modalidade) no período. */
export function fetchBulletRanking(query: BulletRankingQuery): Promise<BulletRankingEntry[]> {
  return getRanking('/api/ranking/bullet', query);
}
