import { useCallback, useEffect, useState } from 'react';
import type { Room } from '@colyseus/sdk';
import type { InviteMessage } from '@puzzle/shared';
import { playSound } from '../sound/sounds';
import { joinPresence } from './connection';

/** Esperas entre tentativas de reconectar (servidor reiniciando, Render acordando). */
const RETRY_DELAYS_MS = [1000, 3000, 5000, 10_000, 30_000];

export interface Presence {
  /** Sobe a cada aviso de que a lista de amigos mudou (alguém entrou, saiu, aceitou…). */
  version: number;
  /** Convites recebidos, do mais antigo para o mais novo. */
  invites: InviteMessage[];
  dismissInvite: (invite: InviteMessage) => void;
}

/**
 * Enquanto a pessoa está logada, mantém a sala de presença aberta (é isso que a mostra online
 * para os amigos) e reconecta sozinha se cair.
 */
export function usePresence(userId: string | null | undefined): Presence {
  const [version, setVersion] = useState(0);
  const [invites, setInvites] = useState<InviteMessage[]>([]);

  useEffect(() => {
    if (!userId) return;
    let stopped = false;
    let room: Room | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const connect = () => {
      joinPresence()
        .then((joined) => {
          if (stopped) {
            void joined.leave();
            return;
          }
          room = joined;
          attempt = 0;
          setVersion((v) => v + 1); // reconectou: a lista pode ter mudado enquanto isso
          joined.onMessage('friendsChanged', () => setVersion((v) => v + 1));
          joined.onMessage('invite', (invite: InviteMessage) => {
            playSound('invite');
            // Um aviso por amigo: o convite novo substitui o anterior dele.
            setInvites((list) => [...list.filter((i) => i.fromId !== invite.fromId), invite]);
          });
          joined.onLeave(() => {
            room = undefined;
            if (!stopped) schedule();
          });
        })
        .catch(() => {
          if (!stopped) schedule();
        });
    };
    const schedule = () => {
      const delay = RETRY_DELAYS_MS[Math.min(attempt++, RETRY_DELAYS_MS.length - 1)];
      retry = setTimeout(connect, delay);
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      void room?.leave();
      setInvites([]);
    };
  }, [userId]);

  const dismissInvite = useCallback(
    (invite: InviteMessage) => setInvites((list) => list.filter((i) => i !== invite)),
    [],
  );

  return { version, invites, dismissInvite };
}
