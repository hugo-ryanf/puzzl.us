import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { ColyseusSDK } from '@colyseus/sdk';
import { TokenVerifier } from 'livekit-server-sdk';
import sharp from 'sharp';
import {
  CATALOG,
  ROOM_NAME,
  type GeneralRankingEntry,
  type GrabMessage,
  type RankingEntry,
  type RankingPage,
  type RoomState,
  type UploadResponse,
} from '@puzzle/shared';
import { createGameServer } from '../app';
import { createAccountStore, type AccountStore } from '../auth/accounts';
import { createCommunityStore } from '../community/community';
import type { AppDatabase } from '../db/database';
import { createGameStore } from '../db/gameStore';
import { clearDatabase, createMemoryDatabase } from '../db/memoryDatabase';
import { createUploadStore } from '../uploads/uploadStore';
import { createVoiceTokenIssuer, voiceRoomName } from '../voice';
import type { PuzzleRoom } from './PuzzleRoom';
import { createSavedGameStore, type SavedGameStore } from './savedGames';
import { createSnapshotStore, type SnapshotStore } from './snapshots';

let colyseus: ColyseusTestServer;
let db: AppDatabase;
let snapshots: SnapshotStore;
let accounts: AccountStore;
let savedGames: SavedGameStore;

const voiceConfig = {
  url: 'wss://teste.livekit.cloud',
  apiKey: 'chave-de-teste',
  apiSecret: 'segredo-de-teste-com-pelo-menos-32-caracteres',
};

beforeAll(async () => {
  db = await createMemoryDatabase();
  const store = createGameStore(db);
  const uploads = createUploadStore(db);
  const voice = createVoiceTokenIssuer(voiceConfig);
  snapshots = createSnapshotStore(db);
  accounts = createAccountStore(db);
  savedGames = createSavedGameStore(db);
  const auth = {
    accounts,
    savedGames,
    publicUrl: 'http://localhost:5173',
    adminEmails: [],
    secureCookies: false,
  };
  const community = createCommunityStore(db);
  colyseus = await boot(
    createGameServer({ store, uploads, voice, snapshots, community, auth }),
    2568,
  );
});
afterAll(() => colyseus.shutdown());
beforeEach(async () => {
  await colyseus.cleanup();
  await clearDatabase(db);
});

const player = (name: string) => ({ name, guestId: randomUUID() });
/** Qualquer imagem do catálogo real serve (a sala valida contra ele). */
const IMAGE = CATALOG[0]!;

/** Sala com Ana (anfitriã) e Bia. Por padrão já começada; `started: false` fica no lobby. */
async function setup({ started = true } = {}) {
  const room = await colyseus.createRoom<PuzzleRoom>(ROOM_NAME, {
    ...player('Ana'),
    pieceCount: 24,
    imageId: IMAGE.id,
  });
  const ana = await colyseus.connectTo(room, player('Ana'));
  const bia = await colyseus.connectTo(room, player('Bia'));
  const state = room.state as RoomState;
  const group = (id: number) => state.groups.get(String(id))!;
  /**
   * Envia e espera o servidor processar a mensagem. O payload é `unknown` de propósito:
   * alguns testes mandam dados inválidos, que o tipo inferido do SDK não deixaria passar.
   */
  const send = async (
    client: typeof ana,
    type: 'start' | 'grab' | 'move' | 'drop' | 'scatter' | 'playAgain',
    payload?: unknown,
  ) => {
    client.send(type, payload as GrabMessage);
    await room.waitForNextMessage();
  };
  if (started) await send(ana, 'start');
  return { room, ana, bia, state, group, send };
}

/** Monta o puzzle inteiro: em ordem de id, a vizinha de cima ou da esquerda já está no bloco. */
async function solve({ ana, state, group, send }: Awaited<ReturnType<typeof setup>>) {
  for (let pieceId = 1; pieceId < state.pieceGroup.length; pieceId++) {
    const groupId = state.pieceGroup[pieceId]!;
    if (groupId === state.pieceGroup[0]) continue;
    const anchor = group(state.pieceGroup[0]!);
    await send(ana, 'grab', { groupId });
    await send(ana, 'drop', { groupId, x: anchor.x, y: anchor.y });
  }
}

