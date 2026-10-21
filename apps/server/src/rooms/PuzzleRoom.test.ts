import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { TokenVerifier } from 'livekit-server-sdk';
import sharp from 'sharp';
import {
  CATALOG,
  ROOM_NAME,
  type GrabMessage,
  type RankingEntry,
  type RoomState,
  type UploadResponse,
} from '@puzzle/shared';
import { createGameServer } from '../app';
import type { AppDatabase } from '../db/database';
import { createGameStore } from '../db/gameStore';
import { clearDatabase, createMemoryDatabase } from '../db/memoryDatabase';
import { createUploadStore } from '../uploads/uploadStore';
import { createVoiceTokenIssuer, voiceRoomName } from '../voice';
import type { PuzzleRoom } from './PuzzleRoom';

let colyseus: ColyseusTestServer;
let db: AppDatabase;

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
  colyseus = await boot(createGameServer({ store, uploads, voice }), 2568);
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
    type: 'start' | 'grab' | 'move' | 'drop' | 'scatter',
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
  });

  it('o tempo gravado aparece na API de ranking da categoria', async () => {
    const game = await setup();
    await solve(game);
    await waitForRankStatus(game.room, game.state);

    const { data } = await colyseus.http.get<RankingEntry[]>(
      `/api/ranking?image=${IMAGE.id}&pieces=24&players=2`,
    );
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ position: 1, players: ['Ana', 'Bia'] });
    expect(data[0]!.durationMs).toBe(game.state.durationMs);
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

  async function uploadPhoto(width = 1600, height = 1200) {
    const body = await sharp({ create: { width, height, channels: 3, background: '#a64' } })
      .jpeg()
      .toBuffer();
    return fetch(`${API}/uploads`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'image/jpeg' },
    });
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
    expect(state.phase).toBe('completed');
    expect(state.rankStatus).toBe('unranked');
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
