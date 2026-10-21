import { randomUUID } from 'node:crypto';
import { Room, validate, type Client, type Delayed } from '@colyseus/core';
import {
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
import type { GameStore } from '../db/gameStore';
import type { UploadStore } from '../uploads/uploadStore';
import type { VoiceTokenIssuer } from '../voice';
import { uniqueRoomCode } from './roomCode';

/** Quanto tempo o servidor segura a vaga de quem caiu (rede instável, F5). */
const RECONNECT_SECONDS = 30;
/** O cliente interpola entre atualizações; 1/s basta para o relógio não derivar. */
const CLOCK_UPDATE_MS = 1000;
/** "Espalhar" mexe na mesa de todos: no máximo uma vez a cada 2 s, para não virar bagunça. */
const SCATTER_COOLDOWN_MS = 2000;

/**
 * Uma sala = um quebra-cabeça. O PuzzleEngine (o mesmo do modo local) é a autoridade:
 * os clientes pedem "pegar/mover/soltar", o servidor valida, aplica e espelha no `state`,
 * que o Colyseus sincroniza com todos.
 *
 * Ciclo: lobby (esperando o anfitrião) → playing (relógio correndo) → completed (grava no ranking).
 */
export class PuzzleRoom extends Room<{ state: RoomState }> {
  maxClients = MAX_PLAYERS;
  /** Movimentos (~20/s) + cursor (~20/s) com folga; acima disso o cliente é desconectado. */
  maxMessagesPerSecond = 100;

  /** Persistência do ranking; injetada por createGameServer. Sem banco, fica undefined. */
  protected store?: GameStore;
  /** Fotos enviadas pelos jogadores; injetada por createGameServer. Sem banco, fica undefined. */
  protected uploads?: UploadStore;
  /** Emissor de tokens do LiveKit; injetado por createGameServer. Sem LiveKit, fica undefined. */
  protected voice?: VoiceTokenIssuer;

  private engine!: PuzzleEngine;
  /** guestId de cada sessão: identifica o jogador no ranking sem ir para o estado público. */
  private readonly guests = new Map<string, string>();
  private startedAt = 0;
  private lastScatterAt = 0;
  private clockTimer?: Delayed;

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
  };

  async onCreate(rawOptions: unknown) {
    const { pieceCount, imageId } = CreateRoomOptions.parse(rawOptions);
    // O puzzle usa o tamanho real da imagem (em pixels).
    const { width, height } = await this.imageSize(imageId);
    this.roomId = await uniqueRoomCode();
    const { rows, cols } = gridForPieceCount(pieceCount, width / height);
    const seed = randomUUID().slice(0, 8);
    this.engine = PuzzleEngine.scattered(generatePuzzle({ seed, rows, cols, width, height }));

    this.state = new RoomState({
      config: new PuzzleConfigSchema({ imageId, seed, rows, cols, width, height, pieceCount }),
    });
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

  onJoin(client: Client, rawOptions: unknown) {
    const { name, guestId } = JoinOptions.parse(rawOptions);
    const usedColors = new Set([...this.state.players.values()].map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[0];
    this.state.players.set(client.sessionId, new PlayerSchema({ name, color }));
    this.guests.set(client.sessionId, guestId);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
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
    this.guests.delete(client.sessionId);
    // O anfitrião saiu: o próximo da lista herda o botão "Começar".
    if (this.state.hostId === client.sessionId) {
      this.state.hostId = this.state.players.keys().next().value ?? '';
    }
  }

  onDispose() {
    this.clockTimer?.clear();
  }

  private get phase(): GamePhase {
    return this.state.phase as GamePhase;
  }

  private start(client: Client) {
    if (this.phase !== 'lobby' || client.sessionId !== this.state.hostId) return;
    this.state.phase = 'playing' satisfies GamePhase;
    this.startedAt = Date.now();
    this.clockTimer = this.clock.setInterval(() => {
      this.state.elapsedMs = Date.now() - this.startedAt;
    }, CLOCK_UPDATE_MS);
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
  }

  /** Para o relógio, fecha a sala e registra o tempo (sem travar o jogo esperando o banco). */
  private finish() {
    const finishedAt = Date.now();
    this.clockTimer?.clear();
    this.state.phase = 'completed' satisfies GamePhase;
    this.state.durationMs = this.state.elapsedMs = finishedAt - this.startedAt;
    // Equipe = quem está na sala na hora do fim (inclui quem caiu e pode voltar).
    // Mesma pessoa em duas abas conta uma vez, como no banco.
    const team = [...this.state.players.entries()].map(([sessionId, player]) => ({
      guestId: this.guests.get(sessionId)!,
      nickname: player.name,
    }));
    this.state.teamSize = new Set(team.map((p) => p.guestId)).size;
    void this.lock();

    // Foto enviada é única: não há com quem comparar, então não entra no ranking.
    if (uploadIdOf(this.state.config.imageId)) {
      this.state.rankStatus = 'unranked' satisfies RankStatus;
      return;
    }
    if (!this.store) {
      this.state.rankStatus = 'unavailable' satisfies RankStatus;
      return;
    }
    this.state.rankStatus = 'saving' satisfies RankStatus;
    const { config } = this.state;
    this.store
      .saveGame({
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
      .then(({ rank }) => {
        this.state.rank = rank;
        this.state.rankStatus = 'saved' satisfies RankStatus;
      })
      .catch((error: unknown) => {
        console.error(`[sala ${this.roomId}] falha ao gravar no ranking`, error);
        this.state.rankStatus = 'unavailable' satisfies RankStatus;
      });
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
