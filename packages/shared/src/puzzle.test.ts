import { describe, expect, it } from 'vitest';
import { generatePuzzle, neighborsOf, pieceEdges, piecePath, reverseEdge } from './puzzle';

const options = { seed: 'teste', rows: 3, cols: 4, width: 400, height: 300 };

describe('generatePuzzle', () => {
  it('é determinístico para o mesmo seed', () => {
    expect(generatePuzzle(options)).toEqual(generatePuzzle(options));
  });

  it('muda os encaixes quando o seed muda', () => {
    const other = generatePuzzle({ ...options, seed: 'outro' });
    expect(other.horizontalTabs).not.toEqual(generatePuzzle(options).horizontalTabs);
  });

  it('posiciona as peças numa grade linha a linha', () => {
    const puzzle = generatePuzzle(options);
    expect(puzzle.pieces).toHaveLength(12);
    expect(puzzle.pieces[5]).toEqual({ id: 5, row: 1, col: 1, x: 100, y: 100 });
  });
});

describe('neighborsOf', () => {
  const puzzle = generatePuzzle(options);

  it('canto tem 2 vizinhos', () => {
    expect(neighborsOf(puzzle, 0).sort()).toEqual([1, 4]);
  });

  it('peça do meio tem 4 vizinhos', () => {
    expect(neighborsOf(puzzle, 5).sort((a, b) => a - b)).toEqual([1, 4, 6, 9]);
  });
});

describe('pieceEdges', () => {
  const puzzle = generatePuzzle(options);
  const edges = (id: number) => pieceEdges(puzzle, puzzle.pieces[id]!);

  it('bordas externas são retas e internas têm encaixe', () => {
    const corner = edges(0);
    expect(corner.top.segments).toHaveLength(1);
    expect(corner.left.segments).toHaveLength(1);
    expect(corner.right.segments).toHaveLength(3);
    expect(corner.bottom.segments).toHaveLength(3);
  });

  it('a borda direita de uma peça é a esquerda da vizinha percorrida ao contrário', () => {
    expect(reverseEdge(edges(6).left)).toEqual(edges(5).right);
  });

  it('a borda de baixo de uma peça é a de cima da vizinha percorrida ao contrário', () => {
    expect(reverseEdge(edges(5).bottom)).toEqual(edges(9).top);
  });
});

describe('piecePath', () => {
  it('é um contorno fechado em coordenadas locais', () => {
    const puzzle = generatePuzzle(options);
    for (const piece of puzzle.pieces) {
      const path = piecePath(puzzle, piece);
      expect(path.from).toEqual({ x: 0, y: 0 });
      expect(path.segments.at(-1)!.to).toEqual({ x: 0, y: 0 });
    }
  });
});
