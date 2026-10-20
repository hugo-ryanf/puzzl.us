import { fileURLToPath } from 'node:url';
import { createGameServer } from './app';
import { connectDatabase } from './db/database';
import { createGameStore, type GameStore } from './db/gameStore';
import { scheduleUploadCleanup } from './uploads/cleanup';
import { createUploadStore, type UploadStore } from './uploads/uploadStore';
import { createVoiceTokenIssuer, voiceConfigFromEnv } from './voice';

const PORT = Number(process.env.PORT ?? 2567);
// Funciona tanto em src/index.ts (dev) quanto em dist/index.js (build): ambos a um nível de drizzle/.
const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

const databaseUrl = process.env.DATABASE_URL;
let store: GameStore | undefined;
let uploads: UploadStore | undefined;
if (databaseUrl) {
  const db = await connectDatabase(databaseUrl, MIGRATIONS);
  store = createGameStore(db);
  uploads = createUploadStore(db);
  scheduleUploadCleanup(uploads);
  console.log('[server] banco conectado, migrações em dia');
} else {
  console.warn(
    '[server] DATABASE_URL não definida: o jogo funciona, mas sem ranking e sem fotos enviadas',
  );
}

const voiceConfig = voiceConfigFromEnv();
const voice = voiceConfig && createVoiceTokenIssuer(voiceConfig);
if (voice) console.log(`[server] chamada de áudio via ${voiceConfig.url}`);
else console.warn('[server] LIVEKIT_* não definidas: o jogo funciona, mas sem chamada de áudio');

await createGameServer({ store, uploads, voice }).listen(PORT);
console.log(`[server] ouvindo em http://localhost:${PORT}`);
