import { and, asc, count, desc, eq, gt, ne, or, type SQL } from 'drizzle-orm';
import type { BulletRankingEntry, BulletRankingQuery, RankingPeriod } from '@puzzle/shared';
import type { AppDatabase } from './database';
import { finishedInPeriod, resolveTeam, teamNames, uniqueTeam, type TeamMember } from './gameStore';
import { bulletRuns } from './schema';

export interface BulletResult {
  roomCode: string;
  minutes: number;
  pieceCount: number;
  solved: number;
  partial: number;
  startedAt: Date;
  finishedAt: Date;
  players: TeamMember[];
}

type Category = Pick<BulletResult, 'minutes' | 'pieceCount'> & { teamSize: number };

/** Como na URL: sem período, vale "desde sempre". */
type Query = Omit<BulletRankingQuery, 'period'> & { period?: RankingPeriod };

export interface BulletStore {
  /** Grava a corrida e devolve a posição da equipe na categoria: de sempre e só de hoje. */
  saveRun(result: BulletResult): Promise<{ rank: number; rankToday: number }>;
  leaderboard(query: Query, limit?: number): Promise<BulletRankingEntry[]>;
}

/** Só se comparam corridas iguais: mesmos minutos, mesmo tamanho, mesma equipe. */
function sameCategory({ minutes, pieceCount, teamSize }: Category) {
  return and(
    eq(bulletRuns.minutes, minutes),
    eq(bulletRuns.pieceCount, pieceCount),
    eq(bulletRuns.teamSize, teamSize),
  );
}

export function createBulletStore(db: AppDatabase): BulletStore {
  /** Melhor corrida de cada equipe (DISTINCT ON): mais montados, depois mais peças, depois a mais antiga. */
  const bestRuns = (category: Category, period: RankingPeriod, where?: SQL) =>
    db
      .selectDistinctOn([bulletRuns.teamKey], {
        id: bulletRuns.id,
        teamKey: bulletRuns.teamKey,
        solved: bulletRuns.solved,
        partial: bulletRuns.partial,
        finishedAt: bulletRuns.finishedAt,
      })
      .from(bulletRuns)
      .where(and(sameCategory(category), finishedInPeriod(bulletRuns.finishedAt, period), where))
      .orderBy(
        bulletRuns.teamKey,
        desc(bulletRuns.solved),
        desc(bulletRuns.partial),
        asc(bulletRuns.finishedAt),
      )
      .as('best_runs');

  return {
    async saveRun(result) {
      const team = uniqueTeam(result.players);
      const category = { ...result, teamSize: team.length };
      return db.transaction(async (tx) => {
        const { teamKey } = await resolveTeam(tx, team);
        await tx.insert(bulletRuns).values({
          roomCode: result.roomCode,
          minutes: result.minutes,
          pieceCount: result.pieceCount,
          teamSize: team.length,
          teamKey,
          solved: result.solved,
          partial: result.partial,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
        });

        // Posição = 1 + quantas OUTRAS equipes têm uma corrida melhor que esta (no período).
        const rankIn = async (period: RankingPeriod) => {
          const best = bestRuns(category, period);
          const [better] = await tx
            .select({ total: count() })
            .from(best)
            .where(
              and(
                ne(best.teamKey, teamKey),
                or(
                  gt(best.solved, result.solved),
                  and(eq(best.solved, result.solved), gt(best.partial, result.partial)),
                ),
              ),
            );
          return (better?.total ?? 0) + 1;
        };
        return { rank: await rankIn('all'), rankToday: await rankIn('day') };
      });
    },

    async leaderboard({ minutes, pieces, players: teamSize, period = 'all' }, limit = 20) {
      const best = bestRuns({ minutes, pieceCount: pieces, teamSize }, period);
      const top = await db
        .select()
        .from(best)
        .orderBy(desc(best.solved), desc(best.partial), asc(best.finishedAt))
        .limit(limit);
      const names = await teamNames(
        db,
        top.map((run) => run.teamKey),
      );
      return top.map((run, index) => ({
        position: index + 1,
        players: names.get(run.teamKey)!,
        solved: run.solved,
        partial: run.partial,
        finishedAt: run.finishedAt.toISOString(),
      }));
    },
  };
}
