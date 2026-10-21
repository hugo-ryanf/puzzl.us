/** Cor do avatar sem foto: fixa por pessoa (pela soma das letras do nome). */
const AVATAR_COLORS = ['#2B59FF', '#0B7A5E', '#B4235A', '#8A5A00', '#6B3FA0', '#2C5866'];

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
