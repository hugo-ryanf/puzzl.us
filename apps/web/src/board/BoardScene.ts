import {
  Application,
  Container,
  Graphics,
  Matrix,
  Texture,
  type FederatedPointerEvent,
} from 'pixi.js';
import {
  PuzzleEngine,
  generatePuzzle,
  gridForPieceCount,
  piecePath,
  type GroupState,
  type Point,
} from '@puzzle/shared';

export interface GameOptions {
  image: HTMLCanvasElement;
  pieceCount: number;
  seed: string;
  onProgress: (progress: Progress) => void;
}

export interface Progress {
  pieces: number;
  groups: number;
  completed: boolean;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;

/**
 * Desenha e controla o tabuleiro. A regra do jogo (grupos, encaixe) mora no PuzzleEngine do
 * pacote shared; aqui só traduzimos mouse → engine e engine → posições na tela.
 */
export class BoardScene {
  /** Tudo que se move com a câmera (pan/zoom) fica dentro de `world`. */
  private readonly world = new Container();
  private engine?: PuzzleEngine;
  private sprites: Graphics[] = [];
  private texture?: Texture;
  private textureImage?: HTMLCanvasElement;
  private onProgress?: (progress: Progress) => void;

  private drag?: { groupId: number; grabOffset: Point };
  private pan?: { last: Point };

  private constructor(private readonly app: Application) {
    app.stage.addChild(this.world);
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.on('pointerdown', this.handleBackgroundDown);
    app.stage.on('globalpointermove', this.handlePointerMove);
    app.stage.on('pointerup', this.handlePointerUp);
    app.stage.on('pointerupoutside', this.handlePointerUp);
    app.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
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

  /** Monta um novo jogo, descartando o anterior. */
  start({ image, pieceCount, seed, onProgress }: GameOptions): void {
    this.clearPieces();
    this.onProgress = onProgress;

    if (image !== this.textureImage) {
      this.texture?.destroy(true);
      this.texture = Texture.from(image);
      this.textureImage = image;
    }
    const texture = this.texture!;

    const { rows, cols } = gridForPieceCount(pieceCount, image.width / image.height);
    const puzzle = generatePuzzle({ seed, rows, cols, width: image.width, height: image.height });
    const engine = PuzzleEngine.scattered(puzzle);
    this.engine = engine;

    const strokeWidth = Math.max(1, Math.min(puzzle.pieceWidth, puzzle.pieceHeight) * 0.012);
    this.sprites = puzzle.pieces.map((piece) => {
      const path = piecePath(puzzle, piece);
      const sprite = new Graphics();
      sprite.moveTo(path.from.x, path.from.y);
      for (const { c1, c2, to } of path.segments) {
        sprite.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
      }
      sprite.closePath();
      // 'global' = textura nas coordenadas da peça; a matriz desloca a imagem para que
      // o (0,0) local da peça mostre o pixel (piece.x, piece.y) da foto.
      sprite.fill({
        texture,
        textureSpace: 'global',
        matrix: new Matrix().translate(-piece.x, -piece.y),
      });
      sprite.stroke({ width: strokeWidth, color: 0x000000, alpha: 0.35 });

      sprite.eventMode = 'static';
      sprite.cursor = 'grab';
      sprite.on('pointerdown', (event) => this.handlePieceDown(piece.id, event));

      const position = engine.piecePosition(piece.id);
      sprite.position.set(position.x, position.y);
      this.world.addChild(sprite);
      return sprite;
    });

    this.fitCamera();
    this.emitProgress();
  }

  destroy(): void {
    this.app.canvas.removeEventListener('wheel', this.handleWheel);
    this.app.destroy(true, { children: true, texture: true, textureSource: true });
  }

  private clearPieces(): void {
    for (const sprite of this.sprites) sprite.destroy();
    this.sprites = [];
    this.drag = undefined;
  }

  /** Enquadra a área onde as peças foram espalhadas (2× o tamanho da imagem). */
  private fitCamera(): void {
    const { width, height } = this.engine!.puzzle;
    const screen = this.app.screen;
    const scale = Math.min(screen.width / (width * 2.1), screen.height / (height * 2.1));
    this.world.scale.set(scale);
    this.world.position.set(
      screen.width / 2 - (width / 2) * scale,
      screen.height / 2 - (height / 2) * scale,
    );
  }

  private handlePieceDown(pieceId: number, event: FederatedPointerEvent): void {
    if (!this.engine || this.engine.isComplete() || event.button !== 0) return;
    const group = this.engine.groupOf(pieceId);
    const pointer = this.world.toLocal(event.global);
    this.drag = {
      groupId: group.id,
      grabOffset: { x: pointer.x - group.x, y: pointer.y - group.y },
    };
    this.bringToFront(group);
  }

  private handleBackgroundDown = (event: FederatedPointerEvent): void => {
    // Clique em peça também "borbulha" até o stage; só fazemos pan se o alvo for o fundo.
    if (event.target !== this.app.stage) return;
    this.pan = { last: { x: event.global.x, y: event.global.y } };
  };

  private handlePointerMove = (event: FederatedPointerEvent): void => {
    if (this.drag && this.engine) {
      const pointer = this.world.toLocal(event.global);
      const { groupId, grabOffset } = this.drag;
      this.engine.moveGroup(groupId, pointer.x - grabOffset.x, pointer.y - grabOffset.y);
      this.syncGroup(this.engine.getGroup(groupId));
    } else if (this.pan) {
      this.world.position.x += event.global.x - this.pan.last.x;
      this.world.position.y += event.global.y - this.pan.last.y;
      this.pan.last = { x: event.global.x, y: event.global.y };
    }
  };

  private handlePointerUp = (): void => {
    if (this.drag && this.engine) {
      const result = this.engine.dropGroup(this.drag.groupId);
      // Se encaixou, o grupo cresceu e pulou para o alinhamento: reposiciona todas as peças dele.
      this.syncGroup(this.engine.getGroup(this.drag.groupId));
      if (result.absorbedGroupIds.length > 0) this.emitProgress();
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

  private syncGroup(group: GroupState): void {
    const { pieces } = this.engine!.puzzle;
    for (const pieceId of group.pieceIds) {
      const piece = pieces[pieceId]!;
      this.sprites[pieceId]!.position.set(piece.x + group.x, piece.y + group.y);
    }
  }

  /** Re-adicionar ao container move a peça para o fim da lista, ou seja, para cima de todas. */
  private bringToFront(group: GroupState): void {
    for (const pieceId of group.pieceIds) this.world.addChild(this.sprites[pieceId]!);
  }

  private emitProgress(): void {
    const engine = this.engine!;
    this.onProgress?.({
      pieces: engine.puzzle.pieces.length,
      groups: engine.groupCount,
      completed: engine.isComplete(),
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
