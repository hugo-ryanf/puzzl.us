import { join, sep } from 'node:path';
import { Server } from '@colyseus/core';
import express from 'express';
import { WebSocketTransport } from '@colyseus/ws-transport';
import {
  BATTLE_ROOM,
  BULLET_ROOM,
  BulletRankingQuery,
  GeneralRankingQuery,
  PopularQuery,
  PIECE_COUNT_PRESETS,
  PRESENCE_ROOM,
  ROOM_NAME,
  RankingQuery,
} from '@puzzle/shared';
import type { AccountStore } from './auth/accounts';
import { registerAuthRoutes, type AuthOptions } from './auth/routes';
import type { CommunityStore } from './community/community';
import { registerCommunityRoutes } from './community/routes';
import { PresenceRoom } from './friends/PresenceRoom';
import { createPresenceHub } from './friends/presence';
import { registerFriendRoutes } from './friends/routes';
import type { BulletStore } from './db/bulletStore';
import type { GameStore } from './db/gameStore';
import { BattleRoom } from './rooms/BattleRoom';
import { BulletRoom } from './rooms/BulletRoom';
import { PuzzleRoom } from './rooms/PuzzleRoom';
import type { SnapshotStore } from './rooms/snapshots';
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
  /** Sem snapshots (também depende do banco) as salas não sobrevivem a um reinício. */
  snapshots?: SnapshotStore;
  /** Quebra-cabeças publicados pelos jogadores. Sem banco, o Explorar mostra só o catálogo. */
  community?: CommunityStore;
  /** Ranking do Bullet. Sem banco, a corrida termina sem posição. */
  bullet?: BulletStore;
  /**
   * Contas (login com Google). Sem banco fica undefined: todo mundo joga como convidado e o
   * /api/me responde que não há login.
   */
  auth?: AuthOptions;
  /**
   * Pasta do site já compilado (apps/web/dist). Em produção o mesmo servidor entrega o site,
   * a API e o WebSocket: uma URL só e nada de CORS. Em dev fica undefined (quem serve é o Vite).
   */
  webDist?: string;
  /**
   * Atrás de um proxy (Render), o IP do visitante vem no X-Forwarded-For. Só ligue quando houver
   * proxy de verdade: sem ele, qualquer um falsificaria o cabeçalho e fugiria do limite de envios.
   */
  trustProxy?: boolean;
}

/**
 * Monta o servidor sem começar a escutar: o index.ts chama listen() e os testes
 * sobem a mesma configuração numa porta própria.
 */
