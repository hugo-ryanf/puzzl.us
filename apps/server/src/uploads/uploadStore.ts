import { randomBytes } from 'node:crypto';
import { and, eq, lt, notExists, sql } from 'drizzle-orm';
import { UPLOAD_PREFIX } from '@puzzle/shared';
import type { AppDatabase } from '../db/database';
import { savedGames, uploads } from '../db/schema';
import type { ProcessedUpload } from './processUpload';

/** Fotos sem uso por mais que isso são apagadas. */
export const UPLOAD_TTL_DAYS = 7;

export interface UploadStore {
  /**
   * Guarda a foto já processada e devolve o id (aleatório, 22 caracteres). Com a conta de quem
   * enviou, ela pode publicar a foto depois.
   */
  save(upload: ProcessedUpload, ownerUserId?: string): Promise<string>;
  /** Só largura/altura (sem carregar os bytes): é o que a sala precisa para montar a grade. */
  size(id: string): Promise<{ width: number; height: number } | undefined>;
  data(id: string): Promise<Buffer | undefined>;
  /** Marca que uma sala acabou de usar a foto (adia a expiração). */
  touch(id: string): Promise<void>;
  /**
   * Apaga fotos sem uso desde `before`, publicadas na comunidade ou não (a publicação vai junto);
   * devolve quantas foram apagadas.
   */
  deleteUnusedSince(before: Date): Promise<number>;
}

export function createUploadStore(db: AppDatabase): UploadStore {
  return {
    async save({ data, width, height }, ownerUserId) {
      // 16 bytes aleatórios = 128 bits: impossível de adivinhar ou enumerar.
      const id = randomBytes(16).toString('base64url');
      await db.insert(uploads).values({ id, data, width, height, ownerUserId });
      return id;
    },

    async size(id) {
      const [row] = await db
        .select({ width: uploads.width, height: uploads.height })
        .from(uploads)
        .where(eq(uploads.id, id));
      return row;
    },

    async data(id) {
      const [row] = await db.select({ data: uploads.data }).from(uploads).where(eq(uploads.id, id));
      return row?.data;
    },

    async touch(id) {
      await db.update(uploads).set({ lastUsedAt: new Date() }).where(eq(uploads.id, id));
    },

    async deleteUnusedSince(before) {
      const deleted = await db
        .delete(uploads)
        .where(
          and(
            lt(uploads.lastUsedAt, before),
            // Foto de partida salva fica, por mais tempo que a pessoa demore para voltar.
            notExists(
              db
                .select({ id: savedGames.id })
                .from(savedGames)
                .where(eq(savedGames.imageId, sql`${UPLOAD_PREFIX} || ${uploads.id}`)),
            ),
          ),
        )
        .returning({ id: uploads.id });
      return deleted.length;
    },
  };
}
