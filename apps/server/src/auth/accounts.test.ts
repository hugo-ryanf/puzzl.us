import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../db/database';
import { createGameStore, type GameResult, type GameStore } from '../db/gameStore';
import { clearDatabase, createMemoryDatabase } from '../db/memoryDatabase';
import { games, players, sessions } from '../db/schema';
import { createAccountStore, type AccountStore } from './accounts';

let db: AppDatabase;
let accounts: AccountStore;
let store: GameStore;
beforeAll(async () => {
  db = await createMemoryDatabase();
  accounts = createAccountStore(db);
  store = createGameStore(db);
});
beforeEach(() => clearDatabase(db));

const google = (sub: string, name = 'Hugo') => ({ sub, name, picture: 'https://foto/hugo.png' });

function game(players: GameResult['players'], durationMs = 60_000): GameResult {
  const finishedAt = new Date();
  return {
    roomCode: 'TESTE',
    imageId: 'praia',
    pieceCount: 24,
    rows: 4,
    cols: 6,
    seed: 'abc',
    startedAt: new Date(finishedAt.getTime() - durationMs),
    finishedAt,
    durationMs,
    players,
  };
}

describe('AccountStore — contas e sessões', () => {
  it('cria a conta no primeiro login e só atualiza nome e foto nos seguintes', async () => {
    const first = await accounts.signInWithGoogle(google('g-1', 'Hugo'), false);
    expect(first).toMatchObject({
      name: 'Hugo',
      avatarUrl: 'https://foto/hugo.png',
      isAdmin: false,
    });
    expect(first.friendCode).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);

    const again = await accounts.signInWithGoogle(google('g-1', 'Hugo R.'), true);
    // Mesmo id e código; o nome do Google muda (sem nickname, o perfil mostra o primeiro nome).
    expect(again).toEqual({ ...first, name: 'Hugo', googleName: 'Hugo R.', isAdmin: true });
  });

  it('a sessão vale pelo token; no banco fica só o hash; sair apaga', async () => {
    const account = await accounts.signInWithGoogle(google('g-1'), false);
    const { token } = await accounts.createSession(account.id);

    expect(await accounts.accountForSession(token)).toEqual(account);
    expect(await accounts.accountForSession('token-inventado')).toBeUndefined();
    const [row] = await db.select().from(sessions);
    expect(row!.tokenHash).not.toBe(token);

    await accounts.deleteSession(token);
    expect(await accounts.accountForSession(token)).toBeUndefined();
  });

  it('sessão expirada não vale e é apagada na limpeza', async () => {
    const account = await accounts.signInWithGoogle(google('g-1'), false);
    const { token } = await accounts.createSession(account.id);
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });

    expect(await accounts.accountForSession(token)).toBeUndefined();
    expect(await accounts.deleteExpiredSessions()).toBe(1);
  });
});

describe('AccountStore — histórico do convidado', () => {
  it('conta sem jogador: o convidado deste navegador vira o jogador da conta', async () => {
    const guestId = randomUUID();
    await store.saveGame(game([{ guestId, nickname: 'Hugo' }]));
    const account = await accounts.signInWithGoogle(google('g-1'), false);

    await accounts.linkGuest(account.id, guestId);
    const [player] = await db.select().from(players).where(eq(players.guestId, guestId));
    expect(player!.userId).toBe(account.id);
  });

  it('conta que já jogava: as partidas do convidado passam para ela, com a equipe recalculada', async () => {
    const account = await accounts.signInWithGoogle(google('g-1'), false);
    const bia = { guestId: randomUUID(), nickname: 'Bia' };
    // No PC 1, logado; no PC 2, ainda como convidado, em dupla com a Bia.
    await store.saveGame(game([{ guestId: randomUUID(), userId: account.id, nickname: 'Hugo' }]));
    const guestId = randomUUID();
    await store.saveGame(game([{ guestId, nickname: 'Hugo' }, bia]));

    await accounts.linkGuest(account.id, guestId);

    const all = await db.select({ id: players.id, userId: players.userId }).from(players);
    expect(all).toHaveLength(2); // o jogador da conta e a Bia; o convidado sumiu
    const mine = all.find((p) => p.userId === account.id)!;
    const duo = (await db.select().from(games)).find((g) => g.teamSize === 2)!;
    expect(duo.teamKey.split(',')).toContain(mine.id);
  });

  it('não mexe num convidado que já é de outra conta (PC compartilhado)', async () => {
    const guestId = randomUUID();
    const other = await accounts.signInWithGoogle(google('g-outro'), false);
    // O convidado deste PC jogou e depois a outra pessoa entrou na conta dela por aqui.
    await store.saveGame(game([{ guestId, nickname: 'Outro' }]));
    await store.saveGame(game([{ guestId, userId: other.id, nickname: 'Outro' }]));
    const account = await accounts.signInWithGoogle(google('g-1'), false);

    await accounts.linkGuest(account.id, guestId);
    const [player] = await db.select().from(players).where(eq(players.guestId, guestId));
    expect(player!.userId).toBe(other.id);
  });

  it('logado em dois aparelhos na mesma partida conta como uma pessoa só', async () => {
    const account = await accounts.signInWithGoogle(google('g-1'), false);
    await store.saveGame(
      game([
        { guestId: randomUUID(), userId: account.id, nickname: 'Hugo' },
        { guestId: randomUUID(), userId: account.id, nickname: 'Hugo (celular)' },
      ]),
    );
    const [saved] = await db.select().from(games);
    expect(saved!.teamSize).toBe(1);
  });
});
