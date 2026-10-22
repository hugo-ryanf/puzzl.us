import {
  Application,
  Container,
  Graphics,
  Matrix,
  Sprite,
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
  type RoomState,
} from '@puzzle/shared';
import type { PuzzleRoom } from '../net/connection';
import { throttle } from '../net/throttle';
import { RemoteCursors } from './RemoteCursors';

/** Zoom out vai até metade do "100%" (a mesa inteira na tela): mais longe que isso é só vazio. */
const MIN_ZOOM_RATIO = 0.5;
const MAX_ZOOM = 8;
/** 20 envios/s: igual à taxa de patch do servidor; mais que isso só gasta banda. */
const SEND_INTERVAL_MS = 50;
/** Quanto maior, mais rápido peças e cursores remotos alcançam a posição do servidor. */
const SMOOTHING = 15;
/** Se a confirmação do drop não chegar nesse tempo, voltamos a seguir o servidor mesmo assim. */
const RELEASE_TIMEOUT_MS = 1000;
/** Ao completar: espera a última peça assentar e então a foto inteira aparece aos poucos. */
const REVEAL_DELAY_MS = 300;
const REVEAL_DURATION_MS = 900;
/** Altura (px) livre no rodapé para a barra de ferramentas não cobrir peças ao enquadrar. */
const TOOLBAR_SPACE = 64;
/** Pontos do fundo nunca ficam mais juntos que isso (px na tela); mais longe, viram ruído. */
const MIN_DOT_SPACING = 14;

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** O tabuleiro desenhado: a raiz do estado (clássico) ou um BoardSchema (Bullet, Batalha). */
export type BoardSource = Pick<RoomState, 'config' | 'groups' | 'pieceGroup'> & { done?: boolean };
/** Chave do tabuleiro nas mensagens dos modos novos; ausente no clássico. */
export type BoardKey = 'main' | 'a' | 'b';

