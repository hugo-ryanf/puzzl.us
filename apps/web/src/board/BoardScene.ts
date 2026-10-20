import {
  Application,
  Container,
  Graphics,
  Matrix,
  Texture,
  type FederatedPointerEvent,
  type Ticker,
} from 'pixi.js';
import { Callbacks } from '@colyseus/sdk';
import {
  generatePuzzle,
  piecePath,
  type CursorBroadcast,
  type EdgePath,
  type Point,
  type Puzzle,
} from '@puzzle/shared';
import type { PuzzleRoom } from '../net/connection';
import { throttle } from '../net/throttle';
import { RemoteCursors } from './RemoteCursors';

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
/** 20 envios/s: igual à taxa de patch do servidor; mais que isso só gasta banda. */
const SEND_INTERVAL_MS = 50;
/** Quanto maior, mais rápido peças e cursores remotos alcançam a posição do servidor. */
const SMOOTHING = 15;
/** Se a confirmação do drop não chegar nesse tempo, voltamos a seguir o servidor mesmo assim. */
const RELEASE_TIMEOUT_MS = 1000;
/** Altura (px) reservada no topo para o painel de fim, para ele não cobrir a imagem montada. */
const COMPLETED_PANEL_SPACE = 210;

interface PieceSprite {
  graphics: Graphics;
  path: EdgePath;
  /** Desloca a imagem para que o (0,0) local da peça mostre o pixel certo da foto. */
  textureMatrix: Matrix;
}

/**
 * Desenha a mesa e traduz mouse ↔ servidor. Quem decide encaixes é o servidor (PuzzleRoom);
 * aqui fazemos só predição local do grupo que eu arrasto e animação suave do resto.
 */
export class BoardScene {
  /** Tudo que se move com a câmera (pan/zoom) fica dentro de `world`. */
  private readonly world = new Container();
  private readonly cursors = new RemoteCursors();

  private room?: PuzzleRoom;
  private puzzle?: Puzzle;
  private texture?: Texture;
  private pieces: PieceSprite[] = [];
  private strokeWidth = 1;

  /** grupo → peças, derivado de state.pieceGroup; recalculado quando há encaixe. */
  private members = new Map<number, number[]>();
  private membersDirty = true;
  /** Grupos cujas peças ainda estão deslizando até a posição do servidor. */
  private readonly animating = new Set<number>();
  /** Grupos que eu soltei e cuja confirmação (heldBy = "") ainda não chegou → prazo. */
  private readonly awaitingRelease = new Map<number, number>();

  private drag?: { groupId: number; grabOffset: Point; x: number; y: number };
  private pan?: { last: Point };
  private readonly unsubscribers: Array<() => void> = [];

  private readonly sendMove = throttle(SEND_INTERVAL_MS, (groupId: number, x: number, y: number) =>
    this.room?.send('move', { groupId, x, y }),
  );
  private readonly sendCursor = throttle(SEND_INTERVAL_MS, (x: number, y: number) =>
    this.room?.send('cursor', { x, y }),
  );

  private constructor(private readonly app: Application) {
    app.stage.addChild(this.world, this.cursors.layer);
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.on('pointerdown', this.handleBackgroundDown);
    app.stage.on('globalpointermove', this.handlePointerMove);
    app.stage.on('pointerup', this.handlePointerUp);
    app.stage.on('pointerupoutside', this.handlePointerUp);
    app.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    app.ticker.add(this.update);
  }

  static async create(host: HTMLElement): Promise<BoardScene> {
    const app = new Application();
    await app.init({
      resizeTo: host,
      background: '#1e1f24',
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio,
    });
    host.appendChild(app.canvas);
    return new BoardScene(app);
  }

