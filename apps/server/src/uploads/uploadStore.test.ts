import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../db/database';
import { clearDatabase, createMemoryDatabase } from '../db/memoryDatabase';
import { uploads as uploadsTable } from '../db/schema';
import { createUploadStore, type UploadStore } from './uploadStore';

const image = { data: Buffer.from([1, 2, 3, 250, 0, 7]), width: 1600, height: 1200 };

let db: AppDatabase;
let uploads: UploadStore;
beforeAll(async () => {
  db = await createMemoryDatabase();
  uploads = createUploadStore(db);
});
beforeEach(() => clearDatabase(db));

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

describe('UploadStore', () => {
  it('guarda e devolve os bytes e o tamanho da foto', async () => {
    const id = await uploads.save(image);
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await uploads.size(id)).toEqual({ width: 1600, height: 1200 });
    expect(await uploads.data(id)).toEqual(image.data);
  });

  it('ids diferentes a cada envio (aleatórios)', async () => {
    expect(await uploads.save(image)).not.toBe(await uploads.save(image));
  });

  it('id desconhecido não devolve nada', async () => {
    expect(await uploads.size('a'.repeat(22))).toBeUndefined();
    expect(await uploads.data('a'.repeat(22))).toBeUndefined();
  });

  it('apaga só as fotos sem uso antes da data de corte', async () => {
    const old = await uploads.save(image);
    const recent = await uploads.save(image);
    await db
      .update(uploadsTable)
      .set({ lastUsedAt: daysAgo(8) })
      .where(eq(uploadsTable.id, old));

    expect(await uploads.deleteUnusedSince(daysAgo(7))).toBe(1);
    expect(await uploads.size(old)).toBeUndefined();
    expect(await uploads.size(recent)).toBeDefined();
  });

  it('usar a foto numa sala adia a expiração', async () => {
    const id = await uploads.save(image);
    await db
      .update(uploadsTable)
      .set({ lastUsedAt: daysAgo(8) })
      .where(eq(uploadsTable.id, id));
    await uploads.touch(id);
    expect(await uploads.deleteUnusedSince(daysAgo(7))).toBe(0);
  });
});
