import { describe, expect, it } from 'vitest';
import { PuzzleEngine } from './engine';
import { generatePuzzle } from './puzzle';
import { createRandom } from './random';

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

  describe('scatterLoose', () => {
    // Grade 4×4: dá espaço para ter um bloco montado e várias peças soltas.
    const big = generatePuzzle({ seed: 'espalhar', rows: 4, cols: 4, width: 400, height: 400 });
    /** Peças 0 e 1 encaixadas num bloco; o resto solto. */
    const withBlock = () => {
      const engine = PuzzleEngine.scattered(big);
      engine.moveGroup(1, engine.getGroup(0).x, engine.getGroup(0).y);
      engine.dropGroup(1);
      return engine;
    };

    it('move só as peças soltas e deixa o bloco montado onde está', () => {
      const engine = withBlock();
      const block = { ...engine.groupOf(0) };
      const moved = engine.scatterLoose(createRandom('teste'));

      expect(moved).toHaveLength(14);
      expect(moved).not.toContain(block.id);
      expect(engine.groupOf(0)).toMatchObject({ x: block.x, y: block.y });
    });

    it('não cai em cima de um bloco montado', () => {
      const engine = withBlock();
      engine.scatterLoose(createRandom('teste'));
      // Bloco = peças 0 e 1 lado a lado: duas peças de largura, uma de altura.
      const block = engine.piecePosition(0);
      for (let id = 2; id < big.pieces.length; id++) {
        const { x, y } = engine.piecePosition(id);
        const apart =
          x >= block.x + big.pieceWidth * 2 ||
          block.x >= x + big.pieceWidth ||
          y >= block.y + big.pieceHeight ||
          block.y >= y + big.pieceHeight;
        expect(apart).toBe(true);
      }
    });

    it('poupa as peças vetadas por canMove', () => {
      const engine = withBlock();
      const before = { ...engine.getGroup(5) };
      const moved = engine.scatterLoose(createRandom('teste'), (group) => group.id !== 5);
      expect(moved).not.toContain(5);
      expect(engine.getGroup(5)).toMatchObject({ x: before.x, y: before.y });
    });
  });
});