  /** Liga a cena a uma sala. Idempotente: o StrictMode chama efeitos duas vezes em dev. */
  attach(room: PuzzleRoom, image: HTMLImageElement): void {
    if (this.room === room) return;
    this.room = room;

    const { config } = room.state;
    const puzzle = generatePuzzle({
      seed: config.seed,
      rows: config.rows,
      cols: config.cols,
      width: config.width,
      height: config.height,
    });
    this.puzzle = puzzle;
    this.texture = Texture.from(image);
    this.strokeWidth = Math.max(1, Math.min(puzzle.pieceWidth, puzzle.pieceHeight) * 0.012);

    this.pieces = puzzle.pieces.map((piece) => {
      const sprite: PieceSprite = {
        graphics: new Graphics(),
        path: piecePath(puzzle, piece),
        textureMatrix: new Matrix().translate(-piece.x, -piece.y),
      };
      this.drawPiece(sprite);
      sprite.graphics.eventMode = 'static';
      sprite.graphics.cursor = 'grab';
      sprite.graphics.on('pointerdown', (event) => this.handlePieceDown(piece.id, event));
      this.world.addChild(sprite.graphics);
      return sprite;
    });

    this.rebuildMembers();
    for (const groupId of this.members.keys()) this.placeGroup(groupId);
    this.fitCamera();
    this.subscribe(room);
  }

  destroy(): void {
    this.sendMove.cancel();
    this.sendCursor.cancel();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.app.canvas.removeEventListener('wheel', this.handleWheel);
    this.app.destroy(true, { children: true, texture: true, textureSource: true });
  }

  private subscribe(room: PuzzleRoom): void {
    const callbacks = Callbacks.get(room);
    const me = room.sessionId;

    this.unsubscribers.push(
      callbacks.onAdd('groups', (group, key) => {
        const groupId = Number(key);
        this.unsubscribers.push(
          callbacks.onChange(group, () => this.handleGroupMoved(groupId)),
          callbacks.listen(group, 'heldBy', (heldBy, previous) => {
            if (heldBy !== (previous ?? '')) this.handleHeldByChange(groupId, heldBy);
          }),
        );
      }),
      callbacks.onRemove('groups', (_group, key) => this.animating.delete(Number(key))),
      // Encaixe no servidor = peças mudando de grupo.
      callbacks.onChange('pieceGroup', (_pieceId, groupId) => {
        this.membersDirty = true;
        this.handleGroupMoved(groupId);
      }),
      callbacks.onAdd('players', (player, sessionId) => {
        if (sessionId === me) return;
        this.cursors.add(sessionId, player.name, player.color);
        this.unsubscribers.push(
          callbacks.listen(player, 'connected', (connected) =>
            this.cursors.setConnected(sessionId, connected),
          ),
        );
      }),
      callbacks.onRemove('players', (_player, sessionId) => this.cursors.remove(sessionId)),
      // Hora da recompensa: a câmera mostra a imagem montada (também ao voltar para a sala).
      callbacks.listen('phase', (phase) => {
        if (phase === 'completed') this.focusCompletedPuzzle();
      }),
      room.onMessage('cursor', ({ sessionId, x, y }: CursorBroadcast) =>
        this.cursors.setTarget(sessionId, x, y),
      ),
    );
  }

  // ── Eventos do servidor ────────────────────────────────────────────────────

  private handleGroupMoved(groupId: number): void {
    if (this.drag?.groupId === groupId) return; // eu estou arrastando: o mouse manda
    if (this.awaitingRelease.has(groupId)) {
      // Grab + drop podem chegar no mesmo patch: aí heldBy nem chega a mudar no cliente.
      if (this.serverGroup(groupId)?.heldBy !== '') return;
      this.awaitingRelease.delete(groupId);
    }
    this.animating.add(groupId);
  }

  private handleHeldByChange(groupId: number, heldBy: string): void {
    if (this.membersDirty) this.rebuildMembers();
    const color = heldBy ? this.room!.state.players.get(heldBy)?.color : undefined;
    for (const pieceId of this.members.get(groupId) ?? [])
      this.drawPiece(this.pieces[pieceId]!, color);
    if (heldBy) this.bringToFront(groupId);

    const me = this.room!.sessionId;
    if (this.drag?.groupId === groupId && heldBy !== '' && heldBy !== me) {
      // Outro jogador pegou primeiro: desistimos e a peça volta para onde o servidor diz.
      this.drag = undefined;
      this.sendMove.cancel();
      this.animating.add(groupId);
    }
    if (heldBy === '' && this.awaitingRelease.delete(groupId)) this.animating.add(groupId);
  }

