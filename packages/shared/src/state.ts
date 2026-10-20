import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * Estado sincronizado da sala. O servidor altera estes objetos e o Colyseus envia só os
 * deltas (binário) ~20×/s. O cliente usa as mesmas classes para decodificar com tipos.
 */

/** Tudo que o cliente precisa para gerar o mesmo puzzle localmente com generatePuzzle(). */
export const PuzzleConfigSchema = schema(
  {
    /** Imagem do catálogo: o cliente carrega /catalog/<imageId>.webp. */
    imageId: t.string(),
    seed: t.string(),
    rows: t.uint16(),
    cols: t.uint16(),
    width: t.uint16(),
    height: t.uint16(),
    /** Tamanho escolhido na criação (categoria do ranking); rows × cols chega perto dele. */
    pieceCount: t.uint16(),
  },
  'PuzzleConfigSchema',
);
export type PuzzleConfigSchema = SchemaType<typeof PuzzleConfigSchema>;

export const PlayerSchema = schema(
  {
    name: t.string(),
    color: t.string(),
    /** false enquanto o jogador caiu e o servidor espera ele reconectar. */
    connected: t.boolean().default(true),
  },
  'PlayerSchema',
);
export type PlayerSchema = SchemaType<typeof PlayerSchema>;

/** Deslocamento do grupo (mesmo significado do GroupState do engine) + quem está segurando. */
export const GroupSchema = schema(
  {
    x: t.float32(),
    y: t.float32(),
    /** sessionId de quem está arrastando; "" quando livre. */
    heldBy: t.string().default(''),
  },
  'GroupSchema',
);
export type GroupSchema = SchemaType<typeof GroupSchema>;

export const RoomState = schema(
  {
    config: PuzzleConfigSchema,
    /** GamePhase: 'lobby' | 'playing' | 'completed'. */
    phase: t.string().default('lobby'),
    /** sessionId de quem pode clicar em "Começar" (o primeiro a entrar; passa adiante se sair). */
    hostId: t.string().default(''),
    /** Tempo de jogo, atualizado pelo servidor a cada segundo; o cliente interpola entre updates. */
    elapsedMs: t.uint32().default(0),
    /** Tempo final, medido no servidor quando a última peça encaixa. */
    durationMs: t.uint32().default(0),
    /** RankStatus: '' | 'saving' | 'saved' | 'unavailable'. */
    rankStatus: t.string().default(''),
    /** Posição no ranking da categoria (válida quando rankStatus === 'saved'). */
    rank: t.uint16().default(0),
    /** Tamanho da equipe no momento do fim (categoria do ranking, mesmo se alguém sair depois). */
    teamSize: t.uint8().default(0),
    /** Chave: sessionId. */
    players: t.map(PlayerSchema),
    /** Chave: id do grupo (em string, exigência do MapSchema). */
    groups: t.map(GroupSchema),
    /** pieceGroup[pieceId] = id do grupo da peça. */
    pieceGroup: t.array('uint16'),
  },
  'RoomState',
);
export type RoomState = SchemaType<typeof RoomState>;
