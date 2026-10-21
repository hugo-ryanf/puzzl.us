import { randomUUID } from 'node:crypto';
import {
  CloseCode,
  ErrorCode,
  Room,
  ServerError,
  matchMaker,
  validate,
  type AuthContext,
  type Client,
  type Delayed,
} from '@colyseus/core';
import {
  CATALOG,
  CreateRoomOptions,
  CursorMessage,
  GrabMessage,
  GroupSchema,
  JoinOptions,
  MAX_PLAYERS,
  MoveMessage,
  PLAYER_COLORS,
  PlayerSchema,
  PuzzleConfigSchema,
  PuzzleEngine,
  RANDOM_IMAGE,
  RestoreRoomOptions,
  ResumeRoomOptions,
  RoomState,
  findCatalogImage,
  generatePuzzle,
  gridForPieceCount,
  uploadIdOf,
  type CursorBroadcast,
  type GamePhase,
  type RankStatus,
  type VoiceTokenResponse,
} from '@puzzle/shared';
import type { AccountStore } from '../auth/accounts';
import { accountFromCookieHeader } from '../auth/routes';
import type { GameResult, GameStore } from '../db/gameStore';
import type { UploadStore } from '../uploads/uploadStore';
import type { VoiceTokenIssuer } from '../voice';
import { uniqueRoomCode } from './roomCode';
import type { CommunityStore } from '../community/community';
import type { PresenceHub } from '../friends/presence';
import type { SavedGameStore } from './savedGames';
import { SNAPSHOT_VERSION, type RoomSnapshot, type SnapshotStore } from './snapshots';

/** Quanto tempo o servidor segura a vaga de quem caiu (rede instável, F5). */
const RECONNECT_SECONDS = 30;
/** O cliente interpola entre atualizações; 1/s basta para o relógio não derivar. */
const CLOCK_UPDATE_MS = 1000;
/** "Espalhar" mexe na mesa de todos: no máximo uma vez a cada 2 s, para não virar bagunça. */
const SCATTER_COOLDOWN_MS = 2000;
/** Snapshot periódico (só se algo mudou): numa queda sem aviso, perde-se no máximo isso. */
const SNAPSHOT_EVERY_MS = 10_000;

type SavedPlayer = RoomSnapshot['players'][number];

/**
 * Uma sala = um quebra-cabeça. O PuzzleEngine (o mesmo do modo local) é a autoridade:
 * os clientes pedem "pegar/mover/soltar", o servidor valida, aplica e espelha no `state`,
 * que o Colyseus sincroniza com todos.
 *
 * Ciclo: lobby (esperando o anfitrião) → playing (relógio correndo) → completed (grava no ranking).
 * Sala solo (maxPlayers = 1) pula o lobby: começa assim que o jogador entra.
 *
 * Com banco, a sala guarda snapshots (ver "Snapshot da sala" na arquitetura): se o servidor
 * reiniciar, o primeiro a voltar pelo código recria a sala de onde ela parou.
 */
export class PuzzleRoom extends Room<{ state: RoomState }> {
  /** Ajustado no onCreate para as vagas escolhidas; cheia, o Colyseus trava a sala sozinho. */
  maxClients = MAX_PLAYERS;
  /** Movimentos (~20/s) + cursor (~20/s) com folga; acima disso o cliente é desconectado. */
  maxMessagesPerSecond = 100;

  /** Persistência do ranking; injetada por createGameServer. Sem banco, fica undefined. */
  protected store?: GameStore;
  /** Fotos enviadas pelos jogadores; injetada por createGameServer. Sem banco, fica undefined. */
  protected uploads?: UploadStore;
  /** Emissor de tokens do LiveKit; injetado por createGameServer. Sem LiveKit, fica undefined. */
  protected voice?: VoiceTokenIssuer;
  /** Snapshots para sobreviver a reinícios; injetado por createGameServer. Sem banco, undefined. */
  protected snapshots?: SnapshotStore;
  /** Contas (login com Google); injetado por createGameServer. Sem banco, undefined. */
  protected accounts?: AccountStore;
  /** Partidas salvas ("Em andamento"); injetado por createGameServer. Sem banco, undefined. */
  protected savedGames?: SavedGameStore;
  /** Fotos publicadas (entram no ranking); injetado por createGameServer. Sem banco, undefined. */
  protected community?: CommunityStore;
  /** Quem está jogando onde (status "jogando" e convites); injetado por createGameServer. */
  protected onlineHub?: PresenceHub;

