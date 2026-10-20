import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` compara o schema com as migrações já existentes e cria a próxima.
// Não precisa de banco: as migrações são aplicadas pelo servidor quando ele sobe.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
