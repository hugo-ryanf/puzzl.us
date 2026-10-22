import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from '@colyseus/core';
import { ColyseusSDK } from '@colyseus/sdk';
import {
  CATALOG,
  BATTLE_ROOM,
  BULLET_ROOM,
  PRESENCE_ROOM,
  ROOM_NAME,
  type FriendsResponse,
  type InviteMessage,
} from '@puzzle/shared';
import { createGameServer } from '../app';
import { createAccountStore, type Account, type AccountStore } from '../auth/accounts';
import type { AppDatabase } from '../db/database';
import { clearDatabase, createMemoryDatabase } from '../db/memoryDatabase';
import { createFriendStore } from './friends';
import { createPresenceHub } from './presence';

const PORT = 2573;
const API = `http://127.0.0.1:${PORT}/api/me`;

let db: AppDatabase;
let accounts: AccountStore;
let server: Server;
beforeAll(async () => {
  db = await createMemoryDatabase();
  accounts = createAccountStore(db);
  server = createGameServer({
    auth: {
      accounts,
      friends: createFriendStore(db),
      publicUrl: 'http://site.test',
      adminEmails: [],
      secureCookies: false,
    },
  });
  await server.listen(PORT);
});
afterAll(() => server.gracefullyShutdown(false));
beforeEach(() => clearDatabase(db));

interface Person {
  account: Account;
  cookie: string;
  sdk: ColyseusSDK;
}

async function login(name: string): Promise<Person> {
  const account = await accounts.signInWithGoogle({ sub: randomUUID(), name }, false);
  const { token } = await accounts.createSession(account.id);
  const cookie = `sid=${token}`;
  const sdk = new ColyseusSDK(`ws://127.0.0.1:${PORT}`, { headers: { cookie } });
  return { account, cookie, sdk };
}

