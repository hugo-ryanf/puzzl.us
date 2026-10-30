import { t } from '../i18n';
export const DIFFICULTY_NAMES = [t('Fácil'), t('Médio'), t('Difícil'), 'Expert'] as const;

/** Aqui a dificuldade é o número de peças escolhido ao criar a sala (1 = Fácil … 4 = Expert). */
export function difficultyOf(pieces: number): 1 | 2 | 3 | 4 {
  if (pieces <= 48) return 1;
  if (pieces <= 100) return 2;
  if (pieces <= 500) return 3;
  return 4;
}

/** As quatro barrinhas crescentes do modelo; as `level` primeiras ficam acesas. */
export function Pips({ level }: { level: number }) {
  return (
    <span className="pips" aria-hidden="true">
      {[6, 9, 12, 15].map((height, i) => (
        <span key={height} className={i < level ? 'on' : ''} style={{ height }} />
      ))}
    </span>
  );
}
