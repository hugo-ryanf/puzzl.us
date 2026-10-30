/**
 * Site de demonstração (vídeo de apresentação, prints): o servidor com um banco Postgres em
 * memória (PGlite, o mesmo dos testes) preenchido com jogadores fictícios, partidas, ranking,
 * Bullet, batalhas e fotos da comunidade feitas com fotos do catálogo. Nada toca no banco real.
 *
 *   pnpm dev:demo      (na raiz: este servidor + o site em http://localhost:5173)
 *
 * Arquivo à parte de propósito: o index.ts (produção) não o importa, então o PGlite não entra no
 * build. Os atalhos de teste (--dev-tools) ficam ligados, como no dev:local.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AVATAR_COLORS,
  AVATAR_PRESETS,
  CATALOG,
  UPLOAD_PREFIX,
  gridForPieceCount,
} from '@puzzle/shared';
import { createGameServer } from '../app';
import { createAccountStore } from '../auth/accounts';
import { createCommunityStore } from '../community/community';
import { createBattleStore } from '../db/battleStore';
import { createBulletStore } from '../db/bulletStore';
import { createGameStore, type TeamMember } from '../db/gameStore';
import { createMemoryDatabase } from '../db/memoryDatabase';
import { createFriendStore } from '../friends/friends';
import { createLibraryStore } from '../library/library';
import { createProfileStore } from '../profile/profile';
import { createSavedGameStore } from '../rooms/savedGames';
import { createSnapshotStore } from '../rooms/snapshots';
import { processUpload } from '../uploads/processUpload';
import { createUploadStore } from '../uploads/uploadStore';
import { createVoiceTokenIssuer, voiceConfigFromEnv } from '../voice';

const PORT = Number(process.env.PORT ?? 2567);
// DEMO_LANG=en: os textos que os jogadores escreveram (títulos, bio) em inglês, para o vídeo em inglês
const EN = process.env.DEMO_LANG === 'en';
const CATALOG_DIR = fileURLToPath(new URL('../../../web/public/catalog/', import.meta.url));
const DAY = 24 * 60 * 60 * 1000;

const db = await createMemoryDatabase();
const accounts = createAccountStore(db);
const store = createGameStore(db);
const uploads = createUploadStore(db);
const community = createCommunityStore(db);
const bullet = createBulletStore(db);
const battles = createBattleStore(db);
const friends = createFriendStore(db);

// ── jogadores fictícios ─────────────────────────────────────────────────────────────────────────
const PEOPLE = [
  ['Ana Souza', 'Ana'],
  ['Bia Lima', 'Bia'],
  ['Caio Rocha', 'Caio'],
  ['Duda Alves', 'Duda'],
  ['Enzo Prado', 'Enzo'],
  ['Lia Torres', 'Lia'],
  ['Theo Nunes', 'Theo'],
  ['Malu Dias', 'Malu'],
  ['Rafa Costa', 'Rafa'],
  ['Gabi Melo', 'Gabi'],
] as const;
const users: Array<{ id: string; nick: string; code: string; guestId: string }> = [];
for (const [i, [full, nick]] of PEOPLE.entries()) {
  const account = await accounts.signInWithGoogle({ sub: `demo-${i}`, name: full }, false);
  // metade com camaleão, metade com as iniciais numa cor
  const preset = i % 2 === 0;
  await accounts.updateProfile(account.id, {
    nickname: nick,
    bio: i === 0 ? (EN ? 'One puzzle a day.' : 'Montando um quebra-cabeça por dia.') : null,
    avatarStyle: preset ? 'preset' : 'initials',
    avatarPreset: preset ? AVATAR_PRESETS[(i / 2) % AVATAR_PRESETS.length]! : null,
    avatarColor: preset ? null : AVATAR_COLORS[i % AVATAR_COLORS.length]!,
  });
  users.push({ id: account.id, nick, code: account.friendCode, guestId: crypto.randomUUID() });
}
const member = (i: number): TeamMember => ({
  guestId: users[i]!.guestId,
  userId: users[i]!.id,
  nickname: users[i]!.nick,
});

// amizades da Ana (o perfil de exemplo)
for (const other of [1, 2, 3, 5]) {
  await friends.add(users[0]!.id, users[other]!.code);
  await friends.accept(users[other]!.id, users[0]!.id);
}

// ── fotos da comunidade: fotos do catálogo publicadas por eles ─────────────────────────────────
// [dono, índice da foto no catálogo, título, título em inglês, autor] — títulos que combinam com cada foto
const COMMUNITY = [
  [1, 8, 'Passeio em Hanói', 'A walk in Hanoi', 'Bia Lima'],
  [2, 15, 'Minha lambreta', 'My scooter', 'Caio Rocha'],
  [3, 1, 'Férias na serra', 'Mountain holiday', 'Duda Alves'],
  [5, 17, 'Rua da minha avó', "Grandma's street", 'Lia Torres'],
  [6, 11, 'Viagem a Roma', 'Trip to Rome', 'Theo Nunes'],
  [0, 3, 'Fim de semana no porto', 'Weekend at the harbor', 'Ana Souza'],
] as const;
for (const [owner, index, titlePt, titleEn, authorName] of COMMUNITY) {
  const title = EN ? titleEn : titlePt;
  const image = CATALOG[index]!;
  const processed = await processUpload(readFileSync(`${CATALOG_DIR}${image.id}.webp`));
  const id = await uploads.save(processed, users[owner]!.id);
  await community.publish(
    { id: users[owner]!.id, isAdmin: false },
    { imageId: `${UPLOAD_PREFIX}${id}`, title, authorName, rights: true },
  );
}

// ── partidas: ranking por tempo e por pontos (hoje, semana, sempre) ─────────────────────────────
const rnd = (() => {
  let s = 12345;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
})();
const now = Date.now();
let room = 0;
async function game(
  players: number[],
  imageIndex: number,
  pieceCount: number,
  daysAgo: number,
  seconds: number,
) {
  const image = CATALOG[imageIndex % CATALOG.length]!;
  const { rows, cols } = gridForPieceCount(pieceCount, image.width / image.height);
  const finishedAt = new Date(now - daysAgo * DAY - rnd() * 3 * 60 * 60 * 1000);
  await store.saveGame({
    roomCode: `DEMO${String(room++).padStart(2, '0')}`.slice(0, 5),
    imageId: image.id,
    pieceCount,
    rows,
    cols,
    seed: `demo${room}`,
    startedAt: new Date(finishedAt.getTime() - seconds * 1000),
    finishedAt,
    durationMs: seconds * 1000,
    players: players.map(member),
  });
}
// cada um joga bastante, em dias seguidos (sequências), com tempos diferentes
const skill = [1.0, 0.82, 1.15, 0.9, 1.3, 0.95, 1.4, 1.1, 1.6, 1.2];
for (let day = 0; day < 9; day++) {
  for (let p = 0; p < users.length; p++) {
    if (rnd() < 0.25 && p > 1) continue;
    for (const pieces of [48, 100, 24]) {
      await game(
        [p],
        day * 3 + p,
        pieces,
        day,
        Math.round(pieces * 9 * skill[p]! * (0.85 + rnd() * 0.3)),
      );
    }
  }
  // em dupla e em equipe
  await game([0, 1], day + 4, 100, day, Math.round(560 * (0.9 + rnd() * 0.2)));
  await game([2, 3], day + 6, 100, day, Math.round(640 * (0.9 + rnd() * 0.2)));
  await game([4, 5, 6], day + 8, 150, day, Math.round(820 * (0.9 + rnd() * 0.2)));
}

// ── Bullet e batalhas ───────────────────────────────────────────────────────────────────────────
for (let p = 0; p < users.length; p++) {
  for (const minutes of [3, 5] as const) {
    const solved = Math.max(1, Math.round((minutes === 3 ? 7 : 11) / skill[p]!));
    const finishedAt = new Date(now - (p % 3) * DAY);
    await bullet.saveRun({
      roomCode: `B${p}${minutes}`,
      minutes,
      pieceCount: 12,
      solved,
      partial: Math.round(rnd() * 8),
      startedAt: new Date(finishedAt.getTime() - minutes * 60 * 1000),
      finishedAt,
      players: [member(p)],
    });
  }
}
for (let k = 0; k < 14; k++) {
  const a = k % 4,
    b = 4 + (k % 5);
  await battles.saveResult({
    roomCode: `X${k}`,
    format: '1v1',
    timed: k % 2 === 0,
    winner: rnd() < 0.62 ? 'a' : 'b',
    walkover: false,
    comeback: k % 5 === 0,
    finishedAt: new Date(now - (k % 6) * DAY),
    teams: { a: [member(a)], b: [member(b)] },
  });
}

// chamada: com LIVEKIT_* (ex.: livekit-server --dev → ws://127.0.0.1:7880, devkey/secret)
const voiceConfig = voiceConfigFromEnv();
createGameServer({
  store,
  uploads,
  voice: voiceConfig && createVoiceTokenIssuer(voiceConfig),
  snapshots: createSnapshotStore(db),
  community,
  bullet,
  battles,
  devTools: true,
  auth: {
    accounts,
    publicUrl: 'http://localhost:5173',
    adminEmails: [],
    secureCookies: false,
    library: createLibraryStore(db),
    savedGames: createSavedGameStore(db),
    friends,
    profiles: createProfileStore(db),
  },
}).listen(PORT);
console.log(
  `[demo] ${users.length} jogadores, ${room} partidas, ${COMMUNITY.length} fotos da comunidade`,
);
console.log(`[demo] perfil de exemplo: ${users[0]!.nick} · código ${users[0]!.code}`);

// DEMO_SESSION_FILE=caminho: já deixa a Ana logada (as gravações do vídeo põem este cookie no
// navegador). É uma sessão do banco em memória: some quando o servidor para.
if (process.env.DEMO_SESSION_FILE) {
  const { token } = await accounts.createSession(users[0]!.id);
  writeFileSync(process.env.DEMO_SESSION_FILE, token);
  console.log(`[demo] sessão da ${users[0]!.nick} em ${process.env.DEMO_SESSION_FILE}`);
}
console.log(`[demo] ouvindo em http://localhost:${PORT} (site: http://localhost:5173)`);
