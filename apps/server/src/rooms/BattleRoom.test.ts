import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchMaker, type Server } from '@colyseus/core';
import { ColyseusSDK, type Room as ClientRoom } from '@colyseus/sdk';
import {
  BATTLE_ROOM,
  CATALOG,
  ENERGY_PER_SNAP,
  POWER_COST,
  RoomState,
  type BoardSchema,
  type PowerBroadcast,
} from '@puzzle/shared';
import { createGameServer } from '../app';
import { COUNTDOWN, ROTATION } from './BaseGameRoom';
import type { BattleRoom } from './BattleRoom';

const PORT = 2575;
const sdk = new ColyseusSDK(`ws://127.0.0.1:${PORT}`);

let server: Server;
beforeAll(async () => {
  COUNTDOWN.seconds = 0; // sem o "3, 2, 1" (tem teste próprio)
  ROTATION.enabled = false; // peças de pé: os testes montam soltando no lugar
  server = createGameServer();
  await server.listen(PORT);
});
afterAll(() => server.gracefullyShutdown(false));

const player = (name: string) => ({ name, guestId: randomUUID() });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Espera a condição valer (as mensagens dos clientes chegam pela rede); `tries` × 10 ms. */
async function until(check: () => boolean, tries = 100) {
  for (let i = 0; i < tries && !check(); i++) await wait(10);
  return check();
}

/** Grade de deslizar a um movimento de resolver: a peça 7 está no lugar do vazio. */
const NEARLY_SOLVED = [0, 1, 2, 3, 4, 5, 6, 8, 7];

/**
 * Batalha com Ana (lado A, anfitriã) e Bia (lado B); `extra` entram depois. `minutes`: batalha
 * por tempo (12 peças, fotos sorteadas).
 */
