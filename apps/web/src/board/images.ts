import { findCatalogImage, uploadIdOf } from '@puzzle/shared';
import { communityPuzzleOf } from '../net/community';

/** Imagens do catálogo ficam em public/catalog (geradas por `pnpm catalog`). */
export const catalogThumbUrl = (id: string) => `/catalog/${id}-mini.webp`;

/** Endereço da foto do puzzle: do catálogo (front) ou enviada (servidor do jogo). */
export function puzzleImageUrl(imageId: string): string {
  const uploadId = uploadIdOf(imageId);
  return uploadId ? `/api/uploads/${uploadId}` : `/catalog/${imageId}.webp`;
}

/** Título e crédito: do catálogo, da comunidade (título e autor) ou "Foto enviada". */
export function puzzleImageInfo(imageId: string): { title: string; credit: string } | undefined {
  const published = communityPuzzleOf(imageId);
  if (published) return { title: published.title, credit: `por ${published.authorName}` };
  if (uploadIdOf(imageId)) return { title: 'Foto enviada', credit: '' };
  return findCatalogImage(imageId);
}

/** Miniatura para listas: do catálogo, a da comunidade, ou a própria foto enviada. */
export function puzzleThumbUrl(imageId: string): string {
  const published = communityPuzzleOf(imageId);
  if (published) return `/api/puzzles/${published.id}/mini`;
  return uploadIdOf(imageId) ? puzzleImageUrl(imageId) : catalogThumbUrl(imageId);
}

/** Baixa e decodifica a foto antes de montar o tabuleiro (a textura precisa dos pixels prontos). */
export async function loadPuzzleImage(imageId: string): Promise<HTMLImageElement> {
  const image = new Image();
  // Foto enviada vem de outra origem (servidor do jogo): sem isso o WebGL recusa a textura.
  image.crossOrigin = 'anonymous';
  image.src = puzzleImageUrl(imageId);
  await image.decode();
  return image;
}
