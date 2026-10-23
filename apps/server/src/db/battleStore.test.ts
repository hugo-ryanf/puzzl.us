import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAccountStore, type AccountStore } from '../auth/accounts';
import { createProfileStore, type ProfileStore } from '../profile/profile';
import { createBattleStore, type BattleResult, type BattleStore } from './battleStore';
import { createBulletStore, type BulletStore } from './bulletStore';
import type { AppDatabase } from './database';
import { clearDatabase, createMemoryDatabase } from './memoryDatabase';
import { players } from './schema';

let db: AppDatabase;
let accounts: AccountStore;
let profiles: ProfileStore;
let battles: BattleStore;
let bullet: BulletStore;
beforeAll(async () => {
  db = await createMemoryDatabase();
  accounts = createAccountStore(db);
  profiles = createProfileStore(db);
  battles = createBattleStore(db);
  bullet = createBulletStore(db);
});
beforeEach(() => clearDatabase(db));

const guest = (nickname: string) => ({ guestId: randomUUID(), nickname });

describe('Placar das batalhas no perfil', () => {
  it('conta vitórias, derrotas, a maior sequência, as viradas e o rival', async () => {
    const ana = await accounts.signInWithGoogle({ sub: randomUUID(), name: 'Ana' }, false);
    const anaMember = { guestId: randomUUID(), userId: ana.id, nickname: 'Ana' };
    const bia = guest('Bia');
    const caio = guest('Caio');
    const battle = (
      winner: BattleResult['winner'],
      opponent: typeof bia,
      comeback = false,
    ): BattleResult => ({
      roomCode: 'ABCDE',
      format: '1v1',
      timed: true,
      winner,
      walkover: false,
      comeback,
      finishedAt: new Date(),
      teams: { a: [anaMember], b: [opponent] },
    });

    await battles.saveResult(battle('a', bia));
    await battles.saveResult(battle('a', bia, true));
    await battles.saveResult(battle('b', caio));
    await battles.saveResult(battle('a', bia));

    const stats = await profiles.stats(ana.id);
    expect(stats).toMatchObject({
      battleWins: 3,
      battleLosses: 1,
      battleBestStreak: 2,
      battleComebacks: 1,
      rival: { name: 'Bia', friendCode: null, battles: 3 },
    });
  });

  it('sem batalhas: tudo zerado e sem rival', async () => {
    const ana = await accounts.signInWithGoogle({ sub: randomUUID(), name: 'Ana' }, false);
    expect(await profiles.stats(ana.id)).toMatchObject({
      battleWins: 0,
      battleLosses: 0,
      rival: null,
    });
  });
});

describe('Recorde do Bullet', () => {
  it('a primeira corrida não é recorde; superar a melhor é; o melhor pessoal aparece', async () => {
    const ana = guest('Ana');
    const run = (solved: number, partial = 0) =>
      bullet.saveRun({
        roomCode: 'ABCDE',
        minutes: 3,
        pieceCount: 12,
        solved,
        partial,
        startedAt: new Date(),
        finishedAt: new Date(),
        players: [ana],
      });
    expect((await run(4)).record).toBe(false);
    expect((await run(6)).record).toBe(true);
    expect((await run(5)).record).toBe(false);
    expect((await run(6, 3)).record).toBe(true); // mesmo número, mais peças no último

    const [{ id: playerId }] = (await db.select({ id: players.id }).from(players)) as [
      { id: string },
    ];
    expect(await bullet.personalBest({ minutes: 3, pieces: 12, players: 1 }, playerId)).toEqual({
      solved: 6,
      partial: 3,
    });
    expect(await bullet.personalBest({ minutes: 5, pieces: 12, players: 1 }, playerId)).toBeNull();
  });
});
