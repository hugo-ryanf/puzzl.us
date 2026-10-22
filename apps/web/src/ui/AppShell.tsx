import { useState, type FormEvent, type ReactNode } from 'react';
import type { FriendStatus, FriendView } from '@puzzle/shared';
import logoUrl from '../assets/logo.webp';
import type { Account } from '../net/account';
import {
  ArrowRightIcon,
  BookmarkIcon,
  CompassIcon,
  HourglassIcon,
  MonitorIcon,
  MoonIcon,
  MoreIcon,
  PlusIcon,
  SunIcon,
  TimerIcon,
  TrophyIcon,
  UsersIcon,
} from './icons';
import { avatarColor, initials } from './avatar';
import { useTheme, type ThemeChoice } from './theme';
import { Popover } from './Popover';

export type Section = 'explore' | 'friends' | 'saved' | 'favorites' | 'records' | 'ranking';

interface AppShellProps {
  active: Section;
  onNavigate: (section: Section) => void;
  onCreateRoom: () => void;
  /** Com código (digitado na barra): abre "Entrar com código" já preenchido. */
  onJoinRoom: (code?: string) => void;
  account: Account;
  /** Amigos aceitos (com status); a barra mostra os primeiros, online antes. */
  friends?: FriendView[];
  /** Pedidos de amizade esperando resposta (número ao lado de "Ver todos"). */
  friendRequests?: number;
  children: ReactNode;
}

