import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_SAVED_GAMES } from '@puzzle/shared';
import { createAccountStore, type AccountStore } from '../auth/accounts';
import type { AppDatabase } from '../db/database';
import { clearDatabase, createMemoryDatabase } from '../db/memoryDatabase';
import { createSavedGameStore, type SavedGameStore } from './savedGames';
import { SNAPSHOT_VERSION, type RoomSnapshot } from './snapshots';

let db: AppDatabase;
let accounts: AccountStore;
let saved: SavedGameStore;
beforeAll(async () => {
  db = await createMemoryDatabase();
  accounts = createAccountStore(db);
  saved = createSavedGameStore(db);
});
beforeEach(() => clearDatabase(db));

function snapshot(elapsedMs = 60_000, imageId = 'praia'): RoomSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    config: {
      imageId,
      seed: 'abc',
      rows: 4,
      cols: 6,
      width: 1200,
      height: 800,
      pieceCount: 24,
      maxPlayers: 2,
    },
    phase: 'playing',
    startedAt: Date.now() - elapsedMs,
    elapsedMs,
    players: [{ guestId: 'convidado', name: 'Hugo', color: '#ff0000', snaps: 3 }],
    groups: [{ id: 0, x: 10, y: 20, pieceIds: [0] }],
  };
}

const user = (sub: string) => accounts.signInWithGoogle({ sub, name: sub }, false);

describe('SavedGameStore', () => {
  it('grava, lista com o progresso e devolve o snapshot', async () => {
    const hugo = await user('hugo');
    const id = await saved.save(hugo.id, snapshot(), { pieces: 24, placed: 6 });
    expect(await saved.list(hugo.id)).toEqual([
      expect.objectContaining({
        id,
        imageId: 'praia',
        pieceCount: 24,
        maxPlayers: 2,
        pieces: 24,
        placed: 6,
        elapsedMs: 60_000,
      }),
    ]);
    const loaded = await saved.load(id);
    expect(loaded?.ownerUserId).toBe(hugo.id);
    expect(loaded?.snapshot.groups).toEqual([{ id: 0, x: 10, y: 20, pieceIds: [0] }]);
  });

  it('salvar de novo com o mesmo id atualiza a mesma entrada', async () => {
    const hugo = await user('hugo');
    const id = await saved.save(hugo.id, snapshot(), { pieces: 24, placed: 6 });
    expect(await saved.save(hugo.id, snapshot(90_000), { pieces: 24, placed: 12 }, id)).toBe(id);
    const list = await saved.list(hugo.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ placed: 12, elapsedMs: 90_000 });
  });

  it('id de outra conta (ou apagado) não é sobrescrito: vira uma entrada nova', async () => {
    const hugo = await user('hugo');
    const bia = await user('bia');
    const id = await saved.save(hugo.id, snapshot(), { pieces: 24, placed: 6 });
    const other = await saved.save(bia.id, snapshot(), { pieces: 24, placed: 1 }, id);
    expect(other).not.toBe(id);
    expect((await saved.list(hugo.id))[0]).toMatchObject({ placed: 6 });
  });

  it('apagar exige ser o dono', async () => {
    const hugo = await user('hugo');
    const bia = await user('bia');
    const id = await saved.save(hugo.id, snapshot(), { pieces: 24, placed: 6 });
    await saved.delete(id, bia.id);
    expect(await saved.list(hugo.id)).toHaveLength(1);
    await saved.delete(id, hugo.id);
    expect(await saved.list(hugo.id)).toHaveLength(0);
  });

  it(`guarda no máximo ${MAX_SAVED_GAMES} por conta: a mais antiga sai`, async () => {
    const hugo = await user('hugo');
    const first = await saved.save(hugo.id, snapshot(), { pieces: 24, placed: 0 });
    for (let i = 0; i < MAX_SAVED_GAMES; i++) {
      await saved.save(hugo.id, snapshot(), { pieces: 24, placed: i });
    }
    const list = await saved.list(hugo.id);
    expect(list).toHaveLength(MAX_SAVED_GAMES);
    expect(list.map((game) => game.id)).not.toContain(first);
  });

  it('ignora snapshot de outro formato', async () => {
    const hugo = await user('hugo');
    const old = { ...snapshot(), version: 0 } as unknown as RoomSnapshot;
    const id = await saved.save(hugo.id, old, { pieces: 24, placed: 0 });
    expect(await saved.load(id)).toBeUndefined();
  });
});