const call = (who: Person, method: string, path: string, body?: object) =>
  fetch(`${API}/${path}`, {
    method,
    headers: { cookie: who.cookie, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });

const list = async (who: Person) =>
  (await (await call(who, 'GET', 'friends')).json()) as FriendsResponse;

/** Ana pede, Bia aceita. */
async function befriend(ana: Person, bia: Person) {
  await call(ana, 'POST', 'friends', { code: bia.account.friendCode });
  await call(bia, 'POST', `friends/${ana.account.id}/accept`);
}

/** Espera até a condição valer (as mensagens da presença chegam pela rede). */
async function until(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
  return check();
}

describe('PresenceHub', () => {
  it('online com uma aba aberta, jogando numa sala, offline sem nada; avisa só quando muda', () => {
    const hub = createPresenceHub();
    const changes: string[] = [];
    hub.onChange((userId) => changes.push(`${userId}:${hub.status(userId)}`));

    const close1 = hub.connect('ana', () => {});
    const close2 = hub.connect('ana', () => {}); // segunda aba: continua online
    hub.enterRoom('ana', 'K7QF2:1', { roomCode: 'K7QF2', imageId: 'x' });
    expect(hub.rooms('ana')).toEqual([{ roomCode: 'K7QF2', imageId: 'x' }]);
    hub.leaveRoom('ana', 'K7QF2:1');
    close1();
    close2();
    expect(changes).toEqual(['ana:online', 'ana:playing', 'ana:online', 'ana:offline']);
  });
});

describe('Amigos', () => {
  it('pede pelo código (com ou sem hífen), a outra pessoa aceita, e os dois se veem', async () => {
    const ana = await login('Ana');
    const bia = await login('Bia');
    const typed = bia.account.friendCode.replace('-', '').toLowerCase();
    expect((await call(ana, 'POST', 'friends', { code: typed })).status).toBe(201);

    expect((await list(ana)).outgoing.map((p) => p.name)).toEqual(['Bia']);
    expect((await list(bia)).incoming.map((p) => p.name)).toEqual(['Ana']);
    // Só quem recebeu aceita.
    expect((await call(ana, 'POST', `friends/${bia.account.id}/accept`)).status).toBe(404);
    expect((await call(bia, 'POST', `friends/${ana.account.id}/accept`)).status).toBe(204);

    const anaView = await list(ana);
    expect(anaView.friendCode).toBe(ana.account.friendCode);
    expect(anaView.friends).toEqual([
      {
        id: bia.account.id,
        name: 'Bia',
        avatarUrl: null,
        avatarColor: null,
        friendCode: bia.account.friendCode,
        status: 'offline',
      },
    ]);
    expect((await list(bia)).friends.map((p) => p.name)).toEqual(['Ana']);
  });

  it('pedido cruzado vira amizade; código errado, o próprio e sem login falham', async () => {
    const ana = await login('Ana');
    const bia = await login('Bia');
    await call(ana, 'POST', 'friends', { code: bia.account.friendCode });
    const back = await call(bia, 'POST', 'friends', { code: ana.account.friendCode });
    expect(await back.json()).toEqual({ result: 'accepted' });

    expect((await call(ana, 'POST', 'friends', { code: 'ZZZZ-ZZZZ' })).status).toBe(404);
    expect((await call(ana, 'POST', 'friends', { code: ana.account.friendCode })).status).toBe(400);
    expect((await call(ana, 'POST', 'friends', { code: 'curto' })).status).toBe(400);
    expect((await fetch(`${API}/friends`)).status).toBe(401);
    // O resto de /api/me continua respondendo sem login.
    expect((await fetch(`${API}`)).status).toBe(200);
  });

  it('desfazer a amizade tira dos dois lados', async () => {
    const ana = await login('Ana');
    const bia = await login('Bia');
    await befriend(ana, bia);
    expect((await call(bia, 'DELETE', `friends/${ana.account.id}`)).status).toBe(204);
    expect((await list(ana)).friends).toEqual([]);
  });

  it('o status segue a sala de presença e a sala do jogo, e o amigo é avisado', async () => {
    const ana = await login('Ana');
    const bia = await login('Bia');
    await befriend(ana, bia);
    const biaPresence = await bia.sdk.joinOrCreate(PRESENCE_ROOM);
    let changed = 0;
    biaPresence.onMessage('friendsChanged', () => changed++);

    const anaPresence = await ana.sdk.joinOrCreate(PRESENCE_ROOM);
    expect(await until(() => changed === 1)).toBe(true);
    expect((await list(bia)).friends[0]!.status).toBe('online');

    const game = await ana.sdk.create(ROOM_NAME, {
      name: 'Ana',
      guestId: randomUUID(),
      pieceCount: 24,
      imageId: CATALOG[0]!.id,
    });
    expect(await until(() => changed === 2)).toBe(true);
    expect((await list(bia)).friends[0]!.status).toBe('playing');

    await game.leave();
    await anaPresence.leave();
    expect(await until(() => changed === 4)).toBe(true);
    expect((await list(bia)).friends[0]!.status).toBe('offline');
    await biaPresence.leave();
  });

  it('pedido, aceite e remoção avisam as duas pessoas na hora (sem recarregar)', async () => {
    const ana = await login('Ana');
    const bia = await login('Bia');
    const count = { ana: 0, bia: 0 };
    const anaPresence = await ana.sdk.joinOrCreate(PRESENCE_ROOM);
    anaPresence.onMessage('friendsChanged', () => count.ana++);
    const biaPresence = await bia.sdk.joinOrCreate(PRESENCE_ROOM);
    biaPresence.onMessage('friendsChanged', () => count.bia++);
    await new Promise((r) => setTimeout(r, 50)); // nada chega antes: ainda não são amigas
    Object.assign(count, { ana: 0, bia: 0 });

    await call(ana, 'POST', 'friends', { code: (await list(bia)).friendCode });
    expect(await until(() => count.ana === 1 && count.bia === 1)).toBe(true);
    expect((await list(bia)).incoming).toHaveLength(1);

    await call(bia, 'POST', `friends/${ana.account.id}/accept`);
    expect(await until(() => count.ana >= 2 && count.bia >= 2)).toBe(true);

    const before = { ...count };
    await call(ana, 'DELETE', `friends/${bia.account.id}`);
    expect(await until(() => count.ana > before.ana && count.bia > before.bia)).toBe(true);
    await anaPresence.leave();
    await biaPresence.leave();
  });

  it('convidado não entra na sala de presença', async () => {
    const guest = new ColyseusSDK(`ws://127.0.0.1:${PORT}`);
    await expect(guest.joinOrCreate(PRESENCE_ROOM)).rejects.toThrow();
  });
});

describe('Convites', () => {
  it('chama um amigo online para a sala em que você está', async () => {
    const ana = await login('Ana');
    const bia = await login('Bia');
    const caio = await login('Caio'); // não é amigo
    await befriend(ana, bia);
    const biaPresence = await bia.sdk.joinOrCreate(PRESENCE_ROOM);
    const invites: InviteMessage[] = [];
    biaPresence.onMessage('invite', (invite: InviteMessage) => invites.push(invite));
    biaPresence.onMessage('friendsChanged', () => {});

    const game = await ana.sdk.create(ROOM_NAME, {
      name: 'Ana',
      guestId: randomUUID(),
      pieceCount: 24,
      imageId: CATALOG[0]!.id,
    });
    const invite = (who: Person, friendId: string, roomCode = game.roomId) =>
      call(who, 'POST', 'invites', { friendId, roomCode });

    expect((await invite(ana, bia.account.id, 'ZZZZZ')).status).toBe(403); // não está nessa sala
    expect((await invite(caio, bia.account.id)).status).toBe(403); // não é amigo
    expect((await invite(ana, caio.account.id)).status).toBe(403);
    expect((await invite(ana, bia.account.id)).status).toBe(204);
    expect(await until(() => invites.length === 1)).toBe(true);
    expect(invites[0]).toEqual({
      fromId: ana.account.id,
      fromName: 'Ana',
      fromAvatarUrl: null,
      roomCode: game.roomId,
      imageId: CATALOG[0]!.id,
    });
    expect((await invite(ana, bia.account.id)).status).toBe(429); // de novo, logo em seguida

    await biaPresence.leave();
    await game.leave();
  });

  it('também chama para salas de Bullet e de Batalha', async () => {
    const ana = await login('Ana');
    const bia = await login('Bia');
    const caio = await login('Caio');
    await befriend(ana, bia);
    await befriend(caio, bia);
    const biaPresence = await bia.sdk.joinOrCreate(PRESENCE_ROOM);
    const invites: InviteMessage[] = [];
    biaPresence.onMessage('invite', (invite: InviteMessage) => invites.push(invite));
    biaPresence.onMessage('friendsChanged', () => {});
    const catalogIds = CATALOG.map((image) => image.id);

    const bullet = await ana.sdk.create(BULLET_ROOM, {
      name: 'Ana',
      guestId: randomUUID(),
      minutes: 3,
      pieces: 12,
      maxPlayers: 2,
    });
    const battle = await caio.sdk.create(BATTLE_ROOM, {
      name: 'Caio',
      guestId: randomUUID(),
      pieceCount: 12,
      imageId: 'random',
      format: '1v1',
      minutes: 3,
    });
    const invite = (who: Person, roomCode: string) =>
      call(who, 'POST', 'invites', { friendId: bia.account.id, roomCode });

    expect((await invite(ana, bullet.roomId)).status).toBe(204);
    expect((await invite(caio, battle.roomId)).status).toBe(204);
    expect(await until(() => invites.length === 2)).toBe(true);
    expect(invites.map((i) => i.roomCode)).toEqual([bullet.roomId, battle.roomId]);
    // A foto de verdade (não 'random'): o aviso mostra a miniatura dela.
    for (const { imageId } of invites) expect(catalogIds).toContain(imageId);

    await biaPresence.leave();
    await bullet.leave();
    await battle.leave();
  });

  it('amigo offline não recebe', async () => {
    const ana = await login('Ana');
    const bia = await login('Bia');
    await befriend(ana, bia);
    const game = await ana.sdk.create(ROOM_NAME, {
      name: 'Ana',
      guestId: randomUUID(),
      pieceCount: 24,
      imageId: CATALOG[0]!.id,
    });
    const response = await call(ana, 'POST', 'invites', {
      friendId: bia.account.id,
      roomCode: game.roomId,
    });
    expect(response.status).toBe(409);
    await game.leave();
  });
});
