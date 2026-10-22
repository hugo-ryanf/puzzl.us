import { and, count, countDistinct, eq, gte, max, or, sql } from 'drizzle-orm';
import { RANKING_TIME_ZONE, type ProfileStats, type PublicProfile } from '@puzzle/shared';
import { profileAvatar, profileName } from '../auth/accounts';
import type { AppDatabase } from '../db/database';
import { finishedInPeriod, streakOf } from '../db/rankingPage';
import { bulletRuns, friendships, gamePlayers, games, players, users } from '../db/schema';

/** A sequência só olha para trás até aqui. */
const STREAK_LOOKBACK = sql`now() - interval '400 days'`;

export interface ProfileStore {
  /** Números do perfil, a partir das partidas do jogador ligado à conta. */
  stats(userId: string): Promise<ProfileStats>;
  /** O perfil público pelo código de amigo, com a relação de quem está vendo. */
  publicProfile(friendCode: string, viewerId?: string): Promise<PublicProfile | undefined>;
}

export function createProfileStore(db: AppDatabase): ProfileStore {
  const stats = async (userId: string): Promise<ProfileStats> => {
    const [friendsRow] = await db
      .select({ total: count() })
      .from(friendships)
      .where(
        and(
          eq(friendships.status, 'accepted'),
          or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId)),
        ),
      );
    const friends = friendsRow?.total ?? 0;
    const [player] = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.userId, userId));
    if (!player) {
      return {
        puzzles: 0,
        images: 0,
        pieces: 0,
        pointsWeek: 0,
        pointsAll: 0,
        streak: 0,
        bulletBest: 0,
        friends,
      };
    }

    const mine = eq(gamePlayers.playerId, player.id);
    const [totals] = await db
      .select({
        puzzles: count(),
        images: countDistinct(games.imageId),
        pieces: sql<number>`coalesce(sum(${games.pieceCount}), 0)::int`,
      })
      .from(games)
      .innerJoin(gamePlayers, eq(gamePlayers.gameId, games.id))
      .where(mine);

    // Pontos: a melhor partida de cada foto e tamanho (como no ranking), em qualquer modalidade.
    const points = async (week: boolean) => {
      const best = db
        .select({ best: max(games.points).as('best') })
        .from(games)
        .innerJoin(gamePlayers, eq(gamePlayers.gameId, games.id))
        .where(and(mine, week ? finishedInPeriod(games.finishedAt, 'week') : undefined))
        .groupBy(games.imageId, games.pieceCount)
        .as('best_by_puzzle');
      const [row] = await db
        .select({ total: sql<number>`coalesce(sum(${best.best}), 0)::int` })
        .from(best);
      return row?.total ?? 0;
    };

    // O id do jogador é um uuid: procurar por ele dentro da team_key não confunde ninguém.
    const inTeam = sql`position(${player.id} in ${bulletRuns.teamKey}) > 0`;
    const [bullet] = await db
      .select({ best: max(bulletRuns.solved) })
      .from(bulletRuns)
      .where(inTeam);

    const day = (column: typeof games.finishedAt | typeof bulletRuns.finishedAt) =>
      sql<string>`to_char(${column} at time zone ${RANKING_TIME_ZONE}, 'YYYY-MM-DD')`;
    const gameDays = await db
      .selectDistinct({ day: day(games.finishedAt) })
      .from(games)
      .innerJoin(gamePlayers, eq(gamePlayers.gameId, games.id))
      .where(and(mine, gte(games.finishedAt, STREAK_LOOKBACK)));
    const bulletDays = await db
      .selectDistinct({ day: day(bulletRuns.finishedAt) })
      .from(bulletRuns)
      .where(and(inTeam, gte(bulletRuns.finishedAt, STREAK_LOOKBACK)));

    return {
      puzzles: totals?.puzzles ?? 0,
      images: totals?.images ?? 0,
      pieces: totals?.pieces ?? 0,
      pointsWeek: await points(true),
      pointsAll: await points(false),
      streak: streakOf(new Set([...gameDays, ...bulletDays].map((row) => row.day))),
      bulletBest: bullet?.best ?? 0,
      friends,
    };
  };

  return {
    stats,

    async publicProfile(friendCode, viewerId) {
      const [user] = await db
        .select({
          id: users.id,
          name: profileName,
          avatarUrl: profileAvatar,
          avatarColor: users.avatarColor,
          bio: users.bio,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.friendCode, friendCode));
      if (!user) return undefined;

      let relation: PublicProfile['relation'] = viewerId ? 'none' : 'guest';
      if (viewerId === user.id) relation = 'me';
      else if (viewerId) {
        const [low, high] = viewerId < user.id ? [viewerId, user.id] : [user.id, viewerId];
        const [friendship] = await db
          .select({ status: friendships.status })
          .from(friendships)
          .where(and(eq(friendships.userLow, low), eq(friendships.userHigh, high)));
        if (friendship) relation = friendship.status === 'accepted' ? 'friend' : 'pending';
      }

      return {
        friendCode,
        name: user.name,
        avatarUrl: user.avatarUrl,
        avatarColor: user.avatarColor,
        bio: user.bio,
        memberSince: user.createdAt.toISOString(),
        stats: await stats(user.id),
        relation,
      };
    },
  };
}
