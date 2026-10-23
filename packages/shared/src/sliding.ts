import type { Random } from './random';

/**
 * Relâmpago de deslizar (8-puzzle): a foto numa grade 3×3 com uma casa vazia; desliza-se uma
 * peça vizinha para o vazio até a foto ficar certa. `tiles[posição] = peça`; a peça
 * EMPTY_TILE (a última) é o vazio, e a grade está resolvida quando tiles[i] === i.
 */
export const SLIDE_SIZE = 3;
export const SLIDE_TILES = SLIDE_SIZE * SLIDE_SIZE;
export const EMPTY_TILE = SLIDE_TILES - 1;

export const solvedTiles = (): number[] => Array.from({ length: SLIDE_TILES }, (_, i) => i);

export const isSolved = (tiles: readonly number[]): boolean =>
  tiles.every((tile, position) => tile === position);

/** Casas vizinhas (em cima, embaixo, dos lados) de uma posição. */
export function slideNeighbors(position: number): number[] {
  const row = Math.floor(position / SLIDE_SIZE);
  const col = position % SLIDE_SIZE;
  const neighbors: number[] = [];
  if (row > 0) neighbors.push(position - SLIDE_SIZE);
  if (row < SLIDE_SIZE - 1) neighbors.push(position + SLIDE_SIZE);
  if (col > 0) neighbors.push(position - 1);
  if (col < SLIDE_SIZE - 1) neighbors.push(position + 1);
  return neighbors;
}

/** A peça na posição `index` encosta no vazio (e pode deslizar para ele). */
export function canSlide(tiles: readonly number[], index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= SLIDE_TILES) return false;
  return slideNeighbors(tiles.indexOf(EMPTY_TILE)).includes(index);
}

/** A grade depois de deslizar a peça de `index` para o vazio (sem conferir; use canSlide). */
export function slide(tiles: readonly number[], index: number): number[] {
  const next = [...tiles];
  const empty = next.indexOf(EMPTY_TILE);
  [next[empty], next[index]] = [next[index]!, next[empty]!];
  return next;
}

/**
 * Embaralha fazendo movimentos válidos a partir da grade resolvida (sem desfazer o anterior):
 * assim sempre tem solução. Nunca devolve a grade já resolvida.
 */
export function scrambleTiles(random: Random, moves = 60): number[] {
  let tiles = solvedTiles();
  let previousEmpty = -1;
  for (let i = 0; i < moves || isSolved(tiles); i++) {
    const empty = tiles.indexOf(EMPTY_TILE);
    const options = slideNeighbors(empty).filter((position) => position !== previousEmpty);
    const choice = options[Math.floor(random() * options.length)]!;
    previousEmpty = empty;
    tiles = slide(tiles, choice);
  }
  return tiles;
}