export interface AttachOptions {
  /** Padrão: a raiz do estado (modo clássico). */
  source?: BoardSource;
  boardKey?: BoardKey;
  /** Só assistir (o lado do adversário na Batalha): sem arrastar e sem mandar cursor. */
  readOnly?: boolean;
}

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
  private source?: BoardSource;
  private boardKey?: BoardKey;
  private readOnly = false;
  private puzzle?: Puzzle;
  private texture?: Texture;
  /** Foto inteira por cima do puzzle montado: esconde as linhas de corte entre as peças. */
  private finishedImage?: Sprite;
  private revealStartedAt = 0;
  private pieces: PieceSprite[] = [];
  private strokeWidth = 1;
  /** Câmera da última vez que os pontos do fundo foram alinhados (evita mexer no DOM à toa). */
  private dotsCamera = '';
  /** Zoom em que a mesa inteira cabe na tela: vale "100%" na barra de ferramentas. */
  private baseScale = 0; // definido em fitCamera(), quando a mesa é enquadrada pela primeira vez
  private lastZoomPercent = 0;

  private zoomListener?: (percent: number) => void;

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
    this.room?.send('move', this.withBoard({ groupId, x, y })),
  );
  private readonly sendCursor = throttle(SEND_INTERVAL_MS, (x: number, y: number) =>
    this.room?.send('cursor', this.withBoard({ x, y })),
  );

  private constructor(
    private readonly app: Application,
    private readonly host: HTMLElement,
  ) {
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
      // Transparente: o fundo (cor + pontos) é CSS no host, alinhado à câmera em syncDots().
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio,
    });
    host.appendChild(app.canvas);
    return new BoardScene(app, host);
  }

  /** Liga a cena a uma sala. Idempotente: o StrictMode chama efeitos duas vezes em dev. */
  attach(room: PuzzleRoom, image: HTMLImageElement, options: AttachOptions = {}): void {
    if (this.room === room) return;
    this.room = room;
    this.source = options.source ?? room.state;
    this.boardKey = options.boardKey;
    this.readOnly = options.readOnly ?? false;

    const { config } = this.source;
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
      sprite.graphics.cursor = this.readOnly ? 'default' : 'grab';
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

  // ── Ferramentas da mesa (barra de baixo) ───────────────────────────────────

  /** Aproxima (> 1) ou afasta (< 1) mantendo fixo o centro da tela. */
  zoomBy(factor: number): void {
    const { width, height } = this.app.screen;
    this.zoomAt({ x: width / 2, y: height / 2 }, factor);
  }

  /** Enquadra todas as peças, onde quer que estejam (útil depois de se perder no pan/zoom). */
  centerView(): void {
    if (!this.puzzle) return;
    const { pieceWidth, pieceHeight } = this.puzzle;
    const { left, top, right, bottom } = this.piecesBounds();
    const margin = Math.min(pieceWidth, pieceHeight);
    this.frame(
      { x: (left + right) / 2, y: (top + bottom) / 2 },
      right - left + margin * 2,
      bottom - top + margin * 2,
    );
  }

  /** Avisa quando o zoom muda (em %, relativo à mesa inteira na tela). Devolve o "desligar". */
  onZoom(listener: (percent: number) => void): () => void {
    this.zoomListener = listener;
    listener(this.lastZoomPercent || 100);
    return () => {
      if (this.zoomListener === listener) this.zoomListener = undefined;
    };
  }

  private subscribe(room: PuzzleRoom): void {
    const callbacks = Callbacks.get(room);
    const me = room.sessionId;
    const source = this.source!;
    // Hora da recompensa: a câmera mostra a imagem montada (também ao voltar para a sala).
    const reveal = () => {
      this.focusCompletedPuzzle();
      this.revealFinishedImage();
    };

    this.unsubscribers.push(
      callbacks.onAdd(source, 'groups', (group, key) => {
        const groupId = Number(key);
        this.unsubscribers.push(
          callbacks.onChange(group, () => this.handleGroupMoved(groupId)),
          callbacks.listen(group, 'heldBy', (heldBy, previous) => {
            if (heldBy !== (previous ?? '')) this.handleHeldByChange(groupId, heldBy);
          }),
        );
      }),
      callbacks.onRemove(source, 'groups', (_group, key) => this.animating.delete(Number(key))),
      // Encaixe no servidor = peças mudando de grupo.
      callbacks.onChange(source, 'pieceGroup', (_pieceId, groupId) => {
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
      // Clássico: acaba com a sala; modos novos: cada tabuleiro avisa quando foi montado.
      source === room.state
        ? callbacks.listen('phase', (phase) => phase === 'completed' && reveal())
        : callbacks.listen(source as BoardSource & { done: boolean }, 'done', (done) => {
            if (done) reveal();
          }),
      // Só os cursores deste tabuleiro (na Batalha, o adversário mexe no dele).
      room.onMessage('cursor', ({ sessionId, x, y, board }: CursorBroadcast) => {
        if (board === this.boardKey) this.cursors.setTarget(sessionId, x, y);
      }),
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
    // Peças só se mexem com o relógio correndo (no lobby, no "3, 2, 1" e depois do fim, travadas).
    if (!room || this.readOnly || room.state.phase !== 'playing' || event.button !== 0) return;
    if (room.state.countdown > 0) return;
    if (this.source!.done) return;
    const groupId = this.source!.pieceGroup[pieceId]!;
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
    room.send('grab', this.withBoard({ groupId }));
  }

  private handleBackgroundDown = (event: FederatedPointerEvent): void => {
    // Clique em peça também "borbulha" até o stage; só fazemos pan se o alvo for o fundo.
    if (event.target !== this.app.stage) return;
    this.pan = { last: { x: event.global.x, y: event.global.y } };
  };

  private handlePointerMove = (event: FederatedPointerEvent): void => {
    const pointer = this.world.toLocal(event.global);
    if (this.room && !this.readOnly) this.sendCursor.call(pointer.x, pointer.y);

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
      this.clampCamera();
    }
  };

  private handlePointerUp = (): void => {
    if (this.drag && this.room) {
      const { groupId, x, y } = this.drag;
      this.sendMove.cancel(); // o drop já leva a posição final
      this.room.send('drop', this.withBoard({ groupId, x, y }));
      this.awaitingRelease.set(groupId, performance.now() + RELEASE_TIMEOUT_MS);
    }
    this.drag = undefined;
    this.pan = undefined;
  };

  /** Zoom pela roda do mouse mantendo fixo o ponto sob o cursor. */
  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.zoomAt({ x: event.offsetX, y: event.offsetY }, Math.exp(-event.deltaY * 0.0015));
  };

  private zoomAt(screenPoint: Point, factor: number): void {
    const before = this.world.toLocal(screenPoint);
    const scale = clamp(this.world.scale.x * factor, this.minScale, MAX_ZOOM);
    this.world.scale.set(scale);
    this.world.position.set(screenPoint.x - before.x * scale, screenPoint.y - before.y * scale);
    this.clampCamera();
  }

  private get minScale(): number {
    return this.baseScale * MIN_ZOOM_RATIO;
  }

  /**
   * Não deixa a câmera se perder: o centro da tela fica sempre dentro da mesa (a área onde as
   * peças foram espalhadas) ou de onde houver peças fora dela — toda peça continua alcançável.
   */
  private clampCamera(): void {
    if (!this.puzzle) return;
    const { width, height } = this.puzzle;
    const pieces = this.piecesBounds();
    const left = Math.min(-width / 2, pieces.left);
    const top = Math.min(-height / 2, pieces.top);
    const right = Math.max(width * 1.5, pieces.right);
    const bottom = Math.max(height * 1.5, pieces.bottom);

    const screen = this.app.screen;
    const scale = this.world.scale.x;
    const centerX = clamp((screen.width / 2 - this.world.x) / scale, left, right);
    const centerY = clamp((screen.height / 2 - this.world.y) / scale, top, bottom);
    this.world.position.set(
      screen.width / 2 - centerX * scale,
      screen.height / 2 - centerY * scale,
    );
  }

  /** Retângulo (na mesa) que envolve todas as peças, onde estiverem agora. */
  private piecesBounds(): Bounds {
    const { pieceWidth, pieceHeight } = this.puzzle!;
    const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const { graphics } of this.pieces) {
      bounds.left = Math.min(bounds.left, graphics.x);
      bounds.top = Math.min(bounds.top, graphics.y);
      bounds.right = Math.max(bounds.right, graphics.x + pieceWidth);
      bounds.bottom = Math.max(bounds.bottom, graphics.y + pieceHeight);
    }
    return bounds;
  }

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
    this.syncDots();

    if (this.finishedImage && this.finishedImage.alpha < 1) {
      const elapsed = now - this.revealStartedAt - REVEAL_DELAY_MS;
      this.finishedImage.alpha = clamp(elapsed / REVEAL_DURATION_MS, 0, 1);
    }

    const percent = Math.round((this.world.scale.x / this.baseScale) * 100);
    if (percent !== this.lastZoomPercent) {
      this.lastZoomPercent = percent;
      this.zoomListener?.(percent);
    }
  };

  /**
   * Os pontos do fundo se movem e escalam junto com a mesa: dão noção de quanto se andou no pan
   * e no zoom. Espaçamento = meia peça, dobrando enquanto ficaria apertado demais na tela.
   */
  private syncDots(): void {
    const { x, y } = this.world.position;
    const scale = this.world.scale.x;
    const camera = `${x}:${y}:${scale}`;
    if (camera === this.dotsCamera) return;
    this.dotsCamera = camera;

    let spacing = (Math.min(this.puzzle!.pieceWidth, this.puzzle!.pieceHeight) / 2) * scale;
    while (spacing < MIN_DOT_SPACING) spacing *= 2;
    // O ponto fica no centro de cada ladrilho; o -spacing/2 põe os pontos nos múltiplos da
    // grade, então ao dobrar o espaçamento metade dos pontos some e o resto fica no lugar.
    const offset = (value: number) => (((value - spacing / 2) % spacing) + spacing) % spacing;
    this.host.style.backgroundSize = `${spacing}px ${spacing}px`;
    this.host.style.backgroundPosition = `${offset(x)}px ${offset(y)}px`;
  }

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
    return this.source?.groups.get(String(groupId));
  }

  /** Nos modos novos, toda mensagem diz de qual tabuleiro é. */
  private withBoard<T extends object>(payload: T): T & { board?: BoardKey } {
    return this.boardKey ? { ...payload, board: this.boardKey } : payload;
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
    this.source!.pieceGroup.forEach((groupId, pieceId) => {
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
          : // Mais forte que no tema escuro: no fundo claro, peças de céu claro sumiriam.
            { width: this.strokeWidth * 1.4, color: 0x15171c, alpha: 0.6 },
      );
  }

  /** Enquadra a área onde as peças foram espalhadas (2× o tamanho da imagem). */
  private fitCamera(): void {
    const { width, height } = this.puzzle!;
    this.frame({ x: width / 2, y: height / 2 }, width * 2.1, height * 2.1);
    this.baseScale = this.world.scale.x;
  }

  /** Puzzle montado: mostra a imagem inteira (onde quer que tenha ficado na mesa). */
  private focusCompletedPuzzle(): void {
    const [group] = this.source!.groups.values();
    if (!group) return;
    const { width, height } = this.puzzle!;
    const center = { x: group.x + width / 2, y: group.y + height / 2 };
    this.frame(center, width * 1.15, height * 1.15);
  }

  /**
   * As peças montadas formam a foto, mas com as linhas de corte à vista. Uma cópia da foto
   * inteira, no mesmo lugar e por cima, vai aparecendo e "apaga" as linhas. Não recebe clique:
   * arrastar continua movendo a câmera.
   */
  private revealFinishedImage(): void {
    const [group] = this.source!.groups.values();
    if (!group || this.finishedImage) return;
    const { width, height } = this.puzzle!;
    const sprite = new Sprite(this.texture!);
    sprite.position.set(group.x, group.y); // posição da peça = posição na foto + deslocamento
    sprite.setSize(width, height);
    sprite.alpha = 0;
    this.world.addChild(sprite);
    this.finishedImage = sprite;
    this.revealStartedAt = performance.now();
  }

  /** Ajusta zoom e posição para caber `width × height` (do tabuleiro) acima da barra de ferramentas. */
  private frame(center: Point, width: number, height: number): void {
    const screen = this.app.screen;
    const available = screen.height - TOOLBAR_SPACE;
    const scale = clamp(
      Math.min(screen.width / width, available / height),
      this.minScale,
      MAX_ZOOM,
    );
    this.world.scale.set(scale);
    this.world.position.set(screen.width / 2 - center.x * scale, available / 2 - center.y * scale);
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
