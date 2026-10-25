import { randomUUID } from 'node:crypto';
import { validate, type Client, type Delayed } from '@colyseus/core';
import {
  BoardSchema,
  CATALOG,
  CreateBulletOptions,
  GrabMessage,
  RotateMessage,
  LIGHTNING_PIECES,
  MAGNET_PIECES,
  MAX_HELPERS,
  MoveMessage,
  PuzzleConfigSchema,
  SlideMessage,
  SlideSchema,
  EMPTY_TILE,
  canSlide,
  isSolved,
  scrambleTiles,
  slide,
  PuzzleEngine,
  RoomState,
  generatePuzzle,
  gridForPieceCount,
  isLightningRound,
  type GamePhase,
  type GameMode,
  type RankStatus,
} from '@puzzle/shared';
import type { BulletStore } from '../db/bulletStore';
import { BaseGameRoom, ROTATION, identityKey } from './BaseGameRoom';
import { BoardRuntime } from './board';
import { uniqueRoomCode } from './roomCode';

/** Depois de montar, a foto inteira aparece por um instante antes do próximo quebra-cabeça. */
export const NEXT_ROUND_DELAY_MS = 900;
/** O Bullet só tem um tabuleiro por vez. */
const BOARD = 'main';
/** Bônus de tempo: encaixar a peça dourada e montar um quebra-cabeça antes da meta. */
export const GOLDEN_BONUS_MS = 5000;
export const FAST_BONUS_MS = 5000;
/** Meta para o bônus de montar rápido, por peça (12 peças: 40 s; 24: 80 s). */
const FAST_MS_PER_PIECE = 40_000 / 12;

/**
 * Bullet: contra o relógio, a equipe monta quantos quebra-cabeças pequenos conseguir. Montou um,
 * entra outro (foto sorteada do catálogo, sem repetir até acabar o baralho). No fim do tempo,
 * vale quantos foram montados; empate, as peças encaixadas no que ficou pela metade.
 */
export class BulletRoom extends BaseGameRoom {
  /** Ranking do Bullet; injetado por createGameServer. Sem banco, fica undefined. */
  protected bullet?: BulletStore;

  private options!: CreateBulletOptions;
  private board!: BoardRuntime;
  /** Fotos ainda não usadas nesta sala, embaralhadas. */
  private deck: string[] = [];
  private endTimer?: Delayed;
  private nextRoundTimer?: Delayed;
  /** Quebra-cabeças desta partida (o 4º, o 8º… são relâmpago) e quando o da vez apareceu. */
  private puzzlesInGame = 0;
  private roundShownAt = 0;

  messages = {
    ...this.commonMessages(),
    start: (client: Client) => {
      if (client.sessionId === this.state.hostId) this.startPlaying();
    },
    grab: validate(GrabMessage, (client, { groupId, board }) => {
      if (this.canPlay(board)) this.board.grab(client.sessionId, groupId);
    }),
    rotate: validate(RotateMessage, (client, { groupId, board }) => {
      if (this.canPlay(board)) this.board.rotate(client.sessionId, groupId);
    }),
    move: validate(MoveMessage, (client, message) => {
      if (this.canPlay(message.board)) this.board.move(client.sessionId, message);
    }),
    drop: validate(MoveMessage, (client, message) => this.drop(client, message)),
    magnet: () => this.useMagnet(),
    slide: validate(SlideMessage, (_client, { index }) => this.slideTile(index)),
    scatter: () => {
      if (this.canPlay(BOARD)) this.board.scatter();
    },
    playAgain: (client: Client) => void this.playAgain(client),
  };

  async onCreate(rawOptions: unknown) {
    this.options = CreateBulletOptions.parse(rawOptions);
    this.maxClients = this.options.maxPlayers;
    // Não reaproveita código guardado por snapshot de uma sala clássica que pode voltar.
    this.roomId = await uniqueRoomCode(async (code) => (await this.snapshots?.has(code)) ?? false);
    this.state = new RoomState({
      mode: 'bullet' satisfies GameMode,
      timeLimitMs: this.options.minutes * 60_000,
      remainingMs: this.options.minutes * 60_000,
    });
    this.nextRound(); // o primeiro já aparece no lobby (travado até o "Começar")
  }

  protected currentImageId(): string {
    return this.state.config.imageId;
  }

  protected releaseHeldBy(sessionId: string): void {
    this.board?.releaseHeldBy(sessionId);
  }

  protected joined() {
    // Solo não tem ninguém para esperar: o relógio começa já.
    if (this.options.maxPlayers === 1) this.startPlaying();
  }

