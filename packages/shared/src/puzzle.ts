import { createRandom, uniform, type Random } from './random';

export interface Point {
  x: number;
  y: number;
}

/** Curva cúbica de Bézier que sai do ponto atual, puxada por c1 e c2, e termina em `to`. */
export interface CubicSegment {
  c1: Point;
  c2: Point;
  to: Point;
}

/** Um trecho de contorno: ponto inicial + curvas encadeadas. */
export interface EdgePath {
  from: Point;
  segments: CubicSegment[];
}

/** Parâmetros sorteados de um encaixe (formato inspirado no gerador clássico de Draradech). */
export interface TabShape {
  /** Para que lado o "dente" aponta. */
  flip: 1 | -1;
  /** Pequenas variações para nenhuma peça ficar igual à outra. */
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
}

export interface PieceDef {
  id: number;
  row: number;
  col: number;
  /** Canto superior esquerdo da peça na posição correta (coordenadas da imagem). */
  x: number;
  y: number;
}

export interface Puzzle {
  seed: string;
  rows: number;
  cols: number;
  width: number;
  height: number;
  pieceWidth: number;
  pieceHeight: number;
  pieces: PieceDef[];
  /** horizontalTabs[r][c]: borda de baixo da peça (r, c); r vai de 0 a rows - 2. */
  horizontalTabs: TabShape[][];
  /** verticalTabs[r][c]: borda direita da peça (r, c); c vai de 0 a cols - 2. */
  verticalTabs: TabShape[][];
}

export interface PuzzleOptions {
  seed: string;
  rows: number;
  cols: number;
  /** Tamanho da imagem; as peças usam as mesmas unidades. */
  width: number;
  height: number;
}

/** Tamanho do encaixe em relação ao lado menor da peça. */
const TAB_SIZE = 0.1;
/** Quanto cada encaixe pode variar em relação ao formato padrão. */
const JITTER = 0.04;

export function generatePuzzle({ seed, rows, cols, width, height }: PuzzleOptions): Puzzle {
  if (rows < 1 || cols < 1 || !Number.isInteger(rows) || !Number.isInteger(cols)) {
    throw new RangeError(`grade inválida: ${rows}×${cols}`);
  }

  const random = createRandom(seed);
  const pieceWidth = width / cols;
  const pieceHeight = height / rows;

  const pieces: PieceDef[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      pieces.push({ id: row * cols + col, row, col, x: col * pieceWidth, y: row * pieceHeight });
    }
  }

  const horizontalTabs = grid(rows - 1, cols, () => randomTab(random));
  const verticalTabs = grid(rows, cols - 1, () => randomTab(random));

  return {
    seed,
    rows,
    cols,
    width,
    height,
    pieceWidth,
    pieceHeight,
    pieces,
    horizontalTabs,
    verticalTabs,
  };
}

/** Ids das peças que encostam em `pieceId` (cima, direita, baixo, esquerda). */
export function neighborsOf(puzzle: Puzzle, pieceId: number): number[] {
  const row = Math.floor(pieceId / puzzle.cols);
  const col = pieceId % puzzle.cols;
  const neighbors: number[] = [];
  if (row > 0) neighbors.push(pieceId - puzzle.cols);
  if (col < puzzle.cols - 1) neighbors.push(pieceId + 1);
  if (row < puzzle.rows - 1) neighbors.push(pieceId + puzzle.cols);
  if (col > 0) neighbors.push(pieceId - 1);
  return neighbors;
}

