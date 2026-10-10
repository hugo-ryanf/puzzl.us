import { describe, expect, it } from 'vitest';
import { PIECE_COUNT_PRESETS, gridForPieceCount } from './grid';

describe('gridForPieceCount', () => {
  it('gera grade quadrada para imagem quadrada', () => {
    expect(gridForPieceCount(100, 1)).toEqual({ rows: 10, cols: 10 });
  });

  it('respeita a proporção de uma foto 3:2', () => {
    expect(gridForPieceCount(24, 3 / 2)).toEqual({ rows: 4, cols: 6 });
  });

  it.each(PIECE_COUNT_PRESETS)('fica a menos de 10%% do alvo para %i peças em 16:9', (target) => {
    const { rows, cols } = gridForPieceCount(target, 16 / 9);
    expect(Math.abs(rows * cols - target) / target).toBeLessThan(0.1);
  });

  it('rejeita entradas inválidas', () => {
    expect(() => gridForPieceCount(2, 1)).toThrow(RangeError);
    expect(() => gridForPieceCount(100, 0)).toThrow(RangeError);
  });
});
