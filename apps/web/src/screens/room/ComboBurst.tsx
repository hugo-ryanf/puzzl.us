import { useEffect, useRef, useState } from 'react';

/** Quanto tempo o "Combo x3" fica na tela. */
const SHOW_MS = 900;

/** "Combo x2, x3…" no topo da minha mesa a cada encaixe seguido (o combo vem do servidor). */
export function ComboBurst({ combo }: { combo: number }) {
  const [shown, setShown] = useState(0);
  const previous = useRef(combo);

  useEffect(() => {
    const before = previous.current;
    previous.current = combo;
    if (combo < 2 || combo <= before) return;
    setShown(combo);
    const timer = setTimeout(() => setShown(0), SHOW_MS);
    return () => clearTimeout(timer);
  }, [combo]);

  if (shown === 0) return null;
  return (
    // key: cada nível novo refaz a animação.
    <div key={shown} className={shown >= 5 ? 'combo-burst big' : 'combo-burst'} aria-hidden="true">
      Combo <strong>x{shown}</strong>
    </div>
  );
}