  // ── Entrada do usuário ─────────────────────────────────────────────────────

  private handlePieceDown(pieceId: number, event: FederatedPointerEvent): void {
    const room = this.room;
    // Peças só se mexem com o relógio correndo (no lobby e depois do fim ficam travadas).
    if (!room || room.state.phase !== 'playing' || event.button !== 0) return;
    const groupId = room.state.pieceGroup[pieceId]!;
    const heldBy = this.serverGroup(groupId)?.heldBy;
    if (heldBy === undefined || (heldBy !== '' && heldBy !== room.sessionId)) return;

    // Predição: começamos a arrastar já, sem esperar a resposta do servidor.
    const piece = this.puzzle!.pieces[pieceId]!;
    const graphics = this.pieces[pieceId]!.graphics;
    const offset = { x: graphics.x - piece.x, y: graphics.y - piece.y };
    const pointer = this.world.toLocal(event.global);
    this.drag = {
      groupId,
      grabOffset: { x: pointer.x - offset.x, y: pointer.y - offset.y },
      ...offset,
    };
    this.animating.delete(groupId);
    this.awaitingRelease.delete(groupId);
    this.bringToFront(groupId);
    room.send('grab', { groupId });
  }

  private handleBackgroundDown = (event: FederatedPointerEvent): void => {
    // Clique em peça também "borbulha" até o stage; só fazemos pan se o alvo for o fundo.
    if (event.target !== this.app.stage) return;
    this.pan = { last: { x: event.global.x, y: event.global.y } };
  };

  private handlePointerMove = (event: FederatedPointerEvent): void => {
    const pointer = this.world.toLocal(event.global);
    if (this.room) this.sendCursor.call(pointer.x, pointer.y);

    if (this.drag) {
      const { groupId, grabOffset } = this.drag;
      this.drag.x = pointer.x - grabOffset.x;
      this.drag.y = pointer.y - grabOffset.y;
      this.placeGroup(groupId, this.drag);
      this.sendMove.call(groupId, this.drag.x, this.drag.y);
    } else if (this.pan) {
      this.world.position.x += event.global.x - this.pan.last.x;
      this.world.position.y += event.global.y - this.pan.last.y;
      this.pan.last = { x: event.global.x, y: event.global.y };
    }
  };

  private handlePointerUp = (): void => {
    if (this.drag && this.room) {
      const { groupId, x, y } = this.drag;
      this.sendMove.cancel(); // o drop já leva a posição final
      this.room.send('drop', { groupId, x, y });
      this.awaitingRelease.set(groupId, performance.now() + RELEASE_TIMEOUT_MS);
    }
    this.drag = undefined;
    this.pan = undefined;
  };

  /** Zoom pela roda do mouse mantendo fixo o ponto sob o cursor. */
  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const cursor = { x: event.offsetX, y: event.offsetY };
    const before = this.world.toLocal(cursor);
    const scale = clamp(this.world.scale.x * Math.exp(-event.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM);
    this.world.scale.set(scale);
    this.world.position.set(cursor.x - before.x * scale, cursor.y - before.y * scale);
  };

  // ── Quadro a quadro ────────────────────────────────────────────────────────

  private update = (ticker: Ticker): void => {
    if (!this.room || !this.puzzle) return;
    if (this.membersDirty) this.rebuildMembers();
    // Fração do caminho a percorrer neste frame, independente do FPS.
    const smoothing = 1 - Math.exp(-SMOOTHING * (ticker.deltaMS / 1000));

    const now = performance.now();
    for (const [groupId, deadline] of this.awaitingRelease) {
      if (now > deadline) {
        this.awaitingRelease.delete(groupId);
        this.animating.add(groupId);
      }
    }

    for (const groupId of this.animating) {
      const group = this.serverGroup(groupId);
      if (!group || this.slideGroup(groupId, group, smoothing)) this.animating.delete(groupId);
    }

    this.cursors.update(smoothing, (p) => this.world.toGlobal(p));
  };

