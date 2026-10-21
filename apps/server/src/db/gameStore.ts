import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  min,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  POINTS_MIN_SAMPLES,
  RANKING_TIME_ZONE,
  gamePoints,
  type GeneralRankingEntry,
  type PopularImage,
  type PopularQuery,
  type GeneralRankingQuery,
  type RankingEntry,
  type RankingPeriod,
  type RankingQuery,
} from '@puzzle/shared';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { AppDatabase } from './database';
import { gamePlayers, games, players } from './schema';

export interface GameResult {
  roomCode: string;
  imageId: string;
  pieceCount: number;
  rows: number;
  cols: number;
  seed: string;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  /** userId quando a pessoa está logada (vale em qualquer aparelho); senão, o convidado. */
  players: Array<{ guestId: string; userId?: string; nickname: string }>;
}

export type TeamMember = GameResult['players'][number];
export type Transaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

/**
 * O jogador do ranking para cada participante. Com conta: o jogador ligado a ela (na primeira
 * partida logado, o convidado deste navegador vira o jogador da conta). Sem conta: o convidado.
 * O apelido mais recente vence.
 */
export async function resolvePlayer(tx: Transaction, member: TeamMember): Promise<string> {
  const { guestId, userId, nickname } = member;
  if (userId) {
    const [mine] = await tx
      .update(players)
      .set({ nickname })
      .where(eq(players.userId, userId))
      .returning({ id: players.id });
    if (mine) return mine.id;
    const [claimed] = await tx
      .update(players)
      .set({ userId, nickname })
      .where(and(eq(players.guestId, guestId), isNull(players.userId)))
      .returning({ id: players.id });
    if (claimed) return claimed.id;
    // O convidado deste navegador é de outra conta (PC compartilhado): jogador novo, só da conta.
    const [created] = await tx
      .insert(players)
      .values({ guestId: randomUUID(), userId, nickname })
      .returning({ id: players.id });
    return created!.id;
  }
  const [row] = await tx
    .insert(players)
    .values({ guestId, nickname })
    .onConflictDoUpdate({ target: players.guestId, set: { nickname } })
    .returning({ id: players.id });
  return row!.id;
}

/** A mesma pessoa em duas abas (ou dois aparelhos, com conta) conta uma vez só. */
export function uniqueTeam(members: TeamMember[]): TeamMember[] {
  return [...new Map(members.map((p) => [p.userId ?? p.guestId, p])).values()];
}

/** Jogadores da equipe e a chave dela (ids ordenados): identifica "a mesma equipe" entre partidas. */
export async function resolveTeam(tx: Transaction, team: TeamMember[]) {
  const playerIds: string[] = [];
  for (const member of team) playerIds.push(await resolvePlayer(tx, member));
  return { playerIds, teamKey: [...playerIds].sort().join(',') };
}

/** Nome de cada equipe pela team_key: os apelidos mais recentes, em ordem alfabética. */
export async function teamNames(
  db: AppDatabase,
  teamKeys: string[],
): Promise<Map<string, string[]>> {
  const ids = [...new Set(teamKeys.flatMap((key) => key.split(',')))];
  const names = new Map(
    ids.length === 0
      ? []
      : (
          await db
            .select({ id: players.id, nickname: players.nickname })
            .from(players)
            .where(inArray(players.id, ids))
        ).map((p) => [p.id, p.nickname]),
  );
  return new Map(
    teamKeys.map((key) => [
      key,
      key
        .split(',')
        .map((id) => names.get(id) ?? '?')
        .sort((a, b) => a.localeCompare(b, 'pt-BR')),
    ]),
  );
}

/** Como na URL: sem período, vale "desde sempre". */
type WithOptionalPeriod<T extends { period: RankingPeriod }> = Omit<T, 'period'> &
  Partial<Pick<T, 'period'>>;

/** O que a sala precisa da persistência. Sem banco configurado, a sala recebe `undefined`. */
export interface GameStore {
  /**
   * Grava a partida e devolve a posição da equipe na categoria (de sempre e só de hoje) e os
   * pontos que ela valeu.
   */
  saveGame(result: GameResult): Promise<{ rank: number; rankToday: number; points: number }>;
  leaderboard(query: WithOptionalPeriod<RankingQuery>, limit?: number): Promise<RankingEntry[]>;
  /** Ranking geral da modalidade no período: soma de peças de todas as fotos. */
  generalLeaderboard(
    query: WithOptionalPeriod<GeneralRankingQuery>,
    limit?: number,
  ): Promise<GeneralRankingEntry[]>;
  /** Fotos mais jogadas na modalidade e no período (para escolher no ranking por foto). */
  popular(query: WithOptionalPeriod<PopularQuery>, limit?: number): Promise<PopularImage[]>;
}

const PERIOD_UNIT = { day: 'day', week: 'week', month: 'month' } as const;

/**
 * Partidas terminadas desde o começo do período, contado no horário de Brasília (o servidor
 * roda em UTC: sem isso, "hoje" viraria às 21h). No Postgres a semana começa na segunda.
 */
function inPeriod(period: RankingPeriod): SQL | undefined {
  return finishedInPeriod(games.finishedAt, period);
}

/** O mesmo filtro de período para outra tabela (a coluna de quando terminou). */
export function finishedInPeriod(column: AnyPgColumn, period: RankingPeriod): SQL | undefined {
  if (period === 'all') return undefined;
  const unit = PERIOD_UNIT[period];
  return gte(
    column,
    sql`date_trunc(${unit}, now() at time zone ${RANKING_TIME_ZONE}) at time zone ${RANKING_TIME_ZONE}`,
  );
}

