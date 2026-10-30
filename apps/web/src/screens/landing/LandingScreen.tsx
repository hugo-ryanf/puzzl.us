import { CATALOG, type CommunityPuzzle } from '@puzzle/shared';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import bannerDarkUrl from '../../assets/landing-camaleao-escuro.webp';
import bannerUrl from '../../assets/landing-camaleao.jpg';
import logoUrl from '../../assets/logo.webp';
import { catalogThumbUrl, localizedCatalogImage, puzzleImageUrl } from '../../board/images';
import { locale, setLocale, t, tRich } from '../../i18n';
import {
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GlobeIcon,
  MoonIcon,
  SunIcon,
} from '../../ui/icons';
import { useTheme } from '../../ui/theme';
import type { PuzzleChoice } from '../explore/CreateRoomDialog';
import {
  CommunitySection,
  FaqSection,
  FinalCta,
  HowSection,
  ModesSection,
  ProfileSection,
  TogetherSection,
  type StartPlaying,
} from './LandingSections';
import { DARK_ART, LIGHT_ART, type BannerArt, type Mover } from './landingArt';

/**
 * As fotos da galeria: só as horizontais do catálogo (3:2 ou mais largas), que preenchem o quadro
 * sem margem; cada uma abre o "Criar sala" com ela.
 */
const GALLERY: PuzzleChoice[] = CATALOG.filter((image) => image.width / image.height >= 1.45)
  .slice(0, 10)
  .map((image) => {
    const local = localizedCatalogImage(image);
    return {
      imageId: image.id,
      title: local.title,
      subtitle: local.credit || t('Foto do catálogo'),
      thumbUrl: catalogThumbUrl(image.id),
    };
  });

export interface LandingScreenProps {
  /** Entra no app: com uma foto (e um modo), o "Criar sala" dela; sem, o "Criar sala" livre. */
  onStart: StartPlaying;
  /** Fotos publicadas pelos jogadores (a seção da comunidade). */
  community: CommunityPuzzle[];
  /** A tela de Ranking do app (pódio, filtros e lista), mostrada como uma seção. */
  ranking: ReactNode;
  /** Login com Google disponível neste servidor. */
  googleLogin: boolean;
}

/**
 * Página de quem chega sem login: o banner do camaleão com peças sendo montadas (com a marca, o
 * tema e o idioma por cima), os modos, o multiplayer, a galeria, a comunidade, o
 * ranking, o perfil, como funciona, perguntas e o convite final. O tema claro (verde) e o escuro
 * (azul) trocam pelo CSS, junto com o resto do site.
 */
