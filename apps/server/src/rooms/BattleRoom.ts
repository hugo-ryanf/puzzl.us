import { randomUUID } from 'node:crypto';
import { validate, type Client, type Delayed } from '@colyseus/core';
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
  type GroupState,
  type Puzzle,
  type GameMode,
  type GamePhase,
} from '@puzzle/shared';
import { BaseGameRoom } from './BaseGameRoom';
import { BoardRuntime } from './board';
import { NEXT_ROUND_DELAY_MS } from './BulletRoom';
import { uniqueRoomCode } from './roomCode';

/** "Espalhar" mexe na mesa do lado todo: no máximo uma vez a cada 2 s. */
const SCATTER_COOLDOWN_MS = 2000;

const otherTeam = (team: BattleTeam): BattleTeam => (team === 'a' ? 'b' : 'a');

/** Um quebra-cabeça da sequência da batalha por tempo: igual para os dois lados. */
interface Round {
  settings: NonNullable<ConstructorParameters<typeof PuzzleConfigSchema>[0]>;
  puzzle: Puzzle;
  layout: GroupState[];
}

/**
 * Batalha: dois lados (1v1 ou 2v2), cada um na sua mesa, sempre com as mesmas peças nas mesmas
 * posições. Corrida: um quebra-cabeça só, quem terminar primeiro ganha. Por tempo (`minutes`):
 * uma sequência de fotos sorteadas, igual para os dois; montou um, vem o próximo (cada lado no seu
 * ritmo) e, no fim do tempo, ganha quem montou mais — empate, quem tem mais peças encaixadas no
 * que ficou pela metade; persistindo, empate. Se um lado sair inteiro no meio, o outro ganha por
 * W.O. No fim, o anfitrião pode pedir revanche (volta ao lobby com os mesmos lados).
 */
