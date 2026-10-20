import { and, asc, count, eq, inArray, lt, min, ne, sql } from 'drizzle-orm';
import type { RankingEntry, RankingQuery } from '@puzzle/shared';
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
  players: Array<{ guestId: string; nickname: string }>;
}

/** O que a sala precisa da persistência. Sem banco configurado, a sala recebe `undefined`. */
export interface GameStore {
  /** Grava a partida e devolve a posição da equipe no ranking da categoria. */
  saveGame(result: GameResult): Promise<{ rank: number }>;
  leaderboard(query: RankingQuery, limit?: number): Promise<RankingEntry[]>;
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
      // A mesma pessoa em duas abas conta uma vez só.
      const team = [...new Map(result.players.map((p) => [p.guestId, p])).values()];

      return db.transaction(async (tx) => {
        // Upsert: o convidado já pode existir de outra partida; o apelido mais recente vence.
        const rows = await tx
          .insert(players)
          .values(team.map(({ guestId, nickname }) => ({ guestId, nickname })))
          .onConflictDoUpdate({
            target: players.guestId,
            set: { nickname: sql`excluded.nickname` },
          })
          .returning({ id: players.id, guestId: players.guestId });
        const playerIdByGuest = new Map(rows.map((r) => [r.guestId, r.id]));
        const teamKey = [...playerIdByGuest.values()].sort().join(',');

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
            startedAt: result.startedAt,
            finishedAt: result.finishedAt,
          })
          .returning({ id: games.id });

        await tx.insert(gamePlayers).values(
          team.map(({ guestId, nickname }) => ({
            gameId: game!.id,
            playerId: playerIdByGuest.get(guestId)!,
            nickname,
          })),
        );

        // Posição = 1 + quantas OUTRAS equipes têm melhor tempo menor que este.
        const bestByTeam = tx
          .select({ teamKey: games.teamKey, best: min(games.durationMs).as('best') })
          .from(games)
          .where(sameCategory(result.imageId, result.pieceCount, team.length))
          .groupBy(games.teamKey)
          .as('best_by_team');
        const [faster] = await tx
          .select({ total: count() })
          .from(bestByTeam)
          .where(and(lt(bestByTeam.best, result.durationMs), ne(bestByTeam.teamKey, teamKey)));

        return { rank: (faster?.total ?? 0) + 1 };
      });
    },

    async leaderboard({ image, pieces, players: teamSize }, limit = 20) {
      // Melhor partida de cada equipe (DISTINCT ON), depois ordena essas partidas por tempo.
      const bestGames = db
        .selectDistinctOn([games.teamKey], {
          id: games.id,
          durationMs: games.durationMs,
          finishedAt: games.finishedAt,
        })
        .from(games)
        .where(sameCategory(image, pieces, teamSize))
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
  };
}