export function LandingScreen({ onStart, ranking, googleLogin, community }: LandingScreenProps) {
  return (
    <div className="landing">
      <section className="lp-hero" aria-label={t('Apresentação')}>
        <div className="lp-hero-art">
          <Banner art={LIGHT_ART} image={bannerUrl} variant="light" />
          <Banner art={DARK_ART} image={bannerDarkUrl} variant="dark" />
        </div>
        {/* a marca, o tema, o idioma e o login ficam soltos sobre o banner */}
        <header className="lp-topbar">
          <a className="lp-brand" href="/">
            <img src={logoUrl} alt="" width={38} height={38} />
            <span className="lp-wordmark">
              puzzl<span>.us</span>
            </span>
          </a>
          <LandingSettings />
          {/* no `pnpm dev` aparece sempre (o servidor local costuma não ter o Google configurado) */}
          {(googleLogin || import.meta.env.DEV) && (
            <a className="lp-login" href="/auth/google">
              <GoogleMark />
              <span className="lp-login-long">{t('Entrar com Google')}</span>
              {/* no celular, curto: o "G" já diz que é o Google */}
              <span className="lp-login-short" aria-hidden="true">
                {t('Entrar')}
              </span>
            </a>
          )}
        </header>
        <div className="lp-hero-copy">
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

      <ModesSection onStart={onStart} />
      <TogetherSection onStart={onStart} />
      <Gallery onPlay={(choice) => onStart(choice)} />
      <CommunitySection puzzles={community} onStart={onStart} />
      <section id="ranking" className="lp-ranking-section">
        <div className="lp-container">{ranking}</div>
      </section>
      <ProfileSection googleLogin={googleLogin} />
      <HowSection />
      <FaqSection />
      <FinalCta onStart={onStart} />

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

/** O "G" colorido do Google, como pede o guia de marca do botão de login. */
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

const LIGHT_IMAGE: CSSProperties = { mixBlendMode: 'multiply' };
const DARK_IMAGE: CSSProperties = { filter: 'drop-shadow(0 0 40px rgba(80, 130, 255, 0.35))' };

/**
 * Tema e idioma, só os ícones sobre o banner: o mesmo tema e o mesmo idioma da barra lateral do
 * app (guardados neste navegador). O ícone mostra para onde vai: lua no claro, sol no escuro.
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
        className="lp-bare"
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
        className="lp-bare"
        lang={other}
        aria-label={other === 'en' ? 'English' : 'Português'}
        title={other === 'en' ? 'English' : 'Português'}
        onClick={() => setLocale(other)}
      >
        <GlobeIcon size={18} />
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
      // ancorado na base: as peças de baixo ficam sempre rentes à borda do banner
      preserveAspectRatio="xMidYMax slice"
    >
      <defs>
        <clipPath id={`lp-clip-${variant}`}>
          <rect x="0" y="0" width="1440" height="600" />
        </clipPath>
        {variant === 'dark' && (
          <linearGradient id="lp-fade-dark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.72" stopColor="#0B1024" stopOpacity="0" />
            <stop offset="1" stopColor="#0B1024" stopOpacity="0.85" />
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
      {/* as peças primeiro e os cursores depois, por cima de todas: um nome nunca fica
          embaixo de outra peça. Cada cursor segura a sua peça pelo centro e faz o mesmo
          deslocamento, sem girar (como uma mão arrastando) */}
      {art.movers.map((m) => (
        <g key={m.id} className="lp-lift" style={liftStyle(m)}>
          <g clipPath={`url(#${m.id})`}>
            <use href={`#${artId}`} />
          </g>
          <path d={m.path} fill="none" stroke="#FFFFFF" strokeWidth="2" />
        </g>
      ))}
      {art.movers.map((m) => (
        <g key={m.id} className="lp-follow" style={liftStyle(m)}>
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

/** O movimento de uma peça (e do seu cursor): sai do lugar, gira em volta do centro e volta. */
function liftStyle(m: Mover): CSSProperties {
  return {
    '--dx': `${m.dx}px`,
    '--dy': `${m.dy}px`,
    '--r': `${m.rotate}deg`,
    transformOrigin: `${m.centerX}px ${m.centerY}px`,
    animationDelay: `${m.delay}s`,
  } as CSSProperties;
}

/** De quanto em quanto tempo o carrossel passa sozinho para a próxima foto. */
const AUTOPLAY_MS = 5000;

/**
 * A galeria: um carrossel circular. A foto atual fica no centro, com metade da anterior e metade
 * da próxima aparecendo dos lados; passa sozinho de tempos em tempos (para com o mouse em cima,
 * com o foco dentro e para quem pede menos movimento) e dá a volta sem pulo: nas pontas há uma
 * cópia da primeira e da última, e ao chegar nela o trilho volta, sem animação, para a original.
 */
function Gallery({ onPlay }: { onPlay: (choice: PuzzleChoice) => void }) {
  const count = GALLERY.length;
  // posição no trilho [última, ...fotos, primeira]: a foto i fica na posição i + 1
  const [position, setPosition] = useState(1);
  const [instant, setInstant] = useState(false);
  const [paused, setPaused] = useState(false);
  const track = [GALLERY[count - 1]!, ...GALLERY, GALLERY[0]!];
  const active = (position - 1 + count) % count;

  // sem animação (menos movimento) não há fim de transição: dá a volta direto na foto certa
  const step = (delta: 1 | -1) =>
    setPosition((current) =>
      reducedMotion()
        ? ((current - 1 + delta + count) % count) + 1
        : Math.min(count + 1, Math.max(0, current + delta)),
    );

  // chegou numa cópia da ponta: volta para a foto original sem animação
  const settle = () => {
    if (position === count + 1 || position === 0) {
      setInstant(true);
      setPosition(position === 0 ? count : 1);
    }
  };
  // depois do salto, a animação volta a valer (dois quadros: o salto precisa ser desenhado antes)
  useEffect(() => {
    if (!instant) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setInstant(false));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [instant]);

  useEffect(() => {
    if (paused || reducedMotion()) return;
    const timer = setInterval(() => step(1), AUTOPLAY_MS);
    return () => clearInterval(timer);
    // `step` só usa o estado pela função de atualização
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, position]);

  return (
    <section
      id="galeria"
      className="lp-gallery"
      aria-labelledby="lp-gallery-title"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
    >
      <Backdrop variant="light" />
      <Backdrop variant="dark" />
      <div className="lp-container lp-gallery-inner">
        <div className="lp-gallery-head">
          <span className="lp-eyebrow">{t('Galeria')}</span>
          <h2 id="lp-gallery-title">{t('Escolha por onde começar')}</h2>
        </div>
      </div>

      <div className="lp-carousel">
        <div
          className={`lp-carousel-track${instant ? ' is-instant' : ''}`}
          style={{ '--pos': position } as CSSProperties}
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget) settle();
          }}
        >
          {track.map((choice, i) => {
            const isActive = i === position;
            // perto do centro, a foto inteira; longe, a miniatura (carrega menos)
            const src =
              Math.abs(i - position) <= 1 ? puzzleImageUrl(choice.imageId) : choice.thumbUrl;
            return (
              <div
                key={`${i}:${choice.imageId}`}
                className={`lp-cslide${isActive ? ' is-active' : ''}`}
                aria-hidden={!isActive}
                onClick={isActive ? undefined : () => setPosition(i)}
              >
                <Frame
                  still={!isActive}
                  overlay={
                    isActive && (
                      <div className="lp-caption">
                        <p className="lp-caption-text">
                          <b>{choice.title}</b> · {choice.subtitle}
                        </p>
                        <button type="button" className="lp-play" onClick={() => onPlay(choice)}>
                          {t('Jogar')}
                          <ArrowRightIcon size={18} />
                        </button>
                      </div>
                    )
                  }
                >
                  <img className="lp-slide-photo" src={src} alt={isActive ? choice.title : ''} />
                </Frame>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="lp-arrow lp-arrow-prev"
          aria-label={t('Foto anterior')}
          onClick={() => step(-1)}
        >
          <ChevronLeftIcon size={22} />
        </button>
        <button
          type="button"
          className="lp-arrow lp-arrow-next"
          aria-label={t('Próxima foto')}
          onClick={() => step(1)}
        >
          <ChevronRightIcon size={22} />
        </button>
      </div>

      <div className="lp-dots" role="group" aria-label={t('Galeria')}>
        {GALLERY.map((item, i) => (
          <button
            key={item.imageId}
            type="button"
            aria-label={t('Foto {n}', { n: i + 1 })}
            aria-current={i === active ? 'true' : undefined}
            onClick={() => setPosition(i + 1)}
          />
        ))}
      </div>
    </section>
  );
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Moldura de quadro (cantos retos, borda fina, sombra larga). Com o mouse em cima, inclina em
 * perspectiva conforme a posição do cursor e a sombra cresce (só acima de 500 px de largura); ao
 * sair, volta devagar. A foto acompanha a rolagem em até 14 px (parallax), um pouco ampliada para
 * não mostrar borda vazia; `overlay` (a legenda) fica parado por cima dela. Quem pede menos
 * movimento no sistema vê o quadro parado.
 */
function Frame({
  children,
  overlay,
  still = false,
}: {
  children: ReactNode;
  overlay?: ReactNode;
  /** Sem inclinação (as fotos dos lados do carrossel). */
  still?: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = frame.current;
    const photo = layer.current;
    if (!box || !photo || reducedMotion()) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = box.getBoundingClientRect();
      const offset = (r.top + r.height / 2 - innerHeight / 2) / innerHeight;
      const shift = Math.max(-1, Math.min(1, offset)) * 14;
      photo.style.transform = `translateY(${shift.toFixed(2)}px) scale(1.012)`;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    return () => {
      removeEventListener('scroll', schedule);
      removeEventListener('resize', schedule);
      cancelAnimationFrame(raf);
    };
  }, []);

  const tilt = (event: MouseEvent<HTMLDivElement>) => {
    const box = frame.current;
    if (!box || still || box.offsetWidth <= 500 || reducedMotion()) return;
    const r = box.getBoundingClientRect();
    const x = ((event.clientX - r.left) / r.width) * 2 - 1;
    const y = ((event.clientY - r.top) / r.height) * 2 - 1;
    box.classList.add('is-tilted');
    box.style.transform = `perspective(1400px) rotateY(${(x * 2.2).toFixed(2)}deg) rotateX(${(-y * 1.6).toFixed(2)}deg)`;
  };
  const settle = () => {
    const box = frame.current;
    if (!box) return;
    box.classList.remove('is-tilted');
    box.style.transform = '';
  };

  return (
    <div ref={frame} className="lp-frame" onMouseMove={tilt} onMouseLeave={settle}>
      <div ref={layer} className="lp-frame-layer">
        {children}
      </div>
      {overlay}
    </div>
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
