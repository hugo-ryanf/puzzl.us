import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { AppDatabase } from './database';
import * as schema from './schema';

/**
 * Postgres de verdade (compilado para WASM) rodando em memória, com as mesmas migrações do
 * Neon. Usado nos testes: cada chamada começa com um banco vazio e não toca no banco real.
 */
export async function createMemoryDatabase(): Promise<AppDatabase> {
  const db = drizzle({ client: new PGlite(), schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
  return db;
}

/** Apaga todos os dados, mantendo as tabelas: bem mais rápido que subir outro PGlite. */
export async function clearDatabase(db: AppDatabase): Promise<void> {
  await db.execute(
    sql`TRUNCATE game_players, games, bullet_runs, battle_result_players, battle_results, players, friendships, puzzle_reports, community_puzzles, uploads, room_snapshots, favorites, saved_games, sessions, users`,
  );
}
