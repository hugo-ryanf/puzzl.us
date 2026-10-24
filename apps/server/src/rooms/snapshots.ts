import { and, eq, gt, lt } from 'drizzle-orm';
import type { GroupInput } from '@puzzle/shared';
import type { AppDatabase } from '../db/database';
import { roomSnapshots } from '../db/schema';

/** Mude ao alterar o formato: snapshots de outra versão são ignorados (a sala não volta). */
export const SNAPSHOT_VERSION = 1;
/** Snapshot sem atualização há mais que isso não é restaurado e acaba apagado. */
export const SNAPSHOT_TTL_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;
const CLEANUP_EVERY_MS = 6 * HOUR_MS;

/** Tudo que a sala precisa para continuar de onde parou. Partida terminada não tem snapshot. */
export interface RoomSnapshot {
  version: typeof SNAPSHOT_VERSION;
  config: {
    imageId: string;
    seed: string;
    rows: number;
    cols: number;
    width: number;
    height: number;
    pieceCount: number;
    maxPlayers: number;
  };
  phase: 'lobby' | 'playing';
  /** Início real da partida (ms desde 1970), que vai para o ranking; 0 ainda no lobby. */
  startedAt: number;
  /** Tempo de jogo até o snapshot. O tempo com o servidor fora do ar não conta. */
  elapsedMs: number;
  /**
   * Por guestId (o sessionId muda ao voltar): quem reentrar recupera cor e encaixes. A mesma
   * pessoa em duas abas vira uma entrada só.
   */
  players: Array<{ guestId: string; name: string; color: string; snaps: number }>;
  /** Snapshots de antes da rotação não têm `rotation`: as peças voltam de pé. */
  groups: GroupInput[];
  /** Conta de quem criou a sala (o único que pode salvar e retomar). Sem conta, ausente. */
  ownerUserId?: string;
  /** A partida salva de onde a sala veio (retomada): ao terminar ou salvar de novo, é ela. */
  savedId?: string;
}

export interface SnapshotStore {
  /** Grava (ou substitui) o snapshot da sala. */
  save(roomCode: string, snapshot: RoomSnapshot): Promise<void>;
  /** O snapshot, se existir, estiver dentro do prazo e no formato atual. */
  load(roomCode: string): Promise<RoomSnapshot | undefined>;
  /** Se o código está guardado por um snapshot (uma sala nova não pode reaproveitá-lo). */
  has(roomCode: string): Promise<boolean>;
  delete(roomCode: string): Promise<void>;
  /** Apaga snapshots sem atualização desde `before`; devolve quantos foram apagados. */
  deleteStaleSince(before: Date): Promise<number>;
}

export function createSnapshotStore(db: AppDatabase): SnapshotStore {
  const fresh = (roomCode: string) =>
    and(
      eq(roomSnapshots.roomCode, roomCode),
      gt(roomSnapshots.updatedAt, new Date(Date.now() - SNAPSHOT_TTL_HOURS * HOUR_MS)),
    );

  return {
    async save(roomCode, snapshot) {
      const updatedAt = new Date();
      await db
        .insert(roomSnapshots)
        .values({ roomCode, data: snapshot, updatedAt })
        .onConflictDoUpdate({ target: roomSnapshots.roomCode, set: { data: snapshot, updatedAt } });
    },

    async load(roomCode) {
      const [row] = await db
        .select({ data: roomSnapshots.data })
        .from(roomSnapshots)
        .where(fresh(roomCode));
      const snapshot = row?.data as RoomSnapshot | undefined;
      return snapshot?.version === SNAPSHOT_VERSION ? snapshot : undefined;
    },

    async has(roomCode) {
      const [row] = await db
        .select({ roomCode: roomSnapshots.roomCode })
        .from(roomSnapshots)
        .where(fresh(roomCode));
      return row !== undefined;
    },

    async delete(roomCode) {
      await db.delete(roomSnapshots).where(eq(roomSnapshots.roomCode, roomCode));
    },

    async deleteStaleSince(before) {
      const deleted = await db
        .delete(roomSnapshots)
        .where(lt(roomSnapshots.updatedAt, before))
        .returning({ roomCode: roomSnapshots.roomCode });
      return deleted.length;
    },
  };
}

/** Apaga snapshots esquecidos (sala que ninguém reabriu): agora e depois a cada 6 horas. */
export function scheduleSnapshotCleanup(snapshots: SnapshotStore): void {
  const run = async () => {
    try {
      const deleted = await snapshots.deleteStaleSince(
        new Date(Date.now() - SNAPSHOT_TTL_HOURS * HOUR_MS),
      );
      if (deleted > 0)
        console.log(`[server] ${deleted} snapshot(s) de sala expirado(s) apagado(s)`);
    } catch (error) {
      console.error('[server] falha ao limpar snapshots de sala expirados', error);
    }
  };
  void run();
  // unref(): o timer sozinho não segura o processo aberto (ex.: ao encerrar o servidor).
  setInterval(() => void run(), CLEANUP_EVERY_MS).unref();
}
