import { neighborsOf, type PieceDef, type Point, type Puzzle } from './puzzle';
import { createRandom, uniform, type Random } from './random';

/**
 * Peças encaixadas andam juntas. Como dentro de um grupo todas estão na posição relativa
 * correta, o grupo guarda só um deslocamento: posição da peça = posição correta + (x, y).
 */
export interface GroupState {
  id: number;
  x: number;
  y: number;
  pieceIds: number[];
}

export interface DropResult {
  /** Grupos que foram absorvidos pelo grupo solto (vazio se não encaixou em nada). */
  absorbedGroupIds: number[];
  completed: boolean;
}

/** Distância máxima (relativa ao lado menor da peça) para o encaixe "puxar" a peça. */
const SNAP_RATIO = 0.25;
/** Tentativas de achar um lugar livre ao reespalhar antes de aceitar cair sobre um bloco. */
const SCATTER_TRIES = 20;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Deslocamento aleatório que põe a peça numa área 2× maior que a imagem, centrada nela. */
function scatterOffset(puzzle: Puzzle, random: Random, piece: PieceDef): Point {
  const { width, height, pieceWidth, pieceHeight } = puzzle;
  return {
    x: uniform(random, -width / 2, width * 1.5 - pieceWidth) - piece.x,
    y: uniform(random, -height / 2, height * 1.5 - pieceHeight) - piece.y,
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

export class PuzzleEngine {
  readonly snapDistance: number;
  private readonly groups = new Map<number, GroupState>();
  private readonly pieceGroup: number[];

  /** `offsets[i]` é o deslocamento inicial da peça i; cada peça começa no próprio grupo. */
  constructor(
    readonly puzzle: Puzzle,
    offsets: Point[],
  ) {
    if (offsets.length !== puzzle.pieces.length) {
      throw new RangeError(
        `esperava ${puzzle.pieces.length} deslocamentos, recebi ${offsets.length}`,
      );
    }
    this.snapDistance = SNAP_RATIO * Math.min(puzzle.pieceWidth, puzzle.pieceHeight);
    this.pieceGroup = puzzle.pieces.map((piece) => piece.id);
    for (const piece of puzzle.pieces) {
      const { x, y } = offsets[piece.id]!;
      this.groups.set(piece.id, { id: piece.id, x, y, pieceIds: [piece.id] });
    }
  }

  /** Espalha as peças numa área 2× maior que a imagem, de forma reproduzível pelo seed. */
  static scattered(puzzle: Puzzle): PuzzleEngine {
    const random = createRandom(`${puzzle.seed}:scatter`);
    const offsets = puzzle.pieces.map((piece) => scatterOffset(puzzle, random, piece));
    return new PuzzleEngine(puzzle, offsets);
  }

  /**
   * Remonta a mesa a partir de grupos já formados (snapshot de uma sala salva). Cada peça tem
   * que aparecer em exatamente um grupo; os ids dos grupos são preservados.
   */
  static fromGroups(puzzle: Puzzle, groups: readonly GroupState[]): PuzzleEngine {
    const seen = new Set<number>();
    for (const group of groups) {
      for (const pieceId of group.pieceIds) {
        if (!puzzle.pieces[pieceId] || seen.has(pieceId)) {
          throw new RangeError(`peça ${pieceId} inválida ou repetida nos grupos`);
        }
        seen.add(pieceId);
      }
    }
    if (seen.size !== puzzle.pieces.length) {
      throw new RangeError(`os grupos cobrem ${seen.size} de ${puzzle.pieces.length} peças`);
    }

    const engine = new PuzzleEngine(
      puzzle,
      puzzle.pieces.map(() => ({ x: 0, y: 0 })),
    );
    engine.groups.clear();
    for (const { id, x, y, pieceIds } of groups) {
      engine.groups.set(id, { id, x, y, pieceIds: [...pieceIds] });
      for (const pieceId of pieceIds) engine.pieceGroup[pieceId] = id;
    }
    return engine;
  }

  /**
   * Reespalha as peças soltas (grupos de uma peça só) pela mesma área do começo, evitando cair
   * em cima dos blocos já montados, que ficam onde estão. Devolve os grupos que mudaram de lugar.
   *
   * `canMove` permite poupar peças — no multiplayer, as que algum jogador está segurando.
   */
  scatterLoose(random: Random, canMove: (group: GroupState) => boolean = () => true): number[] {
    const groups = [...this.groups.values()];
    const blocks = groups.filter((g) => g.pieceIds.length > 1).map((g) => this.bounds(g));
    const moved: number[] = [];
    for (const group of groups) {
      if (group.pieceIds.length > 1 || !canMove(group)) continue;
      const piece = this.puzzle.pieces[group.pieceIds[0]!]!;
      let offset = scatterOffset(this.puzzle, random, piece);
      for (
        let tries = 1;
        tries < SCATTER_TRIES && blocks.some((b) => overlaps(b, this.pieceRect(piece, offset)));
        tries++
      ) {
        offset = scatterOffset(this.puzzle, random, piece);
      }
      group.x = offset.x;
      group.y = offset.y;
      moved.push(group.id);
    }
    return moved;
  }

  get groupCount(): number {
    return this.groups.size;
  }

  isComplete(): boolean {
    return this.groups.size === 1;
  }

  allGroups(): IterableIterator<GroupState> {
    return this.groups.values();
  }

  groupOf(pieceId: number): GroupState {
    return this.getGroup(this.pieceGroup[pieceId]!);
  }

  getGroup(groupId: number): GroupState {
    const group = this.groups.get(groupId);
    if (!group) throw new RangeError(`grupo ${groupId} não existe`);
    return group;
  }

  /** Posição atual (canto superior esquerdo) da peça. */
  piecePosition(pieceId: number): Point {
    const piece = this.puzzle.pieces[pieceId]!;
    const group = this.groupOf(pieceId);
    return { x: piece.x + group.x, y: piece.y + group.y };
  }

  moveGroup(groupId: number, x: number, y: number): void {
    const group = this.getGroup(groupId);
    group.x = x;
    group.y = y;
  }

  /**
   * Solta o grupo: se alguma peça dele estiver perto da posição certa em relação a uma vizinha
   * de outro grupo, o grupo solto "pula" para o alinhamento e absorve o outro. Repete até
   * não haver mais encaixes, porque um encaixe pode alinhar o grupo com um terceiro.
   *
   * `canAbsorb` permite vetar alvos — no multiplayer, grupos que outro jogador está segurando.
   */
  dropGroup(groupId: number, canAbsorb: (other: GroupState) => boolean = () => true): DropResult {
    const group = this.getGroup(groupId);
    const absorbedGroupIds: number[] = [];

    let other = this.findSnapTarget(group, canAbsorb);
    while (other) {
      group.x = other.x;
      group.y = other.y;
      this.absorb(group, other);
      absorbedGroupIds.push(other.id);
      other = this.findSnapTarget(group, canAbsorb);
    }

    return { absorbedGroupIds, completed: this.isComplete() };
  }

  private findSnapTarget(
    group: GroupState,
    canAbsorb: (other: GroupState) => boolean,
  ): GroupState | undefined {
    for (const pieceId of group.pieceIds) {
      for (const neighborId of neighborsOf(this.puzzle, pieceId)) {
        const other = this.groupOf(neighborId);
        if (other.id === group.id || !canAbsorb(other)) continue;
        if (Math.hypot(other.x - group.x, other.y - group.y) <= this.snapDistance) return other;
      }
    }
    return undefined;
  }

  /** Retângulo da peça (sem as abas) se o grupo dela estivesse no deslocamento dado. */
  private pieceRect(piece: PieceDef, offset: Point): Rect {
    const left = piece.x + offset.x;
    const top = piece.y + offset.y;
    return {
      left,
      top,
      right: left + this.puzzle.pieceWidth,
      bottom: top + this.puzzle.pieceHeight,
    };
  }

  /** Retângulo que envolve todas as peças do grupo. */
  private bounds(group: GroupState): Rect {
    const rects = group.pieceIds.map((id) => this.pieceRect(this.puzzle.pieces[id]!, group));
    return {
      left: Math.min(...rects.map((r) => r.left)),
      top: Math.min(...rects.map((r) => r.top)),
      right: Math.max(...rects.map((r) => r.right)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    };
  }

  private absorb(group: GroupState, other: GroupState): void {
    for (const pieceId of other.pieceIds) {
      this.pieceGroup[pieceId] = group.id;
      group.pieceIds.push(pieceId);
    }
    this.groups.delete(other.id);
  }
}