/** As 4 bordas da peça em coordenadas da imagem, em sentido horário. */
export function pieceEdges(puzzle: Puzzle, piece: PieceDef) {
  const { row, col } = piece;
  const tabDepth = Math.min(puzzle.pieceWidth, puzzle.pieceHeight);
  const topLeft = { x: piece.x, y: piece.y };
  const topRight = { x: piece.x + puzzle.pieceWidth, y: piece.y };
  const bottomRight = { x: topRight.x, y: piece.y + puzzle.pieceHeight };
  const bottomLeft = { x: piece.x, y: bottomRight.y };

  // Bordas internas são calculadas sempre no sentido "canônico" (esquerda→direita,
  // cima→baixo); quem percorre ao contrário inverte a mesma curva. Assim os encaixes casam.
  const topTab = puzzle.horizontalTabs[row - 1]?.[col];
  const rightTab = puzzle.verticalTabs[row]?.[col];
  const bottomTab = puzzle.horizontalTabs[row]?.[col];
  const leftTab = puzzle.verticalTabs[row]?.[col - 1];

  return {
    top: edgePath(topLeft, topRight, topTab, tabDepth),
    right: edgePath(topRight, bottomRight, rightTab, tabDepth),
    bottom: reverseEdge(edgePath(bottomLeft, bottomRight, bottomTab, tabDepth)),
    left: reverseEdge(edgePath(topLeft, bottomLeft, leftTab, tabDepth)),
  };
}

/** Contorno fechado da peça em coordenadas locais (canto superior esquerdo da peça = 0,0). */
export function piecePath(puzzle: Puzzle, piece: PieceDef): EdgePath {
  const { top, right, bottom, left } = pieceEdges(puzzle, piece);
  const toLocal = (p: Point): Point => ({ x: p.x - piece.x, y: p.y - piece.y });
  const segments = [top, right, bottom, left].flatMap((edge) =>
    edge.segments.map((s) => ({ c1: toLocal(s.c1), c2: toLocal(s.c2), to: toLocal(s.to) })),
  );
  return { from: toLocal(top.from), segments };
}

export function reverseEdge(edge: EdgePath): EdgePath {
  const points = [edge.from, ...edge.segments.map((s) => s.to)];
  const segments = edge.segments.map((s, i) => ({ c1: s.c2, c2: s.c1, to: points[i]! })).reverse();
  return { from: points[points.length - 1]!, segments };
}

function edgePath(from: Point, to: Point, tab: TabShape | undefined, tabDepth: number): EdgePath {
  // Borda do quebra-cabeça: linha reta (uma cúbica com controles sobre a própria linha).
  if (!tab) return { from, segments: [{ c1: from, c2: to, to }] };

  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  // Normal perpendicular à borda; o flip decide se o dente vai para um lado ou para o outro.
  const nx = -uy * tab.flip;
  const ny = ux * tab.flip;

  const { a, b, c, d, e } = tab;
  const t = TAB_SIZE * tabDepth;
  const mid = (0.5 + b) * length;
  const at = (along: number, across: number): Point => ({
    x: from.x + ux * along + nx * across,
    y: from.y + uy * along + ny * across,
  });

  return {
    from,
    segments: [
      // ombro → base do pescoço
      {
        c1: at(0.2 * length, a * tabDepth),
        c2: at((0.5 + b + d) * length, -t + c * tabDepth),
        to: at(mid - t, t + c * tabDepth),
      },
      // cabeça arredondada do encaixe
      {
        c1: at(mid - 2 * t - d * length, 3 * t + c * tabDepth),
        c2: at(mid + 2 * t - d * length, 3 * t + c * tabDepth),
        to: at(mid + t, t + c * tabDepth),
      },
      // pescoço → ombro → fim da borda
      {
        c1: at((0.5 + b + d) * length, -t + c * tabDepth),
        c2: at(0.8 * length, e * tabDepth),
        to,
      },
    ],
  };
}

function randomTab(random: Random): TabShape {
  return {
    flip: random() < 0.5 ? 1 : -1,
    a: uniform(random, -JITTER, JITTER),
    b: uniform(random, -JITTER, JITTER),
    c: uniform(random, -JITTER, JITTER),
    d: uniform(random, -JITTER, JITTER),
    e: uniform(random, -JITTER, JITTER),
  };
}

function grid<T>(rows: number, cols: number, make: () => T): T[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, make));
}
