import { and, asc, count, desc, eq, gt, ne, or } from 'drizzle-orm';
import type {
  BulletRankingEntry,
  BulletRankingQuery,
  RankingPage,
  RankingPeriod,
} from '@puzzle/shared';
import type { AppDatabase } from './database';
import { resolveTeam, uniqueTeam, type TeamMember } from './gameStore';
import { finishedInPeriod, rankingPage } from './rankingPage';
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
  /** Melhor corrida de cada equipe; `viewerPlayerId` acha "Sua posição". */
  leaderboard(
    query: Query,
    viewerPlayerId?: string,
    limit?: number,
  ): Promise<RankingPage<BulletRankingEntry>>;
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
  const bestRuns = (category: Category, period: RankingPeriod, previous = false) =>
    db
      .selectDistinctOn([bulletRuns.teamKey], {
        id: bulletRuns.id,
        teamKey: bulletRuns.teamKey,
        solved: bulletRuns.solved,
        partial: bulletRuns.partial,
        finishedAt: bulletRuns.finishedAt,
      })
      .from(bulletRuns)
      .where(and(sameCategory(category), finishedInPeriod(bulletRuns.finishedAt, period, previous)))
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

    async leaderboard(
      { minutes, pieces, players: teamSize, period = 'all' },
      viewerPlayerId,
      limit = 20,
    ) {
      const category = { minutes, pieceCount: pieces, teamSize };
      const ordered = (previous: boolean) => {
        const best = bestRuns(category, period, previous);
        return db
          .select()
          .from(best)
          .orderBy(desc(best.solved), desc(best.partial), asc(best.finishedAt));
      };
      return rankingPage(db, {
        rows: await ordered(false),
        previous: period === 'all' ? undefined : await ordered(true),
        viewerPlayerId,
        limit,
        streakSource: 'bullet',
        toEntry: (run) => ({
          solved: run.solved,
          partial: run.partial,
          finishedAt: run.finishedAt.toISOString(),
        }),
      });
    },
  };
}
