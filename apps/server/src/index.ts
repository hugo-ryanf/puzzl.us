import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from './app';
import { createAccountStore } from './auth/accounts';
import { createGoogleAuth, googleConfigFromEnv } from './auth/google';
import type { AuthOptions } from './auth/routes';
import { createLibraryStore } from './library/library';
import { createSavedGameStore } from './rooms/savedGames';
import { connectDatabase } from './db/database';
import { createGameStore, type GameStore } from './db/gameStore';
import {
  createSnapshotStore,
  scheduleSnapshotCleanup,
  type SnapshotStore,
} from './rooms/snapshots';
import { scheduleUploadCleanup } from './uploads/cleanup';
import { createUploadStore, type UploadStore } from './uploads/uploadStore';
import { createVoiceTokenIssuer, voiceConfigFromEnv } from './voice';

const PORT = Number(process.env.PORT ?? 2567);
// Funciona tanto em src/index.ts (dev) quanto em dist/index.js (build): ambos a um nível de drizzle/.
const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
/** Site compilado (pnpm --filter @puzzle/web build). Existindo, este servidor também o entrega. */
const WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

const databaseUrl = process.env.DATABASE_URL;
let store: GameStore | undefined;
let uploads: UploadStore | undefined;
let snapshots: SnapshotStore | undefined;
let auth: AuthOptions | undefined;
/** URL pública do site: para onde o login com Google devolve o navegador. */
const publicUrl = (process.env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
const SESSION_CLEANUP_MS = 24 * 60 * 60 * 1000;
if (databaseUrl) {
  const db = await connectDatabase(databaseUrl, MIGRATIONS);
  store = createGameStore(db);
  uploads = createUploadStore(db);
  scheduleUploadCleanup(uploads);
  snapshots = createSnapshotStore(db);
  scheduleSnapshotCleanup(snapshots);
  const accounts = createAccountStore(db);
  setInterval(() => void accounts.deleteExpiredSessions(), SESSION_CLEANUP_MS).unref();
  const googleConfig = googleConfigFromEnv();
  auth = {
    accounts,
    google: googleConfig && createGoogleAuth(googleConfig),
    publicUrl,
    adminEmails: (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    secureCookies: publicUrl.startsWith('https://'),
    library: createLibraryStore(db),
    savedGames: createSavedGameStore(db),
  };
  console.log('[server] banco conectado, migrações em dia');
  if (auth.google) console.log(`[server] login com Google ligado (volta para ${publicUrl})`);
  else console.warn('[server] GOOGLE_CLIENT_* não definidas: só convidados, sem login');
} else {
  console.warn(
    '[server] DATABASE_URL não definida: o jogo funciona, mas sem ranking, sem fotos enviadas e sem salvar as salas',
  );
}

const voiceConfig = voiceConfigFromEnv();
const voice = voiceConfig && createVoiceTokenIssuer(voiceConfig);
if (voice) console.log(`[server] chamada de áudio via ${voiceConfig.url}`);
else console.warn('[server] LIVEKIT_* não definidas: o jogo funciona, mas sem chamada de áudio');

const webDist = existsSync(join(WEB_DIST, 'index.html')) ? WEB_DIST : undefined;
if (webDist) console.log(`[server] entregando o site de ${webDist}`);

await createGameServer({
  store,
  uploads,
  voice,
  snapshots,
  auth,
  webDist,
  trustProxy: process.env.TRUST_PROXY === '1',
}).listen(PORT);
console.log(`[server] ouvindo em http://localhost:${PORT}`);