export function createGameServer({
  store,
  uploads,
  voice,
  snapshots,
  community,
  bullet,
  auth,
  webDist,
  trustProxy = false,
}: GameServerOptions = {}): Server {
  const accounts: AccountStore | undefined = auth?.accounts;
  const savedGames = auth?.savedGames;
  const friends = auth?.friends;
  // Quem está online e onde (só com contas: convidado não tem amigos).
  const presence = accounts && friends ? createPresenceHub() : undefined;
  // Mudou o status de alguém: os amigos dele buscam a lista de novo.
  presence?.onChange((userId) => {
    void friends!
      .friendIds(userId)
      .then((ids) => ids.forEach((id) => presence.send(id, 'friendsChanged', {})))
      .catch(() => {});
  });
  const server = new Server({
    transport: new WebSocketTransport(),
    greet: false,
    express: (app) => {
      if (trustProxy) app.set('trust proxy', 1); // confia em um salto: o proxy do Render
      // Qualquer origem pode LER a API pública (o "*" não libera cookies: as rotas da conta só
      // respondem com a sessão para o próprio site). O POST de foto manda bytes crus, então o
      // navegador faz um "preflight" OPTIONS.
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

      registerUploadRoutes(app, uploads, accounts);
      registerCommunityRoutes(app, accounts, community);
      if (accounts && friends && presence) registerFriendRoutes(app, accounts, friends, presence);

      if (auth) registerAuthRoutes(app, auth);
      else {
        // Servidor sem banco: sem contas. O site só esconde o botão de entrar.
        app.get('/api/me', (_req, res) => res.json({ user: null, googleLogin: false }));
      }

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

      // Ranking geral da modalidade (soma de todas as fotos) no período.
      app.get('/api/ranking/general', async (req, res) => {
        const query = GeneralRankingQuery.safeParse(req.query);
        if (!query.success) {
          res.status(400).json({ error: 'parâmetros inválidos', issues: query.error.issues });
          return;
        }
        if (!store) {
          res.status(503).json({ error: 'ranking indisponível: servidor sem banco de dados' });
          return;
        }
        res.json(await store.generalLeaderboard(query.data));
      });

      // Fotos mais jogadas na modalidade e no período: a escolha da foto no ranking.
      app.get('/api/ranking/popular', async (req, res) => {
        const query = PopularQuery.safeParse(req.query);
        if (!query.success) {
          res.status(400).json({ error: 'parâmetros inválidos', issues: query.error.issues });
          return;
        }
        if (!store) {
          res.status(503).json({ error: 'ranking indisponível: servidor sem banco de dados' });
          return;
        }
        res.json(await store.popular(query.data));
      });

      // Ranking do Bullet: quantos quebra-cabeças em X minutos, por tamanho e modalidade.
      app.get('/api/ranking/bullet', async (req, res) => {
        const query = BulletRankingQuery.safeParse(req.query);
        if (!query.success) {
          res.status(400).json({ error: 'parâmetros inválidos', issues: query.error.issues });
          return;
        }
        if (!bullet) {
          res.status(503).json({ error: 'ranking indisponível: servidor sem banco de dados' });
          return;
        }
        res.json(await bullet.leaderboard(query.data));
      });

      if (webDist) serveWebApp(app, webDist);
    },
  });

  // A sala recebe as dependências por herança: assim elas nunca passam pelas opções que o
  // cliente envia ao criar/entrar (que ele controla).
  // filterBy(['restore']): o joinOrCreate de quem volta depois de um reinício só encontra a
  // sala restaurada com aquele código; pedidos simultâneos acabam todos na mesma sala.
  server
    .define(
      ROOM_NAME,
      class extends PuzzleRoom {
        protected override store = store;
        protected override uploads = uploads;
        protected override voice = voice;
        protected override snapshots = snapshots;
        protected override accounts = accounts;
        protected override savedGames = savedGames;
        protected override community = community;
        protected override onlineHub = presence;
      },
    )
    .filterBy(['restore']);
  server.define(
    BULLET_ROOM,
    class extends BulletRoom {
      protected override bullet = bullet;
      protected override voice = voice;
      protected override snapshots = snapshots;
      protected override accounts = accounts;
      protected override onlineHub = presence;
    },
  );
  server.define(
    BATTLE_ROOM,
    class extends BattleRoom {
      protected override uploads = uploads;
      protected override voice = voice;
      protected override snapshots = snapshots;
      protected override accounts = accounts;
      protected override onlineHub = presence;
    },
  );
  server.define(
    PRESENCE_ROOM,
    class extends PresenceRoom {
      protected override accounts = accounts;
      protected override onlineHub = presence;
    },
  );
  return server;
}

/** Entrega o site compilado; qualquer outra rota (ex.: /K7QF2, um convite) recebe o index.html. */
function serveWebApp(app: express.Application, webDist: string) {
  app.use(
    express.static(webDist, {
      index: false,
      setHeaders(res, path) {
        // O Vite põe um hash no nome de tudo em assets/: o conteúdo nunca muda, cache eterno.
        if (path.includes(`${sep}assets${sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  // /api, /auth e /matchmake (Colyseus) ficam de fora: lá rota inexistente deve dar 404 de verdade.
  app.get(/^\/(?!api\/|auth\/|matchmake\/).*/, (_req, res) => {
    // Sempre a versão mais nova: é ele que aponta para os arquivos com hash do deploy atual.
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(webDist, 'index.html'));
  });
}
