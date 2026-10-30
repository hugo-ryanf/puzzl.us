import { useCallback, useEffect, useState } from 'react';
import type { FriendsResponse, InviteRequest } from '@puzzle/shared';
import { t, translateServerMessage } from '../i18n';

export interface Friends {
  /** undefined: carregando ou convidado. */
  data?: FriendsResponse;
  /** Pede amizade pelo código; devolve se já virou amizade (a pessoa tinha pedido antes). */
  add: (code: string) => Promise<'requested' | 'accepted' | 'already'>;
  accept: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  invite: (request: InviteRequest) => Promise<void>;
}

async function request(path: string, method: string, body?: object): Promise<Response> {
  const response = await fetch(`/api/me/${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body && JSON.stringify(body),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      error.error
        ? translateServerMessage(error.error)
        : t('Erro {status}.', { status: response.status }),
    );
  }
  return response;
}

/**
 * Amigos e pedidos da conta. `version` vem da sala de presença: sobe quando algo muda do outro
 * lado (amigo ficou online, aceitou o pedido…) e a lista é buscada de novo.
 */
export function useFriends(userId: string | null | undefined, version: number): Friends {
  const [data, setData] = useState<FriendsResponse>();
  const [local, setLocal] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let current = true;
    request('friends', 'GET')
      .then((response) => response.json() as Promise<FriendsResponse>)
      .then((friends) => current && setData(friends))
      .catch(() => {}); // fica com a última lista
    return () => {
      current = false;
    };
  }, [userId, version, local]);

  const refresh = useCallback(() => setLocal((v) => v + 1), []);

  const add = useCallback(
    async (code: string) => {
      const response = await request('friends', 'POST', { code });
      refresh();
      return ((await response.json()) as { result: 'requested' | 'accepted' | 'already' }).result;
    },
    [refresh],
  );
  const accept = useCallback(
    async (id: string) => {
      await request(`friends/${id}/accept`, 'POST');
      refresh();
    },
    [refresh],
  );
  const remove = useCallback(
    async (id: string) => {
      await request(`friends/${id}`, 'DELETE');
      refresh();
    },
    [refresh],
  );
  const invite = useCallback(async (body: InviteRequest) => {
    await request('invites', 'POST', body);
  }, []);

  // Saiu da conta: a lista da conta anterior não vale mais.
  return { data: userId ? data : undefined, add, accept, remove, invite };
}