export class BattleRoom extends BaseGameRoom {
  private options!: CreateBattleOptions;
  private readonly boards = new Map<BattleTeam, BoardRuntime>();
  private readonly lastScatterAt = new Map<BattleTeam, number>();
  /** Por tempo: a sequência de quebra-cabeças (cresce conforme o lado mais rápido avança). */
  private rounds: Round[] = [];
  /** Por tempo: em que quebra-cabeça da sequência cada lado está. */
  private readonly position = new Map<BattleTeam, number>();
  private deck: string[] = [];
  private endTimer?: Delayed;
  private readonly nextRoundTimers = new Map<BattleTeam, Delayed>();

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
    playAgain: (client: Client) => this.rematch(client),
  };

  async onCreate(rawOptions: unknown) {
    this.options = CreateBattleOptions.parse(rawOptions);
    this.maxClients = BATTLE_FORMATS[this.options.format];
    // Não reaproveita código guardado por snapshot de uma sala clássica que pode voltar.
    this.roomId = await uniqueRoomCode(async (code) => (await this.snapshots?.has(code)) ?? false);
    const timeLimitMs = (this.options.minutes ?? 0) * 60_000;
    this.state = new RoomState({
      mode: 'battle' satisfies GameMode,
      timeLimitMs,
      remainingMs: timeLimitMs,
    });
    await this.setupBoards();
  }

  /** Batalha por tempo (quem monta mais), e não corrida (quem monta primeiro). */
  private get timed(): boolean {
    return this.options.minutes !== undefined;
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
    if (this.timed) {
      this.rounds = [];
      this.deck = [];
      for (const team of BATTLE_TEAMS) this.placeRound(team, 0, 0);
      this.state.config = new PuzzleConfigSchema(this.rounds[0]!.settings);
      this.state.round += 1;
      return;
    }
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

  /** Próxima foto do baralho do catálogo; acabou, embaralha de novo (sem repetir a última). */
  private drawImage(): string {
    if (this.deck.length === 0) {
      const last = this.rounds.at(-1)?.settings.imageId;
      this.deck = CATALOG.map((image) => image.id)
        .filter((id) => id !== last)
        .sort(() => Math.random() - 0.5);
    }
    return this.deck.pop()!;
  }

  /** O quebra-cabeça `index` da sequência, sorteado e espalhado na primeira vez que alguém chega. */
  private roundAt(index: number): Round {
    while (this.rounds.length <= index) {
      const imageId = this.drawImage();
      const { width, height } = CATALOG.find((image) => image.id === imageId)!;
      const { rows, cols } = gridForPieceCount(this.options.pieceCount, width / height);
      const seed = randomUUID().slice(0, 8);
      const puzzle = generatePuzzle({ seed, rows, cols, width, height });
      const layout = [...PuzzleEngine.scattered(puzzle).allGroups()].map(
        ({ id, x, y, pieceIds }) => ({ id, x, y, pieceIds: [...pieceIds] }),
      );
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
      this.rounds.push({ settings, puzzle, layout });
    }
    return this.rounds[index]!;
  }

  /** Põe o lado no quebra-cabeça `index` (mesa nova; o cliente remonta só a desse lado). */
  private placeRound(team: BattleTeam, index: number, solved: number) {
    const { settings, puzzle, layout } = this.roundAt(index);
    const board = new BoardSchema({ config: new PuzzleConfigSchema(settings), solved });
    const runtime = new BoardRuntime(PuzzleEngine.fromGroups(puzzle, layout), board);
    runtime.mirror();
    this.position.set(team, index);
    this.boards.set(team, runtime);
    this.state.boards.set(team, board);
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
    if (!this.timed) {
      this.startClock(Date.now(), 0);
      return;
    }
    const limit = this.state.timeLimitMs;
    this.startClock(Date.now(), 0, () => {
      this.state.remainingMs = Math.max(0, limit - this.elapsed());
    });
    this.endTimer = this.clock.setTimeout(() => this.timeUp(), limit);
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
    if (!this.timed) {
      this.finish(team);
      return;
    }
    // Por tempo: conta e, depois de a foto aparecer montada, vem o próximo da sequência.
    board.solved += 1;
    const solved = board.solved;
    this.nextRoundTimers.set(
      team,
      this.clock.setTimeout(() => {
        if (this.phase === 'playing') this.placeRound(team, this.position.get(team)! + 1, solved);
      }, NEXT_ROUND_DELAY_MS),
    );
  }

  /**
   * Acabou o tempo: mais montados ganha; empate, mais peças encaixadas no quebra-cabeça que ficou
   * pela metade (o que acabou de montar conta como montado, sem metade); senão, empate.
   */
  protected timeUp() {
    if (this.phase !== 'playing') return;
    const score = (team: BattleTeam) => {
      const board = this.state.boards.get(team)!;
      return [board.solved, board.done ? 0 : this.boards.get(team)!.placed()] as const;
    };
    const [a, b] = [score('a'), score('b')];
    const diff = a[0] - b[0] || a[1] - b[1];
    this.state.remainingMs = 0;
    this.finish(diff > 0 ? 'a' : diff < 0 ? 'b' : 'draw');
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

  /** Fim: o primeiro lado a montar, o que montou mais (ou o que sobrou) ganha; as mesas param. */
  private finish(winner: BattleTeam | 'draw') {
    if (this.phase !== 'playing') return;
    this.clockTimer?.clear();
    this.endTimer?.clear();
    for (const timer of this.nextRoundTimers.values()) timer.clear();
    this.nextRoundTimers.clear();
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
    this.state.remainingMs = this.state.timeLimitMs;
    for (const player of this.state.players.values()) player.snaps = 0;
    this.boards.clear();
    this.state.boards.clear();
    await this.setupBoards();
  }

  onDispose() {
    this.clockTimer?.clear();
    this.endTimer?.clear();
    for (const timer of this.nextRoundTimers.values()) timer.clear();
  }
}
