import { describe, expect, it } from 'vitest';
import { PuzzleEngine } from './engine';
import { generatePuzzle } from './puzzle';

// Grade 1×3 com peças de 100×100: peças 0-1-2 em linha; 0 e 2 não são vizinhas.
const puzzle = generatePuzzle({ seed: 'motor', rows: 1, cols: 3, width: 300, height: 100 });
const farApart = () =>
  new PuzzleEngine(puzzle, [
    { x: 0, y: 500 },
    { x: 1000, y: 0 },
    { x: 2000, y: 0 },
  ]);

describe('PuzzleEngine', () => {
  it('começa com uma peça por grupo', () => {
    expect(farApart().groupCount).toBe(3);
  });

  it('encaixa quando a vizinha está perto da posição certa', () => {
    const engine = farApart();
    // Deslocamento do grupo 0 é (0, 500); soltamos a peça 1 a 10 unidades disso.
    engine.moveGroup(1, 10, 495);
    const result = engine.dropGroup(1);

    expect(result.absorbedGroupIds).toEqual([0]);
    expect(engine.groupCount).toBe(2);
    // O grupo solto "pula" para o alinhamento exato.
    expect(engine.piecePosition(1)).toEqual({ x: 100, y: 500 });
    expect(engine.groupOf(0).id).toBe(1);
  });

  it('não encaixa quando está longe demais', () => {
    const engine = farApart();
    engine.moveGroup(1, 0, 500 + engine.snapDistance + 1);
    expect(engine.dropGroup(1).absorbedGroupIds).toEqual([]);
    expect(engine.groupCount).toBe(3);
  });

  it('não encaixa peças que não são vizinhas', () => {
    const engine = farApart();
    engine.moveGroup(2, 0, 500);
    expect(engine.dropGroup(2).absorbedGroupIds).toEqual([]);
  });

  it('um encaixe pode puxar outro em cadeia', () => {
    const engine = farApart();
    engine.moveGroup(2, 0, 500); // 2 alinhada com 0, mas sem tocar nela
    engine.moveGroup(1, 5, 505);
    const result = engine.dropGroup(1);

    expect(result.absorbedGroupIds.sort()).toEqual([0, 2]);
    expect(result.completed).toBe(true);
  });

  it('não absorve grupos vetados por canAbsorb', () => {
    const engine = farApart();
    engine.moveGroup(1, 0, 500);
    expect(engine.dropGroup(1, (other) => other.id !== 0).absorbedGroupIds).toEqual([]);
    expect(engine.groupCount).toBe(3);
  });

  it('espalha as peças de forma reproduzível', () => {
    const a = PuzzleEngine.scattered(puzzle);
    const b = PuzzleEngine.scattered(puzzle);
    expect([0, 1, 2].map((id) => a.piecePosition(id))).toEqual(
      [0, 1, 2].map((id) => b.piecePosition(id)),
    );
  });
});
