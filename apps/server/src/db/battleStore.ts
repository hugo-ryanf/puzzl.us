import type { BattleFormat, BattleTeam } from '@puzzle/shared';
import type { AppDatabase } from './database';
import { resolvePlayer, uniqueTeam, type TeamMember } from './gameStore';
import { battleResultPlayers, battleResults } from './schema';

export interface BattleResult {
  roomCode: string;
  format: BattleFormat;
  timed: boolean;
  winner: BattleTeam;
  walkover: boolean;
  /** O vencedor estava atrás a 10 s do fim (batalha por tempo). */
  comeback: boolean;
  finishedAt: Date;
  /** Quem jogou em cada lado (a escalação do começo da partida). */
  teams: Record<BattleTeam, TeamMember[]>;
}

/** Placar das batalhas: sem ranking, só o histórico de cada jogador (perfil e conquistas). */
export interface BattleStore {
  saveResult(result: BattleResult): Promise<void>;
}

export function createBattleStore(db: AppDatabase): BattleStore {
  return {
    async saveResult({ teams, ...result }) {
      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(battleResults)
          .values(result)
          .returning({ id: battleResults.id });
        // A mesma pessoa em duas abas conta uma vez (e nunca nos dois lados ao mesmo tempo).
        const seen = new Set<string>();
        for (const team of ['a', 'b'] as const) {
          for (const member of uniqueTeam(teams[team])) {
            const playerId = await resolvePlayer(tx, member);
            if (seen.has(playerId)) continue;
            seen.add(playerId);
            await tx.insert(battleResultPlayers).values({ resultId: row!.id, playerId, team });
          }
        }
      });
    },
  };
}
