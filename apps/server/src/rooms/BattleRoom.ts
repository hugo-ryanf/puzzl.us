import { randomUUID } from 'node:crypto';
import { validate, type Client, type Delayed } from '@colyseus/core';
import {
  BATTLE_FORMATS,
  BATTLE_TEAMS,
  BoardSchema,
  CATALOG,
  ChooseTeamMessage,
  CreateBattleOptions,
  EMPTY_TILE,
  ENERGY_GOLDEN,
  ENERGY_LIGHTNING,
  ENERGY_PER_COMBO,
  ENERGY_PER_SNAP,
  ENERGY_SOLVED,
  FOG_MS,
  FREEZE_MS,
  GrabMessage,
  RotateMessage,
  MAX_ENERGY,
  MoveMessage,
  POWER_COOLDOWN_MS,
  POWER_COST,
  PuzzleConfigSchema,
  PuzzleEngine,
  RANDOM_IMAGE,
  RoomState,
  SLIDE_LIMIT_SECONDS,
  SLIDE_RESULT_MS,
  ScatterMessage,
  SlideMessage,
  SlideSchema,
  UsePowerMessage,
  canSlide,
  isSolved,
  scrambleTiles,
  slide,
  solvedTiles,
  generatePuzzle,
  gridForPieceCount,
  type BattlePower,
  type DevAction,
  type BattleTeam,
  type PowerBroadcast,
  type Puzzle,
  type GameMode,
  type GamePhase,
} from '@puzzle/shared';
import type { BattleStore } from '../db/battleStore';
import type { TeamMember } from '../db/gameStore';
import { BaseGameRoom, ROTATION } from './BaseGameRoom';
import { BoardRuntime } from './board';
import { NEXT_ROUND_DELAY_MS } from './BulletRoom';
import { uniqueRoomCode } from './roomCode';

/** "Espalhar" mexe na mesa do lado todo: no máximo uma vez a cada 2 s. */
const SCATTER_COOLDOWN_MS = 2000;

const otherTeam = (team: BattleTeam): BattleTeam => (team === 'a' ? 'b' : 'a');

/**
 * Um quebra-cabeça da sequência da batalha por tempo: a mesma foto e as mesmas peças para os
 * dois lados, espalhadas de um jeito diferente em cada um.
 */
interface Round {
  settings: NonNullable<ConstructorParameters<typeof PuzzleConfigSchema>[0]>;
  puzzle: Puzzle;
  /** A peça dourada: a mesma nos dois lados. */
  golden: number;
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
  /** Placar de vitórias (perfil); injetado por createGameServer. Sem banco, fica undefined. */
  protected battles?: BattleStore;
  /** Quem começou a partida em cada lado (quem sair no meio continua contando). */
  private lineup?: Record<BattleTeam, TeamMember[]>;
  /** Batalha por tempo: quem estava na frente a 10 s do fim ('' = empatados), para a virada. */
  private leaderAt10s: BattleTeam | '' = '';
  private leaderTimer?: Delayed;
  /** Relâmpagos da partida: em que tempo de jogo (ms) cada um ainda vai aparecer. */
  private lightningAt: number[] = [];
  /** Tempo de jogo quando o relâmpago pausou a partida (o relógio volta daqui). */
  private pausedAt = 0;
  private slideTimer?: Delayed;
  private resumeTimer?: Delayed;

  messages = {
    ...this.commonMessages(),
    start: (client: Client) => this.start(client),
    chooseTeam: validate(ChooseTeamMessage, (client, { team }) => this.chooseTeam(client, team)),
    grab: validate(GrabMessage, (client, { groupId, board }) => {
      this.playable(client, board)?.grab(client.sessionId, groupId);
    }),
    rotate: validate(RotateMessage, (client, { groupId, board }) => {
      this.playable(client, board)?.rotate(client.sessionId, groupId);
    }),
    move: validate(MoveMessage, (client, message) => {
      this.playable(client, message.board)?.move(client.sessionId, message);
    }),
    drop: validate(MoveMessage, (client, message) => this.drop(client, message)),
    scatter: validate(ScatterMessage, (client, { board }) => this.scatter(client, board)),
    usePower: validate(UsePowerMessage, (client, { power }) => this.usePower(client, power)),
    slide: validate(SlideMessage, (client, { index }) => this.slideTile(client, index)),
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
      powers: this.options.powers,
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

    this.state.config = new PuzzleConfigSchema(settings);
    for (const team of BATTLE_TEAMS) {
      const board = new BoardSchema({ config: new PuzzleConfigSchema(settings) });
      // Mesmo quebra-cabeça, espalhado de outro jeito em cada lado.
      const runtime = new BoardRuntime(
        PuzzleEngine.scattered(puzzle, { salt: team, rotate: ROTATION.enabled }),
        board,
      );
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
      const golden = Math.floor(Math.random() * rows * cols);
      this.rounds.push({ settings, puzzle, golden });
    }
    return this.rounds[index]!;
  }

