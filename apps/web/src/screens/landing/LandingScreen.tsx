import { CATALOG } from '@puzzle/shared';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import bannerDarkUrl from '../../assets/landing-camaleao-escuro.webp';
import bannerUrl from '../../assets/landing-camaleao.webp';
import logoUrl from '../../assets/logo.webp';
import { catalogThumbUrl, localizedCatalogImage } from '../../board/images';
import { locale, setLocale, t, tRich } from '../../i18n';
import {
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MoonIcon,
  SunIcon,
} from '../../ui/icons';
import { useTheme } from '../../ui/theme';
import type { PuzzleChoice } from '../explore/CreateRoomDialog';
import { DARK_ART, LIGHT_ART, type BannerArt } from './landingArt';

/** As fotos da galeria: as primeiras do catálogo, cada uma abre o "Criar sala" com ela. */
const GALLERY: PuzzleChoice[] = CATALOG.slice(0, 10).map((image) => {
  const local = localizedCatalogImage(image);
  return {
    imageId: image.id,
    title: local.title,
    subtitle: local.credit || t('Foto do catálogo'),
    thumbUrl: catalogThumbUrl(image.id),
  };
});

export interface LandingScreenProps {
  /** Entra no app: com uma foto, abre o "Criar sala" dela; sem, o "Criar sala" livre. */
  onStart: (choice?: PuzzleChoice) => void;
  onShowRanking: () => void;
  /** Login com Google disponível neste servidor. */
  googleLogin: boolean;
}

/**
 * Página de quem chega sem login: o banner do camaleão com peças sendo montadas, a galeria e o
 * rodapé. O tema claro (verde) e o escuro (neon) trocam pelo CSS, junto com o resto do site.
 */
export function LandingScreen({ onStart, onShowRanking, googleLogin }: LandingScreenProps) {
  return (
    <div className="landing">
      <header className="lp-header">
        <div className="lp-container lp-header-row">
          <a className="lp-brand" href="/">
            <img src={logoUrl} alt="" width={38} height={38} />
            <span className="lp-wordmark">
              puzzl<span>.us</span>
            </span>
          </a>
          <nav className="lp-nav" aria-label={t('Seções')}>
            <a href="#galeria">{t('Galeria')}</a>
            <button type="button" onClick={onShowRanking}>
              Ranking
            </button>
          </nav>
          <LandingSettings />
          {googleLogin && (
            <a className="lp-btn lp-btn-ghost lp-btn-small" href="/auth/google">
              {t('Entrar com Google')}
            </a>
          )}
        </div>
      </header>

      <section className="lp-hero" aria-label={t('Apresentação')}>
        <div className="lp-hero-art">
          <Banner art={LIGHT_ART} image={bannerUrl} variant="light" />
          <Banner art={DARK_ART} image={bannerDarkUrl} variant="dark" />
        </div>
        <div className="lp-hero-copy">
          <span className="lp-pill">
            <span className="lp-pill-dot" aria-hidden="true" />
            {t('Multiplayer em tempo real')}
          </span>
          <h1>
            {tRich('Cada peça se encaixa melhor {group}.', {
              group: <span className="lp-accent">{t('em grupo')}</span>,
            })}
          </h1>
          <p>
            {t(
              'Crie uma sala, mande o link e montem o mesmo quebra-cabeça ao mesmo tempo, conversando por voz.',
            )}
          </p>
          <div className="lp-actions">
            <button type="button" className="lp-btn lp-btn-primary" onClick={() => onStart()}>
              {t('Criar uma sala')}
              <ArrowRightIcon size={18} />
            </button>
            <a className="lp-btn lp-btn-ghost" href="#galeria">
              {t('Ver a galeria')}
            </a>
          </div>
        </div>
      </section>

      <Gallery onPlay={onStart} />

      <footer className="lp-footer">
        <div className="lp-container lp-footer-row">
          <span className="lp-footer-brand">
            <img src={logoUrl} alt="" width={28} height={28} />
            <b>puzzl.us</b> · {t('Feito por')}{' '}
            <a href="https://github.com/hugo-ryanf" target="_blank" rel="noreferrer">
              hugo-ryanf
            </a>
          </span>
          <a href="/privacidade">{t('Privacidade')}</a>
        </div>
      </footer>
    </div>
  );
}

