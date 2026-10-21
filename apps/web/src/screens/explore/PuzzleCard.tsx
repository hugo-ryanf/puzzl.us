import type { CatalogImage } from '@puzzle/shared';
import { catalogThumbUrl } from '../../board/images';
import { TrophyIcon } from '../../ui/icons';

interface PuzzleCardProps {
  image: CatalogImage;
  onPlay: () => void;
  onShowRanking: () => void;
}

export const orientationOf = (image: { width: number; height: number }) =>
  image.width >= image.height ? 'Horizontal' : 'Vertical';

/** No card só cabe o nome: "Foto de Adrian Botica no Unsplash" → "Adrian Botica". */
const shortCredit = (credit: string) => /^Foto de (.+) no \S+$/.exec(credit)?.[1] ?? credit;

/** Card do catálogo: foto + título abrem "Criar sala"; o troféu abre o ranking da foto. */
export function PuzzleCard({ image, onPlay, onShowRanking }: PuzzleCardProps) {
  return (
    <article className="card">
      <button type="button" className="card-hit" onClick={onPlay}>
        <span className="card-thumb">
          <img src={catalogThumbUrl(image.id)} alt="" loading="lazy" />
          <span className="card-badge">{orientationOf(image)}</span>
        </span>
        <h2 className="card-title">{image.title}</h2>
      </button>
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