  /** Põe o lado no quebra-cabeça `index` (mesa nova; o cliente remonta só a desse lado). */
  private placeRound(team: BattleTeam, index: number, solved: number) {
    const { settings, puzzle, golden } = this.roundAt(index);
    // Energia, escudo e efeitos são do lado, não da mesa: passam para o quebra-cabeça seguinte.
    const previous = this.state.boards.get(team);
    const board = new BoardSchema({
      config: new PuzzleConfigSchema(settings),
      solved,
      golden,
      energy: previous?.energy ?? 0,
      shield: previous?.shield ?? false,
      powerReadyAt: previous?.powerReadyAt ?? 0,
      fogUntil: previous?.fogUntil ?? 0,
      frozenUntil: previous?.frozenUntil ?? 0,
    });
    const runtime = new BoardRuntime(
      PuzzleEngine.scattered(puzzle, { salt: team, rotate: ROTATION.enabled }),
      board,
    );
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
    const sessionsOf = (team: BattleTeam) =>
      [...this.state.players.entries()].filter(([, p]) => p.team === team).map(([id]) => id);
    this.lineup = { a: this.team(sessionsOf('a')), b: this.team(sessionsOf('b')) };
    this.leaderAt10s = '';
    this.lightningAt = this.lightningTimes();
    if (!this.timed) {
      this.runClock(Date.now(), 0);
      return;
    }
    this.startAfterCountdown(() => this.runClock(Date.now(), 0));
  }

  /**
   * Quando vêm os relâmpagos (tempo de jogo, ms): por tempo, 1 em 3 min e 2 em 5 ou 10, cada um
   * sorteado na sua faixa entre 20% e 80% da partida; na corrida, 1 entre 40 s e 100 s.
   */
  private lightningTimes(): number[] {
    const between = (from: number, to: number) => from + Math.random() * (to - from);
    if (!this.timed) return [between(40_000, 100_000)];
    const limit = this.state.timeLimitMs;
    const count = this.options.minutes === 3 ? 1 : 2;
    const width = 0.6 / count;
    return Array.from({ length: count }, (_, i) => {
      const start = 0.2 + i * width;
      return between((start + 0.05) * limit, (start + width - 0.05) * limit);
    });
  }

  /**
   * Liga (ou religa, depois de um relâmpago) o relógio a partir de `elapsedMs`: na batalha por
   * tempo, também o fim e o momento de ver quem está na frente a 10 s do fim.
   */
  private runClock(startedAt: number, elapsedMs: number) {
    this.startClock(startedAt, elapsedMs, () => this.tick());
    if (!this.timed) return;
    const limit = this.state.timeLimitMs;
    this.endTimer?.clear();
    this.endTimer = this.clock.setTimeout(() => this.timeUp(), limit - elapsedMs);
    this.leaderTimer?.clear();
    if (limit - 10_000 > elapsedMs) {
      this.leaderTimer = this.clock.setTimeout(
        () => {
          this.leaderAt10s = this.leader();
        },
        limit - 10_000 - elapsedMs,
      );
    }
  }

  /** A cada segundo de jogo: o tempo que falta e se chegou a hora de um relâmpago. */
  private tick() {
    if (this.timed) this.state.remainingMs = Math.max(0, this.state.timeLimitMs - this.elapsed());
    const next = this.lightningAt[0];
    if (next !== undefined && this.elapsed() >= next) {
      this.lightningAt.shift();
      this.startLightning();
    }
  }

