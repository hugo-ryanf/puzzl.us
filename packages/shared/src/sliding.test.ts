import { describe, expect, it } from 'vitest';
import { createRandom } from './random';
import {
  EMPTY_TILE,
  SLIDE_TILES,
  canSlide,
  isSolved,
  scrambleTiles,
  slide,
  solvedTiles,
} from './sliding';

/** Paridade das inversões: numa grade de lado ímpar, só as pares têm solução. */
function inversions(tiles: number[]): number {
  const pieces = tiles.filter((tile) => tile !== EMPTY_TILE);
  let count = 0;
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) if (pieces[i]! > pieces[j]!) count++;
  }
  return count;
}

describe('Relâmpago de deslizar', () => {
  it('só desliza peça vizinha do vazio', () => {
    const tiles = solvedTiles(); // vazio no canto de baixo à direita (posição 8)
    expect(canSlide(tiles, 7)).toBe(true);
    expect(canSlide(tiles, 5)).toBe(true);
    expect(canSlide(tiles, 4)).toBe(false); // diagonal
    expect(canSlide(tiles, 8)).toBe(false); // o próprio vazio
    expect(canSlide(tiles, 9)).toBe(false);
    expect(slide(tiles, 7)).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 7]);
  });

  it('embaralhado nunca vem resolvido e sempre tem solução', () => {
    for (let seed = 0; seed < 200; seed++) {
      const tiles = scrambleTiles(createRandom(`teste:${seed}`));
      expect(isSolved(tiles)).toBe(false);
      expect([...tiles].sort((a, b) => a - b)).toEqual(solvedTiles());
      expect(tiles).toHaveLength(SLIDE_TILES);
      expect(inversions(tiles) % 2).toBe(0);
    }
  });
});
