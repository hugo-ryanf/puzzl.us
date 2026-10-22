import { AVATAR_COLORS } from '@puzzle/shared';

/** Cor do avatar sem foto nem cor escolhida: fixa por pessoa (pela soma das letras do nome). */
export const avatarColor = (name: string) =>
  AVATAR_COLORS[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];

/** "Hugo Ryan França" → "HR"; "Ana" → "A". */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
