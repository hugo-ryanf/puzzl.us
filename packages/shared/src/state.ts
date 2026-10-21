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
    /** Vagas da sala: 1 = solo (sem sala de espera nem chamada); 2–4 = multiplayer. */
    maxPlayers: t.uint8().default(4),
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
    /**
     * Encaixes que este jogador fez (cada grupo absorvido ao soltar conta 1). Somando todos os
     * jogadores dá peças − 1 no fim: é a "contribuição" de cada um no resultado.
     */
    snaps: t.uint16().default(0),
    /** Lado na Batalha ('a' ou 'b'); vazio nos outros modos. */
    team: t.string().default(''),
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

/**
 * Um tabuleiro dos modos novos: o Bullet troca o tabuleiro a cada quebra-cabeça; a Batalha tem
 * um por lado. (O clássico guarda o dele direto na raiz do RoomState.)
 */
export const BoardSchema = schema(
  {
    config: PuzzleConfigSchema,
    /** Chave: id do grupo (em string, exigência do MapSchema). */
    groups: t.map(GroupSchema),
    /** pieceGroup[pieceId] = id do grupo da peça. */
    pieceGroup: t.array('uint16'),
    /** Montado por completo. */
    done: t.boolean().default(false),
    /** Tempo até montar (Batalha), medido no servidor. */
    durationMs: t.uint32().default(0),
  },
  'BoardSchema',
);
export type BoardSchema = SchemaType<typeof BoardSchema>;

export const RoomState = schema(
  {
    /** GameMode: 'classic' | 'bullet' | 'battle'. */
    mode: t.string().default('classic'),
    config: PuzzleConfigSchema,
    /** GamePhase: 'lobby' | 'playing' | 'completed'. */
    phase: t.string().default('lobby'),
    /** sessionId de quem pode clicar em "Começar" (o primeiro a entrar; passa adiante se sair). */
    hostId: t.string().default(''),
    /**
     * sessionId do dono da sala (quem criou, logado) enquanto ele estiver nela: só ele vê
     * "Salvar e sair" e pode retomar depois. "" = sem dono presente (ou criada por convidado).
     */
    ownerId: t.string().default(''),
    /** Tempo de jogo, atualizado pelo servidor a cada segundo; o cliente interpola entre updates. */
    elapsedMs: t.uint32().default(0),
    /** Tempo final, medido no servidor quando a última peça encaixa. */
    durationMs: t.uint32().default(0),
    /** RankStatus: '' | 'saving' | 'saved' | 'unavailable'. */
    rankStatus: t.string().default(''),
    /** Posição no ranking da categoria (válida quando rankStatus === 'saved'). */
    rank: t.uint16().default(0),
    /** Posição só entre as partidas de hoje (horário de Brasília), na mesma categoria. */
    rankToday: t.uint16().default(0),
    /** Tamanho da equipe no momento do fim (categoria do ranking, mesmo se alguém sair depois). */
    teamSize: t.uint8().default(0),
    /** Chave: sessionId. */
    players: t.map(PlayerSchema),
    /** Chave: id do grupo (em string, exigência do MapSchema). */
    groups: t.map(GroupSchema),
    /** pieceGroup[pieceId] = id do grupo da peça. */
    pieceGroup: t.array('uint16'),
    /** Tabuleiros dos modos novos: 'main' no Bullet; 'a' e 'b' na Batalha. */
    boards: t.map(BoardSchema),
    /** Bullet: duração escolhida. */
    timeLimitMs: t.uint32().default(0),
    /** Bullet: tempo que falta, atualizado a cada segundo. */
    remainingMs: t.uint32().default(0),
    /** Bullet: quebra-cabeça da vez (sobe a cada um novo). */
    round: t.uint16().default(0),
    /** Bullet: quantos quebra-cabeças a equipe já montou. */
    solved: t.uint16().default(0),
    /** Bullet: peças encaixadas no quebra-cabeça que ficou pela metade quando o tempo acabou. */
    partial: t.uint16().default(0),
    /** Batalha: lado vencedor ('a' | 'b'); vazio até alguém terminar. */
    winner: t.string().default(''),
    /** Batalha: o vencedor ganhou porque o outro lado saiu todo. */
    walkover: t.boolean().default(false),
  },
  'RoomState',
);
export type RoomState = SchemaType<typeof RoomState>;