  private engine!: PuzzleEngine;
  /**
   * Quem é cada sessão (conta logada ou convidado): identifica o jogador no ranking sem ir para o
   * estado público.
   */
  private readonly identities = new Map<string, Identity>();
  /** Início real da partida (vai para o ranking). */
  private startedAt = 0;
  /** elapsed = agora − clockOrigin. Numa sala restaurada, o tempo com o servidor fora não conta. */
  private clockOrigin = 0;
  private lastScatterAt = 0;
  private clockTimer?: Delayed;
  /** Jogadores do snapshot que ainda não voltaram, pela chave da pessoa (identityKey). */
  private readonly returning = new Map<string, SavedPlayer>();
  /** Algo mudou desde o último snapshot. */
  private dirty = false;
  private shuttingDown = false;
  /** Gravações e remoções de snapshot em fila, para nunca chegarem fora de ordem ao banco. */
  private persistence = Promise.resolve();
  /** Conta de quem criou a sala: o único que pode salvar e retomar. */
  private ownerUserId?: string;
  /** Sala nova: o primeiro a entrar é quem criou (e vira o dono, se estiver logado). */
  private awaitingCreator = false;
  /** Sala retomada: até o dono entrar, ninguém mais entra (o código é novo, mas por garantia). */
  private awaitingOwner = false;
  /** A partida salva de onde esta sala veio, ou onde ela foi salva. */
  private savedId?: string;
  /** Tempo acumulado de uma partida retomada: o relógio continua daqui no "Começar". */
  private resumeClock?: { startedAt: number; elapsedMs: number };
  /** Salvou pelo botão: ao esvaziar, não precisa salvar de novo. */
  private savedOnPurpose = false;

  messages = {
    start: (client: Client) => this.start(client),
    grab: validate(GrabMessage, (client, { groupId }) => this.grab(client, groupId)),
    move: validate(MoveMessage, (client, message) => this.move(client, message)),
    drop: validate(MoveMessage, (client, message) => this.drop(client, message)),
    scatter: () => this.scatter(),
    cursor: validate(CursorMessage, (client, { x, y }) => {
      const message: CursorBroadcast = { sessionId: client.sessionId, x, y };
      this.broadcast('cursor', message, { except: client });
    }),
    // Usado com room.request(): o valor retornado vira a resposta para o cliente.
    voiceToken: (client: Client) => this.voiceToken(client),
    saveAndLeave: (client: Client) => void this.saveAndLeave(client),
  };

  async onCreate(rawOptions: unknown) {
    const restore = RestoreRoomOptions.safeParse(rawOptions);
    const resume = ResumeRoomOptions.safeParse(rawOptions);
    if (restore.success) await this.restoreFrom(restore.data.restore);
    else if (resume.success) await this.resumeFrom(resume.data.resume);
    else await this.createNew(CreateRoomOptions.parse(rawOptions));

    if (this.snapshots) {
      void this.saveSnapshot(); // já a partir do lobby: o convite tem que continuar valendo
      this.clock.setInterval(() => {
        if (this.dirty) void this.saveSnapshot();
      }, SNAPSHOT_EVERY_MS);
    }
  }

