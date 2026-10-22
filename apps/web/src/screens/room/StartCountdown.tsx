import { useEffect, useRef, useState } from 'react';

/** Quanto tempo o "Já!" fica na tela depois do 1. */
const GO_MS = 700;

/**
 * "3, 2, 1, Já!" no meio da mesa antes do Bullet e da batalha por tempo. Quem conta é o
 * servidor (`countdown` no estado); aqui só mostra o número da vez e o "Já!" quando chega a 0.
 */
export function StartCountdown({ countdown }: { countdown: number }) {
  const [go, setGo] = useState(false);
  const previous = useRef(countdown);

  useEffect(() => {
    const counting = previous.current > 0;
    previous.current = countdown;
    if (countdown > 0 || !counting) return;
    setGo(true);
    const timer = setTimeout(() => setGo(false), GO_MS);
    return () => clearTimeout(timer);
  }, [countdown]);

  if (countdown === 0 && !go) return null;
  return (
    <div className="start-countdown" role="status" aria-live="assertive">
      {/* key: o número novo refaz a animação de entrada. */}
      <span key={countdown} className={countdown > 0 ? 'start-countdown-number' : 'start-go'}>
        {countdown > 0 ? countdown : 'Já!'}
      </span>
    </div>
  );
}
