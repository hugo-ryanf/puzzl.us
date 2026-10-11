import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node22',
  clean: true,
  // O @puzzle/shared é publicado como código TS cru; embutimos no bundle para o Node não precisar lê-lo.
  noExternal: ['@puzzle/shared'],
});