  onDispose() {
    this.countdownTimer?.clear();
    this.clockTimer?.clear();
    this.endTimer?.clear();
    this.nextRoundTimer?.clear();
  }

  private canPlay(board: string | undefined): boolean {
    if (this.phase !== 'playing' || this.state.countdown > 0 || board !== BOARD) return false;
    if (this.state.slides.size > 0) return false; // rodada relâmpago: a mesa é a grade
    return !this.state.boards.get(BOARD)?.done;
  }

  private startPlaying() {
    if (this.phase !== 'lobby') return;
    this.state.phase = 'playing' satisfies GamePhase;
    this.startAfterCountdown(() => {
      this.startClock(Date.now(), 0, () => {
        this.state.remainingMs = Math.max(0, this.limit() - this.elapsed());
      });
      this.roundShownAt = 0;
      this.scheduleEnd();
    });
  }

  /** Tempo total da partida: o escolhido mais os bônus. */
  private limit(): number {
    return this.state.timeLimitMs + this.state.bonusMs;
  }

  private scheduleEnd() {
    this.endTimer?.clear();
    this.endTimer = this.clock.setTimeout(() => this.timeUp(), this.limit() - this.elapsed());
  }

  /** Bônus de tempo (só com o relógio correndo): o fim da partida anda junto. */
  private addTime(ms: number) {
    if (this.phase !== 'playing' || this.state.countdown > 0) return;
    this.state.bonusMs += ms;
    this.state.remainingMs = Math.max(0, this.limit() - this.elapsed());
    this.scheduleEnd();
  }

  /** "Jogar novamente" (anfitrião, depois do fim): placar e relógio zerados, na mesma sala. */
  private async playAgain(client: Client) {
    if (client.sessionId !== this.state.hostId || this.phase !== 'completed') return;
    if (this.state.rankStatus === 'saving') return; // o resultado ainda vai chegar nesta partida
    Object.assign(this.state, {
      phase: 'lobby' satisfies GamePhase,
      remainingMs: this.state.timeLimitMs,
      bonusMs: 0,
      helpers: 0,
      record: false,
      elapsedMs: 0,
      durationMs: 0,
      solved: 0,
      partial: 0,
      rankStatus: '' satisfies RankStatus,
      rank: 0,
      rankToday: 0,
      teamSize: 0,
    });
    this.resetSnaps();
    this.puzzlesInGame = 0;
    this.nextRound();
    await this.unlock();
    if (this.options.maxPlayers === 1) this.startPlaying();
  }

  /** Próxima foto do baralho; acabou, embaralha de novo (sem repetir a última). */
  private drawImage(): string {
    if (this.deck.length === 0) {
      const last = this.state.config?.imageId;
      this.deck = CATALOG.map((image) => image.id)
        .filter((id) => id !== last)
        .sort(() => Math.random() - 0.5);
    }
    return this.deck.pop()!;
  }

  /** Quebra-cabeça novo: tabuleiro novo no lugar do anterior (o cliente remonta a mesa). */
  protected nextRound() {
    const imageId = this.drawImage();
    const { width, height } = CATALOG.find((image) => image.id === imageId)!;
    const lightning = isLightningRound(this.puzzlesInGame++);
    const pieces = lightning ? LIGHTNING_PIECES : this.options.pieces;
    const { rows, cols } = gridForPieceCount(pieces, width / height);
    const seed = randomUUID().slice(0, 8);
    const settings = {
      imageId,
      seed,
      rows,
      cols,
      width,
      height,
      pieceCount: this.options.pieces,
      maxPlayers: this.options.maxPlayers,
    };
    const board = new BoardSchema({
      config: new PuzzleConfigSchema(settings),
      lightning,
      // O relâmpago já é curto: sem dourada.
      golden: lightning ? -1 : Math.floor(Math.random() * rows * cols),
    });
    this.board = new BoardRuntime(
      PuzzleEngine.scattered(generatePuzzle({ seed, rows, cols, width, height }), {
        rotate: ROTATION.enabled,
      }),
      board,
    );
    this.board.mirror();
    this.state.config = new PuzzleConfigSchema(settings); // a raiz mostra o quebra-cabeça da vez
    this.state.boards.set(BOARD, board);
    this.state.slides.clear();
    if (lightning) {
      // Relâmpago: no lugar das peças, a grade de deslizar (a mesa fica guardada por baixo).
      const grid = new SlideSchema({ moves: 0 });
      grid.tiles.push(...scrambleTiles(Math.random));
      this.state.slides.set(BOARD, grid);
    }
    this.state.round += 1;
    this.roundShownAt = this.state.countdown > 0 || this.phase !== 'playing' ? 0 : this.elapsed();
  }

