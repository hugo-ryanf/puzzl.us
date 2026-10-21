import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from './database';
import { createGameStore, type GameResult, type GameStore } from './gameStore';
import { clearDatabase, createMemoryDatabase } from './memoryDatabase';

const ana = { guestId: randomUUID(), nickname: 'Ana' };
const bia = { guestId: randomUUID(), nickname: 'Bia' };
const caio = { guestId: randomUUID(), nickname: 'Caio' };
const duda = { guestId: randomUUID(), nickname: 'Duda' };

// O store não valida a imagem (a API faz isso com zod), então os testes usam ids fictícios.
function game(
  team: GameResult['players'],
  durationMs: number,
  { pieceCount = 100, imageId = 'praia' } = {},
): GameResult {
  const startedAt = new Date('2026-10-20T20:00:00Z');
  return {
    roomCode: 'TESTE',
    imageId,
    pieceCount,
    rows: 7,
    cols: 14,
    seed: 'abc',
    startedAt,
    finishedAt: new Date(startedAt.getTime() + durationMs),
    durationMs,
    players: team,
  };
}

// Subir o PGlite leva alguns segundos: um banco por arquivo, esvaziado entre os testes.
let db: AppDatabase;
let store: GameStore;
beforeAll(async () => {
  db = await createMemoryDatabase();
  store = createGameStore(db);
});
beforeEach(() => clearDatabase(db));

describe('GameStore', () => {
  it('a primeira equipe da categoria fica em 1º', async () => {
    expect(await store.saveGame(game([ana, bia], 60_000))).toEqual({ rank: 1 });
  });

  it('calcula a posição comparando com o melhor tempo das outras equipes', async () => {
    await store.saveGame(game([ana, bia], 60_000));
    await store.saveGame(game([caio, duda], 30_000));
    expect(await store.saveGame(game([ana, caio], 45_000))).toEqual({ rank: 2 });
  });

  it('a própria equipe não conta contra ela mesma', async () => {
    await store.saveGame(game([ana, bia], 30_000));
    // A mesma dupla (em outra ordem) jogando mais devagar continua em 1º entre as equipes.
    expect(await store.saveGame(game([bia, ana], 50_000))).toEqual({ rank: 1 });
  });

  it('o ranking mostra só o melhor tempo de cada equipe, do mais rápido ao mais lento', async () => {
    await store.saveGame(game([ana, bia], 60_000));
    await store.saveGame(game([ana, bia], 40_000));
    await store.saveGame(game([caio, duda], 50_000));

    const ranking = await store.leaderboard({ image: 'praia', pieces: 100, players: 2 });
    expect(ranking.map((r) => [r.position, r.players, r.durationMs])).toEqual([
      [1, ['Ana', 'Bia'], 40_000],
      [2, ['Caio', 'Duda'], 50_000],
    ]);
  });

  it('separa categorias por número de peças e de jogadores', async () => {
    await store.saveGame(game([ana, bia], 60_000, { pieceCount: 100 }));
    await store.saveGame(game([ana, bia], 60_000, { pieceCount: 300 }));
    await store.saveGame(game([caio], 10_000, { pieceCount: 100 }));

    const board = (pieces: number, players: number) =>
      store.leaderboard({ image: 'praia', pieces, players });
    expect(await board(100, 2)).toHaveLength(1);
    expect(await board(300, 2)).toHaveLength(1);
    expect(await board(100, 1)).toHaveLength(1);
    expect(await board(48, 2)).toEqual([]);
  });

  it('separa categorias por imagem: tempo numa foto não compete com outra', async () => {
    await store.saveGame(game([ana, bia], 30_000, { imageId: 'praia' }));
    // Mais lenta, mas é a primeira na montanha.
    expect(await store.saveGame(game([caio, duda], 90_000, { imageId: 'montanha' }))).toEqual({
      rank: 1,
    });
    const montanha = await store.leaderboard({ image: 'montanha', pieces: 100, players: 2 });
    expect(montanha.map((r) => r.players)).toEqual([['Caio', 'Duda']]);
  });

  it('conta a mesma pessoa em duas abas uma vez só', async () => {
    await store.saveGame(game([ana, { ...ana, nickname: 'Ana (aba 2)' }], 20_000));
    expect(await store.leaderboard({ image: 'praia', pieces: 100, players: 1 })).toHaveLength(1);
  });

  it('guarda o apelido usado em cada partida', async () => {
    await store.saveGame(game([ana, bia], 60_000));
    await store.saveGame(game([{ ...ana, nickname: 'Aninha' }, caio], 50_000));
    const ranking = await store.leaderboard({ image: 'praia', pieces: 100, players: 2 });
    expect(ranking.map((r) => r.players)).toEqual([
      ['Aninha', 'Caio'],
      ['Ana', 'Bia'],
    ]);
  });
});
