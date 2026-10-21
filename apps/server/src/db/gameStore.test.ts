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
  {
    pieceCount = 100,
    imageId = 'praia',
    finishedAt = new Date('2026-10-20T20:00:00Z'),
  }: { pieceCount?: number; imageId?: string; finishedAt?: Date } = {},
): GameResult {
  const startedAt = new Date(finishedAt.getTime() - durationMs);
  return {
    roomCode: 'TESTE',
    imageId,
    pieceCount,
    rows: 7,
    cols: 14,
    seed: 'abc',
    startedAt,
    finishedAt,
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
    expect(await store.saveGame(game([ana, bia], 60_000))).toMatchObject({ rank: 1 });
  });

  it('calcula a posição comparando com o melhor tempo das outras equipes', async () => {
    await store.saveGame(game([ana, bia], 60_000));
    await store.saveGame(game([caio, duda], 30_000));
    expect(await store.saveGame(game([ana, caio], 45_000))).toMatchObject({ rank: 2 });
  });

  it('a própria equipe não conta contra ela mesma', async () => {
    await store.saveGame(game([ana, bia], 30_000));
    // A mesma dupla (em outra ordem) jogando mais devagar continua em 1º entre as equipes.
    expect(await store.saveGame(game([bia, ana], 50_000))).toMatchObject({ rank: 1 });
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
    expect(await store.saveGame(game([caio, duda], 90_000, { imageId: 'montanha' }))).toMatchObject(
      {
        rank: 1,
      },
    );
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

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

describe('GameStore — períodos', () => {
  it('filtra o ranking por hoje, semana e mês (partida de 40 dias atrás só aparece em "sempre")', async () => {
    await store.saveGame(game([ana], 10_000, { finishedAt: daysAgo(40) }));
    await store.saveGame(game([bia], 20_000, { finishedAt: new Date() }));
    const names = async (period: 'day' | 'week' | 'month' | 'all') =>
      (await store.leaderboard({ image: 'praia', pieces: 100, players: 1, period })).map(
        (e) => e.players[0],
      );

    expect(await names('all')).toEqual(['Ana', 'Bia']);
    expect(await names('month')).toEqual(['Bia']);
    expect(await names('week')).toEqual(['Bia']);
    expect(await names('day')).toEqual(['Bia']);
  });

  it('a posição de hoje ignora partidas de outros dias', async () => {
    await store.saveGame(game([ana], 10_000, { finishedAt: daysAgo(3) }));
    expect(await store.saveGame(game([bia], 20_000, { finishedAt: new Date() }))).toMatchObject({
      rank: 2,
      rankToday: 1,
    });
  });
});

describe('GameStore — pontos', () => {
  it('sem partidas para comparar, a partida vale as peças (fator 1×)', async () => {
    const saved = await store.saveGame(game([ana], 60_000, { pieceCount: 48 }));
    expect(saved.points).toBe(48);
  });

  it('com o tempo típico da categoria: mais rápido vale mais, limitado a 2× e 0,5×', async () => {
    // Cinco partidas de 100 s (em fotos diferentes) fazem o tempo típico de 100 peças solo.
    for (const imageId of ['a', 'b', 'c', 'd', 'e']) {
      await store.saveGame(game([caio], 100_000, { imageId }));
    }
    expect((await store.saveGame(game([ana], 50_000, { imageId: 'f' }))).points).toBe(200); // 2×
    expect((await store.saveGame(game([ana], 20_000, { imageId: 'g' }))).points).toBe(200); // teto
    expect((await store.saveGame(game([bia], 400_000, { imageId: 'h' }))).points).toBe(50); // piso
  });

  it('ranking soma a melhor partida de cada foto e tamanho; repetir não acumula', async () => {
    const now = new Date();
    await store.saveGame(game([ana, bia], 60_000, { pieceCount: 24, finishedAt: now }));
    await store.saveGame(game([bia, ana], 30_000, { pieceCount: 24, finishedAt: now })); // repetiu
    await store.saveGame(
      game([bia, ana], 90_000, { pieceCount: 48, imageId: 'lago', finishedAt: now }),
    );
    await store.saveGame(game([caio, duda], 300_000, { pieceCount: 100, finishedAt: now }));
    await store.saveGame(game([ana], 5_000, { pieceCount: 500, finishedAt: now })); // solo: outra

    expect(await store.generalLeaderboard({ players: 2, period: 'week' })).toEqual([
      { position: 1, players: ['Caio', 'Duda'], points: 100, puzzles: 1 },
      { position: 2, players: ['Ana', 'Bia'], points: 72, puzzles: 2 },
    ]);
  });

  it('empate em pontos: ganha quem montou mais quebra-cabeças diferentes', async () => {
    await store.saveGame(game([ana], 80_000, { pieceCount: 48, finishedAt: new Date() }));
    await store.saveGame(game([bia], 40_000, { pieceCount: 24, finishedAt: new Date() }));
    await store.saveGame(
      game([bia], 40_000, { pieceCount: 24, imageId: 'lago', finishedAt: new Date() }),
    );
    const top = await store.generalLeaderboard({ players: 1, period: 'day' });
    expect(top.map((e) => [e.players[0], e.points, e.puzzles])).toEqual([
      ['Bia', 48, 2],
      ['Ana', 48, 1],
    ]);
  });

  it('respeita o período: partida antiga não soma na semana', async () => {
    await store.saveGame(game([ana], 10_000, { pieceCount: 1000, finishedAt: daysAgo(10) }));
    expect(await store.generalLeaderboard({ players: 1, period: 'week' })).toEqual([]);
    expect(await store.generalLeaderboard({ players: 1 })).toHaveLength(1);
  });

  it('fotos mais jogadas na modalidade e no período', async () => {
    await store.saveGame(game([ana], 10_000, { imageId: 'lago' }));
    await store.saveGame(game([bia], 10_000, { imageId: 'lago' }));
    await store.saveGame(game([ana], 10_000, { imageId: 'praia' }));
    await store.saveGame(game([ana, bia], 10_000, { imageId: 'deserto' })); // dupla: outra
    expect(await store.popular({ players: 1 })).toEqual([
      { imageId: 'lago', plays: 2 },
      { imageId: 'praia', plays: 1 },
    ]);
  });
});