  private async createNew(options: CreateRoomOptions) {
    const { pieceCount, maxPlayers } = options;
    // "Aleatória": o servidor sorteia, assim ninguém escolhe a foto pelo console do navegador.
    const imageId =
      options.imageId === RANDOM_IMAGE
        ? CATALOG[Math.floor(Math.random() * CATALOG.length)]!.id
        : options.imageId;
    this.maxClients = maxPlayers;
    // O puzzle usa o tamanho real da imagem (em pixels).
    const { width, height } = await this.imageSize(imageId);
    this.roomId = await uniqueRoomCode(async (code) => (await this.snapshots?.has(code)) ?? false);
    const { rows, cols } = gridForPieceCount(pieceCount, width / height);
    const seed = randomUUID().slice(0, 8);
    this.engine = PuzzleEngine.scattered(generatePuzzle({ seed, rows, cols, width, height }));

    this.state = new RoomState({
      config: new PuzzleConfigSchema({
        imageId,
        seed,
        rows,
        cols,
        width,
        height,
        pieceCount,
        maxPlayers,
      }),
    });
    this.mirrorBoard();
    this.awaitingCreator = true;
  }

  /** Recria a sala que sumiu num reinício do servidor, a partir do último snapshot. */
  private async restoreFrom(code: string) {
    // Corrida rara: alguém já trouxe a sala de volta entre o "não encontrada" e este pedido.
    if (await matchMaker.getRoomById(code)) {
      throw new ServerError(ErrorCode.MATCHMAKE_UNHANDLED, `a sala ${code} já está aberta`);
    }
    const snapshot = await this.snapshots?.load(code);
    // Mesma mensagem do joinById: para o cliente é só uma sala que não existe.
    if (!snapshot) {
      throw new ServerError(ErrorCode.MATCHMAKE_INVALID_ROOM_ID, `room "${code}" not found`);
    }

    const { config } = snapshot;
    await this.imageSize(config.imageId); // foto enviada: confere que ainda existe e adia a expiração
    this.roomId = code;
    this.maxClients = config.maxPlayers;
    this.engine = PuzzleEngine.fromGroups(generatePuzzle(config), snapshot.groups);
    this.state = new RoomState({
      config: new PuzzleConfigSchema(config),
      phase: snapshot.phase,
    });
    this.mirrorBoard();
    for (const player of snapshot.players) this.returning.set(player.guestId, player);
    this.ownerUserId = snapshot.ownerUserId;
    this.savedId = snapshot.savedId;
    if (snapshot.phase === 'playing') this.startClock(snapshot.startedAt, snapshot.elapsedMs);
    else if (snapshot.elapsedMs > 0) {
      this.resumeClock = snapshot; // retomada, ainda no lobby
      this.state.elapsedMs = snapshot.elapsedMs;
    }
    console.log(`[sala ${code}] restaurada do snapshot`);
  }

  /**
   * Retoma uma partida salva ("Em andamento") numa sala nova: peças, encaixes e tempo de onde
   * pararam. Começa no lobby (o relógio só volta a correr no "Começar", ou já, se for solo).
   */
  private async resumeFrom(id: string) {
    const saved = await this.savedGames?.load(id);
    if (!saved) {
      throw new ServerError(ErrorCode.MATCHMAKE_INVALID_ROOM_ID, 'partida salva não encontrada');
    }
    const { snapshot } = saved;
    const { config } = snapshot;
    await this.imageSize(config.imageId); // foto enviada: confere que ainda existe
    this.roomId = await uniqueRoomCode(async (code) => (await this.snapshots?.has(code)) ?? false);
    this.maxClients = config.maxPlayers;
    this.engine = PuzzleEngine.fromGroups(generatePuzzle(config), snapshot.groups);
    this.state = new RoomState({ config: new PuzzleConfigSchema(config) });
    this.state.elapsedMs = snapshot.elapsedMs;
    this.mirrorBoard();
    for (const player of snapshot.players) this.returning.set(player.guestId, player);
    this.ownerUserId = saved.ownerUserId;
    this.awaitingOwner = true;
    this.savedId = id;
    this.resumeClock = { startedAt: snapshot.startedAt, elapsedMs: snapshot.elapsedMs };
  }

  /** Copia grupos e posições do engine para o estado sincronizado (sala nova ou restaurada). */
  private mirrorBoard() {
    for (const group of this.engine.allGroups()) {
      this.state.groups.set(String(group.id), new GroupSchema({ x: group.x, y: group.y }));
    }
    this.state.pieceGroup.push(
      ...this.engine.puzzle.pieces.map((p) => this.engine.groupOf(p.id).id),
    );
  }