/** A gravação no banco é assíncrona: espera alguns patches até o status mudar. */
async function waitForRankStatus(room: PuzzleRoom, state: RoomState) {
  for (let i = 0; i < 50 && state.rankStatus === 'saving'; i++) await room.waitForNextPatch();
}

describe('PuzzleRoom — sala e jogadores', () => {
  it('cria a sala com código curto e uma peça por grupo', async () => {
    const { room, state } = await setup();
    expect(room.roomId).toMatch(/^[A-Z2-9]{5}$/);
    const pieces = state.config.rows * state.config.cols;
    expect(state.groups.size).toBe(pieces);
    expect(state.pieceGroup.length).toBe(pieces);
    expect(state.config.pieceCount).toBe(24);
  });

  it('usa a imagem escolhida do catálogo, no tamanho real dela', async () => {
    const { state } = await setup();
    expect(state.config.imageId).toBe(IMAGE.id);
    expect({ width: state.config.width, height: state.config.height }).toEqual({
      width: IMAGE.width,
      height: IMAGE.height,
    });
  });

  it('recusa criar sala com imagem que não está no catálogo', async () => {
    await expect(
      colyseus.createRoom(ROOM_NAME, { ...player('Ana'), pieceCount: 24, imageId: '../../etc' }),
    ).rejects.toThrow();
  });

  it('dá cores diferentes para cada jogador', async () => {
    const { state } = await setup();
    const [a, b] = [...state.players.values()];
    expect(a!.color).not.toBe(b!.color);
  });

  it('rejeita entrada sem nome ou sem guestId válido', async () => {
    const room = await colyseus.createRoom<PuzzleRoom>(ROOM_NAME, {
      ...player('Ana'),
      pieceCount: 24,
      imageId: IMAGE.id,
    });
    await expect(colyseus.connectTo(room, player('  '))).rejects.toThrow();
    await expect(colyseus.connectTo(room, { name: 'Bia', guestId: 'abc' })).rejects.toThrow();
  });
});

describe('PuzzleRoom — solo, vagas e foto aleatória', () => {
  const create = (options: object) =>
    colyseus.createRoom<PuzzleRoom>(ROOM_NAME, {
      ...player('Ana'),
      pieceCount: 24,
      imageId: IMAGE.id,
      ...options,
    });

  it('solo começa na hora, sem sala de espera, e não aceita um segundo jogador', async () => {
    const room = await create({ maxPlayers: 1 });
    await colyseus.connectTo(room, player('Ana'));
    const state = room.state as RoomState;
    expect(state.config.maxPlayers).toBe(1);
    expect(state.phase).toBe('playing');
    await expect(colyseus.connectTo(room, player('Bia'))).rejects.toThrow();
  });

  it('sala de 3 vagas não aceita o quarto jogador', async () => {
    const room = await create({ maxPlayers: 3 });
    for (const name of ['Ana', 'Bia', 'Caio']) await colyseus.connectTo(room, player(name));
    await expect(colyseus.connectTo(room, player('Duda'))).rejects.toThrow();
    expect((room.state as RoomState).phase).toBe('lobby'); // multiplayer espera o "Começar"
  });

  it('recusa mais de 4 vagas (o máximo é o quarteto)', async () => {
    await expect(create({ maxPlayers: 5 })).rejects.toThrow();
  });

  it('foto aleatória: o servidor sorteia uma do catálogo', async () => {
    const room = await create({ imageId: 'random' });
    const { imageId } = (room.state as RoomState).config;
    expect(CATALOG.some((image) => image.id === imageId)).toBe(true);
  });
});

describe('PuzzleRoom — lobby', () => {
  it('começa no lobby, com o primeiro a entrar como anfitrião', async () => {
    const { ana, state } = await setup({ started: false });
    expect(state.phase).toBe('lobby');
    expect(state.hostId).toBe(ana.sessionId);
  });

  it('ninguém pega peças antes de começar', async () => {
    const { ana, group, send } = await setup({ started: false });
    await send(ana, 'grab', { groupId: 0 });
    expect(group(0).heldBy).toBe('');
  });

  it('só o anfitrião pode começar', async () => {
    const { ana, bia, state, send } = await setup({ started: false });
    await send(bia, 'start');
    expect(state.phase).toBe('lobby');
    await send(ana, 'start');
    expect(state.phase).toBe('playing');
  });

  it('se o anfitrião sair, o próximo herda', async () => {
    const { room, ana, bia, state } = await setup({ started: false });
    await ana.leave();
    await room.waitForNextPatch();
    expect(state.hostId).toBe(bia.sessionId);
  });
});

