import { createHash, randomBytes, randomInt } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { AppDatabase } from '../db/database';
import { gamePlayers, games, players, sessions, users } from '../db/schema';

/** Quanto tempo o login dura sem precisar entrar de novo. */
export const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Sem 0/O, 1/I/L: o código de amigo é ditado e digitado. */
const FRIEND_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** O que o resto do servidor (e o /api/me) sabe de uma conta. */
export interface Account {
  id: string;
  name: string;
  avatarUrl: string | null;
  friendCode: string;
  isAdmin: boolean;
}

/** O que o login com Google entrega (claims do id_token). */
export interface GoogleProfile {
  sub: string;
  name: string;
  picture?: string;
  email?: string;
  emailVerified?: boolean;
}

export interface AccountStore {
  /** Cria a conta no primeiro login; nos seguintes, atualiza nome e foto (mudaram no Google). */
  signInWithGoogle(profile: GoogleProfile, isAdmin: boolean): Promise<Account>;
  createSession(userId: string): Promise<{ token: string; expiresAt: Date }>;
  /** A conta dona da sessão, se o token for válido e não tiver expirado. */
  accountForSession(token: string): Promise<Account | undefined>;
  deleteSession(token: string): Promise<void>;
  /**
   * Junta à conta o histórico do convidado deste navegador. Se a conta ainda não tem jogador, o
   * convidado vira o jogador dela; se já tem, as partidas do convidado passam para ele.
   */
  linkGuest(userId: string, guestId: string): Promise<void>;
  deleteExpiredSessions(): Promise<number>;
}

/** No banco vai só o hash: quem lê o banco não consegue se passar por ninguém. */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** "K7QF-2M9D": 31⁸ combinações, o bastante para não colidir na prática. */
function newFriendCode(): string {
  const pick = () => FRIEND_CODE_ALPHABET[randomInt(FRIEND_CODE_ALPHABET.length)];
  const half = () => Array.from({ length: 4 }, pick).join('');
  return `${half()}-${half()}`;
}

const accountColumns = {
  id: users.id,
  name: users.displayName,
  avatarUrl: users.avatarUrl,
  friendCode: users.friendCode,
  isAdmin: users.isAdmin,
};

export function createAccountStore(db: AppDatabase): AccountStore {
  return {
    async signInWithGoogle(profile, isAdmin) {
      const values = {
        googleSub: profile.sub,
        displayName: profile.name.trim().slice(0, 40) || 'Jogador',
        avatarUrl: profile.picture ?? null,
        isAdmin,
      };
      // Código de amigo repetido é quase impossível; se acontecer, tenta outro.
      for (let attempt = 0; ; attempt++) {
        try {
          const [account] = await db
            .insert(users)
            .values({ ...values, friendCode: newFriendCode() })
            .onConflictDoUpdate({
              target: users.googleSub,
              set: {
                displayName: values.displayName,
                avatarUrl: values.avatarUrl,
                isAdmin,
              },
            })
            .returning(accountColumns);
          return account!;
        } catch (error) {
          if (attempt >= 3 || !String(error).includes('friend_code')) throw error;
        }
      }
    },

    async createSession(userId) {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
      await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt });
      return { token, expiresAt };
    },

    async accountForSession(token) {
      const [account] = await db
        .select(accountColumns)
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())));
      return account;
    },

    async deleteSession(token) {
      await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    },

    async linkGuest(userId, guestId) {
      await db.transaction(async (tx) => {
        const [guest] = await tx.select().from(players).where(eq(players.guestId, guestId));
        // Sem histórico, já é desta conta, ou é de outra conta (outra pessoa usou este PC).
        if (!guest || guest.userId) return;

        const [mine] = await tx.select().from(players).where(eq(players.userId, userId));
        if (!mine) {
          await tx.update(players).set({ userId }).where(eq(players.id, guest.id));
          return;
        }

        // A conta já tem jogador: as partidas do convidado passam para ele.
        const rows = await tx
          .select({ gameId: gamePlayers.gameId })
          .from(gamePlayers)
          .where(eq(gamePlayers.playerId, guest.id));
        for (const { gameId } of rows) {
          const [both] = await tx
            .select({ gameId: gamePlayers.gameId })
            .from(gamePlayers)
            .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, mine.id)));
          if (both) {
            // Convidado e conta na mesma partida (dois aparelhos): é uma pessoa só.
            await tx
              .delete(gamePlayers)
              .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, guest.id)));
          } else {
            await tx
              .update(gamePlayers)
              .set({ playerId: mine.id })
              .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, guest.id)));
          }
          // A equipe mudou de "ids": recalcula a chave (e o tamanho, se encolheu).
          const team = await tx
            .select({ playerId: gamePlayers.playerId })
            .from(gamePlayers)
            .where(eq(gamePlayers.gameId, gameId));
          await tx
            .update(games)
            .set({
              teamKey: team
                .map((p) => p.playerId)
                .sort()
                .join(','),
              teamSize: team.length,
            })
            .where(eq(games.id, gameId));
        }
        await tx.delete(players).where(eq(players.id, guest.id));
      });
    },

    async deleteExpiredSessions() {
      const removed = await db
        .delete(sessions)
        .where(lt(sessions.expiresAt, new Date()))
        .returning({ tokenHash: sessions.tokenHash });
      return removed.length;
    },
  };
}
