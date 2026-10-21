import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAccountStore, type AccountStore } from '../auth/accounts';
import type { AppDatabase } from '../db/database';
import { createGameStore, type GameResult, type GameStore } from '../db/gameStore';
import { clearDatabase, createMemoryDatabase } from '../db/memoryDatabase';
import { createLibraryStore, type LibraryStore } from './library';

let db: AppDatabase;
let accounts: AccountStore;
let store: GameStore;
let library: LibraryStore;
beforeAll(async () => {
  db = await createMemoryDatabase();
  accounts = createAccountStore(db);
  store = createGameStore(db);
  library = createLibraryStore(db);
});
beforeEach(() => clearDatabase(db));

function game(
  players: GameResult['players'],
  durationMs: number,
  { imageId = 'praia', pieceCount = 24 } = {},
): GameResult {
  const finishedAt = new Date();
  return {
    roomCode: 'TESTE',
    imageId,
    pieceCount,
    rows: 4,
    cols: 6,
    seed: 'abc',
    startedAt: new Date(finishedAt.getTime() - durationMs),
    finishedAt,
    durationMs,
    players,
  };
}

describe('LibraryStore', () => {
  it('records: melhor tempo e quantas vezes, por foto + peças + modalidade', async () => {
    const hugo = await accounts.signInWithGoogle({ sub: 'g-1', name: 'Hugo' }, false);
    const me = { guestId: randomUUID(), userId: hugo.id, nickname: 'Hugo' };
    const bia = { guestId: randomUUID(), nickname: 'Bia' };
    await store.saveGame(game([me], 90_000));
    await store.saveGame(game([me], 60_000));
    await store.saveGame(game([me, bia], 50_000, { imageId: 'lago', pieceCount: 48 }));
    await store.saveGame(game([bia], 10_000, { imageId: 'deserto' })); // não é da conta

    const records = await library.records(hugo.id);
    expect(records).toHaveLength(2);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          imageId: 'praia',
          pieceCount: 24,
          teamSize: 1,
          bestMs: 60_000,
          plays: 2,
        }),
        expect.objectContaining({
          imageId: 'lago',
          pieceCount: 48,
          teamSize: 2,
          bestMs: 50_000,
          plays: 1,
        }),
      ]),
    );
  });

  it('favoritar e desfavoritar (repetir não duplica)', async () => {
    const hugo = await accounts.signInWithGoogle({ sub: 'g-1', name: 'Hugo' }, false);
    await library.setFavorite(hugo.id, 'praia', true);
    await library.setFavorite(hugo.id, 'praia', true);
    await library.setFavorite(hugo.id, 'lago', true);
    expect((await library.favorites(hugo.id)).sort()).toEqual(['lago', 'praia']);

    await library.setFavorite(hugo.id, 'praia', false);
    expect(await library.favorites(hugo.id)).toEqual(['lago']);
  });
});
