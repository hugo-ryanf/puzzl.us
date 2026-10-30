import { useCallback, useEffect, useState } from 'react';
import type { CommunityPuzzle, PublishPuzzleRequest } from '@puzzle/shared';
import { t, translateServerMessage } from '../i18n';

/**
 * Último retrato da lista, por imageId: a sala e o resultado mostram título e autor da foto
 * publicada sem precisar receber a lista por props.
 */
const byImageId = new Map<string, CommunityPuzzle>();

export function communityPuzzleOf(imageId: string): CommunityPuzzle | undefined {
  return byImageId.get(imageId);
}

export interface Community {
  /** Publicadas (e, para o admin, as ocultas), da mais nova para a mais antiga. */
  puzzles: CommunityPuzzle[];
  publish: (request: PublishPuzzleRequest) => Promise<CommunityPuzzle>;
  report: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
}

/** Erro da API ({ error }, sempre em português) traduzido, ou um genérico com o status. */
async function ensureOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  throw new Error(
    body.error
      ? translateServerMessage(body.error)
      : t('Erro {status}.', { status: response.status }),
  );
}

/** Quebra-cabeças da comunidade; busca de novo ao entrar/sair (muda "minha", "denunciei"). */
export function useCommunity(userId: string | null | undefined): Community {
  const [puzzles, setPuzzles] = useState<CommunityPuzzle[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (userId === undefined) return; // conta ainda carregando: evita buscar duas vezes
    let current = true;
    fetch('/api/puzzles')
      .then((response) => (response.ok ? (response.json() as Promise<CommunityPuzzle[]>) : []))
      .then((list) => {
        if (!current) return;
        byImageId.clear();
        for (const puzzle of list) byImageId.set(puzzle.imageId, puzzle);
        setPuzzles(list);
      })
      .catch(() => {}); // sem lista, o Explorar mostra só o catálogo
    return () => {
      current = false;
    };
  }, [userId, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const publish = useCallback(
    async (request: PublishPuzzleRequest) => {
      const response = await ensureOk(
        await fetch('/api/puzzles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        }),
      );
      const puzzle = (await response.json()) as CommunityPuzzle;
      byImageId.set(puzzle.imageId, puzzle);
      refresh();
      return puzzle;
    },
    [refresh],
  );

  const action = useCallback(
    (method: string, path: (id: string) => string) => async (id: string) => {
      await ensureOk(await fetch(`/api/puzzles/${path(id)}`, { method }));
      refresh();
    },
    [refresh],
  );

  return {
    puzzles,
    publish,
    report: action('POST', (id) => `${id}/report`),
    remove: action('DELETE', (id) => id),
    restore: action('POST', (id) => `${id}/restore`),
  };
}
