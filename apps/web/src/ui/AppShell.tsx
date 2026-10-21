import type { ReactNode } from 'react';
import logoUrl from '../assets/logo.webp';
import {
  BookmarkIcon,
  CompassIcon,
  LogInIcon,
  PlusIcon,
  SettingsIcon,
  TimerIcon,
  TrophyIcon,
  UsersIcon,
} from './icons';

export type Section = 'explore' | 'ranking';

interface AppShellProps {
  active: Section;
  onNavigate: (section: Section) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
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
          <SoonLink icon={<TimerIcon />} label="Meus records" />
          <SoonLink icon={<BookmarkIcon />} label="Salvos" />
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

        <div className="sidebar-footer">
          <SoonLink icon={<SettingsIcon />} label="Configurações" />
          <p className="credits">
            Feito por{' '}
            <a href="https://github.com/hugo-ryanf" target="_blank" rel="noreferrer">
              hugo-ryanf
            </a>
          </p>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}
