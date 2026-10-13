import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Em dev o front chama /api no próprio Vite, que repassa ao servidor — sem CORS.
    proxy: {
      '/api': 'http://localhost:2567',
    },
  },
});
