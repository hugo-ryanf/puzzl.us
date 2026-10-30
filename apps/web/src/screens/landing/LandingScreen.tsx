import { CATALOG } from '@puzzle/shared';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import bannerDarkUrl from '../../assets/landing-camaleao-escuro.webp';
import bannerUrl from '../../assets/landing-camaleao.webp';
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
  /** A tela de Ranking do app (pódio, filtros e lista), mostrada como uma seção. */
  ranking: ReactNode;
  /** Login com Google disponível neste servidor. */
  googleLogin: boolean;
}

/**
 * Página de quem chega sem login: o banner do camaleão com peças sendo montadas (com a marca, o
 * tema e o idioma por cima), a galeria, o ranking e o rodapé. O tema claro (verde) e o escuro
 * (neon) trocam pelo CSS, junto com o resto do site.
 */
export function LandingScreen({ onStart, ranking, googleLogin }: LandingScreenProps) {
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
          {googleLogin && (
            <a className="lp-bare lp-login" href="/auth/google">
              {t('Entrar com Google')}
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

      <Gallery onPlay={onStart} />
      <section id="ranking" className="lp-ranking-section">
        <div className="lp-container">{ranking}</div>
      </section>

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
      {art.movers.map((m) => (
        <g
          key={m.id}
          className="lp-lift"
          style={
            {
              '--dx': `${m.dx}px`,
              '--dy': `${m.dy}px`,
              '--r': `${m.rotate}deg`,
              transformOrigin: `${m.centerX}px ${m.centerY}px`,
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

/**
 * A galeria: uma foto por vez, quase do tamanho da tela, num quadro. As setas (e as bolinhas)
 * trocam a foto com um "slide": a nova entra pelo lado, como arrastada, e cobre a anterior.
 */
function Gallery({ onPlay }: { onPlay: (choice: PuzzleChoice) => void }) {
  const [index, setIndex] = useState(0);
  // a foto que está saindo (fica por baixo até a nova terminar de entrar) e de que lado vem a nova
  const [leaving, setLeaving] = useState<number | null>(null);
  const [direction, setDirection] = useState<1 | -1>(1);
  const count = GALLERY.length;
  const choice = GALLERY[index]!;

  const show = (next: number, step: 1 | -1) => {
    if (next === index) return;
    setDirection(step);
    setLeaving(reducedMotion() ? null : index);
    setIndex(next);
  };
  const go = (step: 1 | -1) => show((index + step + count) % count, step);

  // a próxima foto já vem carregando, para a troca não piscar
  useEffect(() => {
    const next = new Image();
    next.src = puzzleImageUrl(GALLERY[(index + 1) % count]!.imageId);
  }, [index, count]);

  const side = direction > 0 ? 'from-right' : 'from-left';
  return (
    <section id="galeria" className="lp-gallery" aria-labelledby="lp-gallery-title">
      <Backdrop variant="light" />
      <Backdrop variant="dark" />
      <div className="lp-container lp-gallery-inner">
        <div className="lp-gallery-head">
          <span className="lp-eyebrow">{t('Galeria')}</span>
          <h2 id="lp-gallery-title">{t('Escolha por onde começar')}</h2>
        </div>

        {/* o quadro no centro; as setas do lado de fora, na altura do meio dele */}
        <div className="lp-stage">
          <Frame
            overlay={
              <div className="lp-caption">
                <div className="lp-dots" role="group" aria-label={t('Galeria')}>
                  {GALLERY.map((item, i) => (
                    <button
                      key={item.imageId}
                      type="button"
                      aria-label={t('Foto {n}', { n: i + 1 })}
                      aria-current={i === index ? 'true' : undefined}
                      onClick={() => show(i, i > index ? 1 : -1)}
                    />
                  ))}
                </div>
                <p className="lp-caption-text" aria-live="polite">
                  <b>{choice.title}</b> · {choice.subtitle}
                </p>
                <button type="button" className="lp-play" onClick={() => onPlay(choice)}>
                  {t('Jogar')}
                  <ArrowRightIcon size={18} />
                </button>
              </div>
            }
          >
            {leaving !== null && (
              <Slide
                key={GALLERY[leaving]!.imageId}
                choice={GALLERY[leaving]!}
                className={`is-leaving ${side}`}
              />
            )}
            <Slide
              key={choice.imageId}
              choice={choice}
              className={leaving !== null ? `is-entering ${side}` : ''}
              onEntered={() => setLeaving(null)}
            />
          </Frame>
          <button
            type="button"
            className="lp-arrow lp-arrow-prev"
            aria-label={t('Foto anterior')}
            onClick={() => go(-1)}
          >
            <ChevronLeftIcon size={22} />
          </button>
          <button
            type="button"
            className="lp-arrow lp-arrow-next"
            aria-label={t('Próxima foto')}
            onClick={() => go(1)}
          >
            <ChevronRightIcon size={22} />
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * Uma foto do quadro: inteira (sem corte), sobre uma cópia dela desfocada que preenche as sobras.
 * Ao entrar, avisa quando o slide termina (a anterior pode sair de baixo).
 */
function Slide({
  choice,
  className,
  onEntered,
}: {
  choice: PuzzleChoice;
  className: string;
  onEntered?: () => void;
}) {
  const url = puzzleImageUrl(choice.imageId);
  return (
    <div
      className={`lp-slide ${className}`}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) onEntered?.();
      }}
    >
      <img className="lp-slide-fill" src={url} alt="" aria-hidden="true" />
      <img className="lp-slide-photo" src={url} alt={choice.title} />
    </div>
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
function Frame({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
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
    if (!box || box.offsetWidth <= 500 || reducedMotion()) return;
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
