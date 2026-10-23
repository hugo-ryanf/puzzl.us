import { useEffect, useState } from 'react';
import type { BulletRankingQuery } from '@puzzle/shared';
import { fetchBulletBest } from '../../net/ranking';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';

/**
 * "Seu melhor: 7" no cabeçalho do Bullet: o recorde de quem está vendo na categoria da sala
 * (tempo, tamanho e vagas). Busca de novo a cada partida, para já mostrar o recorde novo.
 */
export function BulletBestPill({ snapshot }: { snapshot: RoomSnapshot }) {
  const [best, setBest] = useState<number | null>();
  const minutes = (snapshot.timeLimitMs / 60_000) as BulletRankingQuery['minutes'];
  const pieces = snapshot.pieceCount as BulletRankingQuery['pieces'];
  const players = snapshot.maxPlayers;
  const game = snapshot.phase === 'lobby' || snapshot.rankStatus === 'saved';

  useEffect(() => {
    if (!game) return;
    let cancelled = false;
    fetchBulletBest({ minutes, pieces, players })
      .then((run) => !cancelled && setBest(run?.solved ?? null))
      .catch(() => !cancelled && setBest(undefined));
    return () => {
      cancelled = true;
    };
  }, [game, minutes, pieces, players]);

  if (best === undefined) return null;
  return (
    <span className="best-pill" title="Sua melhor corrida nesta categoria">
      {best === null ? 'Primeira vez aqui' : `Seu melhor: ${best}`}
    </span>
  );
}
