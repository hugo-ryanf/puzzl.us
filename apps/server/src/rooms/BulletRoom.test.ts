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
import { COUNTDOWN, ROTATION } from './BaseGameRoom';
import type { BulletRoom } from './BulletRoom';

const PORT = 2574;
const sdk = new ColyseusSDK(`ws://127.0.0.1:${PORT}`);

let db: AppDatabase;
let bullet: BulletStore;
let server: Server;
beforeAll(async () => {
  COUNTDOWN.seconds = 0; // sem o "3, 2, 1" (tem teste próprio)
  ROTATION.enabled = false; // peças de pé: os testes montam soltando no lugar
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

/** Grade de deslizar a um movimento de resolver: a peça 7 está no lugar do vazio. */
const NEARLY_SOLVED = [0, 1, 2, 3, 4, 5, 6, 8, 7];

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

  it('jogar novamente: placar e relógio zerados, foto nova, na mesma sala', async () => {
    const game = await create();
    await solve(game);
    await until(() => game.state.round === 2);
    (game.room as unknown as { timeUp(): void }).timeUp();
    for (let i = 0; i < 50 && game.state.rankStatus === 'saving'; i++) await wait(20);
    const imageId = game.state.config.imageId;

    game.client.send('playAgain');
    expect(await until(() => game.state.round === 3)).toBe(true);
    expect(game.state.phase).toBe('playing'); // solo já começa
    expect(game.state.solved).toBe(0);
    expect(game.state.partial).toBe(0);
    expect(game.state.remainingMs).toBeGreaterThan(game.state.timeLimitMs - 2000);
    expect(game.state.config.imageId).not.toBe(imageId);
    expect(game.board().done).toBe(false);
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

  it('peça dourada e montar rápido dão tempo extra', async () => {
    const game = await create();
    expect(game.board().golden).toBeGreaterThanOrEqual(0);
    await solve(game);
    // +5 s da dourada e +5 s por montar antes da meta (40 s para 12 peças).
    expect(game.state.bonusMs).toBe(10_000);
    expect(game.state.remainingMs).toBeGreaterThan(180_000);
    await game.client.leave();
  });

  it('a rodada relâmpago (4º) é a grade de deslizar e dá um ímã, que encaixa peças', async () => {
    const game = await create();
    for (let round = 1; round <= 3; round++) {
      expect(game.state.slides.size).toBe(0);
      await solve(game);
      expect(await until(() => game.state.round === round + 1)).toBe(true);
    }
    const grid = game.state.slides.get('main')!;
    expect(grid.tiles).toHaveLength(9);
    // As peças da mesa ficam travadas; a grade, a um movimento de resolver, se resolve deslizando.
    NEARLY_SOLVED.forEach((tile, position) => (grid.tiles[position] = tile));
    game.client.send('slide', { index: 0 }); // não encosta no vazio: ignorado
    game.client.send('slide', { index: 8 });
    expect(await until(() => game.state.helpers === 1)).toBe(true);
    expect(game.state.solved).toBe(4);
    expect(await until(() => game.state.round === 5)).toBe(true);

    const groups = () => game.board().groups.size;
    const before = groups();
    game.client.send('magnet');
    expect(await until(() => game.state.helpers === 0)).toBe(true);
    expect(groups()).toBeLessThan(before);
    await game.client.leave();
  }, 20_000); // monta 4 quebra-cabeças em sequência

  it('com as peças viradas: girar e encaixar só com a mesma rotação', async () => {
    ROTATION.enabled = true;
    try {
      const { client, board } = await create();
      const groups = () => [...board().groups.values()];
      expect(groups().some((group) => group.rotation !== 0)).toBe(true); // 12 peças sorteadas

      const anchorId = board().pieceGroup[0]!;
      const groupId = board().pieceGroup[1]!;
      const group = () => board().groups.get(String(groupId))!;
      const anchor = board().groups.get(String(anchorId))!;
      client.send('grab', { groupId, board: 'main' });
      await until(() => group().heldBy === client.sessionId);
      // Gira (na mão) até ficar como a vizinha; aí, solta alinhada e encaixa.
      while (group().rotation !== anchor.rotation) {
        const before = group().rotation;
        client.send('rotate', { groupId, board: 'main' });
        expect(await until(() => group().rotation === (before + 1) % 4)).toBe(true);
      }
      client.send('drop', { groupId, x: anchor.x, y: anchor.y, board: 'main' });
      expect(await until(() => board().pieceGroup[1] === board().pieceGroup[0])).toBe(true);
      await client.leave();
    } finally {
      ROTATION.enabled = false;
    }
  });

  it('encaixes seguidos formam combo', async () => {
    const game = await create();
    const me = () => game.state.players.get(game.client.sessionId)!;
    await solve(game, 1, 3);
    expect(me().snaps).toBeGreaterThanOrEqual(1);
    expect(me().combo).toBeGreaterThanOrEqual(2);
    await game.client.leave();
  });

  it('"3, 2, 1" antes de valer: peças travadas e relógio parado até o fim da contagem', async () => {
    COUNTDOWN.seconds = 1;
    try {
      const { state, board, client } = await create();
      expect(state.phase).toBe('playing');
      expect(state.countdown).toBe(1);
      const groupId = board().pieceGroup[1]!;
      const heldBy = () => board().groups.get(String(groupId))!.heldBy;
      client.send('grab', { groupId, board: 'main' });
      await wait(100);
      expect(heldBy()).toBe('');
      expect(state.remainingMs).toBe(180_000);

      expect(await until(() => state.countdown === 0)).toBe(true);
      client.send('grab', { groupId, board: 'main' });
      expect(await until(() => heldBy() === client.sessionId)).toBe(true);
      await client.leave();
    } finally {
      COUNTDOWN.seconds = 0;
    }
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
    expect(saved).toEqual({ rank: 3, rankToday: 3, record: false }); // primeira corrida da dupla

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