/** Só se compara tempo de partidas iguais: mesma imagem, mesmo tamanho, mesma equipe. */
function sameCategory(imageId: string, pieceCount: number, teamSize: number) {
  return and(
    eq(games.imageId, imageId),
    eq(games.pieceCount, pieceCount),
    eq(games.teamSize, teamSize),
  );
}

export function createGameStore(db: AppDatabase): GameStore {
  return {
    async saveGame(result) {
      const team = uniqueTeam(result.players);

      return db.transaction(async (tx) => {
        const { playerIds, teamKey } = await resolveTeam(tx, team);

        // Tempo típico das partidas iguais (peças + modalidade), em qualquer foto, antes desta.
        const [typical] = await tx
          .select({
            samples: count(),
            median: sql<
              number | null
            >`percentile_cont(0.5) within group (order by ${games.durationMs})`,
          })
          .from(games)
          .where(and(eq(games.pieceCount, result.pieceCount), eq(games.teamSize, team.length)));
        const enough = (typical?.samples ?? 0) >= POINTS_MIN_SAMPLES;
        const points = gamePoints(
          result.pieceCount,
          result.durationMs,
          enough ? Number(typical!.median) : undefined,
        );

        const [game] = await tx
          .insert(games)
          .values({
            roomCode: result.roomCode,
            imageId: result.imageId,
            pieceCount: result.pieceCount,
            rows: result.rows,
            cols: result.cols,
            seed: result.seed,
            teamSize: team.length,
            teamKey,
            durationMs: result.durationMs,
            points,
            startedAt: result.startedAt,
            finishedAt: result.finishedAt,
          })
          .returning({ id: games.id });

        await tx.insert(gamePlayers).values(
          team.map(({ nickname }, index) => ({
            gameId: game!.id,
            playerId: playerIds[index]!,
            nickname,
          })),
        );

        // Posição = 1 + quantas OUTRAS equipes têm melhor tempo menor que este (no período).
        const rankIn = async (period: RankingPeriod) => {
          const bestByTeam = tx
            .select({ teamKey: games.teamKey, best: min(games.durationMs).as('best') })
            .from(games)
            .where(
              and(sameCategory(result.imageId, result.pieceCount, team.length), inPeriod(period)),
            )
            .groupBy(games.teamKey)
            .as('best_by_team');
          const [faster] = await tx
            .select({ total: count() })
            .from(bestByTeam)
            .where(and(lt(bestByTeam.best, result.durationMs), ne(bestByTeam.teamKey, teamKey)));
          return (faster?.total ?? 0) + 1;
        };

        return { rank: await rankIn('all'), rankToday: await rankIn('day'), points };
      });
    },

    async leaderboard({ image, pieces, players: teamSize, period = 'all' }, limit = 20) {
      // Melhor partida de cada equipe (DISTINCT ON), depois ordena essas partidas por tempo.
      const bestGames = db
        .selectDistinctOn([games.teamKey], {
          id: games.id,
          durationMs: games.durationMs,
          finishedAt: games.finishedAt,
        })
        .from(games)
        .where(and(sameCategory(image, pieces, teamSize), inPeriod(period)))
        .orderBy(games.teamKey, asc(games.durationMs), asc(games.finishedAt))
        .as('best_games');
      const top = await db
        .select()
        .from(bestGames)
        .orderBy(asc(bestGames.durationMs), asc(bestGames.finishedAt))
        .limit(limit);
      if (top.length === 0) return [];

      const names = await db
        .select({ gameId: gamePlayers.gameId, nickname: gamePlayers.nickname })
        .from(gamePlayers)
        .where(
          inArray(
            gamePlayers.gameId,
            top.map((g) => g.id),
          ),
        )
        .orderBy(asc(gamePlayers.nickname));

      return top.map((game, index) => ({
        position: index + 1,
        players: names.filter((n) => n.gameId === game.id).map((n) => n.nickname),
        durationMs: game.durationMs,
        finishedAt: game.finishedAt.toISOString(),
      }));
    },

    async generalLeaderboard({ players: teamSize, period = 'all' }, limit = 20) {
      // Melhor partida de cada equipe em cada foto e tamanho: repetir não acumula pontos.
      const best = db
        .select({
          teamKey: games.teamKey,
          best: sql<number>`max(${games.points})`.as('best'),
        })
        .from(games)
        .where(and(eq(games.teamSize, teamSize), inPeriod(period)))
        .groupBy(games.teamKey, games.imageId, games.pieceCount)
        .as('best_by_puzzle');
      const points = sql<number>`sum(${best.best})::int`.as('points');
      const top = await db
        .select({ teamKey: best.teamKey, points, puzzles: count() })
        .from(best)
        .groupBy(best.teamKey)
        .orderBy(desc(points), desc(count()))
        .limit(limit);
      if (top.length === 0) return [];

      // team_key = ids dos jogadores unidos por vírgula; o nome mostrado é o apelido mais recente.
      const names = await teamNames(
        db,
        top.map((row) => row.teamKey),
      );
      return top.map((row, index) => ({
        position: index + 1,
        players: names.get(row.teamKey)!,
        points: row.points,
        puzzles: row.puzzles,
      }));
    },

    async popular({ players: teamSize, period = 'all' }, limit = 20) {
      const plays = count().as('plays');
      const rows = await db
        .select({ imageId: games.imageId, plays })
        .from(games)
        .where(and(teamSize ? eq(games.teamSize, teamSize) : undefined, inPeriod(period)))
        .groupBy(games.imageId)
        .orderBy(desc(plays), asc(games.imageId))
        .limit(limit);
      return rows;
    },
  };
}
