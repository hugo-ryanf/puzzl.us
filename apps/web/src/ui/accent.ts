/**
 * Cores de destaque (as cores dos camaleões). Petróleo é o teal de sempre; as outras trocam só
 * `--accent` e os tons dele (data-accent no <html>; as cores claras e escuras ficam no styles.css).
 * Escolhida em "Editar perfil" e guardada neste navegador.
 */
export const ACCENTS = [
  { value: 'petroleo', label: 'Petróleo', swatch: '#3a9aad' },
  { value: 'gelo', label: 'Gelo', swatch: '#4a93bd' },
  { value: 'verde', label: 'Verde', swatch: '#3f9a46' },
  { value: 'ouro', label: 'Ouro', swatch: '#c4930a' },
  { value: 'ambar', label: 'Âmbar', swatch: '#d9741c' },
  { value: 'vermelho', label: 'Vermelho', swatch: '#d33f3f' },
  { value: 'rosa', label: 'Rosa', swatch: '#c94f7c' },
  { value: 'roxo', label: 'Roxo', swatch: '#8350c8' },
] as const;
export type AccentChoice = (typeof ACCENTS)[number]['value'];

const DEFAULT: AccentChoice = 'petroleo';
/** Mesma chave do script do index.html, que aplica a cor antes de o React desenhar. */
const KEY = 'quebra-cabeca:destaque';

/** A cor guardada neste navegador (sem nada guardado: Petróleo). */
export function loadAccent(): AccentChoice {
  try {
    const saved = localStorage.getItem(KEY);
    return ACCENTS.find((accent) => accent.value === saved)?.value ?? DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/** Pinta o site com a cor, sem guardar (a prévia enquanto escolhe). */
export function applyAccent(choice: AccentChoice) {
  const root = document.documentElement;
  if (choice === DEFAULT) delete root.dataset.accent;
  else root.dataset.accent = choice;
}

/** Pinta e guarda neste navegador. */
export function saveAccent(choice: AccentChoice) {
  applyAccent(choice);
  try {
    if (choice === DEFAULT) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // sem storage: vale só nesta aba
  }
}