async function setup(
  format: '1v1' | '2v2' = '1v1',
  extra: string[] = [],
  minutes?: 3,
  powers?: boolean,
) {
  const ana = await sdk.create(
    BATTLE_ROOM,
    minutes
      ? { ...player('Ana'), pieceCount: 12, imageId: 'random', format, minutes, powers }
      : { ...player('Ana'), pieceCount: 24, imageId: CATALOG[0]!.id, format, powers },
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

/** Encaixa a peça `pieceId` no bloco da peça 0 (as duas vizinhas: 0 e 1). */
async function snapOne(client: ClientRoom, board: BoardSchema, key: 'a' | 'b', pieceId = 1) {
  const { pieceGroup, groups } = board;
  const groupId = pieceGroup[pieceId]!;
  const anchor = groups.get(String(pieceGroup[0]))!;
  client.send('grab', { groupId, board: key });
  await until(() => groups.get(String(groupId))?.heldBy === client.sessionId);
  client.send('drop', { groupId, x: anchor.x, y: anchor.y, board: key });
  await until(() => groups.get(String(groupId))?.heldBy !== client.sessionId);
}

describe('BattleRoom', () => {
  it('cada um cai num lado; o mesmo quebra-cabeça, espalhado diferente em cada mesa', async () => {
    const { ana, bia, state, board, team } = await setup();
    expect(state.mode).toBe('battle');
    expect([team(ana), team(bia)]).toEqual(['a', 'b']);
    expect(board('a').config.seed).toBe(board('b').config.seed);
    const positions = (key: 'a' | 'b') =>
      [...board(key).groups.entries()].map(([id, g]) => [id, g.x, g.y]);
    expect(positions('a')).not.toEqual(positions('b'));
    expect(board('a').pieceGroup.length).toBe(board('b').pieceGroup.length);
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

      // Bia chega no segundo: o mesmo que a Ana recebeu, espalhado de outro jeito.
      const second = board('a').config.seed;
      const layout = (key: 'a' | 'b') =>
        [...board(key).groups.entries()].map(([id, g]) => [id, g.x, g.y]);
      const secondLayout = layout('a');
      await solve(bia, board('b'), 'b');
      expect(await until(() => board('b').config.seed === second)).toBe(true);
      expect(layout('b')).not.toEqual(secondLayout);
      await ana.leave();
      await bia.leave();
    });

    it('no fim do tempo ganha quem montou mais; empate total vai para a morte súbita', async () => {
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
      const seed = board('a').config.seed;
      (room as unknown as { timeUp(): void }).timeUp();
      // Ninguém montou nada: morte súbita, com o mesmo quebra-cabeça novo nos dois lados.
      expect(state.phase).toBe('playing');
      expect(state.suddenDeath).toBe(true);
      expect(board('a').config.seed).not.toBe(seed);
      expect(board('a').config.seed).toBe(board('b').config.seed);
      await solve(bia, board('b'), 'b');
      expect(await until(() => state.phase === 'completed')).toBe(true);
      expect(state.winner).toBe('b');

      ana.send('rematch');
      expect(await until(() => state.phase === 'lobby')).toBe(true);
      expect(state.suddenDeath).toBe(false);
      await ana.leave();
      await bia.leave();
    });

    it('"3, 2, 1" antes de valer; o lado que sai na contagem perde por W.O.', async () => {
      COUNTDOWN.seconds = 1;
      try {
        const { ana, bia, state, board } = await setup('1v1', [], 3);
        ana.send('start');
        await until(() => state.phase === 'playing');
        expect(state.countdown).toBe(1);
        const groupId = board('a').pieceGroup[1]!;
        ana.send('grab', { groupId, board: 'a' });
        await wait(100);
        expect(board('a').groups.get(String(groupId))!.heldBy).toBe('');

        await bia.leave();
        expect(await until(() => state.phase === 'completed')).toBe(true);
        expect(state.winner).toBe('a');
        expect(state.countdown).toBe(0);
        await ana.leave();
      } finally {
        COUNTDOWN.seconds = 0;
      }
    });

    it('a peça dourada é a mesma nos dois lados', async () => {
      const { ana, bia, board } = await setup('1v1', [], 3);
      expect(board('a').golden).toBeGreaterThanOrEqual(0);
      expect(board('a').golden).toBe(board('b').golden);
      await ana.leave();
      await bia.leave();
    });

    it('relâmpago: pausa as mesas, mesma grade para os dois, quem monta primeiro leva', async () => {
      const { ana, bia, room, state, board } = await setup('1v1', [], 3);
      ana.send('start');
      await until(() => state.phase === 'playing');
      const lightning = () => (room as unknown as { startLightning(): void }).startLightning();
      lightning();
      expect(state.slides.size).toBe(2);
      expect([...state.slides.get('a')!.tiles]).toEqual([...state.slides.get('b')!.tiles]);

      // Mesas travadas e relógio parado enquanto dura.
      const groupId = board('a').pieceGroup[1]!;
      ana.send('grab', { groupId, board: 'a' });
      const remaining = state.remainingMs;
      await wait(1200);
      expect(board('a').groups.get(String(groupId))!.heldBy).toBe('');
      expect(state.remainingMs).toBe(remaining);

      const grid = state.slides.get('b')!;
      NEARLY_SOLVED.forEach((tile, position) => (grid.tiles[position] = tile));
      bia.send('slide', { index: 8 });
      expect(await until(() => state.slideWinner === 'b')).toBe(true);
      expect(board('b').energy).toBe(100);
      ana.send('slide', { index: 7 }); // depois do vencedor, nada mais vale
      expect(await until(() => state.slides.size === 0, 300)).toBe(true);

      // As mesas voltam a valer.
      ana.send('grab', { groupId, board: 'a' });
      expect(await until(() => board('a').groups.get(String(groupId))!.heldBy !== '')).toBe(true);

      // Prazo acabando sem ninguém montar: ninguém leva, e a partida segue.
      lightning();
      state.slideSeconds = 1;
      expect(await until(() => state.slideWinner === 'none', 300)).toBe(true);
      expect(await until(() => state.slides.size === 0, 300)).toBe(true);
      expect(state.phase).toBe('playing');
      await ana.leave();
      await bia.leave();
    }, 15_000); // espera os 1,5 s do resultado duas vezes

    it('poderes: energia por encaixe, custo, recarga, congelar e escudo', async () => {
      const { ana, bia, state, board } = await setup('1v1', [], 3);
      expect(state.powers).toBe(true);
      const broadcasts: PowerBroadcast[] = [];
      bia.onMessage('power', (message: PowerBroadcast) => broadcasts.push(message));
      ana.send('start');
      await until(() => state.phase === 'playing');

      await snapOne(ana, board('a'), 'a');
      expect(board('a').energy).toBeGreaterThanOrEqual(ENERGY_PER_SNAP);

      // Congelar: a Bia não pega peça nenhuma; o segundo poder logo em seguida não vale (recarga).
      board('a').energy = 100;
      ana.send('usePower', { power: 'freeze' });
      expect(await until(() => board('b').frozenUntil > 0)).toBe(true);
      expect(board('a').energy).toBe(100 - POWER_COST.freeze);
      const groupId = board('b').pieceGroup[1]!;
      bia.send('grab', { groupId, board: 'b' });
      ana.send('usePower', { power: 'fog' });
      await wait(100);
      expect(board('b').groups.get(String(groupId))!.heldBy).toBe('');
      expect(board('a').energy).toBe(100 - POWER_COST.freeze);
      expect(board('b').fogUntil).toBe(0);

      // Congelada, a Bia também não usa poder.
      board('b').energy = 100;
      bia.send('usePower', { power: 'shield' });
      await wait(100);
      expect(board('b').shield).toBe(false);
      expect(board('b').energy).toBe(100);
      board('b').frozenUntil = 0;

      // Escudo da Bia anula a neblina da Ana.
      board('b').energy = 100;
      bia.send('usePower', { power: 'shield' });
      expect(await until(() => board('b').shield)).toBe(true);
      board('a').powerReadyAt = 0;
      ana.send('usePower', { power: 'fog' });
      expect(await until(() => !board('b').shield)).toBe(true);
      expect(board('b').fogUntil).toBe(0);
      expect(await until(() => broadcasts.length === 3)).toBe(true);
      expect(broadcasts.at(-1)).toEqual({ team: 'a', power: 'fog', blocked: true });
      await ana.leave();
      await bia.leave();
    });

    it('embaralhar mexe nas peças soltas do adversário', async () => {
      const { ana, bia, state, board } = await setup('1v1', [], 3);
      ana.send('start');
      await until(() => state.phase === 'playing');
      const positions = () => [...board('b').groups.values()].map((g) => `${g.x},${g.y}`).join();
      const before = positions();
      board('a').energy = 100;
      ana.send('usePower', { power: 'shuffle' });
      expect(await until(() => positions() !== before)).toBe(true);
      await ana.leave();
      await bia.leave();
    });

    it('sem poderes: não junta energia e o pedido é ignorado', async () => {
      const { ana, bia, state, board } = await setup('1v1', [], 3, false);
      expect(state.powers).toBe(false);
      ana.send('start');
      await until(() => state.phase === 'playing');
      await snapOne(ana, board('a'), 'a');
      expect(board('a').energy).toBe(0);
      board('a').energy = 100;
      ana.send('usePower', { power: 'freeze' });
      await wait(100);
      expect(board('b').frozenUntil).toBe(0);
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
