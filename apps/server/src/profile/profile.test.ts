import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { matchMaker, type Server } from '@colyseus/core';
import { ColyseusSDK } from '@colyseus/sdk';
import {
  CATALOG,
  ROOM_NAME,
  RoomState,
  type AccountView,
  type PublicProfile,
} from '@puzzle/shared';
import { createGameServer } from '../app';
import { createAccountStore, type AccountStore } from '../auth/accounts';
import type { AppDatabase } from '../db/database';
import { createGameStore, type GameStore } from '../db/gameStore';
import { clearDatabase, createMemoryDatabase } from '../db/memoryDatabase';
import { createFriendStore, type FriendStore } from '../friends/friends';
import { createProfileStore } from './profile';

const PORT = 2576;
const API = `http://127.0.0.1:${PORT}/api`;

let db: AppDatabase;
let accounts: AccountStore;
let store: GameStore;
let friends: FriendStore;
let server: Server;
beforeAll(async () => {
  db = await createMemoryDatabase();
  accounts = createAccountStore(db);
  store = createGameStore(db);
  friends = createFriendStore(db);
  server = createGameServer({
    store,
    auth: {
      accounts,
      friends,
      profiles: createProfileStore(db),
      publicUrl: 'http://site.test',
      adminEmails: [],
      secureCookies: false,
    },
  });
  await server.listen(PORT);
});
afterAll(() => server.gracefullyShutdown(false));
beforeEach(() => clearDatabase(db));

async function login(name: string) {
  const account = await accounts.signInWithGoogle(
    { sub: randomUUID(), name, picture: 'https://foto.test/eu.jpg' },
    false,
  );
  const { token } = await accounts.createSession(account.id);
  return { account, cookie: `sid=${token}` };
}

