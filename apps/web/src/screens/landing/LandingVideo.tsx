import { useEffect, useRef, useState } from 'react';
import { locale, t } from '../../i18n';

/** Os vídeos da landing (feitos pelo `video/lancamento/render_clips.py`), no idioma da página. */
const videoBase = (name: string) => `/landing/${locale === 'en' ? 'en' : 'pt'}/${name}`;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Um trecho do vídeo de lançamento: mudo, em laço, tocando só enquanto aparece na tela. Quem pede
 * menos movimento no sistema vê o pôster e toca quando quiser.
 */
export function LandingVideo({
  name,
  label,
}: {
  name: string;
  /** O que o vídeo mostra (para leitores de tela). */
  label: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [still] = useState(reducedMotion);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video || still) return;
    const watcher = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.35 },
    );
    watcher.observe(video);
    return () => watcher.disconnect();
  }, [still]);

  const start = () => {
    setStarted(true);
    void ref.current?.play().catch(() => {});
  };

  return (
    <div className="lp-video">
      <video
        ref={ref}
        src={`${videoBase(name)}.mp4`}
        poster={`${videoBase(name)}.jpg`}
        aria-label={label}
        muted
        playsInline
        loop
        preload="none"
      />
      {still && !started && (
        <button type="button" className="lp-video-play" onClick={start}>
          {t('Ver o vídeo')}
        </button>
      )}
    </div>
  );
}
