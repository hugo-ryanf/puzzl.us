import { describe, expect, it } from 'vitest';
import { PuzzleEngine, rotatePoint } from './engine';
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
    /** Peças 0 e 1 encaixadas num bloco; o resto solto (tudo de pé, para medir fácil). */
    const withBlock = () => {
      const engine = PuzzleEngine.scattered(big);
      for (const group of [...engine.allGroups()]) engine.straighten(group.id);
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

  describe('fromGroups', () => {
    it('remonta grupos, posições e o encaixe continua funcionando', () => {
      const engine = PuzzleEngine.fromGroups(puzzle, [
        { id: 1, x: 10, y: 20, pieceIds: [1, 0] },
        { id: 2, x: 2000, y: 0, pieceIds: [2] },
      ]);
      expect(engine.groupCount).toBe(2);
      expect(engine.groupOf(0).id).toBe(1);
      expect(engine.piecePosition(0)).toEqual({ x: 10, y: 20 });

      engine.moveGroup(2, 12, 18);
      expect(engine.dropGroup(2)).toEqual({ absorbedGroupIds: [1], completed: true });
    });

    it('recusa grupos que deixam peça de fora ou repetem peça', () => {
      expect(() =>
        PuzzleEngine.fromGroups(puzzle, [{ id: 0, x: 0, y: 0, pieceIds: [0, 1] }]),
      ).toThrow(RangeError);
      expect(() =>
        PuzzleEngine.fromGroups(puzzle, [
          { id: 0, x: 0, y: 0, pieceIds: [0, 1] },
          { id: 1, x: 0, y: 0, pieceIds: [1, 2] },
        ]),
      ).toThrow(RangeError);
    });
  });
});

describe('peças girando', () => {
  // Grade 2×2: 0 1 / 2 3. Deslocamento zero = cada peça no lugar certo (se estiver de pé).
  const small = generatePuzzle({ seed: 'girar', rows: 2, cols: 2, width: 200, height: 200 });
  const atHome = () => small.pieces.map(() => ({ x: 0, y: 0 }));

  it('só encaixa com a mesma rotação', () => {
    const engine = new PuzzleEngine(small, atHome(), [0, 1, 0, 0]);
    // As de pé (2, embaixo, e depois a 3) encaixam; a 1 (virada) não, mesmo estando no lugar.
    expect(engine.dropGroup(0).absorbedGroupIds).toEqual([2, 3]);
    expect(engine.groupOf(1).id).toBe(1);

    // Desvirada (3 quartos de volta) e posta no alinhamento do bloco, encaixa.
    for (let i = 0; i < 3; i++) engine.rotateGroup(1);
    expect(engine.getGroup(1).rotation).toBe(0);
    const block = engine.groupOf(0);
    engine.moveGroup(1, block.x, block.y);
    expect(engine.dropGroup(1).absorbedGroupIds).toContain(block.id);
  });

  it('girar mantém o centro do grupo e quatro giros voltam ao começo', () => {
    const engine = new PuzzleEngine(small, atHome());
    engine.moveGroup(3, 40, -10);
    const start = { ...engine.getGroup(3) };
    const center = () => {
      const { x, y } = engine.piecePosition(3);
      const { rotation } = engine.getGroup(3);
      // Centro = canto + metade da peça girada junto.
      const half = rotatePoint({ x: small.pieceWidth / 2, y: small.pieceHeight / 2 }, rotation);
      return { x: x + half.x, y: y + half.y };
    };
    const before = center();
    engine.rotateGroup(3);
    expect(center().x).toBeCloseTo(before.x);
    expect(center().y).toBeCloseTo(before.y);
    for (let i = 0; i < 3; i++) engine.rotateGroup(3);
    expect(engine.getGroup(3).x).toBeCloseTo(start.x);
    expect(engine.getGroup(3).y).toBeCloseTo(start.y);
  });

  it('endireitar deixa o grupo de pé', () => {
    const engine = new PuzzleEngine(small, atHome(), [2, 0, 0, 0]);
    engine.straighten(0);
    expect(engine.getGroup(0).rotation).toBe(0);
  });

  it('o espalhar sorteia rotações; grupos sem rotação (snapshot antigo) ficam de pé', () => {
    const rotations = [...PuzzleEngine.scattered(small).allGroups()].map((g) => g.rotation);
    expect(rotations.every((r) => [0, 1, 2, 3].includes(r))).toBe(true);
    const restored = PuzzleEngine.fromGroups(
      small,
      small.pieces.map((p) => ({ id: p.id, x: 0, y: 0, pieceIds: [p.id] })),
    );
    expect([...restored.allGroups()].every((g) => g.rotation === 0)).toBe(true);
  });
});