const LIGHT_IMAGE: CSSProperties = { mixBlendMode: 'multiply' };
const DARK_IMAGE: CSSProperties = { filter: 'drop-shadow(0 0 40px rgba(255, 61, 207, 0.35))' };

/**
 * Tema e idioma, discretos no cabeçalho: o mesmo tema e o mesmo idioma da barra lateral do app
 * (guardados neste navegador). O ícone mostra para onde vai: lua no claro, sol no escuro.
 */
function LandingSettings() {
  const [, setTheme] = useTheme();
  const toggleTheme = () => {
    const chosen = document.documentElement.dataset.theme;
    const dark = chosen ? chosen === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(dark ? 'light' : 'dark');
  };
  const other = locale === 'en' ? 'pt-BR' : 'en';
  return (
    <div className="lp-settings">
      <button
        type="button"
        className="lp-icon-btn"
        aria-label={t('Tema')}
        title={t('Tema')}
        onClick={toggleTheme}
      >
        <span className="lp-only-light">
          <MoonIcon size={18} />
        </span>
        <span className="lp-only-dark">
          <SunIcon size={18} />
        </span>
      </button>
      <button
        type="button"
        className="lp-icon-btn"
        lang={other}
        aria-label={other === 'en' ? 'English' : 'Português'}
        title={other === 'en' ? 'English' : 'Português'}
        onClick={() => setLocale(other)}
      >
        {other === 'en' ? 'EN' : 'PT'}
      </button>
    </div>
  );
}

/** O banner: malha, camaleão, cacos flutuando e as três peças que saem e voltam para o lugar. */
function Banner({
  art,
  image,
  variant,
}: {
  art: BannerArt;
  image: string;
  variant: 'light' | 'dark';
}) {
  const artId = `lp-art-${variant}`;
  return (
    <svg
      className={`lp-banner lp-only-${variant}`}
      aria-hidden="true"
      viewBox="0 0 1440 600"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <clipPath id={`lp-clip-${variant}`}>
          <rect x="0" y="0" width="1440" height="600" />
        </clipPath>
        {variant === 'dark' && (
          <linearGradient id="lp-fade-dark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.72" stopColor="#0B0920" stopOpacity="0" />
            <stop offset="1" stopColor="#0B0920" stopOpacity="0.85" />
          </linearGradient>
        )}
        {art.movers.map((m) => (
          <clipPath key={m.id} id={m.id}>
            <path d={m.path} />
          </clipPath>
        ))}
        <g id={artId}>
          {art.mesh.map((tri, i) => (
            <polygon
              key={i}
              points={tri.points}
              fill={tri.fill}
              stroke={tri.stroke}
              strokeWidth={tri.width}
              strokeLinejoin="round"
            />
          ))}
          {/* estilo na própria imagem: ela é desenhada através de <use>, onde o CSS da página não chega */}
          <image
            style={variant === 'light' ? LIGHT_IMAGE : DARK_IMAGE}
            href={image}
            x="-300"
            y="-40"
            width="1260"
            height="684"
            preserveAspectRatio="none"
          />
          {variant === 'dark' && (
            <rect x="0" y="0" width="1440" height="600" fill="url(#lp-fade-dark)" />
          )}
        </g>
      </defs>
      <g clipPath={`url(#lp-clip-${variant})`}>
        <use href={`#${artId}`} />
      </g>
      {art.shards.map((s, i) => (
        <polygon
          key={i}
          className="lp-drift"
          points={s.points}
          fill={s.fill}
          stroke={s.stroke}
          strokeWidth="1.2"
          strokeLinejoin="round"
          style={{ animationDelay: `${s.delay}s` }}
        />
      ))}
      {/* o buraco de cada peça que saiu */}
      {art.movers.map((m) => (
        <path key={m.id} className="lp-hole" d={m.path} strokeWidth="1.6" strokeDasharray="5 4" />
      ))}
      {art.movers.map((m) => (
        <g
          key={m.id}
          className="lp-lift"
          style={
            {
              '--dx': `${m.dx}px`,
              '--dy': `${m.dy}px`,
              '--r': `${m.rotate}deg`,
              animationDelay: `${m.delay}s`,
            } as CSSProperties
          }
        >
          <g clipPath={`url(#${m.id})`}>
            <use href={`#${artId}`} />
          </g>
          <path d={m.path} fill="none" stroke="#FFFFFF" strokeWidth="2" />
          <g className="lp-cursor" style={{ animationDelay: `${m.delay}s` }}>
            <g transform={`translate(${m.cursorX} ${m.cursorY})`}>
              <path
                d="M0 0 L0 26 L7 20 L12 31 L17 29 L12 18 L21 18 Z"
                fill={m.color}
                stroke="#FFFFFF"
                strokeWidth="2.2"
                strokeLinejoin="round"
              />
              <rect x="16" y="28" width={m.tagWidth} height="26" rx="13" fill={m.color} />
              <text x={16 + m.tagWidth / 2} y="46" textAnchor="middle" className="lp-cursor-name">
                {m.name}
              </text>
            </g>
          </g>
        </g>
      ))}
    </svg>
  );
}

