import { UPLOAD_TTL_DAYS, type UploadStore } from './uploadStore';

const DAY_MS = 24 * 60 * 60 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;

/** Apaga fotos sem uso há mais de UPLOAD_TTL_DAYS: agora e depois a cada 6 horas. */
export function scheduleUploadCleanup(uploads: UploadStore): void {
  const run = async () => {
    try {
      const deleted = await uploads.deleteUnusedSince(
        new Date(Date.now() - UPLOAD_TTL_DAYS * DAY_MS),
      );
      if (deleted > 0) console.log(`[server] ${deleted} foto(s) enviada(s) expirada(s) apagada(s)`);
    } catch (error) {
      console.error('[server] falha ao limpar fotos expiradas', error);
    }
  };
  void run();
  // unref(): o timer sozinho não segura o processo aberto (ex.: ao encerrar o servidor).
  setInterval(() => void run(), EVERY_MS).unref();
}
