import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { matchMaker, type Server } from '@colyseus/core';
import { ColyseusSDK } from '@colyseus/sdk';
import {
  BULLET_ROOM,
  RoomState,
  type BoardSchema,
  type BulletRankingEntry,
  type RankingPage,
} from '@puzzle/shared';
import { createGameServer } from '../app';
import { createBulletStore, type BulletStore } from '../db/bulletStore';
import type { AppDatabase } from '../db/database';
import { clearDatabase, createMemoryDatabase } from '../db/memoryDatabase';
import type { BulletRoom } from './BulletRoom';

const PORT = 2574;
const sdk = new ColyseusSDK(`ws://127.0.0.1:${PORT}`);

let db: AppDatabase;
let bullet: BulletStore;
let server: Server;
beforeAll(async () => {
  db = await createMemoryDatabase();
  bullet = createBulletStore(db);
  server = createGameServer({ bullet });
  await server.listen(PORT);
});
afterAll(() => server.gracefullyShutdown(false));
beforeEach(() => clearDatabase(db));

const player = (name: string) => ({ name, guestId: randomUUID() });

/** Espera a condição valer (as mensagens do cliente chegam pela rede). */
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await wait(10);
  return check();
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sala de Bullet (por padrão solo, que já começa) e acesso à sala do lado do servidor. */
async function create(options: { maxPlayers?: number; pieces?: 12 | 24 } = {}) {
  const client = await sdk.create(
    BULLET_ROOM,
    {
      ...player('Ana'),
      minutes: 3,
      pieces: options.pieces ?? 12,
      maxPlayers: options.maxPlayers ?? 1,
    },
    RoomState,
  );
  const room = matchMaker.getLocalRoomById(client.roomId) as unknown as BulletRoom;
  const state = room.state;
  const board = () => state.boards.get('main') as BoardSchema;
  return { client, room, state, board };
}

/** Encaixa as peças de `from` até `to` (exclusive) do tabuleiro da vez. */
async function solve(game: Awaited<ReturnType<typeof create>>, from = 1, to = Infinity) {
  const { client, board } = game;
  const { pieceGroup, groups } = board();
  const me = client.sessionId;
  for (let pieceId = from; pieceId < Math.min(to, pieceGroup.length); pieceId++) {
    const groupId = pieceGroup[pieceId]!;
    if (groupId === pieceGroup[0]) continue;
    const anchor = groups.get(String(pieceGroup[0]))!;
    client.send('grab', { groupId, board: 'main' });
    await until(() => groups.get(String(groupId))?.heldBy === me);
    client.send('drop', { groupId, x: anchor.x, y: anchor.y, board: 'main' });
    await until(() => groups.get(String(groupId))?.heldBy !== me);
  }
}

describe('BulletRoom', () => {
  it('solo começa na hora, com o relógio regressivo e o primeiro quebra-cabeça', async () => {
    const { state, board, client } = await create();
    expect(state.mode).toBe('bullet');
    expect(state.phase).toBe('playing');
    expect(state.timeLimitMs).toBe(180_000);
    expect(state.round).toBe(1);
    expect(board().pieceGroup.length).toBeGreaterThanOrEqual(9); // ~12 peças
    expect(state.config.imageId).toBe(board().config.imageId);
    await client.leave();
  });

  it('montou um, entra outro com foto diferente e conta como resolvido', async () => {
    const game = await create();
    const firstImage = game.board().config.imageId;
    await solve(game);
    expect(game.board().done).toBe(true);
    expect(game.state.solved).toBe(1);

    expect(await until(() => game.state.round === 2)).toBe(true);
    expect(game.board().done).toBe(false);
    expect(game.board().config.imageId).not.toBe(firstImage);
    await game.client.leave();
  });

  it('acabou o tempo: conta o que ficou pela metade, grava e dá a posição', async () => {
    const game = await create();
    await solve(game);
    await until(() => game.state.round === 2);
    await solve(game, 1, 4); // algumas peças do segundo

    (game.room as unknown as { timeUp(): void }).timeUp();
    expect(game.state.phase).toBe('completed');
    expect(game.state.remainingMs).toBe(0);
    expect(game.state.partial).toBeGreaterThan(0);
    for (let i = 0; i < 50 && game.state.rankStatus === 'saving'; i++) await wait(20);
    expect(game.state.rankStatus).toBe('saved');
    expect(game.state.rank).toBe(1);

    const response = await fetch(
      `http://127.0.0.1:${PORT}/api/ranking/bullet?minutes=3&pieces=12&players=1`,
    );
    const ranking = (await response.json()) as RankingPage<BulletRankingEntry>;
    expect(ranking.entries).toEqual([
      expect.objectContaining({
        position: 1,
        players: ['Ana'],
        solved: 1,
        partial: game.state.partial,
      }),
    ]);
    await game.client.leave();
  });

  it('no lobby ninguém mexe; mensagem sem o tabuleiro certo é ignorada', async () => {
    const { state, board, client } = await create({ maxPlayers: 2 });
    expect(state.phase).toBe('lobby');
    const groupId = board().pieceGroup[1]!;
    const heldBy = () => board().groups.get(String(groupId))!.heldBy;
    client.send('grab', { groupId, board: 'main' });
    await wait(100);
    expect(heldBy()).toBe('');

    client.send('start');
    expect(await until(() => state.phase === 'playing')).toBe(true);
    client.send('grab', { groupId }); // sem `board`
    await wait(100);
    expect(heldBy()).toBe('');
    client.send('grab', { groupId, board: 'main' });
    expect(await until(() => heldBy() === client.sessionId)).toBe(true);
    await client.leave();
  });

  it('a API rejeita categoria fora das opções', async () => {
    const response = await fetch(
      `http://127.0.0.1:${PORT}/api/ranking/bullet?minutes=7&pieces=12&players=1`,
    );
    expect(response.status).toBe(400);
  });
});

describe('BulletStore', () => {
  const run = (players: string[], solved: number, partial: number) => ({
    roomCode: 'TESTE',
    minutes: 5,
    pieceCount: 12,
    solved,
    partial,
    startedAt: new Date(Date.now() - 300_000),
    finishedAt: new Date(),
    players: players.map((nickname) => ({ guestId: guestIds[nickname]!, nickname })),
  });
  const guestIds: Record<string, string> = {
    Ana: randomUUID(),
    Bia: randomUUID(),
    Caio: randomUUID(),
  };

  it('melhor corrida de cada equipe; empate decidido pelas peças do último', async () => {
    await bullet.saveRun(run(['Ana', 'Bia'], 4, 3));
    await bullet.saveRun(run(['Bia', 'Ana'], 6, 0)); // mesma dupla, melhor corrida
    await bullet.saveRun(run(['Ana', 'Caio'], 6, 5)); // mesmo tanto, mais peças no último
    const saved = await bullet.saveRun(run(['Bia', 'Caio'], 2, 0));
    expect(saved).toEqual({ rank: 3, rankToday: 3 });

    const top = (await bullet.leaderboard({ minutes: 5, pieces: 12, players: 2 })).entries;
    expect(top.map((entry) => [entry.players, entry.solved, entry.partial])).toEqual([
      [['Ana', 'Caio'], 6, 5],
      [['Ana', 'Bia'], 6, 0],
      [['Bia', 'Caio'], 2, 0],
    ]);
    // Outra categoria não se mistura.
    expect((await bullet.leaderboard({ minutes: 3, pieces: 12, players: 2 })).entries).toEqual([]);
  });
});
