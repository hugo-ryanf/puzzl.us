import { useCallback, useEffect, useState } from 'react';
import type { AccountView, MeResponse, ProfileUpdate } from '@puzzle/shared';
import { guestId } from './connection';
import { t, translateServerMessage } from '../i18n';
import { forget } from './analytics';

/** Marca, por conta, que o histórico de convidado deste navegador já foi passado para ela. */
const LINKED_KEY = 'quebra-cabeca:convidado-ligado';

/** Mensagens da volta do login (o servidor devolve o navegador para "/?login=…"). */
const LOGIN_NOTICES: Record<string, string> = {
  erro: t('Não foi possível entrar com o Google. Tente de novo.'),
  cancelado: t('Login cancelado.'),
  indisponivel: t('O login com Google não está configurado neste servidor.'),
};

export interface Account {
  /** undefined enquanto carrega; null = convidado. */
  user: AccountView | null | undefined;
  /** O servidor tem login com Google configurado (senão, o botão de entrar some). */
  googleLogin: boolean;
  /** Aviso da volta do login que deu errado, para mostrar uma vez. */
  loginNotice?: string;
  logout: () => Promise<void>;
  /** Salva nickname, bio e avatar; a conta (e o resto do site) já passa a mostrar o novo. */
  updateProfile: (update: ProfileUpdate) => Promise<void>;
}

async function fetchMe(): Promise<MeResponse> {
  const response = await fetch('/api/me');
  if (!response.ok) throw new Error(`Erro ${response.status}`);
  return (await response.json()) as MeResponse;
}

/**
 * Passa para a conta o histórico de convidado deste navegador, uma vez por conta. Falhar não
 * atrapalha nada: tenta de novo na próxima vez que o site abrir.
 */
async function linkGuestOnce(userId: string) {
  try {
    if (localStorage.getItem(LINKED_KEY) === userId) return;
    const response = await fetch('/api/me/link-guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestId: guestId() }),
    });
    if (response.ok) localStorage.setItem(LINKED_KEY, userId);
  } catch {
    // sem rede ou sem storage: fica para a próxima
  }
}

/** Quem está usando o site: conta do Google ou convidado. Lido do servidor (cookie httpOnly). */
export function useAccount(): Account {
  const [me, setMe] = useState<MeResponse>();
  const [loginNotice] = useState(() => {
    // A volta do login traz ?login=ok|erro|…: lê uma vez e limpa a URL.
    const params = new URLSearchParams(location.search);
    const result = params.get('login');
    if (!result) return undefined;
    params.delete('login');
    const query = params.toString();
    history.replaceState(null, '', location.pathname + (query ? `?${query}` : ''));
    return LOGIN_NOTICES[result];
  });

  useEffect(() => {
    let current = true;
    fetchMe()
      .then((data) => {
        if (!current) return;
        setMe(data);
        if (data.user) void linkGuestOnce(data.user.id);
      })
      .catch(() => current && setMe({ user: null, googleLogin: false }));
    return () => {
      current = false;
    };
  }, []);

  const logout = useCallback(async () => {
    await fetch('/auth/logout', { method: 'POST' });
    forget();
    setMe((previous) => previous && { ...previous, user: null });
  }, []);

  const updateProfile = useCallback(async (update: ProfileUpdate) => {
    const response = await fetch('/api/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    });
    const body = (await response.json().catch(() => ({}))) as AccountView & { error?: string };
    if (!response.ok) {
      throw new Error(
        body.error
          ? translateServerMessage(body.error)
          : t('Erro {status}.', { status: response.status }),
      );
    }
    setMe((previous) => previous && { ...previous, user: body });
  }, []);

  return {
    user: me?.user,
    googleLogin: me?.googleLogin ?? false,
    loginNotice,
    logout,
    updateProfile,
  };
}