  /**
   * Relâmpago: pausa as duas mesas (o relógio para e as peças na mão caem) e dá aos dois lados a
   * mesma grade embaralhada. Quem montar primeiro leva energia cheia.
   */
  protected startLightning() {
    if (this.phase !== 'playing' || this.state.suddenDeath || this.state.slides.size > 0) return;
    this.pausedAt = this.elapsed();
    this.clockTimer?.clear();
    this.endTimer?.clear();
    this.leaderTimer?.clear();
    for (const sessionId of this.state.players.keys()) this.releaseHeldBy(sessionId);
    const tiles = scrambleTiles(Math.random);
    for (const team of BATTLE_TEAMS) {
      const grid = new SlideSchema({ moves: 0 });
      grid.tiles.push(...tiles);
      this.state.slides.set(team, grid);
    }
    this.state.slideWinner = '';
    this.state.slideSeconds = SLIDE_LIMIT_SECONDS;
    this.slideTimer = this.clock.setInterval(() => {
      this.state.slideSeconds -= 1;
      if (this.state.slideSeconds === 0) this.endLightning('');
    }, 1000);
  }

  private slideTile(client: Client, index: number) {
    const team = this.state.players.get(client.sessionId)?.team as BattleTeam | '';
    const grid = team ? this.state.slides.get(team) : undefined;
    if (!grid || this.state.slideWinner !== '' || this.phase !== 'playing') return;
    const tiles = [...grid.tiles];
    if (!canSlide(tiles, index)) return;
    const empty = tiles.indexOf(EMPTY_TILE);
    const next = slide(tiles, index);
    grid.tiles[empty] = next[empty]!;
    grid.tiles[index] = next[index]!;
    grid.moves += 1;
    if (isSolved(next)) this.endLightning(team as BattleTeam);
  }

  /** Fim do relâmpago: o vencedor (ou ninguém) aparece um instante e as mesas voltam. */
  private endLightning(winner: BattleTeam | '') {
    if (this.state.slideWinner !== '') return;
    this.slideTimer?.clear();
    this.state.slideWinner = winner || 'none';
    if (winner) this.gainEnergy(this.state.boards.get(winner)!, ENERGY_LIGHTNING);
    this.resumeTimer = this.clock.setTimeout(() => this.resumeAfterLightning(), SLIDE_RESULT_MS);
  }

  private resumeAfterLightning() {
    this.state.slides.clear();
    this.state.slideWinner = '';
    this.state.slideSeconds = 0;
    if (this.phase === 'playing') this.runClock(this.startedAt, this.pausedAt);
  }

  /** Para tudo do relâmpago (fim da partida, revanche, sala fechando). */
  private clearLightning() {
    this.slideTimer?.clear();
    this.resumeTimer?.clear();
    this.lightningAt = [];
    this.state.slides.clear();
    this.state.slideWinner = '';
    this.state.slideSeconds = 0;
  }

  /** Quem está na frente agora (montados, depois peças encaixadas no da vez); '' empatados. */
  private leader(): BattleTeam | '' {
    const score = (team: BattleTeam) => {
      const board = this.state.boards.get(team)!;
      return board.solved * 10_000 + (board.done ? 0 : this.boards.get(team)!.placed());
    };
    const diff = score('a') - score('b');
    return diff > 0 ? 'a' : diff < 0 ? 'b' : '';
  }

  /** O tabuleiro só aceita quem é daquele lado, com a partida valendo e a mesa por montar. */
  private playable(client: Client, board: string | undefined): BoardRuntime | undefined {
    const team = this.state.players.get(client.sessionId)?.team as BattleTeam | '';
    if (!team || board !== team || this.phase !== 'playing' || this.state.countdown > 0) {
      return undefined;
    }
    if (this.state.slides.size > 0) return undefined; // relâmpago: as mesas esperam
    const side = this.state.boards.get(team);
    // Congelado (poder do adversário): ninguém do lado pega nem solta peças até passar.
    if (!side || side.done || side.frozenUntil > this.elapsed()) return undefined;
    return this.boards.get(team);
  }

  private drop(client: Client, message: MoveMessage) {
    const runtime = this.playable(client, message.board);
    const result = runtime?.drop(client.sessionId, message);
    if (!result) return;
    const player = this.state.players.get(client.sessionId)!;
    this.countSnaps(client.sessionId, result.snaps);
    this.afterSnaps(player.team as BattleTeam, runtime!, result, player.combo);
  }

