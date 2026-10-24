import { Room, validate, type AuthContext, type Client, type Delayed } from '@colyseus/core';
import {
  CursorMessage,
  JoinOptions,
  MAX_PLAYERS,
  PLAYER_COLORS,
  PlayerSchema,
  RoomState,
  findCatalogImage,
  uploadIdOf,
  type CursorBroadcast,
  type GamePhase,
  type VoiceTokenResponse,
} from '@puzzle/shared';
import type { AccountStore } from '../auth/accounts';
import { accountFromCookieHeader } from '../auth/routes';
import type { CommunityStore } from '../community/community';
import type { GameResult, GameStore } from '../db/gameStore';
import type { PresenceHub } from '../friends/presence';
import type { UploadStore } from '../uploads/uploadStore';
import type { VoiceTokenIssuer } from '../voice';
import type { SavedGameStore } from './savedGames';
import type { SnapshotStore } from './snapshots';

/** Quanto tempo o servidor segura a vaga de quem caiu (rede instável, F5). */
const RECONNECT_SECONDS = 30;
/** O cliente interpola entre atualizações; 1/s basta para o relógio não derivar. */
export const CLOCK_UPDATE_MS = 1000;
/** Segundos do "3, 2, 1" antes do Bullet e da batalha por tempo (os testes zeram). */
export const COUNTDOWN = { seconds: 3 };
/** Peças espalhadas viradas (todos os modos); os testes de sala desligam para montar fácil. */
export const ROTATION = { enabled: true };
/** Encaixes a menos disso um do outro (do mesmo jogador) formam combo. */
export const COMBO_WINDOW_MS = 3000;
const MAX_COMBO = 9;

/** Quem é a pessoa: a conta (vale em qualquer aparelho) ou, sem login, o convidado do navegador. */
export interface Identity {
  guestId: string;
  userId?: string;
}

/** Chave única da pessoa (para somar duas abas e reconhecer quem volta depois de um reinício). */
export const identityKey = ({ guestId, userId }: Identity) => (userId ? `user:${userId}` : guestId);

/**
 * O que toda sala de jogo tem em comum, seja qual for o modo: jogadores e cores, quem é cada um
 * (conta pelo cookie ou convidado), anfitrião, reconexão, chamada de voz, cursores, presença
 * para os amigos e o relógio. Cada modo (clássico, Bullet, Batalha) cuida dos seus tabuleiros.
 */
export abstract class BaseGameRoom extends Room<{ state: RoomState }> {
  /** Ajustado no onCreate para as vagas escolhidas; cheia, o Colyseus trava a sala sozinho. */
  maxClients = MAX_PLAYERS;
  /** Movimentos (~20/s) + cursor (~20/s) com folga; acima disso o cliente é desconectado. */
  maxMessagesPerSecond = 100;

  // Dependências injetadas por createGameServer (por herança: nunca vêm das opções do cliente).
  // Sem banco/LiveKit, ficam undefined e o recurso correspondente fica indisponível.
  protected store?: GameStore;
  protected uploads?: UploadStore;
  protected voice?: VoiceTokenIssuer;
  protected snapshots?: SnapshotStore;
  protected accounts?: AccountStore;
  protected savedGames?: SavedGameStore;
  protected community?: CommunityStore;
  /** Quem está jogando onde (status "jogando" e convites). */
  protected onlineHub?: PresenceHub;

  /** Quem é cada sessão: identifica o jogador no ranking sem ir para o estado público. */
  protected readonly identities = new Map<string, Identity>();
  /** Início real da partida (vai para o ranking). */
  protected startedAt = 0;
  /** elapsed = agora − clockOrigin. */
  protected clockOrigin = 0;
  protected clockTimer?: Delayed;
  protected countdownTimer?: Delayed;
  /** Hora do último encaixe de cada sessão (para o combo). */
  private readonly lastSnapAt = new Map<string, number>();

  /** Mensagens que valem em qualquer modo; cada sala junta as dela. */
  protected commonMessages() {
    return {
      cursor: validate(CursorMessage, (client, { x, y, board }) => {
        const message: CursorBroadcast = { sessionId: client.sessionId, x, y, board };
        this.broadcast('cursor', message, { except: client });
      }),
      // Usado com room.request(): o valor retornado vira a resposta para o cliente.
      voiceToken: (client: Client) => this.voiceToken(client),
    };
  }

  /** Solta o que este jogador estiver segurando (em qualquer tabuleiro da sala). */
  protected abstract releaseHeldBy(sessionId: string): void;
  /** Foto que a sala está montando agora (para o convite e o status dos amigos). */
  protected abstract currentImageId(): string;

  /** Depois que o jogador entrou (e já está no estado). */
  protected joined?(client: Client, identity: Identity): void;
  /** Depois que o jogador saiu de vez (já fora do estado). */
  protected left?(client: Client, identity: Identity | undefined): void;
  /** Cor e encaixes guardados de quem está voltando (só o clássico restaura salas). */
  protected returningPlayer?(key: string): { color: string; snaps: number } | undefined;

