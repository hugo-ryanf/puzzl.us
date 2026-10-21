import express, { type Application, type ErrorRequestHandler } from 'express';
import {
  UPLOAD_ID_PATTERN,
  UPLOAD_LIMITS,
  UPLOAD_PREFIX,
  type UploadResponse,
} from '@puzzle/shared';
import type { AccountStore } from '../auth/accounts';
import { accountFromCookieHeader } from '../auth/routes';
import { processUpload, UploadError } from './processUpload';
import { createRateLimiter } from './rateLimit';
import type { UploadStore } from './uploadStore';

/** Por IP: o bastante para quem joga, pouco para quem quiser encher o banco. */
const UPLOADS_PER_HOUR = 20;
/** A foto de um id nunca muda: o navegador pode guardar por toda a vida útil dela. */
const CACHE_SECONDS = 7 * 24 * 60 * 60;

/**
 * POST /api/uploads  — corpo = o arquivo da imagem (bytes crus) → { imageId, width, height }
 * GET  /api/uploads/:id — a foto processada (WebP)
 * Sem `uploads` (servidor sem banco), respondem 503.
 */
export function registerUploadRoutes(
  app: Application,
  uploads: UploadStore | undefined,
  accounts?: AccountStore,
) {
  const limiter = createRateLimiter({ max: UPLOADS_PER_HOUR, windowMs: 60 * 60 * 1000 });

  app.post(
    '/api/uploads',
    express.raw({ type: () => true, limit: UPLOAD_LIMITS.maxBytes }),
    async (req, res) => {
      if (!uploads) {
        res.status(503).json({ error: 'Envio de fotos indisponível: servidor sem banco.' });
        return;
      }
      if (!limiter.allow(req.ip ?? 'desconhecido')) {
        res.status(429).json({ error: 'Muitas fotos enviadas. Tente de novo mais tarde.' });
        return;
      }
      try {
        const processed = await processUpload(
          Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
        );
        // Logado: a foto fica marcada como dele (só ele pode publicá-la depois).
        const account = await accountFromCookieHeader(accounts, req.headers.cookie);
        const id = await uploads.save(processed, account?.id);
        const body: UploadResponse = {
          imageId: `${UPLOAD_PREFIX}${id}`,
          width: processed.width,
          height: processed.height,
        };
        res.status(201).json(body);
      } catch (error) {
        if (error instanceof UploadError) {
          res.status(400).json({ error: error.message });
          return;
        }
        throw error;
      }
    },
  );

  app.get('/api/uploads/:id', async (req, res) => {
    const { id } = req.params;
    const data = UPLOAD_ID_PATTERN.test(id) && uploads ? await uploads.data(id) : undefined;
    if (!data) {
      res.status(404).json({ error: 'Foto não encontrada (pode ter expirado).' });
      return;
    }
    res.type('image/webp').set('Cache-Control', `public, max-age=${CACHE_SECONDS}, immutable`);
    res.send(data);
  });

  // Arquivo acima do limite: o express.raw lança antes de chegar na rota.
  const tooLarge: ErrorRequestHandler = (error, _req, res, next) => {
    if ((error as { type?: string }).type === 'entity.too.large') {
      res.status(413).json({ error: 'Arquivo grande demais.' });
      return;
    }
    next(error);
  };
  app.use('/api/uploads', tooLarge);
}
