import { randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { AppDatabase } from '../db/database';
import { uploads } from '../db/schema';
import type { ProcessedUpload } from './processUpload';

/** Fotos sem uso por mais que isso são apagadas. */
export const UPLOAD_TTL_DAYS = 7;

export interface UploadStore {
  /** Guarda a foto já processada e devolve o id (aleatório, 22 caracteres). */
  save(upload: ProcessedUpload): Promise<string>;
  /** Só largura/altura (sem carregar os bytes): é o que a sala precisa para montar a grade. */
  size(id: string): Promise<{ width: number; height: number } | undefined>;
  data(id: string): Promise<Buffer | undefined>;
  /** Marca que uma sala acabou de usar a foto (adia a expiração). */
  touch(id: string): Promise<void>;
  /** Apaga fotos sem uso desde `before`; devolve quantas foram apagadas. */
  deleteUnusedSince(before: Date): Promise<number>;
}

export function createUploadStore(db: AppDatabase): UploadStore {
  return {
    async save({ data, width, height }) {
      // 16 bytes aleatórios = 128 bits: impossível de adivinhar ou enumerar.
      const id = randomBytes(16).toString('base64url');
      await db.insert(uploads).values({ id, data, width, height });
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
        .where(lt(uploads.lastUsedAt, before))
        .returning({ id: uploads.id });
      return deleted.length;
    },
  };
}
