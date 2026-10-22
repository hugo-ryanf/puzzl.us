import { avatarColor, initials } from './avatar';

interface AvatarProps {
  name: string;
  /** Foto (do Google); sem ela, as iniciais. */
  url?: string | null;
  /** Cor das iniciais escolhida no perfil (sem ela, uma cor fixa pelo nome). */
  color?: string | null;
  size: number;
  className?: string;
}

/** Foto ou iniciais num círculo. Decorativo: quem dá o nome é o texto ao lado. */
export function Avatar({ name, url, color, size, className }: AvatarProps) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  const classes = className ? `user-avatar ${className}` : 'user-avatar';
  if (url) {
    // Foto do Google: sem enviar de qual site veio o pedido (o Google bloqueia com referrer).
    return (
      <img
        className={classes}
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        style={style}
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className={classes}
      style={{ ...style, background: color ?? avatarColor(name) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
