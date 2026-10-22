import { randomUUID } from 'node:crypto';
import { validate, type Client, type Delayed } from '@colyseus/core';
import {
  BoardSchema,
  CATALOG,
  CreateBulletOptions,
  GrabMessage,
  MoveMessage,
  PuzzleConfigSchema,
  PuzzleEngine,
  RoomState,
  generatePuzzle,
  gridForPieceCount,
  type GamePhase,
  type GameMode,
  type RankStatus,
} from '@puzzle/shared';
import type { BulletStore } from '../db/bulletStore';
import { BaseGameRoom, identityKey } from './BaseGameRoom';
import { BoardRuntime } from './board';
import { uniqueRoomCode } from './roomCode';

/** Depois de montar, a foto inteira aparece por um instante antes do próximo quebra-cabeça. */
export const NEXT_ROUND_DELAY_MS = 900;
/** O Bullet só tem um tabuleiro por vez. */
const BOARD = 'main';

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

  messages = {
    ...this.commonMessages(),
    start: (client: Client) => {
      if (client.sessionId === this.state.hostId) this.startPlaying();
    },
    grab: validate(GrabMessage, (client, { groupId, board }) => {
      if (this.canPlay(board)) this.board.grab(client.sessionId, groupId);
    }),
    move: validate(MoveMessage, (client, message) => {
      if (this.canPlay(message.board)) this.board.move(client.sessionId, message);
    }),
    drop: validate(MoveMessage, (client, message) => this.drop(client, message)),
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
    this.clockTimer?.clear();
    this.endTimer?.clear();
    this.nextRoundTimer?.clear();
  }

  private canPlay(board: string | undefined): boolean {
    return this.phase === 'playing' && board === BOARD && !this.state.boards.get(BOARD)?.done;
  }

  private startPlaying() {
    if (this.phase !== 'lobby') return;
    this.state.phase = 'playing' satisfies GamePhase;
    const limit = this.state.timeLimitMs;
    this.startClock(Date.now(), 0, () => {
      this.state.remainingMs = Math.max(0, limit - this.elapsed());
    });
    this.endTimer = this.clock.setTimeout(() => this.timeUp(), limit);
  }

  /** "Jogar novamente" (anfitrião, depois do fim): placar e relógio zerados, na mesma sala. */
  private async playAgain(client: Client) {
    if (client.sessionId !== this.state.hostId || this.phase !== 'completed') return;
    if (this.state.rankStatus === 'saving') return; // o resultado ainda vai chegar nesta partida
    Object.assign(this.state, {
      phase: 'lobby' satisfies GamePhase,
      remainingMs: this.state.timeLimitMs,
      elapsedMs: 0,
      durationMs: 0,
      solved: 0,
      partial: 0,
      rankStatus: '' satisfies RankStatus,
      rank: 0,
      rankToday: 0,
      teamSize: 0,
    });
    for (const player of this.state.players.values()) player.snaps = 0;
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
    const { rows, cols } = gridForPieceCount(this.options.pieces, width / height);
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
    const board = new BoardSchema({ config: new PuzzleConfigSchema(settings) });
    this.board = new BoardRuntime(
      PuzzleEngine.scattered(generatePuzzle({ seed, rows, cols, width, height })),
      board,
    );
    this.board.mirror();
    this.state.config = new PuzzleConfigSchema(settings); // a raiz mostra o quebra-cabeça da vez
    this.state.boards.set(BOARD, board);
    this.state.round += 1;
  }

  private drop(client: Client, message: MoveMessage) {
    if (message.board !== BOARD) return;
    const result = this.board.drop(client.sessionId, message);
    if (!result) return;
    const player = this.state.players.get(client.sessionId);
    if (player) player.snaps += result.snaps;
    if (!result.completed || this.phase !== 'playing') return;

    this.state.boards.get(BOARD)!.done = true;
    this.state.solved += 1;
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
    for (const sessionId of this.state.players.keys()) this.board.releaseHeldBy(sessionId);
    this.state.phase = 'completed' satisfies GamePhase;
    this.state.remainingMs = 0;
    this.state.durationMs = this.state.elapsedMs = this.state.timeLimitMs;
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
      .then(({ rank, rankToday }) => {
        this.state.rank = rank;
        this.state.rankToday = rankToday;
        this.state.rankStatus = 'saved' satisfies RankStatus;
      })
      .catch((error: unknown) => {
        console.error(`[bullet ${this.roomId}] falha ao gravar no ranking`, error);
        this.state.rankStatus = 'unavailable' satisfies RankStatus;
      });
  }
}
