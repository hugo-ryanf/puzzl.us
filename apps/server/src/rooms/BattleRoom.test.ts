import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchMaker, type Server } from '@colyseus/core';
import { ColyseusSDK, type Room as ClientRoom } from '@colyseus/sdk';
import { BATTLE_ROOM, CATALOG, RoomState, type BoardSchema } from '@puzzle/shared';
import { createGameServer } from '../app';
import type { BattleRoom } from './BattleRoom';

const PORT = 2575;
const sdk = new ColyseusSDK(`ws://127.0.0.1:${PORT}`);

let server: Server;
beforeAll(async () => {
  server = createGameServer();
  await server.listen(PORT);
});
afterAll(() => server.gracefullyShutdown(false));

const player = (name: string) => ({ name, guestId: randomUUID() });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Espera a condição valer (as mensagens dos clientes chegam pela rede). */
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await wait(10);
  return check();
}

/**
 * Batalha com Ana (lado A, anfitriã) e Bia (lado B); `extra` entram depois. `minutes`: batalha
 * por tempo (12 peças, fotos sorteadas).
 */
async function setup(format: '1v1' | '2v2' = '1v1', extra: string[] = [], minutes?: 3) {
  const ana = await sdk.create(
    BATTLE_ROOM,
    minutes
      ? { ...player('Ana'), pieceCount: 12, imageId: 'random', format, minutes }
      : { ...player('Ana'), pieceCount: 24, imageId: CATALOG[0]!.id, format },
    RoomState,
  );
  const room = matchMaker.getLocalRoomById(ana.roomId) as unknown as BattleRoom;
  const state = room.state;
  const bia = await sdk.joinById(ana.roomId, player('Bia'), RoomState);
  const others: ClientRoom[] = [];
  for (const name of extra) others.push(await sdk.joinById(ana.roomId, player(name), RoomState));
  await until(() => state.players.size === 2 + extra.length);
  const board = (team: 'a' | 'b') => state.boards.get(team) as BoardSchema;
  const team = (client: ClientRoom) => state.players.get(client.sessionId)!.team;
  return { ana, bia, others, room, state, board, team };
}

/** Monta o tabuleiro inteiro do lado, peça por peça. */
async function solve(client: ClientRoom, board: BoardSchema, key: 'a' | 'b') {
  const { pieceGroup, groups } = board;
  for (let pieceId = 1; pieceId < pieceGroup.length; pieceId++) {
    const groupId = pieceGroup[pieceId]!;
    if (groupId === pieceGroup[0]) continue;
    const anchor = groups.get(String(pieceGroup[0]))!;
    client.send('grab', { groupId, board: key });
    await until(() => groups.get(String(groupId))?.heldBy === client.sessionId);
    client.send('drop', { groupId, x: anchor.x, y: anchor.y, board: key });
    await until(() => groups.get(String(groupId))?.heldBy !== client.sessionId);
  }
}

