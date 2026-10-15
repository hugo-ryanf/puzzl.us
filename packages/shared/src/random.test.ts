import { describe, expect, it } from 'vitest';
import { createRandom } from './random';

const take = (seed: string, n: number) => Array.from({ length: n }, createRandom(seed));

describe('createRandom', () => {
  it('repete a sequência para o mesmo seed', () => {
    expect(take('sala-1', 5)).toEqual(take('sala-1', 5));
  });

  it('gera sequências diferentes para seeds diferentes', () => {
    expect(take('sala-1', 5)).not.toEqual(take('sala-2', 5));
  });

  it('fica sempre em [0, 1)', () => {
    for (const n of take('limites', 1000)) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});
