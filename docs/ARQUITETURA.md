# Arquitetura — Quebra-cabeça colaborativo online

## Contexto

Projeto pessoal/portfólio: jogo de quebra-cabeça no browser em que 2–4+ amigos entram numa
sala, montam o mesmo quebra-cabeça **simultaneamente** (cada um pega peças, vê o cursor e o
que o outro está montando), conversam por **áudio**, escolhem o **tamanho** (nº de peças),
têm o **tempo cronometrado** e um **ranking** por puzzle/equipe. Futuro: **upload de foto**
própria virando quebra-cabeça.

Decisões já tomadas: TypeScript ponta a ponta · só web desktop · tiers gratuitos · salas de 2–4+.
A pasta `quebra-cabeça/` está vazia → projeto do zero. Deve ter **repo git próprio**
(`git init` dentro dela; o `.git` da pasta-pai engloba tudo). Commits ficam com o Hugo.

---

## Visão geral

```
                ┌──────────────────────── Browser (React + PixiJS) ───────────────────────┐
                │  Lobby/Ranking (React)   Tabuleiro (PixiJS/WebGL)   Áudio (LiveKit SDK)  │
                └───────┬──────────────────────────┬───────────────────────────┬──────────┘
                   HTTPS│REST                   WSS│(Colyseus)              WebRTC│
                ┌───────▼──────────────────────────▼──────────┐        ┌──────▼────────┐
                │        apps/server (Node + Colyseus)         │ token  │ LiveKit Cloud │
                │  Express REST  │  PuzzleRoom (estado autorit.)│───────▶│   (SFU free)  │
                └───────┬─────────────────────┬────────────────┘        └───────────────┘
                        │ Drizzle             │ presigned URL
                 ┌──────▼──────┐       ┌──────▼──────────┐
                 │ Postgres    │       │ Storage imagens │
                 │ (Neon free) │       │ (Cloudflare R2) │
                 └─────────────┘       └─────────────────┘
```

**Princípio central:** o servidor é **autoritativo** sobre o estado do puzzle (posições,
grupos, quem está segurando o quê, tempo). O cliente faz _predição local_ (a peça segue o
mouse sem esperar o servidor) e o servidor confirma/corrige.

---

## Stack

| Camada              | Escolha                                                            | Por quê                                                                             |
| ------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Monorepo            | **pnpm workspaces**                                                | compartilhar tipos e a geometria do puzzle entre front e server                     |
| Front               | **Vite + React + TS**                                              | lobby, ranking, UI; simples e rápido                                                |
| Render do tabuleiro | **PixiJS v8** (WebGL)                                              | aguenta 500–1000 peças com máscara de imagem a 60 fps; DOM/SVG engasga              |
| Tempo real          | **Colyseus** (Node)                                                | salas, sync de estado por _schema_ (delta binário), reconexão e matchmaking prontos |
| REST                | Express (mesmo processo do Colyseus)                               | criar sala, ranking, upload, token de áudio                                         |
| Áudio               | **LiveKit Cloud** (free) + `livekit-client`                        | SFU gerenciado, resolve NAT/TURN; P2P puro exigiria TURN próprio                    |
| Banco               | **Postgres (Neon free)** + **Drizzle ORM**                         | relacional serve bem pro ranking; Drizzle é TS-first                                |
| Imagens             | **Cloudflare R2** (S3-compat, 10 GB free) + `sharp`                | upload por URL pré-assinada; redimensiona/limpa EXIF                                |
| Auth (MVP)          | **convidado**: apelido + `guestId` no localStorage                 | zero fricção pra amigos; contas (OAuth Discord/Google) depois                       |
| Validação           | **zod** em `packages/shared`                                       | mesmos schemas validam mensagens no cliente e no servidor                           |
| Deploy              | Front: **Cloudflare Pages/Vercel** · Server: **Render/Koyeb free** | WebSocket precisa de processo long-running (não serve serverless)                   |

> Render free “dorme” após ~15 min (cold start ~30 s) — aceitável pra jogar com amigos.

---

## Estrutura do repositório