/** Quantos amigos cabem na barra; o resto fica na página Amigos. */
const SIDEBAR_FRIENDS = 4;
const STATUS_ORDER: Record<FriendStatus, number> = { playing: 0, online: 1, offline: 2 };
const STATUS_LABELS: Record<FriendStatus, string> = {
  playing: 'Jogando',
  online: 'Online',
  offline: 'Offline',
};
/** Barra lateral + conteúdo. Em telas estreitas a barra vai para cima (flex-wrap). */
export function AppShell({
  active,
  onNavigate,
  onCreateRoom,
  onJoinRoom,
  account,
  friends,
  friendRequests = 0,
  children,
}: AppShellProps) {
  const current = (section: Section) => (section === active ? ('page' as const) : undefined);
  const [code, setCode] = useState('');
  const ready = code.length === 5;

  function joinWithCode(event: FormEvent) {
    event.preventDefault();
    onJoinRoom(ready ? code : undefined);
    setCode('');
  }

  const navLink = (section: Section, icon: ReactNode, label: string, extra?: ReactNode) => (
    <li>
      <button
        type="button"
        className="nav-link"
        aria-current={current(section)}
        onClick={() => onNavigate(section)}
      >
        {icon}
        {label}
        {extra}
      </button>
    </li>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <button type="button" className="brand" onClick={() => onNavigate('explore')}>
          <img className="brand-logo" src={logoUrl} alt="" />
          <span className="brand-name">
            puzzl<span>.us</span>
          </span>
        </button>

        <div className="sidebar-actions">
          <button
            type="button"
            className="btn btn-primary btn-lg create-btn"
            onClick={onCreateRoom}
          >
            <PlusIcon size={18} />
            Criar sala
          </button>
          <form className="join-code" onSubmit={joinWithCode}>
            <label htmlFor="sidebar-code" className="sr-only">
              Código da sala
            </label>
            <input
              id="sidebar-code"
              className="input join-code-input"
              autoComplete="off"
              maxLength={5}
              placeholder="Código da sala"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
            <button
              type="submit"
              className={ready ? 'btn join-code-go ready' : 'btn join-code-go'}
              aria-label="Entrar na sala"
            >
              <ArrowRightIcon size={18} />
            </button>
          </form>
        </div>

        <nav className="nav" aria-label="Principal">
          <ul>
            {navLink('explore', <CompassIcon />, 'Explorar')}
            {navLink('saved', <HourglassIcon />, 'Em andamento')}
            {navLink('favorites', <BookmarkIcon />, 'Favoritos')}
            {navLink('records', <TimerIcon />, 'Meus records')}
            {navLink('ranking', <TrophyIcon />, 'Ranking')}
            {/* No celular a seção de amigos não cabe: vira um item do menu. */}
            <li className="mobile-only">
              <button
                type="button"
                className="nav-link"
                aria-current={current('friends')}
                onClick={() => onNavigate('friends')}
              >
                <UsersIcon />
                Amigos
                {friendRequests > 0 && <span className="nav-count">{friendRequests}</span>}
              </button>
            </li>
          </ul>
        </nav>

        {account.user && (
          <SidebarFriends
            friends={friends}
            requests={friendRequests}
            active={active === 'friends'}
            onOpen={() => onNavigate('friends')}
          />
        )}

        <div className="sidebar-footer">
          <AccountBox account={account} onFriends={() => onNavigate('friends')} />
          {/* Logado, o tema fica no menu "⋯" da conta; convidado não tem menu, então fica aqui. */}
          {!account.user && <ThemeSwitch />}
          <p className="credits">
            Feito por{' '}
            <a href="https://github.com/hugo-ryanf" target="_blank" rel="noreferrer">
              hugo-ryanf
            </a>
            {' · '}
            <a href="/privacidade">Privacidade</a>
          </p>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}

const THEMES: Array<{ value: ThemeChoice; label: string; icon: ReactNode }> = [
  { value: 'system', label: 'Sistema', icon: <MonitorIcon size={16} /> },
  { value: 'light', label: 'Claro', icon: <SunIcon size={16} /> },
  { value: 'dark', label: 'Escuro', icon: <MoonIcon size={16} /> },
];

/** Claro, escuro ou o mesmo do aparelho (guardado neste navegador). */
function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="theme-switch" role="group" aria-label="Tema">
      {THEMES.map(({ value, label, icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          title={value === 'system' ? 'Seguir o tema do aparelho' : `Tema ${label.toLowerCase()}`}
          onClick={() => setTheme(value)}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  );
}

/** Amigos na barra: quem está jogando e online primeiro; o resto na página Amigos. */
function SidebarFriends({
  friends = [],
  requests,
  active,
  onOpen,
}: {
  friends?: FriendView[];
  requests: number;
  active: boolean;
  onOpen: () => void;
}) {
  const online = friends.filter((friend) => friend.status !== 'offline').length;
  const shown = [...friends]
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
    .slice(0, SIDEBAR_FRIENDS);

  return (
    <section className="sidebar-friends" aria-labelledby="sidebar-friends-title">
      <div className="sidebar-friends-header">
        <h2 id="sidebar-friends-title">
          Amigos {friends.length > 0 && <span>{online} online</span>}
        </h2>
        <button
          type="button"
          className={active ? 'btn-link see-all current' : 'btn-link see-all'}
          onClick={onOpen}
        >
          Ver todos
          {requests > 0 && (
            <span className="nav-count" aria-label={`${requests} pedidos`}>
              {requests}
            </span>
          )}
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="sidebar-friends-empty">
          Adicione amigos pelo código para ver quem está online.
        </p>
      ) : (
        <ul>
          {shown.map((friend) => (
            <li key={friend.id}>
              <button type="button" className="sidebar-friend" onClick={onOpen}>
                <span className="sidebar-friend-avatar" aria-hidden="true">
                  {friend.avatarUrl ? (
                    <img src={friend.avatarUrl} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <span style={{ background: avatarColor(friend.name) }}>
                      {friend.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className={`status-dot ${friend.status}`} />
                </span>
                <span className="sidebar-friend-text">
                  <strong className={friend.status === 'offline' ? 'offline' : undefined}>
                    {friend.name}
                  </strong>
                  <small>{STATUS_LABELS[friend.status]}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Conta no rodapé: entrar com Google (convidado) ou foto, nome e o menu "⋯" (logado). */
function AccountBox({ account, onFriends }: { account: Account; onFriends: () => void }) {
  const { user, googleLogin, logout } = account;
  if (user === undefined) return <div className="sidebar-account" />; // carregando
  if (!user) {
    if (!googleLogin) return <div className="sidebar-account" />; // servidor sem login
    return (
      <div className="sidebar-account">
        {/* Link de verdade (não fetch): o login é uma ida e volta de páginas até o Google. */}
        <a className="btn btn-block google-btn" href="/auth/google">
          <GoogleMark />
          Entrar com Google
        </a>
        <small>Para salvar partidas, favoritar e adicionar amigos.</small>
      </div>
    );
  }
  return (
    <div className="sidebar-account signed-in">
      {user.avatarUrl ? (
        // Foto do Google: sem enviar de qual site veio o pedido (o Google bloqueia com referrer).
        <img className="account-avatar" src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span className="account-avatar">{initials(user.name)}</span>
      )}
      <span className="account-name">{user.name}</span>
      <Popover
        label="Menu da conta"
        triggerClassName="btn btn-ghost icon-only account-menu"
        trigger={<MoreIcon size={18} />}
        align="end"
      >
        <div className="menu-list">
          <p className="popover-note">Tema</p>
          <ThemeSwitch />
          <button type="button" className="btn" onClick={onFriends}>
            <UsersIcon size={16} />
            Amigos e código
          </button>
          <button type="button" className="btn" onClick={() => void logout()}>
            Sair
          </button>
        </div>
      </Popover>
    </div>
  );
}

/** O "G" colorido do Google, como pedem as regras de marca para botões de login. */
function GoogleMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
