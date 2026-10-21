import express, { type Application, type RequestHandler } from 'express';
import { CommunityPuzzleId, PublishPuzzleRequest, type CommunityPuzzle } from '@puzzle/shared';
import type { AccountStore } from '../auth/accounts';
import { accountFromCookieHeader } from '../auth/routes';
import type { CommunityStore, Viewer } from './community';

/** A miniatura de um id nunca muda; um dia de cache e o card abre na hora. */
const MINI_CACHE_SECONDS = 24 * 60 * 60;

/**
 * GET    /api/puzzles              → publicadas (o admin vê também as ocultas)
 * POST   /api/puzzles              → publica uma foto enviada pela própria conta
 * GET    /api/puzzles/:id/mini     → miniatura do card
 * POST   /api/puzzles/:id/report   → denuncia (logado)
 * DELETE /api/puzzles/:id          → tira do ar (autor ou admin)
 * POST   /api/puzzles/:id/restore  → volta ao ar uma foto oculta (admin)
 * Sem banco, a lista é vazia e o resto responde 503.
 */
export function registerCommunityRoutes(
  app: Application,
  accounts: AccountStore | undefined,
  community: CommunityStore | undefined,
) {
  const router = express.Router();

  const viewerOf = async (cookie: string | undefined): Promise<Viewer | undefined> => {
    const account = await accountFromCookieHeader(accounts, cookie);
    return account ? { id: account.id, isAdmin: account.isAdmin } : undefined;
  };

  router.get('/', async (req, res) => {
    const body: CommunityPuzzle[] = community
      ? await community.list(await viewerOf(req.headers.cookie))
      : [];
    res.setHeader('Cache-Control', 'no-store'); // muda ao publicar, denunciar e remover
    res.json(body);
  });

  router.get('/:id/mini', async (req, res) => {
    const id = CommunityPuzzleId.safeParse(req.params.id);
    const mini = id.success && community ? await community.mini(id.data) : undefined;
    if (!mini) {
      res.status(404).json({ error: 'Quebra-cabeça não encontrado.' });
      return;
    }
    res.type('image/webp').set('Cache-Control', `public, max-age=${MINI_CACHE_SECONDS}`);
    res.send(mini);
  });

  // Daqui para baixo: exige banco e login.
  const signedIn: RequestHandler = async (req, res, next) => {
    if (!community) {
      res.status(503).json({ error: 'Indisponível: servidor sem banco.' });
      return;
    }
    const viewer = await viewerOf(req.headers.cookie);
    if (!viewer) {
      res.status(401).json({ error: 'Entre com sua conta.' });
      return;
    }
    res.locals.viewer = viewer;
    next();
  };
  const withId: RequestHandler = (req, res, next) => {
    const id = CommunityPuzzleId.safeParse(req.params.id);
    if (!id.success) {
      res.status(404).json({ error: 'Quebra-cabeça não encontrado.' });
      return;
    }
    res.locals.id = id.data;
    next();
  };

  router.post('/', signedIn, express.json(), async (req, res) => {
    const request = PublishPuzzleRequest.safeParse(req.body);
    if (!request.success) {
      res.status(400).json({ error: request.error.issues[0]?.message ?? 'Dados inválidos.' });
      return;
    }
    const result = await community!.publish(res.locals.viewer as Viewer, request.data);
    if (result.ok) {
      res.status(201).json(result.puzzle);
      return;
    }
    const errors = {
      'not-found': [404, 'Foto não encontrada (pode ter expirado).'],
      'not-owner': [403, 'Só quem enviou a foto (com a conta) pode publicá-la.'],
      'already-published': [409, 'Esta foto já foi publicada.'],
    } as const;
    const [status, error] = errors[result.reason];
    res.status(status).json({ error });
  });

  router.post('/:id/report', signedIn, withId, async (_req, res) => {
    const result = await community!.report(res.locals.id as string, res.locals.viewer as Viewer);
    if (result === 'not-found') res.status(404).json({ error: 'Quebra-cabeça não encontrado.' });
    else if (result === 'own') res.status(400).json({ error: 'Esta foto é sua.' });
    else res.json({ hidden: result === 'hidden' });
  });

  router.delete('/:id', signedIn, withId, async (_req, res) => {
    const result = await community!.remove(res.locals.id as string, res.locals.viewer as Viewer);
    if (result === 'not-found') res.status(404).json({ error: 'Quebra-cabeça não encontrado.' });
    else if (result === 'forbidden') res.status(403).json({ error: 'Só o autor ou o admin.' });
    else res.sendStatus(204);
  });

  router.post('/:id/restore', signedIn, withId, async (_req, res) => {
    if (!(res.locals.viewer as Viewer).isAdmin) {
      res.status(403).json({ error: 'Só o admin.' });
      return;
    }
    if (await community!.restore(res.locals.id as string)) res.sendStatus(204);
    else res.status(404).json({ error: 'Nada para restaurar.' });
  });

  app.use('/api/puzzles', router);
}
