import type { RankingEntry, RankingQuery } from '@puzzle/shared';
import { SERVER_URL } from './connection';

export async function fetchRanking({
  image,
  pieces,
  players,
}: RankingQuery): Promise<RankingEntry[]> {
  const params = new URLSearchParams({
    image,
    pieces: String(pieces),
    players: String(players),
  });
  const response = await fetch(`${SERVER_URL}/api/ranking?${params}`);
  if (response.status === 503) throw new Error('O ranking está indisponível (servidor sem banco).');
  if (!response.ok) throw new Error(`Erro ${response.status} ao carregar o ranking.`);
  return (await response.json()) as RankingEntry[];
}
