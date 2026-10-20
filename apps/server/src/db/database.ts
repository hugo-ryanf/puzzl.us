import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import * as schema from './schema';

/**
 * Tipo comum a qualquer driver Postgres do Drizzle: em produção é o node-postgres (Neon),
 * nos testes é o PGlite em memória. O código de ranking só depende deste tipo.
 */
export type AppDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Conecta no Postgres (Neon) e aplica as migrações pendentes antes de liberar o uso. */
export async function connectDatabase(url: string, migrationsFolder: string): Promise<AppDatabase> {
  // Neon exige SSL; a própria connection string traz `sslmode=require`.
  const db = drizzle(new Pool({ connectionString: url, max: 5 }), { schema });
  await migrate(db, { migrationsFolder });
  return db;
}
