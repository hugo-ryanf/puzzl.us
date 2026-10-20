import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from '@colyseus/core';
import type { MeResponse } from '@puzzle/shared';
import { createGameServer } from '../app';
import type { AppDatabase } from '../db/database';
import { createGameStore } from '../db/gameStore';
import { clearDatabase, createMemoryDatabase } from '../db/memoryDatabase';
import { players } from '../db/schema';
import { createAccountStore, type GoogleProfile } from './accounts';
import type { GoogleAuth } from './google';

const PORT = 2571;
const base = `http://127.0.0.1:${PORT}`;
const PUBLIC_URL = 'http://site.test';

/** Google de mentira: o "código" que volta no callback é o sub da conta. */
let nextProfile: GoogleProfile;
const fakeGoogle: GoogleAuth = {
  start: () => ({
    url: new URL('https://accounts.google.test/o/oauth2/auth?client=teste'),
    state: 'estado-123',
    codeVerifier: 'verificador-456',
  }),
  async finish(code, codeVerifier) {
    if (codeVerifier !== 'verificador-456') throw new Error('PKCE errado');
    return { ...nextProfile, sub: code };
  },
};

let db: AppDatabase;
let server: Server;
beforeAll(async () => {
  db = await createMemoryDatabase();
  server = createGameServer({
    store: createGameStore(db),
    auth: {
      accounts: createAccountStore(db),
      google: fakeGoogle,
      publicUrl: PUBLIC_URL,
      adminEmails: ['hugo@exemplo.com'],
      secureCookies: false,
    },
  });
  await server.listen(PORT);
});
afterAll(() => server.gracefullyShutdown(false));
beforeEach(async () => {
  await clearDatabase(db);
  nextProfile = { sub: '', name: 'Hugo', email: 'hugo@exemplo.com', emailVerified: true };
});

/** Cookies "nome=valor" de um Set-Cookie, prontos para mandar de volta. */
const cookiesFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0]!)
    .filter((cookie) => !cookie.endsWith('='))
    .join('; ');

/** Faz o login completo (ida ao "Google" e volta) e devolve o cookie da sessão. */
async function login(sub = 'g-1') {
  const start = await fetch(`${base}/auth/google`, { redirect: 'manual' });
  const callback = await fetch(`${base}/auth/google/callback?code=${sub}&state=estado-123`, {
    redirect: 'manual',
    headers: { cookie: cookiesFrom(start) },
  });
  return { start, callback, session: cookiesFrom(callback) };
}

const me = async (cookie = '') =>
  (await (await fetch(`${base}/api/me`, { headers: { cookie } })).json()) as MeResponse;

describe('login com Google', () => {
  it('vai para o Google guardando state e PKCE em cookies httpOnly', async () => {
    const { start } = await login();
    expect(start.status).toBe(302);
    expect(start.headers.get('location')).toContain('accounts.google.test');
    const cookies = start.headers.getSetCookie().join('\n');
    expect(cookies).toMatch(/oauth_state=estado-123;.*HttpOnly/);
    expect(cookies).toMatch(/oauth_verifier=verificador-456;.*HttpOnly/);
  });

  it('na volta cria a sessão e o /api/me passa a mostrar a conta', async () => {
    const { callback, session } = await login();
    expect(callback.headers.get('location')).toBe(`${PUBLIC_URL}/?login=ok`);
    expect(callback.headers.getSetCookie().join('\n')).toMatch(/sid=.*HttpOnly.*SameSite=Lax/);

    expect(await me()).toEqual({ user: null, googleLogin: true });
    expect((await me(session)).user).toMatchObject({ name: 'Hugo', isAdmin: true });
  });

  it('só vira admin com o e-mail verificado da lista', async () => {
    nextProfile = { ...nextProfile, emailVerified: false };
    expect((await me((await login()).session)).user?.isAdmin).toBe(false);
  });

  it('recusa a volta com state diferente (login forjado por outro site)', async () => {
    const start = await fetch(`${base}/auth/google`, { redirect: 'manual' });
    const callback = await fetch(`${base}/auth/google/callback?code=g-1&state=outro`, {
      redirect: 'manual',
      headers: { cookie: cookiesFrom(start) },
    });
    expect(callback.headers.get('location')).toBe(`${PUBLIC_URL}/?login=erro`);
    expect(cookiesFrom(callback)).not.toContain('sid=');
  });

  it('quem desiste na tela do Google volta como cancelado', async () => {
    const callback = await fetch(`${base}/auth/google/callback?error=access_denied`, {
      redirect: 'manual',
    });
    expect(callback.headers.get('location')).toBe(`${PUBLIC_URL}/?login=cancelado`);
  });

  it('sair apaga a sessão', async () => {
    const { session } = await login();
    const logout = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { cookie: session },
    });
    expect(logout.status).toBe(204);
    expect((await me(session)).user).toBeNull();
  });

  it('juntar o convidado exige estar logado e liga o histórico à conta', async () => {
    const guestId = randomUUID();
    await db.insert(players).values({ guestId, nickname: 'Hugo' });
    const link = (cookie: string) =>
      fetch(`${base}/api/me/link-guest`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestId }),
      });

    expect((await link('')).status).toBe(401);
    const { session } = await login();
    expect((await link(session)).status).toBe(204);
    const [player] = await db.select().from(players).where(eq(players.guestId, guestId));
    expect(player!.userId).toBe((await me(session)).user!.id);
  });
});
