import {
  GroupSchema,
  PuzzleEngine,
  neighborsOf,
  type GroupState,
  type MoveMessage,
  type RoomState,
} from '@puzzle/shared';

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
      this.target.groups.set(
        String(group.id),
        new GroupSchema({ x: group.x, y: group.y, rotation: group.rotation }),
      );
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

  /**
   * Gira o grupo um quarto de volta em volta do centro dele: livre, ou na mão de quem pede.
   * Devolve se girou.
   */
  rotate(sessionId: string, groupId: number): boolean {
    const group = this.target.groups.get(String(groupId));
    if (!group || (group.heldBy !== '' && group.heldBy !== sessionId)) return false;
    this.engine.rotateGroup(groupId);
    const turned = this.engine.getGroup(groupId);
    group.x = turned.x;
    group.y = turned.y;
    group.rotation = turned.rotation;
    return true;
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

    group.heldBy = '';
    // Montado: a foto fica de pé para a revelação.
    if (completed) this.engine.straighten(groupId);
    this.syncMerge(groupId, absorbedGroupIds);
    return { snaps: absorbedGroupIds.length, completed };
  }

  /** Copia para o estado o resultado de um encaixe: posição do grupo e peças que entraram. */
  private syncMerge(groupId: number, absorbedGroupIds: number[]): void {
    const merged = this.engine.getGroup(groupId);
    const group = this.target.groups.get(String(groupId))!;
    group.x = merged.x;
    group.y = merged.y;
    group.rotation = merged.rotation;
    for (const id of absorbedGroupIds) this.target.groups.delete(String(id));
    for (const pieceId of merged.pieceIds) {
      if (this.target.pieceGroup[pieceId] !== groupId) this.target.pieceGroup[pieceId] = groupId;
    }
  }

  /** Teste: monta a mesa inteira de uma vez (alinha tudo na peça 0 e encaixa). */
  solveAll(): { snaps: number; completed: boolean } {
    for (const group of this.target.groups.values()) group.heldBy = '';
    const target = this.engine.groupOf(0);
    for (const group of [...this.engine.allGroups()]) {
      if (group.id !== target.id) this.engine.alignTo(group.id, target);
    }
    const { absorbedGroupIds, completed } = this.engine.dropGroup(target.id);
    if (completed) this.engine.straighten(target.id);
    this.syncMerge(target.id, absorbedGroupIds);
    return { snaps: absorbedGroupIds.length, completed };
  }

  /** Teste: todas as peças de pé (cada grupo gira em volta do próprio centro). */
  straightenAll(): void {
    for (const group of this.engine.allGroups()) {
      this.engine.straighten(group.id);
      const schema = this.target.groups.get(String(group.id))!;
      schema.x = group.x;
      schema.y = group.y;
      schema.rotation = group.rotation;
    }
  }

  /** A peça já está encaixada em alguma outra (todas começam soltas). */
  isSnapped(pieceId: number): boolean {
    return this.engine.groupOf(pieceId).pieceIds.length > 1;
  }

  /**
   * Ímã: encaixa sozinho até `count` peças soltas, cada uma no maior bloco vizinho dela (nada na
   * mão de alguém). Devolve quantos encaixes fez e se a mesa ficou completa.
   */
  magnet(count: number): { snaps: number; completed: boolean } {
    const free = (group: GroupState) => this.target.groups.get(String(group.id))?.heldBy === '';
    let snaps = 0;
    for (let i = 0; i < count; i++) {
      let best: { loose: GroupState; target: GroupState } | undefined;
      for (const loose of this.engine.allGroups()) {
        if (loose.pieceIds.length !== 1 || !free(loose)) continue;
        for (const neighborId of neighborsOf(this.engine.puzzle, loose.pieceIds[0]!)) {
          const target = this.engine.groupOf(neighborId);
          if (target.id === loose.id || !free(target)) continue;
          if (!best || target.pieceIds.length > best.target.pieceIds.length)
            best = { loose, target };
        }
      }
      if (!best) break;
      // Mesma rotação e deslocamento do vizinho = a peça no lugar certo em relação a ele.
      this.engine.alignTo(best.loose.id, best.target);
      const { absorbedGroupIds, completed } = this.engine.dropGroup(best.loose.id, free);
      if (completed) this.engine.straighten(best.loose.id);
      this.syncMerge(best.loose.id, absorbedGroupIds);
      snaps += absorbedGroupIds.length;
    }
    return { snaps, completed: this.engine.isComplete() };
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