```
quebra-cabeça/
├─ apps/
│  ├─ web/                 # Vite + React + PixiJS
│  │  └─ src/
│  │     ├─ pages/         # Home, Lobby, Room, Leaderboard
│  │     ├─ board/         # PixiJS: BoardScene, PieceSprite, camera (pan/zoom), input
│  │     ├─ net/           # cliente Colyseus, throttling, interpolação de cursores
│  │     └─ audio/         # integração LiveKit (join, mute, indicador de fala)
│  └─ server/              # Node + Colyseus + Express
│     └─ src/
│        ├─ rooms/PuzzleRoom.ts   # lógica autoritativa
│        ├─ rooms/schema.ts       # PuzzleState, PieceState, PlayerState
│        ├─ http/                 # rotas REST (rooms, leaderboard, uploads, livekit-token)
│        ├─ db/                   # Drizzle schema + migrations
│        └─ services/             # snap/merge, timer, storage(R2), imagens(sharp)
└─ packages/
   └─ shared/              # tipos, zod schemas das mensagens, constantes,
                           # gerador determinístico do puzzle (seed → bordas/encaixes)
```

---

## Modelo do puzzle (o coração do jogo)

**Geração determinística:** `{ imageId, rows, cols, seed }` → `packages/shared/generatePuzzle()`
produz, para cada peça: posição correta `(cx, cy)`, vizinhos e as 4 bordas
(`plana | macho | fêmea` + parâmetros de curva Bézier derivados do seed). Cliente e servidor
rodam a **mesma função** → o servidor nunca manda formas pela rede, só números.

- Cliente: usa as bordas para desenhar a máscara (`Graphics` Bézier) e recortar a textura.
- Servidor: só precisa de `(cx, cy)` e vizinhos para validar encaixes.

**Tamanhos:** presets por nº aproximado de peças (ex.: 24, 48, 100, 300, 500, 1000); `rows×cols`
calculado pela proporção da imagem.

**Grupos:** peças encaixadas formam um **grupo** (union-find). Arrastar uma peça move o grupo
inteiro. Puzzle completo ⇔ existe 1 grupo com todas as peças.

---

## Estado da sala (Colyseus schema)

```ts
PuzzleState {
  puzzle: { imageUrl, rows, cols, seed }
  status: "lobby" | "playing" | "finished"
  startedAt, finishedAt            // ms, definidos pelo servidor
  groups: Map<groupId, { x, y, heldBy: sessionId | "" }>   // posição do grupo
  pieces: Map<pieceId, { groupId, offsetX, offsetY }>      // posição relativa ao grupo
  players: Map<sessionId, { name, color, isHost }>
}
```

Guardar posição **por grupo** (não por peça) reduz muito o tráfego: arrastar um bloco de
200 peças = 1 atualização.

**Cursores ficam FORA do schema** — são efêmeros e de alta frequência: mensagens
`cursor {x,y}` com throttle ~20 Hz, retransmitidas para os outros, e o cliente **interpola**
para parecer suave.

---

## Protocolo de interação (cliente ↔ servidor)

