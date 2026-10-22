import { useEffect, useState } from 'react';

/** "system" segue o aparelho; "light"/"dark" ficam fixos. */
export type ThemeChoice = 'system' | 'light' | 'dark';

/** Mesma chave do script do index.html, que aplica o tema antes de o React desenhar. */
const KEY = 'quebra-cabeca:tema';

function load(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

/** Tema escolhido (guardado neste navegador) e como trocá-lo. */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(load);

  useEffect(() => {
    const root = document.documentElement;
    if (choice === 'system') delete root.dataset.theme;
    else root.dataset.theme = choice;
    try {
      if (choice === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch {
      // sem storage: vale só nesta aba
    }
  }, [choice]);

  return [choice, setChoice];
}
