import { findCatalogImage, uploadIdOf } from '@puzzle/shared';

/** Imagens do catálogo ficam em public/catalog (geradas por `pnpm catalog`). */
export const catalogThumbUrl = (id: string) => `/catalog/${id}-mini.webp`;

/** Endereço da foto do puzzle: do catálogo (front) ou enviada (servidor do jogo). */
export function puzzleImageUrl(imageId: string): string {
  const uploadId = uploadIdOf(imageId);
  return uploadId ? `/api/uploads/${uploadId}` : `/catalog/${imageId}.webp`;
}

/** Título para mostrar na sala; fotos enviadas não têm título nem crédito. */
export function puzzleImageInfo(imageId: string): { title: string; credit: string } | undefined {
  if (uploadIdOf(imageId)) return { title: 'Foto enviada', credit: '' };
  return findCatalogImage(imageId);
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
