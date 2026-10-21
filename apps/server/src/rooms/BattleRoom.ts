import { randomUUID } from 'node:crypto';
import { validate, type Client } from '@colyseus/core';
import {
  BATTLE_FORMATS,
  BATTLE_TEAMS,
  BoardSchema,
  CATALOG,
  ChooseTeamMessage,
  CreateBattleOptions,
  GrabMessage,
  MoveMessage,
  PuzzleConfigSchema,
  PuzzleEngine,
  RANDOM_IMAGE,
  RoomState,
  ScatterMessage,
  generatePuzzle,
  gridForPieceCount,
  type BattleTeam,
  type GameMode,
  type GamePhase,
} from '@puzzle/shared';
import { BaseGameRoom } from './BaseGameRoom';
import { BoardRuntime } from './board';
import { uniqueRoomCode } from './roomCode';

/** "Espalhar" mexe na mesa do lado todo: no máximo uma vez a cada 2 s. */
const SCATTER_COOLDOWN_MS = 2000;

const otherTeam = (team: BattleTeam): BattleTeam => (team === 'a' ? 'b' : 'a');

/**
 * Batalha: dois lados (1v1 ou 2v2) montam o mesmo quebra-cabeça, cada um na sua mesa. As duas
 * mesas começam idênticas; quem terminar primeiro ganha. Se um lado sair inteiro no meio, o outro
 * ganha por W.O. No fim, o anfitrião pode pedir revanche (volta ao lobby com os mesmos lados).
 */
export class BattleRoom extends BaseGameRoom {
  private options!: CreateBattleOptions;
  private readonly boards = new Map<BattleTeam, BoardRuntime>();
  private readonly lastScatterAt = new Map<BattleTeam, number>();

  messages = {
    ...this.commonMessages(),
    start: (client: Client) => this.start(client),
    chooseTeam: validate(ChooseTeamMessage, (client, { team }) => this.chooseTeam(client, team)),
    grab: validate(GrabMessage, (client, { groupId, board }) => {
      this.playable(client, board)?.grab(client.sessionId, groupId);
    }),
    move: validate(MoveMessage, (client, message) => {
      this.playable(client, message.board)?.move(client.sessionId, message);
    }),
    drop: validate(MoveMessage, (client, message) => this.drop(client, message)),
    scatter: validate(ScatterMessage, (client, { board }) => this.scatter(client, board)),
    rematch: (client: Client) => this.rematch(client),
  };

  async onCreate(rawOptions: unknown) {
    this.options = CreateBattleOptions.parse(rawOptions);
    this.maxClients = BATTLE_FORMATS[this.options.format];
    // Não reaproveita código guardado por snapshot de uma sala clássica que pode voltar.
    this.roomId = await uniqueRoomCode(async (code) => (await this.snapshots?.has(code)) ?? false);
    this.state = new RoomState({ mode: 'battle' satisfies GameMode });
    await this.setupBoards();
  }

  /** Vagas de cada lado: 1 no 1v1, 2 no 2v2. */
  private get perTeam(): number {
    return BATTLE_FORMATS[this.options.format] / 2;
  }

  /**
   * As duas mesas: um puzzle só, espalhado uma vez, e o lado B recebe uma cópia exata das
   * posições do lado A — ninguém começa com sorte.
   */
  private async setupBoards() {
    const imageId =
      this.options.imageId === RANDOM_IMAGE
        ? CATALOG[Math.floor(Math.random() * CATALOG.length)]!.id
        : this.options.imageId;
    const { width, height } = await this.imageSize(imageId);
    const { rows, cols } = gridForPieceCount(this.options.pieceCount, width / height);
    const seed = randomUUID().slice(0, 8);
    const settings = {
      imageId,
      seed,
      rows,
      cols,
      width,
      height,
      pieceCount: this.options.pieceCount,
      maxPlayers: this.maxClients,
    };
    const puzzle = generatePuzzle({ seed, rows, cols, width, height });
    const first = PuzzleEngine.scattered(puzzle);
    const layout = [...first.allGroups()].map(({ id, x, y, pieceIds }) => ({
      id,
      x,
      y,
      pieceIds: [...pieceIds],
    }));

    this.state.config = new PuzzleConfigSchema(settings);
    for (const team of BATTLE_TEAMS) {
      const board = new BoardSchema({ config: new PuzzleConfigSchema(settings) });
      const engine = team === 'a' ? first : PuzzleEngine.fromGroups(puzzle, layout);
      const runtime = new BoardRuntime(engine, board);
      runtime.mirror();
      this.boards.set(team, runtime);
      this.state.boards.set(team, board);
    }
    this.state.round += 1; // mesas novas: o cliente remonta as duas cenas
  }

