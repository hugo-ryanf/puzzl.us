import { describe, expect, it } from 'vitest';
import { levelOf, levelStart } from './protocol';

describe('levelOf', () => {
  it('começa no nível 1 e sobe exatamente no começo de cada nível', () => {
    expect(levelOf(0)).toBe(1);
    expect(levelOf(49)).toBe(1);
    expect(levelOf(50)).toBe(2);
    expect(levelOf(199)).toBe(2);
    expect(levelOf(200)).toBe(3);
    expect(levelOf(4050)).toBe(10);
  });

  it('é o inverso de levelStart em toda a faixa', () => {
    for (let level = 1; level <= 200; level++) {
      expect(levelOf(levelStart(level))).toBe(level);
      expect(levelOf(levelStart(level + 1) - 1)).toBe(level);
    }
  });

  it('pontos negativos não descem do nível 1', () => {
    expect(levelOf(-10)).toBe(1);
  });
});