  /** Ímã: gasta uma ajuda e encaixa sozinho algumas peças da mesa da vez. */
  private useMagnet() {
    if (!this.canPlay(BOARD) || this.state.helpers === 0) return;
    this.state.helpers -= 1;
    this.afterSnaps(this.board.magnet(MAGNET_PIECES));
  }

  private drop(client: Client, message: MoveMessage) {
    if (message.board !== BOARD) return;
    const result = this.board.drop(client.sessionId, message);
    if (!result) return;
    this.countSnaps(client.sessionId, result.snaps);
    this.afterSnaps(result);
  }

  /** Depois de encaixes (da mão de alguém ou do ímã): dourada, quebra-cabeça montado e bônus. */
  private afterSnaps(result: { snaps: number; completed: boolean }) {
    if (result.snaps === 0 || this.phase !== 'playing') return;
    const board = this.state.boards.get(BOARD)!;
    if (board.golden >= 0 && this.board.isSnapped(board.golden)) {
      board.golden = -1;
      this.addTime(GOLDEN_BONUS_MS);
    }
    if (result.completed) this.roundSolved();
  }

  /** Relâmpago: desliza uma casa (qualquer jogador da sala); montou, conta como montado. */
  private slideTile(index: number) {
    const grid = this.state.slides.get(BOARD);
    const board = this.state.boards.get(BOARD);
    if (!grid || !board || board.done || this.phase !== 'playing' || this.state.countdown > 0) {
      return;
    }
    const tiles = [...grid.tiles];
    if (!canSlide(tiles, index)) return;
    const empty = tiles.indexOf(EMPTY_TILE);
    const next = slide(tiles, index);
    grid.tiles[empty] = next[empty]!;
    grid.tiles[index] = next[index]!;
    grid.moves += 1;
    if (isSolved(next)) this.roundSolved();
  }

  /** Quebra-cabeça da vez montado (ou a grade do relâmpago): conta, bônus e o próximo. */
  private roundSolved() {
    const board = this.state.boards.get(BOARD)!;
    board.done = true;
    this.state.solved += 1;
    if (board.lightning) {
      this.state.helpers = Math.min(MAX_HELPERS, this.state.helpers + 1);
    } else if (this.elapsed() - this.roundShownAt <= FAST_MS_PER_PIECE * this.options.pieces) {
      this.addTime(FAST_BONUS_MS);
    }
    this.nextRoundTimer = this.clock.setTimeout(() => {
      if (this.phase === 'playing') this.nextRound();
    }, NEXT_ROUND_DELAY_MS);
  }

  /** Acabou o tempo: fecha a sala e grava a corrida (sem travar o jogo esperando o banco). */
  protected timeUp() {
    if (this.phase !== 'playing') return;
    const finishedAt = Date.now();
    this.clockTimer?.clear();
    this.endTimer?.clear();
    this.nextRoundTimer?.clear();
    const board = this.state.boards.get(BOARD)!;
    this.state.slides.clear();
    for (const sessionId of this.state.players.keys()) this.board.releaseHeldBy(sessionId);
    this.state.phase = 'completed' satisfies GamePhase;
    this.state.remainingMs = 0;
    this.state.durationMs = this.state.elapsedMs = this.limit();
    this.state.partial = board.done ? 0 : this.board.placed();
    const team = this.team();
    this.state.teamSize = new Set(team.map(identityKey)).size;
    void this.lock();

    if (!this.bullet) {
      this.state.rankStatus = 'unavailable' satisfies RankStatus;
      return;
    }
    this.state.rankStatus = 'saving' satisfies RankStatus;
    this.bullet
      .saveRun({
        roomCode: this.roomId,
        minutes: this.options.minutes,
        pieceCount: this.options.pieces,
        solved: this.state.solved,
        partial: this.state.partial,
        startedAt: new Date(this.startedAt),
        finishedAt: new Date(finishedAt),
        players: team,
      })
      .then(({ rank, rankToday, record }) => {
        this.state.rank = rank;
        this.state.rankToday = rankToday;
        this.state.record = record;
        this.state.rankStatus = 'saved' satisfies RankStatus;
      })
      .catch((error: unknown) => {
        console.error(`[bullet ${this.roomId}] falha ao gravar no ranking`, error);
        this.state.rankStatus = 'unavailable' satisfies RankStatus;
      });
  }
}
