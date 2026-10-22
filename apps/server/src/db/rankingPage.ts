import { and, eq, gte, inArray, lt, max, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  levelOf,
  RANKING_TIME_ZONE,
  type RankingPage,
  type RankingPeriod,
  type RankingRowBase,
} from '@puzzle/shared';
import type { AppDatabase } from './database';
import { profileAvatar, profileName } from '../auth/accounts';
import { bulletRuns, gamePlayers, games, players, users } from './schema';

const PERIOD_UNIT = { day: 'day', week: 'week', month: 'month' } as const;
/** A sequência de dias só olha para trás até aqui (ninguém vai ter uma maior que isso). */
const STREAK_LOOKBACK_DAYS = 400;

/** Começo do dia/semana/mês de agora (`back` = 0) ou de N períodos atrás, no horário de Brasília. */
function periodStart(unit: 'day' | 'week' | 'month', back: number): SQL {
  return sql`date_trunc(${unit}, (now() at time zone ${RANKING_TIME_ZONE}) - (${`${back} ${unit}`})::interval) at time zone ${RANKING_TIME_ZONE}`;
}

/**
 * Filtro do período, contado no horário de Brasília (o servidor roda em UTC: sem isso, "hoje"
 * viraria às 21h). No Postgres a semana começa na segunda. `previous`: o período anterior
 * equivalente (ontem, a semana passada, o mês passado), para comparar.
 */
export function finishedInPeriod(
  column: AnyPgColumn,
  period: RankingPeriod,
  previous = false,
): SQL | undefined {
  if (period === 'all') return undefined;
  const unit = PERIOD_UNIT[period];
  if (!previous) return gte(column, periodStart(unit, 0));
  return and(gte(column, periodStart(unit, 1)), lt(column, periodStart(unit, 0)));
}

/** "2026-10-21" de hoje e de ontem no horário de Brasília. */
export function localDay(offsetDays = 0): string {
  const date = new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: RANKING_TIME_ZONE }).format(date);
}

/**
 * Dias seguidos em que cada equipe terminou pelo menos uma partida (das partidas clássicas ou do
 * Bullet), contando até hoje — ou até ontem, se ainda não jogou hoje (a sequência não quebra).
 */
async function streaks(
  db: AppDatabase,
  source: 'games' | 'bullet',
  teamKeys: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (teamKeys.length === 0) return result;
  const table = source === 'games' ? games : bulletRuns;
  const day = sql<string>`to_char(${table.finishedAt} at time zone ${RANKING_TIME_ZONE}, 'YYYY-MM-DD')`;
  // DISTINCT (e não GROUP BY): o fuso vai como parâmetro, e o Postgres não casaria as expressões.
  const rows = await db
    .selectDistinct({ teamKey: table.teamKey, day })
    .from(table)
    .where(
      and(
        inArray(table.teamKey, teamKeys),
        gte(table.finishedAt, sql`now() - (${`${STREAK_LOOKBACK_DAYS} days`})::interval`),
      ),
    );

  const days = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = days.get(row.teamKey) ?? new Set();
    set.add(row.day);
    days.set(row.teamKey, set);
  }
  for (const [teamKey, set] of days) result.set(teamKey, streakOf(set));
  return result;
}

/** Dias seguidos ("2026-10-21") até hoje, ou até ontem se ainda não jogou hoje. */
export function streakOf(days: ReadonlySet<string>): number {
  let offset = days.has(localDay(0)) ? 0 : 1;
  let count = 0;
  while (days.has(localDay(offset))) {
    count++;
    offset++;
  }
  return count;
}

/**
 * Pontos de sempre de cada jogador: a melhor partida de cada foto e tamanho, em qualquer
 * modalidade (a mesma conta do perfil). É daqui que sai o nível.
 */
export async function allTimePoints(
  db: AppDatabase,
  playerIds: string[],
): Promise<Map<string, number>> {
  if (playerIds.length === 0) return new Map();
  const best = db
    .select({ playerId: gamePlayers.playerId, best: max(games.points).as('best') })
    .from(games)
    .innerJoin(gamePlayers, eq(gamePlayers.gameId, games.id))
    .where(inArray(gamePlayers.playerId, playerIds))
    .groupBy(gamePlayers.playerId, games.imageId, games.pieceCount)
    .as('best_by_puzzle');
  const rows = await db
    .select({ playerId: best.playerId, total: sql<number>`sum(${best.best})::int` })
    .from(best)
    .groupBy(best.playerId);
  return new Map(rows.map((row) => [row.playerId, row.total]));
}