describe('BattleRoom', () => {
  it('cada um cai num lado e as duas mesas começam idênticas', async () => {
    const { ana, bia, state, board, team } = await setup();
    expect(state.mode).toBe('battle');
    expect([team(ana), team(bia)]).toEqual(['a', 'b']);
    expect(board('a').config.seed).toBe(board('b').config.seed);
    const positions = (key: 'a' | 'b') =>
      [...board(key).groups.entries()].map(([id, g]) => [id, g.x, g.y]);
    expect(positions('a')).toEqual(positions('b'));
    await ana.leave();
    await bia.leave();
  });

  it('só mexe no tabuleiro do próprio lado, e só depois de começar', async () => {
    const { ana, bia, state, board } = await setup();
    const groupId = board('a').pieceGroup[1]!;
    ana.send('grab', { groupId, board: 'a' });
    await wait(80);
    expect(board('a').groups.get(String(groupId))!.heldBy).toBe(''); // lobby

    bia.send('start'); // Bia não é a anfitriã
    await wait(80);
    expect(state.phase).toBe('lobby');
    ana.send('start');
    expect(await until(() => state.phase === 'playing')).toBe(true);

    ana.send('grab', { groupId, board: 'b' }); // mesa do adversário
    await wait(80);
    expect(board('b').groups.get(String(groupId))!.heldBy).toBe('');
    ana.send('grab', { groupId, board: 'a' });
    expect(
      await until(() => board('a').groups.get(String(groupId))!.heldBy === ana.sessionId),
    ).toBe(true);
    await ana.leave();
    await bia.leave();
  });

  it('quem montar primeiro ganha; a revanche volta ao lobby com mesas novas', async () => {
    const { ana, bia, state, board } = await setup();
    ana.send('start');
    await until(() => state.phase === 'playing');
    await solve(bia, board('b'), 'b');
    expect(await until(() => state.phase === 'completed')).toBe(true);
    expect(state.winner).toBe('b');
    expect(board('b').done).toBe(true);
    expect(board('b').durationMs).toBeGreaterThan(0);
    expect(board('a').done).toBe(false);

    const round = state.round;
    ana.send('rematch');
    expect(await until(() => state.phase === 'lobby' && state.round === round + 1)).toBe(true);
    expect(state.winner).toBe('');
    expect(board('b').done).toBe(false);
    await ana.leave();
    await bia.leave();
  });

  it('2v2: troca de lado só com vaga; lado vazio no meio da partida perde por W.O.', async () => {
    const { ana, bia, others, state, team } = await setup('2v2', ['Caio', 'Duda']);
    const [caio, duda] = others as [ClientRoom, ClientRoom];
    expect([team(ana), team(bia), team(caio), team(duda)].sort()).toEqual(['a', 'a', 'b', 'b']);

    // Lado B cheio: Ana (A) não consegue ir para lá.
    ana.send('chooseTeam', { team: 'b' });
    await wait(80);
    expect(team(ana)).toBe('a');

    ana.send('start');
    await until(() => state.phase === 'playing');
    const all = [ana, bia, caio, duda];
    const sideB = all.filter((client) => team(client) === 'b');
    for (const client of sideB) await client.leave();
    expect(await until(() => state.phase === 'completed')).toBe(true);
    expect(state.winner).toBe('a');
    expect(state.walkover).toBe(true);
    for (const client of all.filter((c) => !sideB.includes(c))) await client.leave();
  });

  it('a sala trava quando enche (1v1 = 2 vagas)', async () => {
    const { ana, bia } = await setup();
    await expect(sdk.joinById(ana.roomId, player('Caio'), RoomState)).rejects.toThrow();
    await ana.leave();
    await bia.leave();
  });

  describe('por tempo', () => {
    it('quem monta segue para o próximo da mesma sequência; o outro lado fica no dele', async () => {
      const { ana, bia, state, board } = await setup('1v1', [], 3);
      expect(state.timeLimitMs).toBe(3 * 60_000);
      expect(board('a').config.seed).toBe(board('b').config.seed);
      ana.send('start');
      await until(() => state.phase === 'playing');
      const first = board('a').config.seed;

      await solve(ana, board('a'), 'a');
      expect(await until(() => board('a').config.seed !== first)).toBe(true);
      expect(board('a').solved).toBe(1);
      expect(board('a').done).toBe(false);
      expect(state.phase).toBe('playing'); // montar um não acaba a partida
      expect(board('b').config.seed).toBe(first);

      // Bia chega no segundo: é o mesmo que a Ana recebeu, nas mesmas posições.
      const second = board('a').config.seed;
      const layout = (key: 'a' | 'b') =>
        [...board(key).groups.entries()].map(([id, g]) => [id, g.x, g.y]);
      const secondLayout = layout('a');
      await solve(bia, board('b'), 'b');
      expect(await until(() => board('b').config.seed === second)).toBe(true);
      expect(layout('b')).toEqual(secondLayout);
      await ana.leave();
      await bia.leave();
    });

    it('no fim do tempo ganha quem montou mais; empate vai para as peças encaixadas', async () => {
      const { ana, bia, room, state, board } = await setup('1v1', [], 3);
      ana.send('start');
      await until(() => state.phase === 'playing');
      await solve(bia, board('b'), 'b');
      await until(() => board('b').solved === 1 && !board('b').done);
      (room as unknown as { timeUp(): void }).timeUp();
      expect(state.phase).toBe('completed');
      expect(state.winner).toBe('b');
      expect(state.remainingMs).toBe(0);

      // Revanche zera tudo; de novo, ninguém monta nada: empate.
      ana.send('rematch');
      expect(await until(() => state.phase === 'lobby')).toBe(true);
      expect([board('a').solved, board('b').solved]).toEqual([0, 0]);
      expect(state.remainingMs).toBe(3 * 60_000);
      ana.send('start');
      await until(() => state.phase === 'playing');
      (room as unknown as { timeUp(): void }).timeUp();
      expect(state.winner).toBe('draw');
      await ana.leave();
      await bia.leave();
    });

    it('recusa tamanho fora dos do Bullet', async () => {
      await expect(
        sdk.create(BATTLE_ROOM, {
          ...player('Ana'),
          pieceCount: 48,
          imageId: 'random',
          format: '1v1',
          minutes: 3,
        }),
      ).rejects.toThrow();
    });
  });
});
