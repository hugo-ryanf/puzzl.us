import { and, desc, eq, inArray } from 'drizzle-orm';
import { MAX_SAVED_GAMES, type SavedGameSummary } from '@puzzle/shared';
import type { AppDatabase } from '../db/database';
import { savedGames } from '../db/schema';
import { SNAPSHOT_VERSION, type RoomSnapshot } from './snapshots';

/** O que vai para a lista "Em andamento" junto com o snapshot. */
export interface SavedProgress {
  pieces: number;
  placed: number;
}

export interface SavedGameStore {
  /**
   * Grava (ou atualiza, se `id` vier de uma partida retomada) e devolve o id. Passando de
   * MAX_SAVED_GAMES, a mais antiga do dono é apagada.
   */
  save(
    ownerUserId: string,
    snapshot: RoomSnapshot,
    progress: SavedProgress,
    id?: string,
  ): Promise<string>;
  /** O snapshot e o dono, se existir e for do formato atual. */
  load(id: string): Promise<{ ownerUserId: string; snapshot: RoomSnapshot } | undefined>;
  list(ownerUserId: string): Promise<SavedGameSummary[]>;
  /** Apaga (só se for do dono, quando ele é informado). */
  delete(id: string, ownerUserId?: string): Promise<void>;
}

export function createSavedGameStore(db: AppDatabase): SavedGameStore {
  return {
    async save(ownerUserId, snapshot, { pieces, placed }, id) {
      const values = {
        ownerUserId,
        imageId: snapshot.config.imageId,
        pieceCount: snapshot.config.pieceCount,
        maxPlayers: snapshot.config.maxPlayers,
        pieces,
        placed,
        elapsedMs: snapshot.elapsedMs,
        data: snapshot,
        updatedAt: new Date(),
      };
      return db.transaction(async (tx) => {
        let savedId = id;
        if (savedId) {
          const updated = await tx
            .update(savedGames)
            .set(values)
            .where(and(eq(savedGames.id, savedId), eq(savedGames.ownerUserId, ownerUserId)))
            .returning({ id: savedGames.id });
          if (updated.length === 0) savedId = undefined; // foi apagada no meio: grava de novo
        }
        if (!savedId) {
          const [created] = await tx
            .insert(savedGames)
            .values(values)
            .returning({ id: savedGames.id });
          savedId = created!.id;
        }
        // Limite por conta: as mais antigas além do limite saem.
        const all = await tx
          .select({ id: savedGames.id })
          .from(savedGames)
          .where(eq(savedGames.ownerUserId, ownerUserId))
          .orderBy(desc(savedGames.updatedAt));
        const excess = all.slice(MAX_SAVED_GAMES).map((row) => row.id);
        if (excess.length > 0) await tx.delete(savedGames).where(inArray(savedGames.id, excess));
        return savedId;
      });
    },

    async load(id) {
      const [row] = await db
        .select({ ownerUserId: savedGames.ownerUserId, data: savedGames.data })
        .from(savedGames)
        .where(eq(savedGames.id, id));
      const snapshot = row?.data as RoomSnapshot | undefined;
      if (!row || snapshot?.version !== SNAPSHOT_VERSION) return undefined;
      return { ownerUserId: row.ownerUserId, snapshot };
    },

    async list(ownerUserId) {
      const rows = await db
        .select()
        .from(savedGames)
        .where(eq(savedGames.ownerUserId, ownerUserId))
        .orderBy(desc(savedGames.updatedAt));
      return rows.map((row) => ({
        id: row.id,
        imageId: row.imageId,
        pieceCount: row.pieceCount,
        maxPlayers: row.maxPlayers,
        pieces: row.pieces,
        placed: row.placed,
        elapsedMs: row.elapsedMs,
        savedAt: row.updatedAt.toISOString(),
      }));
    },

    async delete(id, ownerUserId) {
      await db
        .delete(savedGames)
        .where(
          ownerUserId
            ? and(eq(savedGames.id, id), eq(savedGames.ownerUserId, ownerUserId))
            : eq(savedGames.id, id),
        );
    },
  };
}
