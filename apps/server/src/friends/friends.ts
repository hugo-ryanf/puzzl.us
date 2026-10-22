import { and, eq, or } from 'drizzle-orm';
import type { FriendView } from '@puzzle/shared';
import type { AppDatabase } from '../db/database';
import { profileAvatar, profileName } from '../auth/accounts';
import { friendships, users } from '../db/schema';

/** Os dois ids em ordem: a amizade fica numa linha só, qualquer que seja o lado. */
const pair = (a: string, b: string) =>
  a < b ? { userLow: a, userHigh: b } : { userLow: b, userHigh: a };

export type AddFriendResult =
  | { result: 'not-found' }
  | { result: 'self' }
  | { result: 'requested' | 'accepted' | 'already'; friendId: string };

export interface FriendList {
  friendCode: string;
  /** Sem status: quem monta a resposta junta o que a presença sabe. */
  friends: Omit<FriendView, 'status'>[];
  incoming: Omit<FriendView, 'status'>[];
  outgoing: Omit<FriendView, 'status'>[];
}

export interface FriendStore {
  /** Pede amizade pelo código. Se a outra pessoa já tinha pedido, vira amizade na hora. */
  add(userId: string, friendCode: string): Promise<AddFriendResult>;
  /** Aceita um pedido recebido; false se não havia pedido daquela pessoa. */
  accept(userId: string, otherId: string): Promise<boolean>;
  /** Recusa, cancela ou desfaz: apaga a linha, qualquer que seja o estado. */
  remove(userId: string, otherId: string): Promise<boolean>;
  list(userId: string): Promise<FriendList>;
  /** Amigos aceitos (para avisar quando o status muda). */
  friendIds(userId: string): Promise<string[]>;
  areFriends(a: string, b: string): Promise<boolean>;
}

export function createFriendStore(db: AppDatabase): FriendStore {
  const pairOf = (a: string, b: string) => {
    const { userLow, userHigh } = pair(a, b);
    return and(eq(friendships.userLow, userLow), eq(friendships.userHigh, userHigh));
  };
  const involving = (userId: string) =>
    or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId));

  return {
    async add(userId, friendCode) {
      const [other] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.friendCode, friendCode));
      if (!other) return { result: 'not-found' };
      if (other.id === userId) return { result: 'self' };
      const friendId = other.id;

      const [existing] = await db.select().from(friendships).where(pairOf(userId, friendId));
      if (!existing) {
        await db
          .insert(friendships)
          .values({ ...pair(userId, friendId), requestedBy: userId })
          .onConflictDoNothing();
        return { result: 'requested', friendId };
      }
      if (existing.status === 'accepted') return { result: 'already', friendId };
      // Pedido meu ainda pendente: nada muda. Pedido da outra pessoa: aceitar é o que eu quero.
      if (existing.requestedBy === userId) return { result: 'requested', friendId };
      await db.update(friendships).set({ status: 'accepted' }).where(pairOf(userId, friendId));
      return { result: 'accepted', friendId };
    },

    async accept(userId, otherId) {
      const updated = await db
        .update(friendships)
        .set({ status: 'accepted' })
        .where(
          and(
            pairOf(userId, otherId),
            eq(friendships.status, 'pending'),
            eq(friendships.requestedBy, otherId),
          ),
        )
        .returning({ status: friendships.status });
      return updated.length > 0;
    },

    async remove(userId, otherId) {
      const deleted = await db
        .delete(friendships)
        .where(pairOf(userId, otherId))
        .returning({ status: friendships.status });
      return deleted.length > 0;
    },

    async list(userId) {
      const [me] = await db
        .select({ friendCode: users.friendCode })
        .from(users)
        .where(eq(users.id, userId));
      const rows = await db
        .select({
          userLow: friendships.userLow,
          userHigh: friendships.userHigh,
          status: friendships.status,
          requestedBy: friendships.requestedBy,
          id: users.id,
          name: profileName,
          avatarUrl: profileAvatar,
          avatarColor: users.avatarColor,
          friendCode: users.friendCode,
        })
        .from(friendships)
        .innerJoin(
          users,
          // A outra ponta da amizade.
          or(
            and(eq(friendships.userLow, userId), eq(users.id, friendships.userHigh)),
            and(eq(friendships.userHigh, userId), eq(users.id, friendships.userLow)),
          ),
        )
        .where(involving(userId));

      const list: FriendList = {
        friendCode: me?.friendCode ?? '',
        friends: [],
        incoming: [],
        outgoing: [],
      };
      for (const row of rows) {
        const person = {
          id: row.id,
          name: row.name,
          avatarUrl: row.avatarUrl,
          avatarColor: row.avatarColor,
          friendCode: row.friendCode,
        };
        if (row.status === 'accepted') list.friends.push(person);
        else if (row.requestedBy === userId) list.outgoing.push(person);
        else list.incoming.push(person);
      }
      const byName = (a: { name: string }, b: { name: string }) =>
        a.name.localeCompare(b.name, 'pt-BR');
      list.friends.sort(byName);
      list.incoming.sort(byName);
      list.outgoing.sort(byName);
      return list;
    },

    async friendIds(userId) {
      const rows = await db
        .select({ userLow: friendships.userLow, userHigh: friendships.userHigh })
        .from(friendships)
        .where(and(involving(userId), eq(friendships.status, 'accepted')));
      return rows.map((row) => (row.userLow === userId ? row.userHigh : row.userLow));
    },

    async areFriends(a, b) {
      const [row] = await db
        .select({ status: friendships.status })
        .from(friendships)
        .where(pairOf(a, b));
      return row?.status === 'accepted';
    },
  };
}
