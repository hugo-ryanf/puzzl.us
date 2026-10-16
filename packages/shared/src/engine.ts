import { neighborsOf, type Point, type Puzzle } from './puzzle';
import { createRandom, uniform } from './random';

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
    const { width, height, pieceWidth, pieceHeight } = puzzle;
    const offsets = puzzle.pieces.map((piece) => ({
      x: uniform(random, -width / 2, width * 1.5 - pieceWidth) - piece.x,
      y: uniform(random, -height / 2, height * 1.5 - pieceHeight) - piece.y,
    }));
    return new PuzzleEngine(puzzle, offsets);
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
   */
  dropGroup(groupId: number): DropResult {
    const group = this.getGroup(groupId);
    const absorbedGroupIds: number[] = [];

    let other = this.findSnapTarget(group);
    while (other) {
      group.x = other.x;
      group.y = other.y;
      this.absorb(group, other);
      absorbedGroupIds.push(other.id);
      other = this.findSnapTarget(group);
    }

    return { absorbedGroupIds, completed: this.isComplete() };
  }

  private findSnapTarget(group: GroupState): GroupState | undefined {
    for (const pieceId of group.pieceIds) {
      for (const neighborId of neighborsOf(this.puzzle, pieceId)) {
        const other = this.groupOf(neighborId);
        if (other.id === group.id) continue;
        if (Math.hypot(other.x - group.x, other.y - group.y) <= this.snapDistance) return other;
      }
    }
    return undefined;
  }

  private absorb(group: GroupState, other: GroupState): void {
    for (const pieceId of other.pieceIds) {
      this.pieceGroup[pieceId] = group.id;
      group.pieceIds.push(pieceId);
    }
    this.groups.delete(other.id);
  }
}