  /** Aproxima as peças do grupo da posição do servidor. Devolve true quando chegaram. */
  private slideGroup(groupId: number, offset: Point, smoothing: number): boolean {
    let arrived = true;
    for (const pieceId of this.members.get(groupId) ?? []) {
      const piece = this.puzzle!.pieces[pieceId]!;
      const graphics = this.pieces[pieceId]!.graphics;
      const dx = piece.x + offset.x - graphics.x;
      const dy = piece.y + offset.y - graphics.y;
      if (Math.abs(dx) + Math.abs(dy) < 0.5) {
        graphics.position.set(piece.x + offset.x, piece.y + offset.y);
      } else {
        graphics.position.set(graphics.x + dx * smoothing, graphics.y + dy * smoothing);
        arrived = false;
      }
    }
    return arrived;
  }

  // ── Auxiliares ─────────────────────────────────────────────────────────────

  private serverGroup(groupId: number) {
    return this.room?.state.groups.get(String(groupId));
  }

  /** Posiciona o grupo na hora (sem animação), no deslocamento dado ou no do servidor. */
  private placeGroup(groupId: number, offset: Point | undefined = this.serverGroup(groupId)): void {
    if (!offset) return;
    for (const pieceId of this.members.get(groupId) ?? []) {
      const piece = this.puzzle!.pieces[pieceId]!;
      this.pieces[pieceId]!.graphics.position.set(piece.x + offset.x, piece.y + offset.y);
    }
  }

  private rebuildMembers(): void {
    this.members.clear();
    this.room!.state.pieceGroup.forEach((groupId, pieceId) => {
      const list = this.members.get(groupId);
      if (list) list.push(pieceId);
      else this.members.set(groupId, [pieceId]);
    });
    this.membersDirty = false;
  }

  /** Contorno da peça preenchido com a imagem; a borda ganha a cor de quem está segurando. */
  private drawPiece({ graphics, path, textureMatrix }: PieceSprite, heldColor?: string): void {
    graphics.clear().moveTo(path.from.x, path.from.y);
    for (const { c1, c2, to } of path.segments) {
      graphics.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
    }
    graphics
      .closePath()
      .fill({ texture: this.texture!, textureSpace: 'global', matrix: textureMatrix })
      .stroke(
        heldColor
          ? { width: this.strokeWidth * 3, color: heldColor }
          : { width: this.strokeWidth, color: 0x000000, alpha: 0.35 },
      );
  }

  /** Enquadra a área onde as peças foram espalhadas (2× o tamanho da imagem). */
  private fitCamera(): void {
    const { width, height } = this.puzzle!;
    this.frame({ x: width / 2, y: height / 2 }, width * 2.1, height * 2.1);
  }

  /** Puzzle montado: mostra a imagem inteira (onde quer que tenha ficado na mesa). */
  private focusCompletedPuzzle(): void {
    const [group] = this.room!.state.groups.values();
    if (!group) return;
    const { width, height } = this.puzzle!;
    const center = { x: group.x + width / 2, y: group.y + height / 2 };
    this.frame(center, width * 1.15, height * 1.15, COMPLETED_PANEL_SPACE);
  }

  /** Ajusta zoom e posição para caber `width × height` (do tabuleiro) abaixo de `topInset` px. */
  private frame(center: Point, width: number, height: number, topInset = 0): void {
    const screen = this.app.screen;
    const available = screen.height - topInset;
    const scale = clamp(Math.min(screen.width / width, available / height), MIN_ZOOM, MAX_ZOOM);
    this.world.scale.set(scale);
    this.world.position.set(
      screen.width / 2 - center.x * scale,
      topInset + available / 2 - center.y * scale,
    );
  }

  /** Re-adicionar ao container move a peça para o fim da lista, ou seja, para cima de todas. */
  private bringToFront(groupId: number): void {
    if (this.membersDirty) this.rebuildMembers();
    for (const pieceId of this.members.get(groupId) ?? []) {
      this.world.addChild(this.pieces[pieceId]!.graphics);
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