describe('PuzzleRoom — jogo', () => {
  it('primeiro a pegar ganha: o segundo pedido é ignorado', async () => {
    const { ana, bia, group, send } = await setup();
    await send(ana, 'grab', { groupId: 3 });
    await send(bia, 'grab', { groupId: 3 });
    expect(group(3).heldBy).toBe(ana.sessionId);
  });

  it('ignora movimento de quem não está segurando', async () => {
    const { ana, bia, group, send } = await setup();
    const before = { x: group(3).x, y: group(3).y };
    await send(ana, 'grab', { groupId: 3 });
    await send(bia, 'move', { groupId: 3, x: 9999, y: 9999 });
    expect({ x: group(3).x, y: group(3).y }).toEqual(before);
  });

  // O Colyseus desconecta quem manda payload que não passa no zod: cliente legítimo
  // nunca faz isso. A sala continua normal para os outros.
  it('desconecta quem manda mensagem malformada e a sala segue para os outros', async () => {
    const { room, ana, bia, state, group, send } = await setup();
    await send(ana, 'grab', { groupId: 'abc' });
    await room.waitForNextPatch();

    expect(state.players.get(ana.sessionId)?.connected).toBe(false);
    await send(bia, 'grab', { groupId: 0 });
    expect(group(0).heldBy).toBe(bia.sessionId);
  });

  it('encaixa ao soltar perto da vizinha e funde os grupos', async () => {
    const { ana, bia, state, group, send } = await setup();
    const target = group(0);
    await send(ana, 'grab', { groupId: 1 });
    await send(ana, 'drop', { groupId: 1, x: target.x + 5, y: target.y - 5 });

    expect(state.groups.has('0')).toBe(false);
    expect(state.pieceGroup[0]).toBe(1);
    expect(group(1).heldBy).toBe('');
    // O encaixe conta para quem soltou.
    expect(state.players.get(ana.sessionId)?.snaps).toBe(1);
    expect(state.players.get(bia.sessionId)?.snaps).toBe(0);
  });

  it('não absorve um grupo que outro jogador está segurando', async () => {
    const { ana, bia, state, group, send } = await setup();
    await send(bia, 'grab', { groupId: 0 });
    await send(ana, 'grab', { groupId: 1 });
    await send(ana, 'drop', { groupId: 1, x: group(0).x, y: group(0).y });
    expect(state.groups.has('0')).toBe(true);
  });

  it('repassa o cursor para os outros jogadores', async () => {
    const { ana, bia } = await setup();
    const received = bia.waitForMessage('cursor');
    ana.send('cursor', { x: 10, y: 20 });
    expect(await received).toEqual({ sessionId: ana.sessionId, x: 10, y: 20 });
  });

  it('espalhar move as peças soltas, mas não blocos montados nem peças na mão de alguém', async () => {
    const { ana, bia, state, group, send } = await setup();
    // Bloco 0+1 montado, e a Bia segurando a peça 5.
    await send(ana, 'grab', { groupId: 1 });
    await send(ana, 'drop', { groupId: 1, x: group(0).x, y: group(0).y });
    await send(bia, 'grab', { groupId: 5 });
    const before = new Map([...state.groups.entries()].map(([id, g]) => [id, { x: g.x, y: g.y }]));

    await send(ana, 'scatter');

    const position = (id: string) => ({ x: group(Number(id)).x, y: group(Number(id)).y });
    expect(position('1')).toEqual(before.get('1'));
    expect(position('5')).toEqual(before.get('5'));
    const moved = [...before.keys()].filter((id) => id !== '1' && id !== '5');
    expect(moved.every((id) => position(id).x !== before.get(id)!.x)).toBe(true);
  });

  it('espalhar não funciona no lobby nem duas vezes seguidas', async () => {
    const { ana, group, send } = await setup({ started: false });
    const lobby = { x: group(3).x, y: group(3).y };
    await send(ana, 'scatter');
    expect({ x: group(3).x, y: group(3).y }).toEqual(lobby);

    await send(ana, 'start');
    await send(ana, 'scatter');
    const first = { x: group(3).x, y: group(3).y };
    await send(ana, 'scatter');
    expect({ x: group(3).x, y: group(3).y }).toEqual(first);
  });

  it('solta o grupo quando o jogador sai', async () => {
    const { room, ana, group, send } = await setup();
    await send(ana, 'grab', { groupId: 2 });
    await ana.leave();
    await room.waitForNextPatch();
    expect(group(2).heldBy).toBe('');
  });
});