/** A galeria em carrossel: setas, rolagem com encaixe e a barrinha de progresso. */
function Gallery({ onPlay }: { onPlay: (choice: PuzzleChoice) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ progress: 0, visible: 1 });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setScroll({
      progress: max > 0 ? el.scrollLeft / max : 0,
      visible: el.scrollWidth > 0 ? Math.min(1, el.clientWidth / el.scrollWidth) : 1,
    });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const go = (direction: number) => {
    const el = track.current;
    if (el)
      el.scrollBy({ left: direction * Math.max(320, el.clientWidth - 160), behavior: 'smooth' });
  };
  const atStart = scroll.progress <= 0.01;
  const atEnd = scroll.progress >= 0.99 || scroll.visible >= 1;

  return (
    <section id="galeria" className="lp-gallery" aria-labelledby="lp-gallery-title">
      <Backdrop variant="light" />
      <Backdrop variant="dark" />
      <div className="lp-container lp-gallery-inner">
        <div className="lp-gallery-head">
          <div>
            <span className="lp-eyebrow">{t('Galeria')}</span>
            <h2 id="lp-gallery-title">{t('Escolha por onde começar')}</h2>
          </div>
          <div className="lp-arrows">
            <button
              type="button"
              className="lp-square"
              aria-label={t('Anteriores')}
              disabled={atStart}
              onClick={() => go(-1)}
            >
              <ChevronLeftIcon size={18} />
            </button>
            <button
              type="button"
              className="lp-square"
              aria-label={t('Próximos')}
              disabled={atEnd}
              onClick={() => go(1)}
            >
              <ChevronRightIcon size={18} />
            </button>
          </div>
        </div>

        <div className="lp-track" ref={track} onScroll={measure}>
          {GALLERY.map((choice) => (
            <article key={choice.imageId} className="lp-card">
              <img className="lp-card-photo" src={choice.thumbUrl} alt="" loading="lazy" />
              <div className="lp-card-body">
                <h3>{choice.title}</h3>
                <div className="lp-card-row">
                  <span className="lp-card-credit">{choice.subtitle}</span>
                  <button type="button" className="lp-play" onClick={() => onPlay(choice)}>
                    {t('Jogar')}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="lp-progress" aria-hidden="true">
          <div
            style={{
              left: `${scroll.progress * (1 - scroll.visible) * 100}%`,
              width: `${scroll.visible * 100}%`,
            }}
          />
        </div>
      </div>
    </section>
  );
}

function Backdrop({ variant }: { variant: 'light' | 'dark' }) {
  const art = variant === 'light' ? LIGHT_ART : DARK_ART;
  return (
    <svg
      className={`lp-backdrop lp-only-${variant}`}
      aria-hidden="true"
      viewBox="0 0 1440 640"
      preserveAspectRatio="xMidYMid slice"
    >
      {art.backdrop.map((tri, i) => (
        <polygon
          key={i}
          points={tri.points}
          fill={tri.fill}
          stroke={tri.stroke}
          strokeWidth={tri.width}
        />
      ))}
    </svg>
  );
}
