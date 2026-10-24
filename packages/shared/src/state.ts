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
    /**
     * Bullet e Batalha: encaixes seguidos, cada um a menos de COMBO_WINDOW_MS do anterior (1 =
     * sem combo). Sobe a cada encaixe dentro do prazo e volta a 1 no primeiro fora dele.
     */
    combo: t.uint8().default(0),
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
    /** Quartos de volta (0–3) no sentido do relógio; só encaixa com a mesma rotação. */
    rotation: t.uint8().default(0),
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
    /** Batalha por tempo: quantos quebra-cabeças este lado já montou (passa para a mesa seguinte). */
    solved: t.uint16().default(0),
    /**
     * Bullet e batalha por tempo: a peça dourada deste quebra-cabeça (encaixá-la vale bônus);
     * -1 quando não há (ou já foi encaixada).
     */
    golden: t.int16().default(-1),
    /** Rodada relâmpago: quebra-cabeça pequeno que, montado, vale uma ação. */
    lightning: t.boolean().default(false),
    /** Batalha com poderes: energia do lado (0–100), escudo armado e quando volta a poder usar. */
    energy: t.uint8().default(0),
    shield: t.boolean().default(false),
    powerReadyAt: t.uint32().default(0),
    /** Efeitos recebidos, até quando valem (em ms do relógio da partida, como elapsedMs). */
    fogUntil: t.uint32().default(0),
    frozenUntil: t.uint32().default(0),
  },
  'BoardSchema',
);
export type BoardSchema = SchemaType<typeof BoardSchema>;

/** Relâmpago de deslizar: a grade de um lado (tiles[posição] = peça; ver sliding.ts). */
export const SlideSchema = schema(
  {
    tiles: t.array('uint8'),
    /** Casas deslizadas (o cliente toca um som a cada uma). */
    moves: t.uint16().default(0),
  },
  'SlideSchema',
);
export type SlideSchema = SchemaType<typeof SlideSchema>;

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
    /** Pontos que a partida valeu no ranking por pontos (peças × velocidade). */
    points: t.uint32().default(0),
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
    /**
     * Bullet e batalha por tempo: "3, 2, 1" antes de valer. A fase já é 'playing', mas as peças
     * ficam travadas e o relógio só começa quando chega a 0.
     */
    countdown: t.uint8().default(0),
    /** Bullet: tempo ganho em bônus (peça dourada, montar rápido), somado ao tempo escolhido. */
    bonusMs: t.uint32().default(0),
    /** Bullet: a corrida (já gravada) bateu o recorde da equipe na categoria. */
    record: t.boolean().default(false),
    /** Bullet: ajudas "Ímã" guardadas (cada rodada relâmpago montada dá uma). */
    helpers: t.uint8().default(0),
    /** Batalha: poderes ligados nesta sala. */
    powers: t.boolean().default(false),
    /**
     * Relâmpago de deslizar em andamento: a grade de cada lado ('a'/'b' na batalha, 'main' no
     * Bullet). Vazio fora do relâmpago.
     */
    slides: t.map(SlideSchema),
    /** Batalha: segundos que faltam para o relâmpago acabar sem ninguém montar. */
    slideSeconds: t.uint8().default(0),
    /** Batalha: quem montou o relâmpago primeiro ('a'/'b'), 'none' se o prazo acabou; '' antes. */
    slideWinner: t.string().default(''),
    /**
     * Batalha por tempo empatada no fim do tempo: os dois lados recebem mais um quebra-cabeça e
     * quem montar primeiro ganha. Fica true até a revanche (o resultado diz como foi).
     */
    suddenDeath: t.boolean().default(false),
    /** Bullet: quebra-cabeça da vez (sobe a cada um novo). */
    round: t.uint16().default(0),
    /** Bullet: quantos quebra-cabeças a equipe já montou. */
    solved: t.uint16().default(0),
    /** Bullet: peças encaixadas no quebra-cabeça que ficou pela metade quando o tempo acabou. */
    partial: t.uint16().default(0),
    /** Batalha: lado vencedor ('a' | 'b'), 'draw' (empate na batalha por tempo); vazio até o fim. */
    winner: t.string().default(''),
    /** Batalha: o vencedor ganhou porque o outro lado saiu todo. */
    walkover: t.boolean().default(false),
  },
  'RoomState',
);
export type RoomState = SchemaType<typeof RoomState>;
