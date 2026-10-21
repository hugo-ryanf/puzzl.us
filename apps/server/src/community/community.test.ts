import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from '@colyseus/core';
import sharp from 'sharp';
import { COMMUNITY_HIDE_REPORTS, type CommunityPuzzle, type UploadResponse } from '@puzzle/shared';
import { createGameServer } from '../app';
import { createAccountStore, type AccountStore } from '../auth/accounts';
import type { AppDatabase } from '../db/database';
import { clearDatabase, createMemoryDatabase } from '../db/memoryDatabase';
import { createUploadStore, type UploadStore } from '../uploads/uploadStore';
import { createCommunityStore } from './community';

const PORT = 2572;
const API = `http://127.0.0.1:${PORT}/api`;

let db: AppDatabase;
let accounts: AccountStore;
let uploads: UploadStore;
let server: Server;
beforeAll(async () => {
  db = await createMemoryDatabase();
  accounts = createAccountStore(db);
  uploads = createUploadStore(db);
  server = createGameServer({
    uploads,
    community: createCommunityStore(db),
    auth: { accounts, publicUrl: 'http://site.test', adminEmails: [], secureCookies: false },
  });
  await server.listen(PORT);
});
afterAll(() => server.gracefullyShutdown(false));
beforeEach(() => clearDatabase(db));

/** Conta logada: devolve o cookie da sessão. Admin vira admin pelo login (ADMIN_EMAILS). */
async function login(name: string, isAdmin = false) {
  const account = await accounts.signInWithGoogle({ sub: randomUUID(), name }, isAdmin);
  const { token } = await accounts.createSession(account.id);
  return `sid=${token}`;
}

async function upload(cookie = '') {
  const body = await sharp({
    create: { width: 1200, height: 900, channels: 3, background: '#4a6' },
  })
    .jpeg()
    .toBuffer();
  const response = await fetch(`${API}/uploads`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'image/jpeg', cookie },
  });
  return ((await response.json()) as UploadResponse).imageId;
}

const publish = (cookie: string, imageId: string, extra: object = {}) =>
  fetch(`${API}/puzzles`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageId,
      title: 'Meu quintal',
      authorName: 'Hugo',
      rights: true,
      ...extra,
    }),
  });

const list = async (cookie = '') =>
  (await (await fetch(`${API}/puzzles`, { headers: { cookie } })).json()) as CommunityPuzzle[];

const call = (method: string, path: string, cookie: string) =>
  fetch(`${API}/puzzles/${path}`, { method, headers: { cookie } });

describe('Quebra-cabeças da comunidade', () => {
  it('quem enviou publica; aparece para todos com miniatura', async () => {
    const hugo = await login('Hugo');
    const imageId = await upload(hugo);
    const response = await publish(hugo, imageId);
    expect(response.status).toBe(201);
    const puzzle = (await response.json()) as CommunityPuzzle;
    expect(puzzle).toMatchObject({
      imageId,
      title: 'Meu quintal',
      authorName: 'Hugo',
      width: 1200,
      height: 900,
      status: 'published',
      mine: true,
    });

    const [seen] = await list(); // convidado
    expect(seen).toMatchObject({ id: puzzle.id, mine: false, reported: false });
    const mini = await fetch(`${API}/puzzles/${puzzle.id}/mini`);
    expect(mini.headers.get('content-type')).toBe('image/webp');
    const { width } = await sharp(Buffer.from(await mini.arrayBuffer())).metadata();
    expect(width).toBe(480);
  });

  it('só publica logado, a própria foto, com título e direitos, e uma vez só', async () => {
    const hugo = await login('Hugo');
    const bia = await login('Bia');
    const imageId = await upload(hugo);
    const anonymous = await upload(); // enviada sem conta: ninguém pode publicar

    expect((await publish('', imageId)).status).toBe(401);
    expect((await publish(bia, imageId)).status).toBe(403);
    expect((await publish(hugo, anonymous)).status).toBe(403);
    expect((await publish(hugo, imageId, { rights: false })).status).toBe(400);
    expect((await publish(hugo, imageId, { title: ' ' })).status).toBe(400);
    expect((await publish(hugo, `upload:${'x'.repeat(22)}`)).status).toBe(404);
    expect((await publish(hugo, imageId)).status).toBe(201);
    expect((await publish(hugo, imageId)).status).toBe(409);
  });

  it(`${COMMUNITY_HIDE_REPORTS} denúncias ocultam; o admin vê, restaura ou remove`, async () => {
    const hugo = await login('Hugo');
    const admin = await login('Admin', true);
    const { id } = (await (await publish(hugo, await upload(hugo))).json()) as CommunityPuzzle;

    expect((await call('POST', `${id}/report`, '')).status).toBe(401);
    expect((await call('POST', `${id}/report`, hugo)).status).toBe(400); // a própria
    for (let i = 0; i < COMMUNITY_HIDE_REPORTS; i++) {
      const reporter = await login(`Pessoa ${i}`);
      expect((await call('POST', `${id}/report`, reporter)).status).toBe(200);
      // Denunciar de novo não conta duas vezes.
      await call('POST', `${id}/report`, reporter);
    }
    expect(await list()).toEqual([]);
    const [hidden] = await list(admin);
    expect(hidden).toMatchObject({ id, status: 'hidden', reports: COMMUNITY_HIDE_REPORTS });

    expect((await call('POST', `${id}/restore`, hugo)).status).toBe(403);
    expect((await call('POST', `${id}/restore`, admin)).status).toBe(204);
    expect((await list()).map((puzzle) => puzzle.id)).toEqual([id]);

    expect((await call('DELETE', id, admin)).status).toBe(204);
    expect(await list(admin)).toEqual([]);
    expect((await fetch(`${API}/puzzles/${id}/mini`)).status).toBe(404);
  });

  it('o autor remove a sua; outra pessoa não', async () => {
    const hugo = await login('Hugo');
    const bia = await login('Bia');
    const { id } = (await (await publish(hugo, await upload(hugo))).json()) as CommunityPuzzle;
    expect((await call('DELETE', id, bia)).status).toBe(403);
    expect((await call('DELETE', id, hugo)).status).toBe(204);
    expect(await list()).toEqual([]);
  });

  it('a limpeza de 7 dias poupa fotos publicadas', async () => {
    const hugo = await login('Hugo');
    const published = await upload(hugo);
    await publish(hugo, published);
    await upload(hugo); // não publicada
    const future = new Date(Date.now() + 60_000);
    expect(await uploads.deleteUnusedSince(future)).toBe(1);
    expect(await list()).toHaveLength(1);
  });
});
