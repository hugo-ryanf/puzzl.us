import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { PIECE_COUNT_PRESETS, ROOM_NAME, RankingQuery } from '@puzzle/shared';
import type { GameStore } from './db/gameStore';
import { PuzzleRoom } from './rooms/PuzzleRoom';
import { registerUploadRoutes } from './uploads/routes';
import type { UploadStore } from './uploads/uploadStore';
import type { VoiceTokenIssuer } from './voice';

export interface GameServerOptions {
  /** Sem store (DATABASE_URL não configurada) o jogo funciona e o ranking fica indisponível. */
  store?: GameStore;
  /** Sem uploads (também depende do banco) não dá para jogar com foto própria. */
  uploads?: UploadStore;
  /** Sem voice (LIVEKIT_* não configuradas) o jogo funciona e a chamada fica indisponível. */
  voice?: VoiceTokenIssuer;
}

/**
 * Monta o servidor sem começar a escutar: o index.ts chama listen() e os testes
 * sobem a mesma configuração numa porta própria.
 */
export function createGameServer({ store, uploads, voice }: GameServerOptions = {}): Server {
  const server = new Server({
    transport: new WebSocketTransport(),
    greet: false,
    express: (app) => {
      // API pública e sem cookies: qualquer origem pode usar (o front pode estar em outro
      // domínio). O POST de foto manda bytes crus, então o navegador faz um "preflight" OPTIONS.
      app.use('/api', (req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          res.sendStatus(204);
          return;
        }
        next();
      });

      app.get('/api/health', (_req, res) => {
        res.json({
          ok: true,
          piecePresets: PIECE_COUNT_PRESETS,
          ranking: !!store,
          uploads: !!uploads,
          voice: !!voice,
        });
      });

      registerUploadRoutes(app, uploads);

      app.get('/api/ranking', async (req, res) => {
        const query = RankingQuery.safeParse(req.query);
        if (!query.success) {
          res.status(400).json({ error: 'parâmetros inválidos', issues: query.error.issues });
          return;
        }
        if (!store) {
          res.status(503).json({ error: 'ranking indisponível: servidor sem banco de dados' });
          return;
        }
        res.json(await store.leaderboard(query.data));
      });
    },
  });

  // A sala recebe as dependências por herança: assim elas nunca passam pelas opções que o
  // cliente envia ao criar/entrar (que ele controla).
  server.define(
    ROOM_NAME,
    class extends PuzzleRoom {
      protected override store = store;
      protected override uploads = uploads;
      protected override voice = voice;
    },
  );
  return server;
}
