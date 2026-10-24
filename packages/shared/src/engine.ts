import { neighborsOf, type PieceDef, type Point, type Puzzle } from './puzzle';
import { createRandom, uniform, type Random } from './random';

/**
 * Peças encaixadas andam juntas. Como dentro de um grupo todas estão na posição relativa
 * correta, o grupo guarda só um deslocamento e uma rotação (em quartos de volta, no sentido do
 * relógio): posição da peça = girar(posição correta, rotação) + (x, y). Sem rotação, é a posição
 * correta + (x, y).
 */
export interface GroupState {
  id: number;
  x: number;
  y: number;
  /** 0, 1, 2 ou 3 quartos de volta. */
  rotation: number;
  pieceIds: number[];
}

/** Grupo vindo de fora (snapshot antigo): sem rotação, vale 0. */
export type GroupInput = Omit<GroupState, 'rotation'> & { rotation?: number };

/** Gira um ponto em volta da origem, em quartos de volta no sentido do relógio (y para baixo). */
export function rotatePoint({ x, y }: Point, rotation: number): Point {
  switch (((rotation % 4) + 4) % 4) {
    case 1:
      return { x: -y, y: x };
    case 2:
      return { x: -x, y: -y };
    case 3:
      return { x: y, y: -x };
    default:
      return { x, y };
  }
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

/**
 * Deslocamento de uma peça virada para o canto dela cair onde `offset` poria a peça de pé (o
 * espalhamento sorteia lugares pensando nas peças de pé).
 */
function turnedOffset(piece: PieceDef, offset: Point, rotation: number): Point {
  const turned = rotatePoint(piece, rotation);
  return { x: piece.x + offset.x - turned.x, y: piece.y + offset.y - turned.y };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

export class PuzzleEngine {
  readonly snapDistance: number;
  private readonly groups = new Map<number, GroupState>();
  private readonly pieceGroup: number[];

  /**
   * `offsets[i]` é o deslocamento inicial da peça i e `rotations[i]` a rotação dela (sem: todas
   * de pé); cada peça começa no próprio grupo.
   */
  constructor(
    readonly puzzle: Puzzle,
    offsets: Point[],
    rotations: number[] = [],
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
      const rotation = rotations[piece.id] ?? 0;
      this.groups.set(piece.id, { id: piece.id, x, y, rotation, pieceIds: [piece.id] });
    }
  }

  /**
   * Espalha as peças numa área 2× maior que a imagem, de forma reproduzível pelo seed. Com `salt`
   * (o lado da batalha), o mesmo quebra-cabeça sai espalhado de outro jeito; com `rotate`, cada
   * peça cai virada para um lado sorteado.
   */
  static scattered(
    puzzle: Puzzle,
    { salt, rotate = false }: { salt?: string; rotate?: boolean } = {},
  ): PuzzleEngine {
    const random = createRandom(`${puzzle.seed}:scatter${salt ? `:${salt}` : ''}`);
    // Virada, o canto da peça fica onde ela cairia de pé.
    const rotations = puzzle.pieces.map(() => (rotate ? Math.floor(random() * 4) : 0));
    const offsets = puzzle.pieces.map((piece) =>
      turnedOffset(piece, scatterOffset(puzzle, random, piece), rotations[piece.id]!),
    );
    return new PuzzleEngine(puzzle, offsets, rotations);
  }

  /**
   * Remonta a mesa a partir de grupos já formados (snapshot de uma sala salva). Cada peça tem
   * que aparecer em exatamente um grupo; os ids dos grupos são preservados.
   */
  static fromGroups(puzzle: Puzzle, groups: readonly GroupInput[]): PuzzleEngine {
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
    for (const { id, x, y, rotation = 0, pieceIds } of groups) {
      engine.groups.set(id, { id, x, y, rotation, pieceIds: [...pieceIds] });
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
      // A peça continua virada como estava; só muda de lugar.
      const place = () =>
        turnedOffset(piece, scatterOffset(this.puzzle, random, piece), group.rotation);
      let offset = place();
      for (
        let tries = 1;
        tries < SCATTER_TRIES &&
        blocks.some((b) => overlaps(b, this.pieceRect(piece, offset, group.rotation)));
        tries++
      ) {
        offset = place();
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

  /** Posição atual do canto da peça (o canto de cima à esquerda quando ela está de pé). */
  piecePosition(pieceId: number): Point {
    const piece = this.puzzle.pieces[pieceId]!;
    const group = this.groupOf(pieceId);
    const turned = rotatePoint(piece, group.rotation);
    return { x: turned.x + group.x, y: turned.y + group.y };
  }

  /** Gira o grupo um quarto de volta (sentido do relógio) sem tirar o centro dele do lugar. */
  rotateGroup(groupId: number): void {
    const group = this.getGroup(groupId);
    const { pieceWidth, pieceHeight } = this.puzzle;
    // Centro das peças na foto (de pé); girado + deslocamento = centro na mesa.
    const pieces = group.pieceIds.map((id) => this.puzzle.pieces[id]!);
    const center = {
      x: pieces.reduce((sum, p) => sum + p.x, 0) / pieces.length + pieceWidth / 2,
      y: pieces.reduce((sum, p) => sum + p.y, 0) / pieces.length + pieceHeight / 2,
    };
    const before = rotatePoint(center, group.rotation);
    group.rotation = (group.rotation + 1) % 4;
    const after = rotatePoint(center, group.rotation);
    group.x += before.x - after.x;
    group.y += before.y - after.y;
  }

  /** Gira até ficar de pé (a foto montada aparece certa). */
  straighten(groupId: number): void {
    while (this.getGroup(groupId).rotation !== 0) this.rotateGroup(groupId);
  }

  /** Põe o grupo na rotação e no deslocamento de outro (o ímã: alinhado para encaixar). */
  alignTo(groupId: number, target: GroupState): void {
    const group = this.getGroup(groupId);
    group.rotation = target.rotation;
    group.x = target.x;
    group.y = target.y;
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
        // Virados de jeitos diferentes não encaixam (com a mesma rotação, alinhado = mesmo x, y).
        if (other.rotation !== group.rotation) continue;
        if (Math.hypot(other.x - group.x, other.y - group.y) <= this.snapDistance) return other;
      }
    }
    return undefined;
  }

  /** Retângulo da peça (sem as abas) se o grupo dela estivesse no deslocamento e rotação dados. */
  private pieceRect(piece: PieceDef, offset: Point, rotation = 0): Rect {
    const { pieceWidth, pieceHeight } = this.puzzle;
    const corners = [
      { x: piece.x, y: piece.y },
      { x: piece.x + pieceWidth, y: piece.y + pieceHeight },
    ].map((corner) => rotatePoint(corner, rotation));
    return {
      left: Math.min(corners[0]!.x, corners[1]!.x) + offset.x,
      top: Math.min(corners[0]!.y, corners[1]!.y) + offset.y,
      right: Math.max(corners[0]!.x, corners[1]!.x) + offset.x,
      bottom: Math.max(corners[0]!.y, corners[1]!.y) + offset.y,
    };
  }

  /** Retângulo que envolve todas as peças do grupo. */
  private bounds(group: GroupState): Rect {
    const rects = group.pieceIds.map((id) =>
      this.pieceRect(this.puzzle.pieces[id]!, group, group.rotation),
    );
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
