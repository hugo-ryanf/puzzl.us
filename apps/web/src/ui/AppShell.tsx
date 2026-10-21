import type { ReactNode } from 'react';
import logoUrl from '../assets/logo.webp';
import type { Account } from '../net/account';
import {
  BookmarkIcon,
  CompassIcon,
  HourglassIcon,
  LogInIcon,
  PlusIcon,
  SettingsIcon,
  TimerIcon,
  TrophyIcon,
  UsersIcon,
} from './icons';

export type Section = 'explore' | 'favorites' | 'records' | 'ranking';

interface AppShellProps {
  active: Section;
  onNavigate: (section: Section) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  account: Account;
  children: ReactNode;
}

/** Itens do menu que ainda não existem: aparecem, mas desabilitados e marcados "em breve". */
function SoonLink({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <button type="button" className="nav-link" disabled aria-label={`${label} (em breve)`}>
      {icon}
      {label}
      <span className="soon" aria-hidden="true">
        em breve
      </span>
    </button>
  );
}

/** Barra lateral + conteúdo. Em telas estreitas a barra vai para cima (flex-wrap). */
export function AppShell({
  active,
  onNavigate,
  onCreateRoom,
  onJoinRoom,
  account,
  children,
}: AppShellProps) {
  const current = (section: Section) => (section === active ? ('page' as const) : undefined);

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
          <button type="button" className="btn btn-primary btn-lg" onClick={onCreateRoom}>
            <PlusIcon size={18} />
            Criar sala
          </button>
          <button type="button" className="btn btn-lg" onClick={onJoinRoom}>
            <LogInIcon size={18} />
            Entrar com código
          </button>
        </div>

        <nav className="nav" aria-label="Principal">
          <button
            type="button"
            className="nav-link"
            aria-current={current('explore')}
            onClick={() => onNavigate('explore')}
          >
            <CompassIcon />
            Explorar
          </button>
          <SoonLink icon={<UsersIcon />} label="Amigos" />
          <SoonLink icon={<HourglassIcon />} label="Em andamento" />
          <button
            type="button"
            className="nav-link"
            aria-current={current('favorites')}
            onClick={() => onNavigate('favorites')}
          >
            <BookmarkIcon />
            Favoritos
          </button>
          <button
            type="button"
            className="nav-link"
            aria-current={current('records')}
            onClick={() => onNavigate('records')}
          >
            <TimerIcon />
            Meus records
          </button>
          <button
            type="button"
            className="nav-link"
            aria-current={current('ranking')}
            onClick={() => onNavigate('ranking')}
          >
            <TrophyIcon />
            Ranking
          </button>
        </nav>

        <AccountBox account={account} />

        <div className="sidebar-footer">
          <SoonLink icon={<SettingsIcon />} label="Configurações" />
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

/** Conta na barra lateral: entrar com Google (convidado) ou foto, nome e "Sair" (logado). */
function AccountBox({ account }: { account: Account }) {
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
        <span className="account-avatar">{user.name.charAt(0).toUpperCase()}</span>
      )}
      <span className="account-name">{user.name}</span>
      <button type="button" className="btn-link" onClick={() => void logout()}>
        Sair
      </button>
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
