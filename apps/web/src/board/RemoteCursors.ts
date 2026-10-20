import { Container, Graphics, Text, type Point as PixiPoint } from 'pixi.js';
import type { Point } from '@puzzle/shared';

interface RemoteCursor {
  view: Container;
  /** Última posição recebida e posição exibida, ambas em coordenadas do tabuleiro. */
  target?: Point;
  shown?: Point;
  connected: boolean;
}

/**
 * Cursores dos outros jogadores. A posição vive em coordenadas do tabuleiro (para continuar no
 * lugar certo quando você dá zoom/pan), mas o desenho fica numa camada de tela, com tamanho fixo.
 */
export class RemoteCursors {
  /**
   * `none`: fora do hit test. Sem isso o cursor de um amigo em cima de uma peça "tampa" o
   * clique (o Pixi respeita oclusão) e o evento cai no fundo, virando pan em vez de pegar a peça.
   */
  readonly layer = new Container({ eventMode: 'none' });
  private readonly cursors = new Map<string, RemoteCursor>();

  add(sessionId: string, name: string, color: string): void {
    const view = new Container();
    const arrow = new Graphics()
      .poly([0, 0, 0, 18, 5, 14, 9, 22, 12, 21, 8, 13, 14, 13])
      .fill(color)
      .stroke({ width: 1.5, color: 0xffffff });
    const label = new Text({
      text: name,
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 12, fill: 0xffffff },
    });
    label.position.set(14, 18);
    const badge = new Graphics()
      .roundRect(label.x - 4, label.y - 2, label.width + 8, label.height + 4, 4)
      .fill(color);
    view.addChild(arrow, badge, label);
    view.visible = false; // só aparece depois da primeira posição
    this.layer.addChild(view);
    this.cursors.set(sessionId, { view, connected: true });
  }

  remove(sessionId: string): void {
    this.cursors.get(sessionId)?.view.destroy({ children: true });
    this.cursors.delete(sessionId);
  }

  setTarget(sessionId: string, x: number, y: number): void {
    const cursor = this.cursors.get(sessionId);
    if (!cursor) return;
    cursor.target = { x, y };
    cursor.shown ??= { x, y };
  }

  setConnected(sessionId: string, connected: boolean): void {
    const cursor = this.cursors.get(sessionId);
    if (cursor) cursor.connected = connected;
  }

  /** `smoothing` ∈ (0, 1]: fração do caminho até o alvo percorrida neste frame. */
  update(smoothing: number, toScreen: (p: Point) => PixiPoint): void {
    for (const cursor of this.cursors.values()) {
      const { target, shown, view } = cursor;
      view.visible = cursor.connected && !!target;
      if (!target || !shown) continue;
      shown.x += (target.x - shown.x) * smoothing;
      shown.y += (target.y - shown.y) * smoothing;
      const screen = toScreen(shown);
      view.position.set(screen.x, screen.y);
    }
  }
}