  /**
   * Quem está logado é reconhecido pelo cookie da sessão, que o navegador manda na conexão do
   * WebSocket. Sem sessão (ou sem banco) a pessoa entra como convidado: nunca é recusada.
   */
  async onAuth(_client: Client, _options: unknown, context: AuthContext) {
    const account = await accountFromCookieHeader(this.accounts, context.headers?.get('cookie'));
    return account ? { userId: account.id, name: account.name } : true;
  }

  onJoin(client: Client, rawOptions: unknown) {
    const options = JoinOptions.parse(rawOptions);
    const auth = client.auth as { userId?: string; name?: string } | true | undefined;
    const { guestId } = options;
    // Logado: o nickname do perfil (o mesmo em toda sala e no ranking); convidado: o digitado.
    const name = (typeof auth === 'object' && auth.name) || options.name;
    const identity: Identity = {
      guestId,
      userId: typeof auth === 'object' ? auth.userId : undefined,
    };
    const saved = this.returningPlayer?.(identityKey(identity));
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
    if (identity.userId) {
      this.onlineHub?.enterRoom(identity.userId, `${this.roomId}:${client.sessionId}`, {
        roomCode: this.roomId,
        imageId: this.currentImageId(),
      });
    }
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    this.joined?.(client, identity);
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
    const identity = this.identities.get(client.sessionId);
    if (identity?.userId) {
      this.onlineHub?.leaveRoom(identity.userId, `${this.roomId}:${client.sessionId}`);
    }
    this.identities.delete(client.sessionId);
    // O anfitrião saiu: o próximo da lista herda o botão "Começar".
    if (this.state.hostId === client.sessionId) {
      this.state.hostId = this.state.players.keys().next().value ?? '';
    }
    this.left?.(client, identity);
  }

  protected get phase(): GamePhase {
    return this.state.phase as GamePhase;
  }

  protected startClock(startedAt: number, elapsedMs: number, onTick?: () => void) {
    this.startedAt = startedAt;
    this.clockOrigin = Date.now() - elapsedMs;
    this.state.elapsedMs = elapsedMs;
    this.clockTimer?.clear();
    this.clockTimer = this.clock.setInterval(() => {
      this.state.elapsedMs = this.elapsed();
      onTick?.();
    }, CLOCK_UPDATE_MS);
  }

  /** Conta "3, 2, 1" no estado e então chama `go` (que liga o relógio de verdade). */
  protected startAfterCountdown(go: () => void) {
    this.countdownTimer?.clear();
    this.state.countdown = COUNTDOWN.seconds;
    if (this.state.countdown === 0) return go();
    this.countdownTimer = this.clock.setInterval(() => {
      this.state.countdown -= 1;
      if (this.state.countdown > 0) return;
      this.countdownTimer?.clear();
      go();
    }, 1000);
  }

  /** Soma os encaixes do jogador e atualiza o combo dele (Bullet e Batalha). */
  protected countSnaps(sessionId: string, snaps: number) {
    const player = this.state.players.get(sessionId);
    if (!player || snaps === 0) return;
    player.snaps += snaps;
    const now = Date.now();
    const quick = now - (this.lastSnapAt.get(sessionId) ?? 0) <= COMBO_WINDOW_MS;
    player.combo = quick ? Math.min(MAX_COMBO, player.combo + 1) : 1;
    this.lastSnapAt.set(sessionId, now);
  }

  /** Partida nova (jogar novamente, revanche): encaixes e combos do zero. */
  protected resetSnaps() {
    for (const player of this.state.players.values()) {
      player.snaps = 0;
      player.combo = 0;
    }
    this.lastSnapAt.clear();
  }

  /** Partida acabou antes de a contagem terminar (W.O.): para a contagem. */
  protected stopCountdown() {
    this.countdownTimer?.clear();
    this.state.countdown = 0;
  }

  protected elapsed(): number {
    return Date.now() - this.clockOrigin;
  }

  /**
   * Equipe para o ranking: quem está na sala agora (inclui quem caiu e pode voltar), ou só as
   * sessões dadas. A mesma pessoa em duas abas conta uma vez (o banco junta pela identidade).
   */
  protected team(sessionIds?: Iterable<string>): GameResult['players'] {
    const ids = sessionIds ? new Set(sessionIds) : undefined;
    return [...this.state.players.entries()]
      .filter(([sessionId]) => !ids || ids.has(sessionId))
      .map(([sessionId, player]) => ({
        ...this.identities.get(sessionId)!,
        nickname: player.name,
      }));
  }

  /** Catálogo: o zod já garantiu que existe. Foto enviada: busca no banco e adia a expiração. */
  protected async imageSize(imageId: string): Promise<{ width: number; height: number }> {
    const uploadId = uploadIdOf(imageId);
    if (!uploadId) return findCatalogImage(imageId)!;
    if (!this.uploads) throw new Error('fotos enviadas indisponíveis: servidor sem banco');
    const size = await this.uploads.size(uploadId);
    if (!size) throw new Error('foto não encontrada (pode ter expirado)');
    await this.uploads.touch(uploadId);
    return size;
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
}
