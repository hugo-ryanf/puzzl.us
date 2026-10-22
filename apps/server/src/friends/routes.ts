import express, { type Application, type RequestHandler } from 'express';
import {
  AddFriendRequest,
  FriendId,
  InviteRequest,
  type FriendsResponse,
  type InviteMessage,
} from '@puzzle/shared';
import type { Account, AccountStore } from '../auth/accounts';
import { accountFromCookieHeader } from '../auth/routes';
import type { FriendStore } from './friends';
import type { PresenceHub } from './presence';

/** O mesmo amigo só pode ser chamado de novo depois disso (evita encher a tela dele de avisos). */
const INVITE_COOLDOWN_MS = 15_000;

/**
 * GET    /api/me/friends            → código, amigos (com status), pedidos recebidos e enviados
 * POST   /api/me/friends            → { code } pede amizade (ou aceita, se a pessoa já pediu)
 * POST   /api/me/friends/:id/accept → aceita um pedido recebido
 * DELETE /api/me/friends/:id        → recusa, cancela ou desfaz a amizade
 * POST   /api/me/invites            → { friendId, roomCode } chama um amigo online para a sala
 * Tudo exige login. Cada mudança avisa as duas pessoas pela sala de presença ('friendsChanged'):
 * a outra e as outras abas/aparelhos de quem fez a mudança.
 */
export function registerFriendRoutes(
  app: Application,
  accounts: AccountStore,
  friends: FriendStore,
  presence: PresenceHub,
) {
  const router = express.Router();
  const lastInvite = new Map<string, number>();

  // Só nas rotas daqui: o roteador divide /api/me com o GET /api/me (que responde sem login).
  router.use(['/friends', '/invites'], async (req, res, next) => {
    const account = await accountFromCookieHeader(accounts, req.headers.cookie);
    if (!account) {
      res.status(401).json({ error: 'Entre com sua conta.' });
      return;
    }
    res.locals.account = account;
    next();
  });
  const me = (res: express.Response) => res.locals.account as Account;
  const notify = (res: express.Response, otherId: string) => {
    presence.send(otherId, 'friendsChanged', {});
    presence.send(me(res).id, 'friendsChanged', {});
  };

  const withId: RequestHandler = (req, res, next) => {
    const id = FriendId.safeParse(req.params.id);
    if (!id.success) {
      res.status(404).json({ error: 'Pessoa não encontrada.' });
      return;
    }
    res.locals.otherId = id.data;
    next();
  };

  router.get('/friends', async (_req, res) => {
    const list = await friends.list(me(res).id);
    const body: FriendsResponse = {
      friendCode: list.friendCode,
      friends: list.friends.map((friend) => ({ ...friend, status: presence.status(friend.id) })),
      incoming: list.incoming.map((person) => ({ ...person, status: 'offline' })),
      outgoing: list.outgoing.map((person) => ({ ...person, status: 'offline' })),
    };
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  });

  router.post('/friends', express.json(), async (req, res) => {
    const request = AddFriendRequest.safeParse(req.body);
    if (!request.success) {
      res.status(400).json({ error: request.error.issues[0]?.message ?? 'Código inválido.' });
      return;
    }
    const added = await friends.add(me(res).id, request.data.code);
    if (added.result === 'not-found') {
      res.status(404).json({ error: 'Nenhuma conta com esse código.' });
      return;
    }
    if (added.result === 'self') {
      res.status(400).json({ error: 'Esse é o seu próprio código.' });
      return;
    }
    notify(res, added.friendId);
    res.status(added.result === 'requested' ? 201 : 200).json({ result: added.result });
  });

  router.post('/friends/:id/accept', withId, async (_req, res) => {
    const otherId = res.locals.otherId as string;
    if (!(await friends.accept(me(res).id, otherId))) {
      res.status(404).json({ error: 'Pedido não encontrado.' });
      return;
    }
    notify(res, otherId);
    res.sendStatus(204);
  });

  router.delete('/friends/:id', withId, async (_req, res) => {
    const otherId = res.locals.otherId as string;
    if (await friends.remove(me(res).id, otherId)) notify(res, otherId);
    res.sendStatus(204);
  });

  router.post('/invites', express.json(), async (req, res) => {
    const request = InviteRequest.safeParse(req.body);
    if (!request.success) {
      res.status(400).json({ error: 'Convite inválido.' });
      return;
    }
    const { friendId, roomCode } = request.data;
    const account = me(res);
    if (!(await friends.areFriends(account.id, friendId))) {
      res.status(403).json({ error: 'Só dá para chamar amigos.' });
      return;
    }
    // Só chama para a sala em que você está de verdade.
    const room = presence.rooms(account.id).find((at) => at.roomCode === roomCode);
    if (!room) {
      res.status(403).json({ error: 'Você não está nessa sala.' });
      return;
    }
    const key = `${account.id}>${friendId}`;
    const now = Date.now();
    if (now - (lastInvite.get(key) ?? 0) < INVITE_COOLDOWN_MS) {
      res.status(429).json({ error: 'Espere um pouco para chamar de novo.' });
      return;
    }
    const invite: InviteMessage = {
      fromId: account.id,
      fromName: account.name,
      fromAvatarUrl: account.avatarUrl,
      roomCode,
      imageId: room.imageId,
    };
    if (!presence.send(friendId, 'invite', invite)) {
      res.status(409).json({ error: 'Seu amigo não está online.' });
      return;
    }
    lastInvite.set(key, now);
    if (lastInvite.size > 1000) {
      for (const [k, at] of lastInvite) if (now - at > INVITE_COOLDOWN_MS) lastInvite.delete(k);
    }
    res.sendStatus(204);
  });

  app.use('/api/me', router);
}