  /** Depois de encaixes num lado: energia, dourada e, montado, o fim ou o próximo. */
  private afterSnaps(
    team: BattleTeam,
    runtime: BoardRuntime,
    result: { snaps: number; completed: boolean },
    combo: number,
  ) {
    const board = this.state.boards.get(team)!;
    if (result.snaps > 0) {
      this.gainEnergy(
        board,
        result.snaps * ENERGY_PER_SNAP + Math.max(0, combo - 1) * ENERGY_PER_COMBO,
      );
    }
    if (board.golden >= 0 && runtime.isSnapped(board.golden)) {
      board.golden = -1;
      this.gainEnergy(board, ENERGY_GOLDEN);
    }
    if (!result.completed) return;
    board.done = true;
    board.durationMs = this.elapsed();
    // Corrida, ou a morte súbita da batalha por tempo: quem montar primeiro ganha.
    if (!this.timed || this.state.suddenDeath) {
      this.finish(team);
      return;
    }
    // Por tempo: conta e, depois de a foto aparecer montada, vem o próximo da sequência.
    this.gainEnergy(board, ENERGY_SOLVED);
    board.solved += 1;
    const solved = board.solved;
    this.nextRoundTimers.set(
      team,
      this.clock.setTimeout(() => {
        if (this.phase === 'playing') this.placeRound(team, this.position.get(team)! + 1, solved);
      }, NEXT_ROUND_DELAY_MS),
    );
  }

  protected devCommand(client: Client, action: DevAction, value?: number) {
    const team = this.state.players.get(client.sessionId)?.team as BattleTeam | '';
    if (!team || this.phase !== 'playing') return;
    if (action === 'skipCountdown') return this.skipCountdown();
    if (this.state.countdown > 0) return;
    const other = otherTeam(team);
    const board = this.state.boards.get(team)!;
    const theirs = this.state.boards.get(other)!;
    const sliding = this.state.slides.size > 0;
    const solveSide = (side: BattleTeam) => {
      const target = this.state.boards.get(side)!;
      if (sliding || target.done) return;
      const runtime = this.boards.get(side)!;
      this.afterSnaps(side, runtime, runtime.solveAll(), 1);
    };
    switch (action) {
      case 'restartCountdown': {
        if (sliding) return;
        // O relógio para, o "3, 2, 1" volta e a partida continua de onde estava.
        const elapsed = this.elapsed();
        this.clockTimer?.clear();
        this.endTimer?.clear();
        this.leaderTimer?.clear();
        this.startAfterCountdown(() => this.runClock(this.startedAt, elapsed));
        return;
      }
      case 'time':
        if (value === undefined || !this.timed || sliding || this.state.suddenDeath) return;
        this.runClock(this.startedAt, Math.max(0, this.state.timeLimitMs - value * 1000));
        return this.tick();
      case 'endNow':
        // Por tempo: o fim normal (pode dar morte súbita); corrida: o meu lado ganha.
        if (sliding) return;
        return this.timed && !this.state.suddenDeath ? this.timeUp() : this.finish(team);
      case 'suddenDeath':
        if (!this.timed || sliding || this.state.suddenDeath) return;
        this.endTimer?.clear();
        this.state.remainingMs = 0;
        return this.suddenDeath();
      case 'lightning':
        return this.startLightning();
      case 'slideSolve': {
        const grid = this.state.slides.get(team);
        if (!grid || this.state.slideWinner !== '') return;
        solvedTiles().forEach((tile, position) => (grid.tiles[position] = tile));
        return this.endLightning(team);
      }
      case 'slideTime':
        if (sliding && this.state.slideWinner === '' && value !== undefined) {
          this.state.slideSeconds = Math.max(1, Math.min(SLIDE_LIMIT_SECONDS, value));
        }
        return;
      case 'solve':
        return solveSide(team);
      case 'solveThem':
        return solveSide(other);
      case 'straighten':
        return this.boards.get(team)!.straightenAll();
      case 'combo': {
        const player = this.state.players.get(client.sessionId)!;
        player.combo = Math.min(9, Math.max(1, player.combo) + 1);
        return;
      }
      case 'energy':
        board.energy = MAX_ENERGY;
        board.powerReadyAt = 0;
        return;
      case 'shieldMe':
        board.shield = true;
        return;
      case 'fogMe':
        board.fogUntil = this.elapsed() + FOG_MS;
        return;
      case 'freezeMe':
        board.frozenUntil = this.elapsed() + FREEZE_MS;
        return;
      case 'fogThem':
        theirs.fogUntil = this.elapsed() + FOG_MS;
        return;
      case 'freezeThem':
        theirs.frozenUntil = this.elapsed() + FREEZE_MS;
        return;
    }
  }

