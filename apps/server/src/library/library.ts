import express, { type Application } from 'express';
import { and, count, desc, eq, max, min } from 'drizzle-orm';
import {
  FavoriteImageId,
  SavedGameId,
  type LibraryResponse,
  type PuzzleRecord,
  type SavedGameSummary,
} from '@puzzle/shared';
import type { AccountStore } from '../auth/accounts';
import { accountFromCookieHeader } from '../auth/routes';
import type { AppDatabase } from '../db/database';
import { favorites, gamePlayers, games, players } from '../db/schema';
import type { SavedGameStore } from '../rooms/savedGames';

/** Coisas só da conta: records (quebra-cabeças concluídos) e favoritos. */
export interface LibraryStore {
  /** Melhor marca por categoria, da mais recente para a mais antiga. */
  records(userId: string): Promise<PuzzleRecord[]>;
  favorites(userId: string): Promise<string[]>;
  setFavorite(userId: string, imageId: string, favorite: boolean): Promise<void>;
}

export function createLibraryStore(db: AppDatabase): LibraryStore {
  return {
    async records(userId) {
      // As partidas da conta, pelo jogador ligado a ela (o histórico de convidado já passou para
      // ele no login). Concluídos não precisam de tabela própria: são as partidas gravadas.
      const lastPlayedAt = max(games.finishedAt).as('last_played_at');
      const rows = await db
        .select({
          imageId: games.imageId,
          pieceCount: games.pieceCount,
          teamSize: games.teamSize,
          bestMs: min(games.durationMs),
          plays: count(),
          lastPlayedAt,
        })
        .from(games)
        .innerJoin(gamePlayers, eq(gamePlayers.gameId, games.id))
        .innerJoin(players, eq(players.id, gamePlayers.playerId))
        .where(eq(players.userId, userId))
        .groupBy(games.imageId, games.pieceCount, games.teamSize)
        .orderBy(desc(lastPlayedAt));
      return rows.map((row) => ({
        imageId: row.imageId,
        pieceCount: row.pieceCount,
        teamSize: row.teamSize,
        bestMs: row.bestMs ?? 0,
        plays: row.plays,
        // max() de timestamp volta como texto em alguns drivers: normaliza para ISO.
        lastPlayedAt: new Date(row.lastPlayedAt as unknown as string).toISOString(),
      }));
    },

    async favorites(userId) {
      const rows = await db
        .select({ imageId: favorites.imageId })
        .from(favorites)
        .where(eq(favorites.userId, userId))
        .orderBy(desc(favorites.createdAt));
      return rows.map((row) => row.imageId);
    },

    async setFavorite(userId, imageId, favorite) {
      if (favorite) {
        await db.insert(favorites).values({ userId, imageId }).onConflictDoNothing();
      } else {
        await db
          .delete(favorites)
          .where(and(eq(favorites.userId, userId), eq(favorites.imageId, imageId)));
      }
    },
  };
}

/**
 * GET    /api/me/library            → { records, favorites }
 * PUT    /api/me/favorites/:imageId → favorita
 * DELETE /api/me/favorites/:imageId → desfavorita
 * GET    /api/me/saved              → partidas salvas ("Em andamento")
 * DELETE /api/me/saved/:id          → descarta uma partida salva
 * Tudo exige login (401 sem sessão). Cookie SameSite=Lax: outro site não consegue disparar.
 */
export function registerLibraryRoutes(
  app: Application,
  accounts: AccountStore,
  library: LibraryStore,
  savedGames?: SavedGameStore,
) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    const account = await accountFromCookieHeader(accounts, req.headers.cookie);
    if (!account) {
      res.status(401).json({ error: 'Entre com sua conta.' });
      return;
    }
    res.locals.userId = account.id;
    next();
  });

  router.get('/library', async (_req, res) => {
    const userId = res.locals.userId as string;
    const body: LibraryResponse = {
      records: await library.records(userId),
      favorites: await library.favorites(userId),
    };
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  });

  const favoriteRoute =
    (favorite: boolean): express.RequestHandler =>
    async (req, res) => {
      const imageId = FavoriteImageId.safeParse(req.params.imageId);
      if (!imageId.success) {
        res.status(400).json({ error: 'Quebra-cabeça inválido.' });
        return;
      }
      await library.setFavorite(res.locals.userId as string, imageId.data, favorite);
      res.sendStatus(204);
    };
  router.put('/favorites/:imageId', favoriteRoute(true));
  router.delete('/favorites/:imageId', favoriteRoute(false));

  if (savedGames) {
    router.get('/saved', async (_req, res) => {
      const body: SavedGameSummary[] = await savedGames.list(res.locals.userId as string);
      res.setHeader('Cache-Control', 'no-store');
      res.json(body);
    });
    router.delete('/saved/:id', async (req, res) => {
      const id = SavedGameId.safeParse(req.params.id);
      if (!id.success) {
        res.status(400).json({ error: 'Partida inválida.' });
        return;
      }
      await savedGames.delete(id.data, res.locals.userId as string); // só apaga se for da conta
      res.sendStatus(204);
    });
  }

  app.use('/api/me', router);
}