  /** Catálogo: o zod já garantiu que existe. Foto enviada: busca no banco e adia a expiração. */
  private async imageSize(imageId: string): Promise<{ width: number; height: number }> {
    const uploadId = uploadIdOf(imageId);
    if (!uploadId) return findCatalogImage(imageId)!;
    if (!this.uploads) throw new Error('fotos enviadas indisponíveis: servidor sem banco');
    const size = await this.uploads.size(uploadId);
    if (!size) throw new Error('foto não encontrada (pode ter expirado)');
    await this.uploads.touch(uploadId);
    return size;
  }

  /**
   * Quem está logado é reconhecido pelo cookie da sessão, que o navegador manda na conexão do
   * WebSocket. Sem sessão (ou sem banco) a pessoa entra como convidado: nunca é recusada.
   */
  async onAuth(_client: Client, _options: unknown, context: AuthContext) {
    const account = await accountFromCookieHeader(this.accounts, context.headers?.get('cookie'));
    // Partida retomada: quem entra primeiro tem que ser o dono (quem salvou).
    if (this.awaitingOwner && account?.id !== this.ownerUserId) {
      throw new ServerError(ErrorCode.AUTH_FAILED, 'só quem salvou a partida pode retomá-la');
    }
    return account ? { userId: account.id } : true;
  }

  onJoin(client: Client, rawOptions: unknown) {
    const { name, guestId } = JoinOptions.parse(rawOptions);
    const identity: Identity = { guestId, userId: (client.auth as Partial<Identity>)?.userId };
    const key = identityKey(identity);
    // Voltando para uma sala restaurada: recupera a cor (se ainda livre) e os encaixes.
    const saved = this.returning.get(key);
    this.returning.delete(key);
    const usedColors = new Set([...this.state.players.values()].map((p) => p.color));
    const color =
      saved && !usedColors.has(saved.color)
        ? saved.color
        : (PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[0]);
    this.state.players.set(
      client.sessionId,
      new PlayerSchema({ name, color, snaps: saved?.snaps ?? 0 }),
    );
    this.identities.set(client.sessionId, identity);
    this.dirty = true;
    if (this.awaitingCreator) {
      this.awaitingCreator = false;
      this.ownerUserId = identity.userId; // criada por convidado: sem dono (não dá para salvar)
    }
    if (identity.userId) {
      this.onlineHub?.enterRoom(identity.userId, `${this.roomId}:${client.sessionId}`, {
        roomCode: this.roomId,
        imageId: this.state.config.imageId,
      });
    }
    if (identity.userId && identity.userId === this.ownerUserId) {
      this.awaitingOwner = false;
      this.state.ownerId = client.sessionId;
    }
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    // Solo não tem ninguém para esperar: o relógio começa já.
    if (this.state.config.maxPlayers === 1) this.startPlaying();
  }