  private gainEnergy(board: BoardSchema, amount: number) {
    if (this.state.powers) board.energy = Math.min(MAX_ENERGY, board.energy + Math.max(0, amount));
  }

  /**
   * Poder de um lado: precisa de energia, da recarga vencida e da partida valendo. O escudo arma o
   * próprio lado; os outros vão na mesa do adversário, a não ser que o escudo dele anule.
   */
  private usePower(client: Client, power: BattlePower) {
    const team = this.state.players.get(client.sessionId)?.team as BattleTeam | '';
    if (!team || !this.state.powers || this.phase !== 'playing' || this.state.countdown > 0) return;
    if (this.state.slides.size > 0) return;
    const mine = this.state.boards.get(team)!;
    const now = this.elapsed();
    if (mine.energy < POWER_COST[power] || now < mine.powerReadyAt) return;
    if (mine.frozenUntil > now) return; // congelado: nem peças, nem poderes
    mine.energy -= POWER_COST[power];
    mine.powerReadyAt = now + POWER_COOLDOWN_MS;

    const target = otherTeam(team);
    const theirs = this.state.boards.get(target)!;
    let blocked = false;
    if (power === 'shield') {
      mine.shield = true;
    } else if (theirs.shield) {
      theirs.shield = false;
      blocked = true;
    } else if (power === 'fog') {
      theirs.fogUntil = now + FOG_MS;
    } else if (power === 'freeze') {
      theirs.frozenUntil = now + FREEZE_MS;
      // Solta o que o outro lado tinha na mão: congelado, não mexe em nada.
      for (const [sessionId, player] of this.state.players) {
        if (player.team === target) this.boards.get(target)?.releaseHeldBy(sessionId);
      }
    } else {
      this.boards.get(target)?.scatter();
    }
    this.broadcast('power', { team, power, blocked } satisfies PowerBroadcast);
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
    if (diff !== 0) {
      this.finish(diff > 0 ? 'a' : 'b');
      return;
    }
    this.suddenDeath();
  }

  /**
   * Empate no fim do tempo: o relógio para e os dois lados recebem o mesmo quebra-cabeça novo
   * (o seguinte de quem estava mais adiantado na sequência). Quem montar primeiro ganha.
   */
  private suddenDeath() {
    this.clockTimer?.clear();
    this.clearLightning();
    for (const timer of this.nextRoundTimers.values()) timer.clear();
    this.nextRoundTimers.clear();
    const next = Math.max(...BATTLE_TEAMS.map((team) => this.position.get(team) ?? 0)) + 1;
    this.state.suddenDeath = true;
    for (const team of BATTLE_TEAMS) {
      this.placeRound(team, next, this.state.boards.get(team)!.solved);
    }
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
    this.stopCountdown();
    this.clockTimer?.clear();
    this.endTimer?.clear();
    this.leaderTimer?.clear();
    this.clearLightning();
    for (const timer of this.nextRoundTimers.values()) timer.clear();
    this.nextRoundTimers.clear();
    this.state.winner = winner;
    this.state.durationMs = this.state.elapsedMs = this.elapsed();
    this.state.phase = 'completed' satisfies GamePhase;
    for (const sessionId of this.state.players.keys()) this.releaseHeldBy(sessionId);
    if (winner !== 'draw') this.saveResult(winner);
  }

  /** Grava o resultado (sem travar a sala: o placar é só do perfil). */
  private saveResult(winner: BattleTeam) {
    if (!this.battles || !this.lineup) return;
    this.battles
      .saveResult({
        roomCode: this.roomId,
        format: this.options.format,
        timed: this.timed,
        winner,
        walkover: this.state.walkover,
        comeback: this.timed && this.leaderAt10s !== '' && this.leaderAt10s !== winner,
        finishedAt: new Date(),
        teams: this.lineup,
      })
      .catch((error: unknown) => {
        console.error(`[batalha ${this.roomId}] falha ao gravar o resultado`, error);
      });
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
    this.state.suddenDeath = false;
    this.resetSnaps();
    this.boards.clear();
    this.state.boards.clear();
    await this.setupBoards();
  }

  onDispose() {
    this.leaderTimer?.clear();
    this.slideTimer?.clear();
    this.resumeTimer?.clear();
    this.countdownTimer?.clear();
    this.clockTimer?.clear();
    this.endTimer?.clear();
    for (const timer of this.nextRoundTimers.values()) timer.clear();
  }
}
