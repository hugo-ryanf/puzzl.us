import { and, count, desc, eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import {
  COMMUNITY_HIDE_REPORTS,
  UPLOAD_PREFIX,
  uploadIdOf,
  type CommunityPuzzle,
  type PublishPuzzleRequest,
} from '@puzzle/shared';
import type { AppDatabase } from '../db/database';
import { communityPuzzles, puzzleReports, uploads } from '../db/schema';

/** Lado maior da miniatura do card (o catálogo usa o mesmo tamanho). */
const MINI_SIDE = 480;

/** Quem pede: muda o que a lista mostra (ocultas para o admin, "minha", "já denunciei"). */
export interface Viewer {
  id: string;
  isAdmin: boolean;
}

export type PublishResult =
  | { ok: true; puzzle: CommunityPuzzle }
  | { ok: false; reason: 'not-found' | 'not-owner' | 'already-published' };

export interface CommunityStore {
  /** Publica uma foto enviada; só a conta que enviou pode, e cada foto uma vez só. */
  publish(viewer: Viewer, request: PublishPuzzleRequest): Promise<PublishResult>;
  /** Publicadas, da mais nova para a mais antiga; o admin vê também as ocultas. */
  list(viewer?: Viewer): Promise<CommunityPuzzle[]>;
  /** Se a partida com esta foto entra no ranking. */
  isPublished(uploadId: string): Promise<boolean>;
  /** Miniatura do card (WebP), se não foi removida. */
  mini(id: string): Promise<Buffer | undefined>;
  /** Uma denúncia por conta; COMMUNITY_HIDE_REPORTS delas tiram a foto do ar. */
  report(id: string, viewer: Viewer): Promise<'not-found' | 'own' | 'reported' | 'hidden'>;
  /** Autor ou admin tiram a foto do Explorar (as partidas já feitas continuam no histórico). */
  remove(id: string, viewer: Viewer): Promise<'not-found' | 'forbidden' | 'removed'>;
  /** Admin: a foto oculta volta ao ar e as denúncias são descartadas. */
  restore(id: string): Promise<boolean>;
}

export function createCommunityStore(db: AppDatabase): CommunityStore {
  const select = {
    id: communityPuzzles.id,
    uploadId: communityPuzzles.uploadId,
    title: communityPuzzles.title,
    authorUserId: communityPuzzles.authorUserId,
    authorName: communityPuzzles.authorName,
    status: communityPuzzles.status,
    createdAt: communityPuzzles.createdAt,
    width: uploads.width,
    height: uploads.height,
  };
  type Row = {
    [K in keyof typeof select]: (typeof select)[K]['_']['data'];
  };

  const view = (row: Row, viewer: Viewer | undefined, reports = 0, reported = false) =>
    ({
      id: row.id,
      imageId: `${UPLOAD_PREFIX}${row.uploadId}`,
      title: row.title,
      authorName: row.authorName,
      width: row.width,
      height: row.height,
      createdAt: row.createdAt.toISOString(),
      status: row.status === 'hidden' ? 'hidden' : 'published',
      reports: viewer?.isAdmin ? reports : 0,
      mine: row.authorUserId === viewer?.id,
      reported,
    }) satisfies CommunityPuzzle;

  const find = async (id: string) =>
    (await db.select().from(communityPuzzles).where(eq(communityPuzzles.id, id)))[0];

  return {
    async publish(viewer, { imageId, title, authorName }) {
      const uploadId = uploadIdOf(imageId)!;
      const [upload] = await db
        .select({ ownerUserId: uploads.ownerUserId, data: uploads.data })
        .from(uploads)
        .where(eq(uploads.id, uploadId));
      if (!upload) return { ok: false, reason: 'not-found' };
      if (upload.ownerUserId !== viewer.id) return { ok: false, reason: 'not-owner' };

      const mini = await sharp(upload.data)
        .resize(MINI_SIDE, MINI_SIDE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 75 })
        .toBuffer();
      // Uma vez só, mesmo que tenha sido removida: voltar ao ar é decisão do admin.
      const [created] = await db
        .insert(communityPuzzles)
        .values({ uploadId, title, authorUserId: viewer.id, authorName, mini })
        .onConflictDoNothing()
        .returning({ id: communityPuzzles.id });
      if (!created) return { ok: false, reason: 'already-published' };

      const [row] = await db
        .select(select)
        .from(communityPuzzles)
        .innerJoin(uploads, eq(uploads.id, communityPuzzles.uploadId))
        .where(eq(communityPuzzles.id, created.id));
      return { ok: true, puzzle: view(row!, viewer) };
    },

    async list(viewer) {
      const statuses: Array<'published' | 'hidden'> = viewer?.isAdmin
        ? ['published', 'hidden']
        : ['published'];
      const rows = await db
        .select(select)
        .from(communityPuzzles)
        .innerJoin(uploads, eq(uploads.id, communityPuzzles.uploadId))
        .where(inArray(communityPuzzles.status, statuses))
        .orderBy(desc(communityPuzzles.createdAt));
      if (rows.length === 0) return [];

      const ids = rows.map((row) => row.id);
      const counts = new Map<string, number>();
      if (viewer?.isAdmin) {
        const grouped = await db
          .select({ puzzleId: puzzleReports.puzzleId, reports: count() })
          .from(puzzleReports)
          .where(inArray(puzzleReports.puzzleId, ids))
          .groupBy(puzzleReports.puzzleId);
        for (const { puzzleId, reports } of grouped) counts.set(puzzleId, reports);
      }
      const reported = new Set<string>();
      if (viewer) {
        const mine = await db
          .select({ puzzleId: puzzleReports.puzzleId })
          .from(puzzleReports)
          .where(and(eq(puzzleReports.userId, viewer.id), inArray(puzzleReports.puzzleId, ids)));
        for (const { puzzleId } of mine) reported.add(puzzleId);
      }
      return rows.map((row) => view(row, viewer, counts.get(row.id), reported.has(row.id)));
    },

    async isPublished(uploadId) {
      const [row] = await db
        .select({ status: communityPuzzles.status })
        .from(communityPuzzles)
        .where(eq(communityPuzzles.uploadId, uploadId));
      return row?.status === 'published';
    },

    async mini(id) {
      const [row] = await db
        .select({ mini: communityPuzzles.mini, status: communityPuzzles.status })
        .from(communityPuzzles)
        .where(eq(communityPuzzles.id, id));
      return row && row.status !== 'removed' ? row.mini : undefined;
    },

    async report(id, viewer) {
      const puzzle = await find(id);
      if (!puzzle || puzzle.status === 'removed') return 'not-found';
      if (puzzle.authorUserId === viewer.id) return 'own';
      await db
        .insert(puzzleReports)
        .values({ puzzleId: id, userId: viewer.id })
        .onConflictDoNothing();
      const [{ reports }] = (await db
        .select({ reports: count() })
        .from(puzzleReports)
        .where(eq(puzzleReports.puzzleId, id))) as [{ reports: number }];
      if (puzzle.status === 'published' && reports >= COMMUNITY_HIDE_REPORTS) {
        await db
          .update(communityPuzzles)
          .set({ status: 'hidden' })
          .where(and(eq(communityPuzzles.id, id), eq(communityPuzzles.status, 'published')));
        return 'hidden';
      }
      return puzzle.status === 'hidden' ? 'hidden' : 'reported';
    },

    async remove(id, viewer) {
      const puzzle = await find(id);
      if (!puzzle || puzzle.status === 'removed') return 'not-found';
      if (puzzle.authorUserId !== viewer.id && !viewer.isAdmin) return 'forbidden';
      await db
        .update(communityPuzzles)
        .set({ status: 'removed' })
        .where(eq(communityPuzzles.id, id));
      return 'removed';
    },

    async restore(id) {
      const restored = await db
        .update(communityPuzzles)
        .set({ status: 'published' })
        .where(and(eq(communityPuzzles.id, id), eq(communityPuzzles.status, 'hidden')))
        .returning({ id: communityPuzzles.id });
      if (restored.length === 0) return false;
      await db.delete(puzzleReports).where(eq(puzzleReports.puzzleId, id));
      return true;
    },
  };
}