type Members = Pick<RankingRowBase, 'players' | 'profiles' | 'avatars' | 'levels'>;

/** A maior sequência de dias seguidos ("2026-10-21") em qualquer época. */
export function longestStreak(days: ReadonlySet<string>): number {
  const sorted = [...days].map((day) => Date.parse(`${day}T00:00:00Z`)).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  sorted.forEach((time, index) => {
    run = index > 0 && time - sorted[index - 1]! === 24 * 60 * 60 * 1000 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

/**
 * Quem é cada equipe pela team_key, em ordem alfabética: o nome de cada jogador (com conta, o
 * nickname atual do perfil; convidado, o apelido mais recente), o código de amigo e o avatar
 * (null para convidado) e o nível.
 */
export async function teamMembers(
  db: AppDatabase,
  teamKeys: string[],
): Promise<Map<string, Members>> {
  const ids = [...new Set(teamKeys.flatMap((key) => key.split(',')))];
  const rows =
    ids.length === 0
      ? []
      : await db
          .select({
            id: players.id,
            name: sql<string>`coalesce(${profileName}, ${players.nickname})`,
            code: users.friendCode,
            url: profileAvatar,
            color: users.avatarColor,
          })
          .from(players)
          .leftJoin(users, eq(users.id, players.userId))
          .where(inArray(players.id, ids));
  const points = await allTimePoints(db, ids);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return new Map(
    teamKeys.map((key) => {
      const members = key
        .split(',')
        .map((id) => ({
          ...(byId.get(id) ?? { name: '?', code: null, url: null, color: null }),
          level: levelOf(points.get(id) ?? 0),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      return [
        key,
        {
          players: members.map((m) => m.name),
          profiles: members.map((m) => m.code ?? null),
          avatars: members.map((m) => ({ url: m.url ?? null, color: m.color ?? null })),
          levels: members.map((m) => m.level),
        },
      ];
    }),
  );
}

/**
 * Monta a resposta do ranking a partir da lista completa e ordenada (melhor primeiro): o topo,
 * o total, a variação em relação ao período anterior, a sequência de dias e a "Sua posição" —
 * a melhor equipe do ranking que tem o jogador de quem pede.
 */
export async function rankingPage<R extends { teamKey: string }, E>(
  db: AppDatabase,
  options: {
    rows: R[];
    /** A mesma lista no período anterior (sem ela, não há variação: período "sempre"). */
    previous?: R[];
    viewerPlayerId?: string;
    limit: number;
    streakSource: 'games' | 'bullet';
    toEntry: (row: R) => E;
  },
): Promise<RankingPage<RankingRowBase & E>> {
  const { rows, previous, viewerPlayerId, limit, streakSource, toEntry } = options;
  const before = previous && new Map(previous.map((row, index) => [row.teamKey, index + 1]));
  const top = rows.slice(0, limit);
  const meIndex = viewerPlayerId
    ? rows.findIndex((row) => row.teamKey.split(',').includes(viewerPlayerId))
    : -1;
  const keys = new Set(top.map((row) => row.teamKey));
  if (meIndex >= 0) {
    keys.add(rows[meIndex]!.teamKey);
    if (meIndex > 0) keys.add(rows[meIndex - 1]!.teamKey);
  }
  const members = await teamMembers(db, [...keys]);
  const streak = await streaks(db, streakSource, [...keys]);

  const entry = (row: R, index: number): RankingRowBase & E => {
    const was = before?.get(row.teamKey);
    return {
      position: index + 1,
      ...members.get(row.teamKey)!,
      ...(before ? { change: was ? was - (index + 1) : null } : {}),
      streak: streak.get(row.teamKey) ?? 0,
      ...toEntry(row),
    };
  };
  return {
    entries: top.map(entry),
    total: rows.length,
    me:
      meIndex >= 0
        ? {
            ...entry(rows[meIndex]!, meIndex),
            ahead: meIndex > 0 ? entry(rows[meIndex - 1]!, meIndex - 1) : undefined,
          }
        : undefined,
  };
}
