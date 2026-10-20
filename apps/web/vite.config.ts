import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Servidor do jogo em dev (VITE_SERVER_URL aponta para outro, ex.: um servidor de teste). */
const SERVER = process.env.VITE_SERVER_URL ?? 'http://localhost:2567';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Em dev o front chama /api e /auth no próprio Vite, que repassa ao servidor: mesma origem,
    // então o cookie da sessão (login com Google) vai junto, sem CORS. A sala (WebSocket) vai
    // direto à porta 2567; cookie não depende de porta, então a sessão também chega lá.
    proxy: {
      '/api': SERVER,
      '/auth': SERVER,
    },
  },
});
