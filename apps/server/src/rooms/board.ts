import { GroupSchema, PuzzleEngine, type MoveMessage, type RoomState } from '@puzzle/shared';

/** Onde o tabuleiro é espelhado: a raiz do RoomState (clássico) ou um BoardSchema (modos novos). */
export type BoardTarget = Pick<RoomState, 'groups' | 'pieceGroup'>;

/**
 * Um tabuleiro jogável: o PuzzleEngine (a autoridade) mais o espelho dele no estado sincronizado.
 * Valida e aplica pegar/mover/soltar/espalhar; quem decide se vale (fase, lado) é a sala.
 */
export class BoardRuntime {
  constructor(
    readonly engine: PuzzleEngine,
    private readonly target: BoardTarget,
  ) {}

  /** Copia grupos e posições do engine para o estado (tabuleiro novo ou restaurado). */
  mirror(): void {
    for (const group of this.engine.allGroups()) {
      this.target.groups.set(String(group.id), new GroupSchema({ x: group.x, y: group.y }));
    }
    this.target.pieceGroup.push(
      ...this.engine.puzzle.pieces.map((p) => this.engine.groupOf(p.id).id),
    );
  }

  /** Primeiro a pegar ganha: se o grupo já tem dono, o pedido é ignorado. */
  grab(sessionId: string, groupId: number): void {
    const group = this.target.groups.get(String(groupId));
    if (!group || group.heldBy !== '') return;
    this.releaseHeldBy(sessionId); // um grupo por vez por jogador
    group.heldBy = sessionId;
  }

  /** Devolve se mexeu (só quem está segurando move). */
  move(sessionId: string, { groupId, x, y }: MoveMessage): boolean {
    const group = this.heldGroup(sessionId, groupId);
    if (!group) return false;
    this.engine.moveGroup(groupId, x, y);
    group.x = x;
    group.y = y;
    return true;
  }

  /** Solta e encaixa no que estiver perto. Undefined se este jogador não segurava o grupo. */
  drop(
    sessionId: string,
    { groupId, x, y }: MoveMessage,
  ): { snaps: number; completed: boolean } | undefined {
    const group = this.heldGroup(sessionId, groupId);
    if (!group) return undefined;

    this.engine.moveGroup(groupId, x, y);
    const { absorbedGroupIds, completed } = this.engine.dropGroup(
      groupId,
      // Não "arranca" da mão de outro jogador um grupo que ele está arrastando.
      (other) => this.target.groups.get(String(other.id))?.heldBy === '',
    );

    const merged = this.engine.getGroup(groupId);
    group.x = merged.x;
    group.y = merged.y;
    group.heldBy = '';
    for (const id of absorbedGroupIds) this.target.groups.delete(String(id));
    for (const pieceId of merged.pieceIds) {
      if (this.target.pieceGroup[pieceId] !== groupId) this.target.pieceGroup[pieceId] = groupId;
    }
    return { snaps: absorbedGroupIds.length, completed };
  }

  /** Reespalha as peças soltas; blocos montados e peças na mão de alguém ficam. */
  scatter(): void {
    const moved = this.engine.scatterLoose(
      Math.random,
      (group) => this.target.groups.get(String(group.id))?.heldBy === '',
    );
    for (const groupId of moved) {
      const { x, y } = this.engine.getGroup(groupId);
      const group = this.target.groups.get(String(groupId))!;
      group.x = x;
      group.y = y;
    }
  }

  releaseHeldBy(sessionId: string): void {
    for (const group of this.target.groups.values()) {
      if (group.heldBy === sessionId) group.heldBy = '';
    }
  }

  /** Peças já encaixadas em alguma outra (grupos de 2 ou mais). */
  placed(): number {
    let placed = 0;
    for (const group of this.engine.allGroups()) {
      if (group.pieceIds.length > 1) placed += group.pieceIds.length;
    }
    return placed;
  }

  /** O grupo, se existir e for este jogador quem está segurando. */
  private heldGroup(sessionId: string, groupId: number): GroupSchema | undefined {
    const group = this.target.groups.get(String(groupId));
    return group?.heldBy === sessionId ? group : undefined;
  }
}