describe('PuzzleRoom — chamada de áudio', () => {
  it('entrega um token da chamada desta sala, com o sessionId como identidade', async () => {
    const { room, ana } = await setup({ started: false });
    const response = await ana.request('voiceToken');

    expect(response).toMatchObject({ available: true, url: voiceConfig.url });
    if (!response.available) throw new Error('chamada deveria estar disponível');
    const claims = await new TokenVerifier(voiceConfig.apiKey, voiceConfig.apiSecret).verify(
      response.token,
    );
    expect(claims.sub).toBe(ana.sessionId);
    expect(claims.name).toBe('Ana');
    expect(claims.video?.room).toBe(voiceRoomName(room.roomId));
  });
});

describe('PuzzleRoom — fim e ranking', () => {
  it('ao montar tudo: para o relógio, grava no ranking e informa a posição', async () => {
    const game = await setup();
    await solve(game);
    const { room, state } = game;

    expect(state.groups.size).toBe(1);
    expect(state.phase).toBe('completed');
    expect(state.durationMs).toBeGreaterThan(0);
    expect(state.teamSize).toBe(2);
    // A Ana montou tudo sozinha: todos os encaixes (peças − 1) são dela.
    expect(state.players.get(game.ana.sessionId)?.snaps).toBe(state.pieceGroup.length - 1);
    await waitForRankStatus(room, state);
    expect(state.rankStatus).toBe('saved');
    expect(state.rank).toBe(1);
    expect(state.rankToday).toBe(1);
  });

  it('jogar novamente: só o anfitrião, mesa nova na mesma sala, com a mesma foto', async () => {
    const game = await setup();
    await solve(game);
    const { room, state, ana, bia, send } = game;
    await waitForRankStatus(room, state);
    const { seed, round } = { seed: state.config.seed, round: state.round };

    await send(bia, 'playAgain');
    expect(state.phase).toBe('completed');

    ana.send('playAgain');
    for (let i = 0; i < 50 && state.phase !== 'lobby'; i++) await room.waitForNextPatch();
    expect(state.phase).toBe('lobby');
    expect(state.round).toBe(round + 1);
    expect(state.config.imageId).toBe(IMAGE.id);
    expect(state.config.seed).not.toBe(seed);
    expect(state.groups.size).toBe(state.pieceGroup.length); // uma peça por grupo de novo
    expect(state.players.get(ana.sessionId)?.snaps).toBe(0);
    expect([state.rankStatus, state.rank, state.points, state.durationMs]).toEqual(['', 0, 0, 0]);
    expect(state.players.size).toBe(2); // ninguém saiu da sala
    expect(room.locked).toBe(false);

    ana.send('start');
    for (let i = 0; i < 50 && state.phase !== 'playing'; i++) await room.waitForNextPatch();
    expect(state.phase).toBe('playing');
  });

  it('o tempo gravado aparece na API de ranking da categoria', async () => {
    const game = await setup();
    await solve(game);
    await waitForRankStatus(game.room, game.state);

    const { data } = await colyseus.http.get<RankingPage<RankingEntry>>(
      `/api/ranking?image=${IMAGE.id}&pieces=24&players=2`,
    );
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0]).toMatchObject({ position: 1, players: ['Ana', 'Bia'] });
    expect(data.entries[0]!.durationMs).toBe(game.state.durationMs);

    // Acabou de terminar: aparece também no ranking de hoje.
    const today = await colyseus.http.get<RankingPage<RankingEntry>>(
      `/api/ranking?image=${IMAGE.id}&pieces=24&players=2&period=day`,
    );
    expect(today.data.entries).toHaveLength(1);
    expect(today.data.entries[0]).toMatchObject({ change: null, streak: 1 });
  });

  it('a partida soma no ranking geral da modalidade (dupla)', async () => {
    const game = await setup();
    await solve(game);
    await waitForRankStatus(game.room, game.state);
    expect(game.state.points).toBe(24); // sem partidas para comparar: vale as peças

    const { data } = await colyseus.http.get<RankingPage<GeneralRankingEntry>>(
      '/api/ranking/general?players=2&period=week',
    );
    expect(data.total).toBe(1);
    expect(data.entries).toMatchObject([
      {
        position: 1,
        players: ['Ana', 'Bia'],
        points: 24,
        puzzles: 1,
      },
    ]);
    // Período inválido é recusado.
    await expect(
      colyseus.http.get('/api/ranking/general?players=2&period=ano'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('a API rejeita categoria inválida', async () => {
    const url = (query: string) => colyseus.http.get(`/api/ranking?${query}`);
    // Imagem fora do catálogo.
    await expect(url('image=nao-existe&pieces=24&players=2')).rejects.toMatchObject({
      statusCode: 400,
    });
    // Tamanho fora dos presets.
    await expect(url(`image=${IMAGE.id}&pieces=7&players=2`)).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('Fotos enviadas', () => {
  const API = 'http://localhost:2568/api';

  async function uploadPhoto(width = 1600, height = 1200, cookie = '') {
    const body = await sharp({ create: { width, height, channels: 3, background: '#a64' } })
      .jpeg()
      .toBuffer();
    return fetch(`${API}/uploads`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'image/jpeg', cookie },
    });
  }

  /** Monta tudo sozinha (Ana) e espera o servidor decidir sobre o ranking. */
  async function playAlone(imageId: string) {
    const room = await colyseus.createRoom<PuzzleRoom>(ROOM_NAME, {
      ...player('Ana'),
      pieceCount: 24,
      imageId,
    });
    const ana = await colyseus.connectTo(room, player('Ana'));
    const state = room.state as RoomState;
    const send = async (type: 'start' | 'grab' | 'drop', payload?: unknown) => {
      ana.send(type, payload as GrabMessage);
      await room.waitForNextMessage();
    };
    await send('start');
    for (let pieceId = 1; pieceId < state.pieceGroup.length; pieceId++) {
      const groupId = state.pieceGroup[pieceId]!;
      if (groupId === state.pieceGroup[0]) continue;
      const anchor = state.groups.get(String(state.pieceGroup[0]))!;
      await send('grab', { groupId });
      await send('drop', { groupId, x: anchor.x, y: anchor.y });
    }
    await waitForRankStatus(room, state);
    return { room, state };
  }

  it('envia a foto, devolve o id da sala e serve a versão processada', async () => {
    const response = await uploadPhoto();
    expect(response.status).toBe(201);
    const { imageId, width, height } = (await response.json()) as UploadResponse;
    expect(imageId).toMatch(/^upload:[A-Za-z0-9_-]{22}$/);
    expect({ width, height }).toEqual({ width: 1600, height: 1200 });

    const image = await fetch(`${API}/uploads/${imageId.slice('upload:'.length)}`);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/webp');
    expect(image.headers.get('access-control-allow-origin')).toBe('*'); // textura WebGL exige CORS
    expect((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).width).toBe(1600);
  });

  it('responde 400 para o que não é imagem e 404 para foto desconhecida', async () => {
    const garbage = await fetch(`${API}/uploads`, { method: 'POST', body: 'não sou uma foto' });
    expect(garbage.status).toBe(400);
    expect((await garbage.json()) as { error: string }).toHaveProperty('error');
    expect((await fetch(`${API}/uploads/${'x'.repeat(22)}`)).status).toBe(404);
    expect((await fetch(`${API}/uploads/..%2F..%2Fetc`)).status).toBe(404);
  });

  it('responde ao preflight de CORS do navegador', async () => {
    const preflight = await fetch(`${API}/uploads`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('a sala usa a foto enviada no tamanho dela e a partida fica fora do ranking', async () => {
    const { imageId } = (await (await uploadPhoto(1200, 1600)).json()) as UploadResponse;
    const room = await colyseus.createRoom<PuzzleRoom>(ROOM_NAME, {
      ...player('Ana'),
      pieceCount: 24,
      imageId,
    });
    const ana = await colyseus.connectTo(room, player('Ana'));
    const state = room.state as RoomState;
    expect({ w: state.config.width, h: state.config.height }).toEqual({ w: 1200, h: 1600 });

    await ana.leave();

    const played = await playAlone(imageId);
    expect(played.state.phase).toBe('completed');
    expect(played.state.rankStatus).toBe('unranked');
  });

  it('depois de publicada, a foto entra no ranking como as do catálogo', async () => {
    const account = await accounts.signInWithGoogle({ sub: randomUUID(), name: 'Hugo' }, false);
    const { token } = await accounts.createSession(account.id);
    const cookie = `sid=${token}`;
    const { imageId } = (await (await uploadPhoto(1600, 1200, cookie)).json()) as UploadResponse;
    const publish = await fetch(`${API}/puzzles`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId, title: 'Meu quintal', authorName: 'Hugo', rights: true }),
    });
    expect(publish.status).toBe(201);

    const { state } = await playAlone(imageId);
    expect(state.rankStatus).toBe('saved');
    expect(state.rank).toBe(1);
    const ranking = await fetch(`${API}/ranking?image=${imageId}&pieces=24&players=1`);
    expect(
      ((await ranking.json()) as RankingPage<RankingEntry>).entries.map((entry) => entry.players),
    ).toEqual([['Ana']]);
  });

  it('recusa criar sala com foto que não existe (ou expirou)', async () => {
    await expect(
      colyseus.createRoom(ROOM_NAME, {
        ...player('Ana'),
        pieceCount: 24,
        imageId: `upload:${'z'.repeat(22)}`,
      }),
    ).rejects.toThrow();
  });
});

describe('PuzzleRoom — snapshot e reinício do servidor', () => {
  const ana = { name: 'Ana', guestId: randomUUID() };
  const bia = { name: 'Bia', guestId: randomUUID() };

  /** Espera a fila de gravação da sala chegar ao banco. */
  async function waitForSnapshot(code: string, exists: boolean) {
    for (let i = 0; i < 50 && (await snapshots.has(code)) !== exists; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return snapshots.has(code);
  }

  /** Partida em andamento com um encaixe da Ana; depois o servidor "desliga" a sala. */
  async function playThenShutdown() {
    const room = await colyseus.createRoom<PuzzleRoom>(ROOM_NAME, {
      ...ana,
      pieceCount: 24,
      imageId: IMAGE.id,
    });
    const anaClient = await colyseus.connectTo(room, ana);
    await colyseus.connectTo(room, bia);
    const state = room.state as RoomState;
    const send = async (type: 'start' | 'grab' | 'drop', payload?: object) => {
      anaClient.send(type, payload);
      await room.waitForNextMessage();
    };
    await send('start');
    const anchor = state.groups.get('0')!;
    await send('grab', { groupId: 1 });
    await send('drop', { groupId: 1, x: anchor.x, y: anchor.y });

    const before = {
      code: room.roomId,
      config: state.config.toJSON(),
      pieceGroup: [...state.pieceGroup],
      group1: { x: state.groups.get('1')!.x, y: state.groups.get('1')!.y },
      anaColor: state.players.get(anaClient.sessionId)!.color,
    };
    await room.onBeforeShutdown();
    return before;
  }

  const restore = (who: typeof ana, code: string) =>
    colyseus.sdk.joinOrCreate(ROOM_NAME, { ...who, restore: code });

  it('volta com o mesmo código, a mesa como estava e o relógio andando', async () => {
    const before = await playThenShutdown();
    expect(await snapshots.has(before.code)).toBe(true);
    expect(colyseus.getRoomById(before.code)).toBeUndefined();

    const client = await restore(ana, before.code);
    expect(client.roomId).toBe(before.code);
    const room = colyseus.getRoomById<RoomState>(before.code);
    const state = room.state as RoomState;
    expect(state.config.toJSON()).toEqual(before.config);
    expect(state.phase).toBe('playing');
    expect([...state.pieceGroup]).toEqual(before.pieceGroup);
    expect(state.groups.get('1')).toMatchObject(before.group1);
    expect(state.groups.has('0')).toBe(false);

    // Quem volta recupera a cor e os encaixes que tinha.
    const restoredAna = state.players.get(client.sessionId)!;
    expect(restoredAna.color).toBe(before.anaColor);
    expect(restoredAna.snaps).toBe(1);
  });

  it('dois amigos voltando ao mesmo tempo caem na mesma sala', async () => {
    const { code } = await playThenShutdown();
    const [a, b] = await Promise.all([restore(ana, code), restore(bia, code)]);
    expect(a.roomId).toBe(code);
    expect(b.roomId).toBe(code);
    expect((colyseus.getRoomById(code).state as RoomState).players.size).toBe(2);
  });

  it('sem snapshot, a sala simplesmente não existe', async () => {
    await expect(restore(ana, 'ZZZZZ')).rejects.toThrow(/not found/);
  });

  it('partida terminada não deixa snapshot', async () => {
    const game = await setup();
    expect(await waitForSnapshot(game.room.roomId, true)).toBe(true); // salvo ao criar
    await solve(game);
    expect(game.state.phase).toBe('completed');
    expect(await waitForSnapshot(game.room.roomId, false)).toBe(false);
  });

  it('se todo mundo sai, o snapshot é apagado', async () => {
    const { room, ana: anaClient, bia: biaClient } = await setup();
    const code = room.roomId;
    expect(await waitForSnapshot(code, true)).toBe(true);
    await anaClient.leave();
    await biaClient.leave();
    expect(await waitForSnapshot(code, false)).toBe(false);
  });
});

describe('PuzzleRoom — salvar e retomar (Em andamento)', () => {
  /** Conta logada: o cookie da sessão vai no WebSocket, como no navegador. */
  async function login(name: string) {
    const account = await accounts.signInWithGoogle({ sub: randomUUID(), name }, false);
    const { token } = await accounts.createSession(account.id);
    const sdk = new ColyseusSDK('ws://127.0.0.1:2568', { headers: { cookie: `sid=${token}` } });
    return { account, sdk, guest: player(name) };
  }

  /** Espera a gravação (assíncrona) chegar ao banco. */
  async function waitForSaved(userId: string, count: number) {
    for (let i = 0; i < 50 && (await savedGames.list(userId)).length !== count; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return savedGames.list(userId);
  }

  /** Hugo (logado) cria, Bia entra, começam e fazem um encaixe. */
  async function playLoggedIn() {
    const hugo = await login('Hugo');
    const hugoClient = await hugo.sdk.create(ROOM_NAME, {
      ...hugo.guest,
      pieceCount: 24,
      imageId: IMAGE.id,
    });
    const room = colyseus.getRoomById(hugoClient.roomId) as unknown as PuzzleRoom;
    const bia = await colyseus.connectTo(room, player('Bia'));
    const state = room.state as RoomState;
    type Message = 'start' | 'grab' | 'drop' | 'saveAndLeave';
    const send = async (client: typeof bia, type: Message, payload?: object) => {
      client.send(type, payload);
      await room.waitForNextMessage();
    };
    await send(hugoClient, 'start');
    const anchor = state.groups.get('0')!;
    await send(hugoClient, 'grab', { groupId: 1 });
    await send(hugoClient, 'drop', { groupId: 1, x: anchor.x, y: anchor.y });
    return { hugo, hugoClient, bia, room, state, send };
  }

  /** "Salvar e sair" do Hugo; devolve a partida salva. */
  async function saveAndLeave(
    hugo: { account: { id: string } },
    client: Awaited<ReturnType<typeof playLoggedIn>>['hugoClient'],
  ) {
    client.onMessage('saved', () => {});
    const left = new Promise((resolve) => client.onLeave(resolve));
    client.send('saveAndLeave');
    await left;
    const [game] = await savedGames.list(hugo.account.id);
    return game!;
  }

  it('quem cria logado é o dono; só ele salva, e a sala fecha para todos', async () => {
    const { hugo, hugoClient, bia, state, send } = await playLoggedIn();
    expect(state.ownerId).toBe(hugoClient.sessionId);

    await send(bia, 'saveAndLeave'); // Bia não é a dona: ignorado
    expect(await savedGames.list(hugo.account.id)).toHaveLength(0);

    const saved = new Promise((resolve) => bia.onMessage('saved', resolve));
    const biaLeft = new Promise((resolve) => bia.onLeave(resolve));
    const game = await saveAndLeave(hugo, hugoClient);
    await saved;
    await biaLeft;
    expect(game).toMatchObject({ imageId: IMAGE.id, pieceCount: 24, pieces: 24, placed: 2 });
  });

  it('retoma numa sala nova, no lobby, com a mesa e o tempo de antes; só o dono', async () => {
    const { hugo, hugoClient, state } = await playLoggedIn();
    const before = { code: hugoClient.roomId, pieceGroup: [...state.pieceGroup] };
    const game = await saveAndLeave(hugo, hugoClient);
    const resume = (who: { guestId: string; name: string }) => ({ ...who, resume: game.id });

    // Outra conta e convidado não retomam a partida do Hugo.
    const maria = await login('Maria');
    await expect(maria.sdk.create(ROOM_NAME, resume(maria.guest))).rejects.toThrow();
    await expect(colyseus.sdk.create(ROOM_NAME, resume(player('Zé')))).rejects.toThrow();

    const client = await hugo.sdk.create(ROOM_NAME, resume(hugo.guest));
    expect(client.roomId).not.toBe(before.code);
    const room = colyseus.getRoomById(client.roomId);
    const resumed = room.state as RoomState;
    expect(resumed.phase).toBe('lobby');
    expect([...resumed.pieceGroup]).toEqual(before.pieceGroup);
    expect(resumed.elapsedMs).toBe(game.elapsedMs);
    expect(resumed.ownerId).toBe(client.sessionId);
    expect(resumed.players.get(client.sessionId)!.snaps).toBe(1); // os encaixes de antes

    client.send('start');
    await room.waitForNextMessage();
    expect(resumed.phase).toBe('playing');
    expect(resumed.elapsedMs).toBeGreaterThanOrEqual(game.elapsedMs);
  });

  it('ao montar tudo na partida retomada, ela sai do Em andamento', async () => {
    const { hugo, hugoClient } = await playLoggedIn();
    const game = await saveAndLeave(hugo, hugoClient);

    const client = await hugo.sdk.create(ROOM_NAME, { ...hugo.guest, resume: game.id });
    const room = colyseus.getRoomById(client.roomId) as unknown as PuzzleRoom;
    const state = room.state as RoomState;
    const send = async (_who: unknown, type: 'start' | 'grab' | 'drop', payload?: unknown) => {
      client.send(type, payload);
      await room.waitForNextMessage();
    };
    await send(client, 'start');
    const group = (id: number) => state.groups.get(String(id))!;
    await solve({ ana: client, state, group, send } as unknown as Parameters<typeof solve>[0]);
    // A última jogada pode ainda estar na fila do servidor: espera o fim.
    for (let i = 0; i < 50 && state.phase !== 'completed'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(state.phase).toBe('completed');
    expect(await waitForSaved(hugo.account.id, 0)).toHaveLength(0);
  });

  it('se todo mundo sai no meio da partida, ela vai para o Em andamento do dono', async () => {
    const { hugo, hugoClient, bia } = await playLoggedIn();
    await bia.leave();
    await hugoClient.leave();
    expect(await waitForSaved(hugo.account.id, 1)).toHaveLength(1);
  });

  it('o servidor desligando também salva a partida do dono', async () => {
    const { hugo, room } = await playLoggedIn();
    await room.onBeforeShutdown();
    expect(await savedGames.list(hugo.account.id)).toHaveLength(1);
  });

  it('sala criada por convidado não tem dono (não dá para salvar)', async () => {
    const { state, ana, room } = await setup();
    expect(state.ownerId).toBe('');
    ana.send('saveAndLeave');
    await room.waitForNextMessage();
    expect(state.phase).toBe('playing');
  });
});