| Mensagem (cliente→servidor)              | Regra no servidor                                                                                                                                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grab {groupId}`                         | se `heldBy` vazio → `heldBy = eu` (lock); senão ignora. _Primeiro a pegar ganha._                                                                                                                         |
| `move {groupId, x, y}` (throttle ~20 Hz) | aceita só se `heldBy === eu`; atualiza posição                                                                                                                                                            |
| `drop {groupId, x, y}`                   | solta lock; roda **snap**: para cada peça do grupo, checa vizinhos de outros grupos; se a distância entre posição atual e esperada < limiar → alinha e **funde grupos**. Se 1 grupo restante → `finished` |
| `cursor {x, y}`                          | broadcast para os outros (sem persistir)                                                                                                                                                                  |
| `start` (host)                           | `status = playing`, `startedAt = now`                                                                                                                                                                     |

Extras: lock expira se o jogador desconectar (`onLeave` libera `heldBy`); Colyseus
`allowReconnection(30s)` para quedas de rede; cor do jogador pinta a borda da peça que
ele está segurando (é o “ver o que o outro está montando”).

---

## Cronômetro e ranking

- Tempo **sempre medido no servidor** (`finishedAt - startedAt`) → cliente não consegue trapacear.
- Ao terminar, `PuzzleRoom` grava a sessão no Postgres.

**Tabelas (Drizzle):**

- `players` (id, guest_id, nickname, created_at) — depois ganha `auth_provider` p/ contas
- `images` (id, url, width, height, source: `catalog|upload`, owner_id, created_at)
- `puzzles` (id, image_id, rows, cols, piece_count, seed) — mesma imagem+tamanho+seed = mesmo puzzle
- `sessions` (id, puzzle_id, started_at, finished_at, duration_ms, team_size, team_key)
- `session_players` (session_id, player_id)

`team_key` = ids dos jogadores ordenados e concatenados → identifica “a mesma dupla/equipe”.
**Ranking** = `SELECT … WHERE puzzle_id = ? AND team_size = ? ORDER BY duration_ms LIMIT 20`
(categorias por tamanho de equipe para ser justo; opção de mostrar só o melhor tempo por `team_key`).
Ranking só faz sentido para puzzles do **catálogo** (uploads são únicos).

---

## Áudio

1. Cliente pede `POST /api/livekit-token {roomId}` → servidor assina JWT do LiveKit (api key/secret no env) com identidade = jogador.
2. Cliente entra na sala LiveKit de mesmo id, publica microfone; UI com mute e indicador de quem fala.
3. Áudio é totalmente independente do Colyseus — se cair, o jogo continua.

## Upload de foto (fase futura)

1. `POST /api/uploads` → servidor devolve URL pré-assinada do R2 (limite de tamanho/tipo).
2. Cliente envia direto ao R2; depois chama `POST /api/images/:id/process`.
3. Servidor com `sharp`: valida que é imagem, remove EXIF (privacidade/GPS), redimensiona (ex.: máx 2048 px), gera thumbnail.
4. A imagem vira `images.source = upload` e pode ser usada ao criar sala.

## Fluxo de sala

Home → “Criar sala” (escolhe imagem + tamanho) → `POST /api/rooms` cria `PuzzleRoom` e devolve
código curto (ex.: `K7QF`) / link `/{code}` → amigo abre o link, digita apelido, entra →
lobby mostra jogadores + áudio → host clica “Começar” → jogo → tela de vitória com tempo e
posição no ranking.

---

## Roadmap em fases (cada fase = branch de feature, commits atômicos feitos pelo Hugo)

0. **Setup** — `git init`, pnpm workspaces, `apps/web`, `apps/server`, `packages/shared`, TS/ESLint/Prettier, Vitest.
1. **Puzzle single-player local** — `generatePuzzle` (shared, com testes), render PixiJS com máscara, pan/zoom, arrastar, snap, grupos, detecção de fim. _Maior parte da dificuldade está aqui._
2. **Multiplayer** — PuzzleRoom + schema, criar/entrar por código, grab/move/drop com lock, snap autoritativo, cursores interpolados, reconexão.
3. **Tempo + persistência + ranking** — Postgres/Drizzle, gravar sessão, página de ranking.
4. **Áudio** — LiveKit token + UI.
5. **Catálogo e tamanhos** — algumas imagens fixas no R2, presets de peças.
6. **Upload de foto** — fluxo R2 + sharp.
7. **Polimento** — snapshot do estado da sala (sobreviver a restart), contas OAuth, sons, rotação de peças opcional, deploy.

---

## Verificação

- **Unit (Vitest):** `generatePuzzle` determinístico (mesmo seed ⇒ mesma saída; bordas vizinhas complementares macho/fêmea); snap/merge (union-find) e detecção de fim.
- **Integração do servidor:** `@colyseus/testing` — dois clientes simulados: lock (2º `grab` é ignorado), `move` de quem não segura é rejeitado, snap funde grupos, fim grava sessão no banco.
- **Manual end-to-end:** `pnpm dev` → abrir a mesma sala em duas janelas (uma anônima) → conferir cursores, peças sincronizadas, encaixe, cronômetro, entrada no ranking; áudio testado com dois dispositivos.
- **Carga leve:** puzzle de 1000 peças mantendo ~60 fps e tráfego estável com 4 clientes.