  protected currentImageId(): string {
    return this.state.config.imageId;
  }

  protected releaseHeldBy(sessionId: string): void {
    for (const board of this.boards.values()) board.releaseHeldBy(sessionId);
  }

  private teamCount(team: BattleTeam): number {
    return [...this.state.players.values()].filter((player) => player.team === team).length;
  }

  /** Quem entra cai no lado com menos gente (empate: lado A). */
  protected joined(client: Client) {
    const player = this.state.players.get(client.sessionId)!;
    player.team = this.teamCount('b') < this.teamCount('a') ? 'b' : 'a';
  }

  /** Um lado ficou vazio no meio da partida: o outro ganha por W.O. */
  protected left() {
    if (this.phase !== 'playing') return;
    for (const team of BATTLE_TEAMS) {
      if (this.teamCount(team) === 0 && this.teamCount(otherTeam(team)) > 0) {
        this.state.walkover = true;
        this.finish(otherTeam(team));
        return;
      }
    }
  }

  private chooseTeam(client: Client, team: BattleTeam) {
    const player = this.state.players.get(client.sessionId);
    if (!player || this.phase !== 'lobby' || player.team === team) return;
    if (this.teamCount(team) >= this.perTeam) return; // lado cheio
    player.team = team;
  }

  /** "Começar" do anfitrião: precisa de gente nos dois lados. */
  private start(client: Client) {
    if (client.sessionId !== this.state.hostId || this.phase !== 'lobby') return;
    if (BATTLE_TEAMS.some((team) => this.teamCount(team) === 0)) return;
    this.state.phase = 'playing' satisfies GamePhase;
    this.startClock(Date.now(), 0);
  }

  /** O tabuleiro só aceita quem é daquele lado, com a partida valendo e a mesa por montar. */
  private playable(client: Client, board: string | undefined): BoardRuntime | undefined {
    const team = this.state.players.get(client.sessionId)?.team as BattleTeam | '';
    if (!team || board !== team || this.phase !== 'playing') return undefined;
    if (this.state.boards.get(team)?.done) return undefined;
    return this.boards.get(team);
  }

  private drop(client: Client, message: MoveMessage) {
    const runtime = this.playable(client, message.board);
    const result = runtime?.drop(client.sessionId, message);
    if (!result) return;
    const player = this.state.players.get(client.sessionId)!;
    player.snaps += result.snaps;
    if (!result.completed) return;
    const team = player.team as BattleTeam;
    const board = this.state.boards.get(team)!;
    board.done = true;
    board.durationMs = this.elapsed();
    this.finish(team);
  }

  private scatter(client: Client, board: string | undefined) {
    const runtime = this.playable(client, board);
    if (!runtime) return;
    const team = board as BattleTeam;
    const now = Date.now();
    if (now - (this.lastScatterAt.get(team) ?? 0) < SCATTER_COOLDOWN_MS) return;
    this.lastScatterAt.set(team, now);
    runtime.scatter();
  }

  /** Fim: o primeiro lado a montar (ou o que sobrou) ganha; as duas mesas param. */
  private finish(winner: BattleTeam) {
    if (this.phase !== 'playing') return;
    this.clockTimer?.clear();
    this.state.winner = winner;
    this.state.durationMs = this.state.elapsedMs = this.elapsed();
    this.state.phase = 'completed' satisfies GamePhase;
    for (const sessionId of this.state.players.keys()) this.releaseHeldBy(sessionId);
  }

  /** Revanche (anfitrião): mesas novas, mesmos lados; foto nova se era aleatória. */
  private async rematch(client: Client) {
    if (client.sessionId !== this.state.hostId || this.phase !== 'completed') return;
    this.state.phase = 'lobby' satisfies GamePhase;
    this.state.winner = '';
    this.state.walkover = false;
    this.state.elapsedMs = 0;
    this.state.durationMs = 0;
    for (const player of this.state.players.values()) player.snaps = 0;
    this.boards.clear();
    this.state.boards.clear();
    await this.setupBoards();
  }

  onDispose() {
    this.clockTimer?.clear();
  }
}
