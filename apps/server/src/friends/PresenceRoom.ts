import { ErrorCode, Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import type { AccountStore } from '../auth/accounts';
import { accountFromCookieHeader } from '../auth/routes';
import type { PresenceHub } from './presence';

/**
 * Sala sem estado que todo cliente logado mantém aberta enquanto o site está aberto: estar
 * conectado aqui é estar "online", e é por aqui que chegam os convites e os avisos de que a
 * lista de amigos mudou. Convidado não entra (não tem amigos).
 */
export class PresenceRoom extends Room {
  /** Injetados por createGameServer. */
  protected accounts?: AccountStore;
  protected onlineHub?: PresenceHub;

  private disconnects = new Map<string, () => void>();

  onCreate() {
    this.autoDispose = true;
  }

  async onAuth(_client: Client, _options: unknown, context: AuthContext) {
    const account = await accountFromCookieHeader(this.accounts, context.headers?.get('cookie'));
    if (!account || !this.onlineHub) throw new ServerError(ErrorCode.AUTH_FAILED, 'sem login');
    return { userId: account.id };
  }

  onJoin(client: Client) {
    const { userId } = client.auth as { userId: string };
    this.disconnects.set(
      client.sessionId,
      this.onlineHub!.connect(userId, (type, payload) => client.send(type, payload)),
    );
  }

  onLeave(client: Client) {
    this.disconnects.get(client.sessionId)?.();
    this.disconnects.delete(client.sessionId);
  }
}