  /** Queda sem "tchau": solta o que ele segurava e guarda a vaga por um tempo. */
  async onDrop(client: Client) {
    this.releaseHeldBy(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;
    await this.allowReconnection(client, RECONNECT_SECONDS);
  }

  onReconnect(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
  }

  onLeave(client: Client) {
    this.releaseHeldBy(client.sessionId);
    this.state.players.delete(client.sessionId);
    const userId = this.identities.get(client.sessionId)?.userId;
    if (userId) this.onlineHub?.leaveRoom(userId, `${this.roomId}:${client.sessionId}`);
    this.identities.delete(client.sessionId);
    if (this.state.ownerId === client.sessionId) this.state.ownerId = '';
    this.dirty = true;
    // O anfitrião saiu: o próximo da lista herda o botão "Começar".
    if (this.state.hostId === client.sessionId) {
      this.state.hostId = this.state.players.keys().next().value ?? '';
    }
  }

  async onDispose() {
    this.clockTimer?.clear();
    if (this.shuttingDown) return; // no desligamento o snapshot fica (e o progresso já foi salvo)
    // Todo mundo saiu no meio da partida: vai para o "Em andamento" do dono, se houver.
    if (!this.savedOnPurpose && this.phase === 'playing') await this.saveProgress();
    // Não há a quem devolver a sala: o snapshot de reinício não serve mais.
    await this.forgetSnapshot();
  }

  /** Desligamento (deploy, Render dormindo): grava o snapshot antes de derrubar os jogadores. */
  async onBeforeShutdown() {
    this.shuttingDown = true;
    // Antes do snapshot: assim ele já leva o id da partida salva.
    if (this.phase === 'playing') await this.saveProgress();
    await this.saveSnapshot();
    await this.disconnect(CloseCode.SERVER_SHUTDOWN).catch(() => {});
  }

  private get phase(): GamePhase {
    return this.state.phase as GamePhase;
  }

  /** "Começar" do anfitrião no lobby. */
  private start(client: Client) {
    if (client.sessionId !== this.state.hostId) return;
    this.startPlaying();
  }

  private startPlaying() {
    if (this.phase !== 'lobby') return;
    this.state.phase = 'playing' satisfies GamePhase;
    // Partida retomada continua do tempo acumulado; o início real (do ranking) é o de antes.
    const resumed = this.resumeClock;
    if (resumed?.startedAt) this.startClock(resumed.startedAt, resumed.elapsedMs);
    else this.startClock(Date.now(), resumed?.elapsedMs ?? 0);
    this.resumeClock = undefined;
    this.dirty = true;
  }

  private startClock(startedAt: number, elapsedMs: number) {
    this.startedAt = startedAt;
    this.clockOrigin = Date.now() - elapsedMs;
    this.state.elapsedMs = elapsedMs;
    this.clockTimer = this.clock.setInterval(() => {
      this.state.elapsedMs = this.elapsed();
    }, CLOCK_UPDATE_MS);
  }

  private elapsed(): number {
    return Date.now() - this.clockOrigin;
  }

  /**
   * Token da chamada de áudio. Identidade no LiveKit = sessionId, assim o cliente liga
   * "quem está falando" ao jogador da lista sem nenhum mapeamento extra.
   */
  private async voiceToken(client: Client): Promise<VoiceTokenResponse> {
    const player = this.state.players.get(client.sessionId);
    if (!this.voice || !player) return { available: false };
    const credentials = await this.voice.issue({
      roomId: this.roomId,
      identity: client.sessionId,
      name: player.name,
    });
    return { available: true, ...credentials };
  }

  private grab(client: Client, groupId: number) {
    const group = this.state.groups.get(String(groupId));
    // Primeiro a pegar ganha: se já tem dono (ou não está valendo), o pedido é ignorado.
    if (!group || group.heldBy !== '' || this.phase !== 'playing') return;
    this.releaseHeldBy(client.sessionId); // um grupo por vez por jogador
    group.heldBy = client.sessionId;
  }

  private move(client: Client, { groupId, x, y }: MoveMessage) {
    const group = this.heldGroup(client, groupId);
    if (!group) return;
    this.engine.moveGroup(groupId, x, y);
    group.x = x;
    group.y = y;
    this.dirty = true;
  }

  private drop(client: Client, { groupId, x, y }: MoveMessage) {
    const group = this.heldGroup(client, groupId);
    if (!group) return;

    this.engine.moveGroup(groupId, x, y);
    const { absorbedGroupIds, completed } = this.engine.dropGroup(
      groupId,
      // Não "arranca" da mão de outro jogador um grupo que ele está arrastando.
      (other) => this.state.groups.get(String(other.id))?.heldBy === '',
    );

    const player = this.state.players.get(client.sessionId);
    if (player) player.snaps += absorbedGroupIds.length;

    const merged = this.engine.getGroup(groupId);
    group.x = merged.x;
    group.y = merged.y;
    group.heldBy = '';
    for (const id of absorbedGroupIds) this.state.groups.delete(String(id));
    for (const pieceId of merged.pieceIds) {
      if (this.state.pieceGroup[pieceId] !== groupId) this.state.pieceGroup[pieceId] = groupId;
    }
    this.dirty = true;
    if (completed) this.finish();
  }

  /** Reespalha as peças soltas pela mesa (para todos); blocos montados e peças na mão ficam. */
  private scatter() {
    const now = Date.now();
    if (this.phase !== 'playing' || now - this.lastScatterAt < SCATTER_COOLDOWN_MS) return;
    this.lastScatterAt = now;
    const moved = this.engine.scatterLoose(
      Math.random,
      (group) => this.state.groups.get(String(group.id))?.heldBy === '',
    );
    for (const groupId of moved) {
      const { x, y } = this.engine.getGroup(groupId);
      const group = this.state.groups.get(String(groupId))!;
      group.x = x;
      group.y = y;
    }
    this.dirty = true;
  }

  /**
   * Grava a partida no "Em andamento" do dono (se houver dono e banco). Atualiza a mesma entrada
   * quando a sala já veio de uma partida salva. Devolve se deu certo.
   */
  private async saveProgress(): Promise<boolean> {
    const store = this.savedGames;
    if (!store || !this.ownerUserId || this.phase === 'completed') return false;
    let placed = 0;
    for (const group of this.engine.allGroups()) {
      if (group.pieceIds.length > 1) placed += group.pieceIds.length;
    }
    try {
      this.savedId = await store.save(
        this.ownerUserId,
        this.snapshot(),
        { pieces: this.engine.puzzle.pieces.length, placed },
        this.savedId,
      );
      return true;
    } catch (error) {
      console.error(`[sala ${this.roomId}] falha ao salvar a partida`, error);
      return false;
    }
  }

  /** "Salvar e sair" (só o dono): grava, avisa todo mundo e fecha a sala. */
  private async saveAndLeave(client: Client) {
    if (client.sessionId !== this.state.ownerId || this.phase === 'completed') return;
    if (!(await this.saveProgress())) {
      client.send('saveFailed', {});
      return;
    }
    this.savedOnPurpose = true;
    this.broadcast('saved', {});
    await this.forgetSnapshot();
    await this.disconnect(CloseCode.CONSENTED);
  }

  /** Para o relógio, fecha a sala e registra o tempo (sem travar o jogo esperando o banco). */
  private finish() {
    const finishedAt = Date.now();
    this.clockTimer?.clear();
    this.state.phase = 'completed' satisfies GamePhase;
    this.state.durationMs = this.state.elapsedMs = this.elapsed();
    // Partida terminada não volta: o resultado já está no estado (e no ranking).
    void this.forgetSnapshot();
    if (this.savedId) void this.savedGames?.delete(this.savedId).catch(() => {});
    // Equipe = quem está na sala na hora do fim (inclui quem caiu e pode voltar).
    // Mesma pessoa em duas abas (ou dois aparelhos, com conta) conta uma vez, como no banco.
    const team = [...this.state.players.entries()].map(([sessionId, player]) => ({
      ...this.identities.get(sessionId)!,
      nickname: player.name,
    }));
    this.state.teamSize = new Set(team.map(identityKey)).size;
    void this.lock();

    if (!this.store) {
      this.state.rankStatus = 'unavailable' satisfies RankStatus;
      return;
    }
    this.state.rankStatus = 'saving' satisfies RankStatus;
    void this.saveResult(team, finishedAt);
  }

  /**
   * Grava no ranking. Foto enviada só entra se estiver publicada: antes disso ela é única e não
   * há com quem comparar.
   */
  private async saveResult(team: GameResult['players'], finishedAt: number) {
    const { config } = this.state;
    const uploadId = uploadIdOf(config.imageId);
    if (uploadId && !(await this.community?.isPublished(uploadId).catch(() => false))) {
      this.state.rankStatus = 'unranked' satisfies RankStatus;
      return;
    }
    await this.store!.saveGame({
      roomCode: this.roomId,
      imageId: config.imageId,
      pieceCount: config.pieceCount,
      rows: config.rows,
      cols: config.cols,
      seed: config.seed,
      startedAt: new Date(this.startedAt),
      finishedAt: new Date(finishedAt),
      durationMs: this.state.durationMs,
      players: team,
    })
      .then(({ rank, rankToday }) => {
        this.state.rank = rank;
        this.state.rankToday = rankToday;
        this.state.rankStatus = 'saved' satisfies RankStatus;
      })
      .catch((error: unknown) => {
        console.error(`[sala ${this.roomId}] falha ao gravar no ranking`, error);
        this.state.rankStatus = 'unavailable' satisfies RankStatus;
      });
  }

  /** Enfileira a gravação do estado atual. Partida terminada não tem snapshot. */
  private saveSnapshot(): Promise<void> {
    const store = this.snapshots;
    if (!store || this.phase === 'completed') return this.persistence;
    this.dirty = false;
    const snapshot = this.snapshot(); // tirado agora, não quando a fila chegar nele
    return this.enqueue(
      () => store.save(this.roomId, snapshot),
      (error) => {
        console.error(`[sala ${this.roomId}] falha ao gravar o snapshot`, error);
        this.dirty = true; // tenta de novo no próximo ciclo
      },
    );
  }

  private forgetSnapshot(): Promise<void> {
    const store = this.snapshots;
    if (!store) return this.persistence;
    return this.enqueue(
      () => store.delete(this.roomId),
      (error) => console.error(`[sala ${this.roomId}] falha ao apagar o snapshot`, error),
    );
  }

  /** Falha no banco não derruba a sala nem trava a fila: só vai para `onError`. */
  private enqueue(task: () => Promise<void>, onError: (error: unknown) => void): Promise<void> {
    this.persistence = this.persistence.then(task).catch(onError);
    return this.persistence;
  }

  private snapshot(): RoomSnapshot {
    const { config } = this.state;
    const players = new Map<string, SavedPlayer>();
    for (const [sessionId, player] of this.state.players) {
      const key = identityKey(this.identities.get(sessionId)!);
      const same = players.get(key); // a mesma pessoa em duas abas: soma os encaixes
      if (same) same.snaps += player.snaps;
      else {
        players.set(key, {
          guestId: key,
          name: player.name,
          color: player.color,
          snaps: player.snaps,
        });
      }
    }
    // Quem estava antes do último reinício e ainda não voltou continua com a vaga guardada.
    for (const saved of this.returning.values()) {
      if (!players.has(saved.guestId)) players.set(saved.guestId, saved);
    }
    const playing = this.phase === 'playing';
    return {
      version: SNAPSHOT_VERSION,
      config: {
        imageId: config.imageId,
        seed: config.seed,
        rows: config.rows,
        cols: config.cols,
        width: config.width,
        height: config.height,
        pieceCount: config.pieceCount,
        maxPlayers: config.maxPlayers,
      },
      phase: playing ? 'playing' : 'lobby',
      startedAt: this.startedAt || (this.resumeClock?.startedAt ?? 0),
      elapsedMs: playing ? this.elapsed() : (this.resumeClock?.elapsedMs ?? 0),
      ownerUserId: this.ownerUserId,
      savedId: this.savedId,
      players: [...players.values()],
      groups: [...this.engine.allGroups()].map(({ id, x, y, pieceIds }) => ({
        id,
        x,
        y,
        pieceIds: [...pieceIds],
      })),
    };
  }

  /** O grupo, se existir e for este cliente quem está segurando. */
  private heldGroup(client: Client, groupId: number): GroupSchema | undefined {
    const group = this.state.groups.get(String(groupId));
    return group?.heldBy === client.sessionId ? group : undefined;
  }

  private releaseHeldBy(sessionId: string) {
    for (const group of this.state.groups.values()) {
      if (group.heldBy === sessionId) group.heldBy = '';
    }
  }
}

/** Quem é a pessoa: a conta (vale em qualquer aparelho) ou, sem login, o convidado do navegador. */
interface Identity {
  guestId: string;
  userId?: string;
}

/** Chave única da pessoa (para somar duas abas e reconhecer quem volta depois de um reinício). */
const identityKey = ({ guestId, userId }: Identity) => (userId ? `user:${userId}` : guestId);