const patch = (cookie: string, body: object) =>
  fetch(`${API}/me/profile`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const profileOf = async (code: string, cookie = '') =>
  (await (await fetch(`${API}/profiles/${code}`, { headers: { cookie } })).json()) as PublicProfile;

describe('Perfil', () => {
  it('sem nickname escolhido, o nome é o primeiro nome do Google e a foto é a do Google', async () => {
    const { account } = await login('Hugo Ryan França');
    expect(account).toMatchObject({
      name: 'Hugo',
      googleName: 'Hugo Ryan França',
      avatarUrl: 'https://foto.test/eu.jpg',
      avatarStyle: 'google',
      bio: null,
    });
  });

  it('muda nickname, bio e avatar; um novo login no Google não desfaz', async () => {
    const { account, cookie } = await login('Hugo Ryan França');
    const response = await patch(cookie, {
      nickname: '  hugao ',
      bio: 'Monto de 1000 peças no domingo',
      avatarStyle: 'initials',
      avatarColor: '#0B7A5E',
    });
    expect(response.status).toBe(200);
    expect((await response.json()) as AccountView).toMatchObject({
      name: 'hugao',
      avatarUrl: null,
      avatarColor: '#0B7A5E',
      googleAvatarUrl: 'https://foto.test/eu.jpg',
      bio: 'Monto de 1000 peças no domingo',
    });

    // Entrar de novo atualiza só o que vem do Google.
    const again = await accounts.signInWithGoogle(
      { sub: (await db.query.users.findFirst())!.googleSub, name: 'Hugo R.' },
      false,
    );
    expect(again).toMatchObject({ id: account.id, name: 'hugao', googleName: 'Hugo R.' });
  });

  it('recusa nickname curto, cor fora da paleta e quem não está logado', async () => {
    const { cookie } = await login('Hugo');
    expect((await patch(cookie, { nickname: 'H' })).status).toBe(400);
    expect((await patch(cookie, { avatarColor: '#123456' })).status).toBe(400);
    expect((await patch(cookie, { bio: 'x'.repeat(121) })).status).toBe(400);
    expect((await patch('', { nickname: 'Hugo' })).status).toBe(401);
  });

  it('perfil público com estatísticas e a relação com quem vê', async () => {
    const hugo = await login('Hugo');
    const bia = await login('Bia');
    const guestId = randomUUID();
    await accounts.linkGuest(hugo.account.id, guestId);
    const now = new Date();
    const game = (imageId: string, pieceCount: number, durationMs: number) =>
      store.saveGame({
        roomCode: 'TESTE',
        imageId,
        pieceCount,
        rows: 4,
        cols: 6,
        seed: 'abc',
        startedAt: new Date(now.getTime() - durationMs),
        finishedAt: now,
        durationMs,
        players: [{ guestId, userId: hugo.account.id, nickname: 'Hugo' }],
      });
    await game('praia', 24, 60_000);
    await game('praia', 24, 30_000); // repetiu: pontos contam uma vez
    await game('lago', 48, 90_000);

    const seen = await profileOf(hugo.account.friendCode);
    expect(seen).toMatchObject({ name: 'Hugo', relation: 'guest' });
    expect(seen.stats).toMatchObject({
      puzzles: 3,
      images: 2,
      pieces: 96,
      pointsAll: 72,
      pointsWeek: 72,
      streak: 1,
      bulletBest: 0,
      friends: 0,
    });

    expect((await profileOf(hugo.account.friendCode, hugo.cookie)).relation).toBe('me');
    expect((await profileOf(hugo.account.friendCode, bia.cookie)).relation).toBe('none');
    await friends.add(bia.account.id, hugo.account.friendCode);
    expect((await profileOf(hugo.account.friendCode, bia.cookie)).relation).toBe('pending');
    await friends.accept(hugo.account.id, bia.account.id);
    const asFriend = await profileOf(hugo.account.friendCode, bia.cookie);
    expect(asFriend.relation).toBe('friend');
    expect(asFriend.stats.friends).toBe(1);

    // Código digitado sem hífen e em minúsculas também acha; inexistente, 404.
    const typed = hugo.account.friendCode.replace('-', '').toLowerCase();
    expect((await fetch(`${API}/profiles/${typed}`)).status).toBe(200);
    expect((await fetch(`${API}/profiles/ZZZZ-ZZZZ`)).status).toBe(404);
  });

  it('o ranking mostra o nickname atual e o código do perfil de quem tem conta', async () => {
    const hugo = await login('Hugo');
    const guestId = randomUUID();
    await accounts.linkGuest(hugo.account.id, guestId);
    const visitor = { guestId: randomUUID(), nickname: 'Visitante' };
    await store.saveGame({
      roomCode: 'TESTE',
      imageId: 'praia',
      pieceCount: 24,
      rows: 4,
      cols: 6,
      seed: 'abc',
      startedAt: new Date(Date.now() - 60_000),
      finishedAt: new Date(),
      durationMs: 60_000,
      players: [{ guestId, userId: hugo.account.id, nickname: 'Hugo' }, visitor],
    });
    await patch(hugo.cookie, { nickname: 'Hugão' });
    const { entries } = await store.leaderboard({ image: 'praia', pieces: 24, players: 2 });
    expect(entries[0]).toMatchObject({
      players: ['Hugão', 'Visitante'],
      profiles: [hugo.account.friendCode, null],
    });
  });

  it('na sala, quem está logado entra com o nickname do perfil (não com o digitado)', async () => {
    const { cookie } = await login('Hugo Ryan França');
    await patch(cookie, { nickname: 'Hugão' });
    const sdk = new ColyseusSDK(`ws://127.0.0.1:${PORT}`, { headers: { cookie } });
    const client = await sdk.create(
      ROOM_NAME,
      { name: 'Outro nome', guestId: randomUUID(), pieceCount: 24, imageId: CATALOG[0]!.id },
      RoomState,
    );
    const room = matchMaker.getLocalRoomById(client.roomId);
    expect((room.state as RoomState).players.get(client.sessionId)!.name).toBe('Hugão');
    await client.leave();
  });
});
