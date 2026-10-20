import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Subir o PGlite (Postgres em WASM) leva alguns segundos, e mais quando vários arquivos
    // de teste sobem o seu em paralelo; o padrão de 10 s para hooks fica apertado.
    hookTimeout: 30_000,
  },
});
