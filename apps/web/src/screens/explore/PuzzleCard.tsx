import type { CatalogImage } from '@puzzle/shared';
import { catalogThumbUrl } from '../../board/images';
import { formatDuration } from '../../format';
import { BookmarkIcon, CheckIcon, TrophyIcon } from '../../ui/icons';

interface PuzzleCardProps {
  image: CatalogImage;
  onPlay: () => void;
  onShowRanking: () => void;
  /** Melhor tempo, se a pessoa já montou esta foto (mostra o selo "Montado"). */
  completedMs?: number;
  favorite?: boolean;
  /** Sem ele (servidor sem login), o marcador de favorito não aparece. */
  onToggleFavorite?: () => void;
}

export const orientationOf = (image: { width: number; height: number }) =>
  image.width >= image.height ? 'Horizontal' : 'Vertical';

/** No card só cabe o nome: "Foto de Adrian Botica no Unsplash" → "Adrian Botica". */
const shortCredit = (credit: string) => /^Foto de (.+) no \S+$/.exec(credit)?.[1] ?? credit;

/**
 * Card do catálogo: foto + título abrem "Criar sala"; o troféu abre o ranking da foto; o
 * marcador favorita; o selo verde avisa que você já montou.
 */
export function PuzzleCard({
  image,
  onPlay,
  onShowRanking,
  completedMs,
  favorite = false,
  onToggleFavorite,
}: PuzzleCardProps) {
  return (
    <article className="card">
      <button type="button" className="card-hit" onClick={onPlay}>
        <span className="card-thumb">
          <img src={catalogThumbUrl(image.id)} alt="" loading="lazy" />
          <span className="card-badges">
            <span className="card-badge">{orientationOf(image)}</span>
            {completedMs !== undefined && (
              <span
                className="card-badge done"
                title={`Você já montou · melhor tempo ${formatDuration(completedMs)}`}
              >
                <CheckIcon size={12} />
                Montado
              </span>
            )}
          </span>
        </span>
        <h2 className="card-title">{image.title}</h2>
      </button>
      {/* Fora do botão do card (botão dentro de botão não vale): fica por cima, no canto. */}
      {onToggleFavorite && (
        <button
          type="button"
          className={favorite ? 'card-favorite on' : 'card-favorite'}
          aria-pressed={favorite}
          aria-label={favorite ? `Tirar ${image.title} dos favoritos` : `Favoritar ${image.title}`}
          title={favorite ? 'Tirar dos favoritos' : 'Favoritar para montar depois'}
          onClick={onToggleFavorite}
        >
          <BookmarkIcon size={17} />
        </button>
      )}
      <div className="card-meta">
        {/* O crédito completo fica no title e aparece inteiro no diálogo e na sala. */}
        <span className="credit" title={image.credit}>
          {image.credit ? shortCredit(image.credit) : 'Foto do catálogo'}
        </span>
        <button
          type="button"
          className="btn"
          onClick={onShowRanking}
          aria-label={`Ranking de ${image.title}`}
        >
          <TrophyIcon size={16} />
          Ranking
        </button>
      </div>
    </article>
  );
}
