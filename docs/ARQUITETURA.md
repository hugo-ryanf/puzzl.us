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

| Camada              | Escolha                                                         | Por quê                                                                              |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Monorepo            | **pnpm workspaces**                                             | compartilhar tipos e a geometria do puzzle entre front e server                      |
| Front               | **Vite + React + TS**                                           | lobby, ranking, UI; simples e rápido                                                 |
| Render do tabuleiro | **PixiJS v8** (WebGL)                                           | aguenta 500–1000 peças com máscara de imagem a 60 fps; DOM/SVG engasga               |
| Tempo real          | **Colyseus** (Node)                                             | salas, sync de estado por _schema_ (delta binário), reconexão e matchmaking prontos  |
| REST                | Express (mesmo processo do Colyseus)                            | criar sala, ranking, upload, token de áudio                                          |
| Áudio               | **LiveKit Cloud** (free) + `livekit-client`                     | SFU gerenciado, resolve NAT/TURN; P2P puro exigiria TURN próprio                     |
| Banco               | **Postgres (Neon free)** + **Drizzle ORM**                      | relacional serve bem pro ranking; Drizzle é TS-first                                 |
| Imagens             | **Cloudflare R2** (S3-compat, 10 GB free) + `sharp`             | upload por URL pré-assinada; redimensiona/limpa EXIF                                 |
| Auth (MVP)          | **convidado**: apelido + `guestId` no localStorage              | zero fricção pra amigos; contas (OAuth Discord/Google) depois                        |
| Validação           | **zod** em `packages/shared`                                    | mesmos schemas validam mensagens no cliente e no servidor                            |
| Deploy              | **Render free**: um serviço Node entrega site + API + WebSocket | WebSocket precisa de processo long-running (não serve serverless); uma URL, sem CORS |

> Render free “dorme” após ~15 min (a primeira visita leva ~1 min) — aceitável pra jogar com
> amigos. A configuração fica em `render.yaml`; os segredos só no painel do Render.

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

Implementado em `packages/shared/src/state.ts` (schema 5, API `schema({...})` sem decorators):

```ts
RoomState {
  config: { seed, rows, cols, width, height, pieceCount }  // o cliente regera o puzzle localmente
  phase: 'lobby' | 'playing' | 'completed'
  hostId: sessionId                     // quem pode clicar "Começar" (herda se sair)
  elapsedMs, durationMs                 // relógio do servidor (ver "Cronômetro e ranking")
  rankStatus, rank, teamSize            // resultado no ranking, preenchido após o fim
  players: Map<sessionId, { name, color, connected }>
  groups: Map<groupId, { x, y, heldBy: sessionId | "" }>  // (x, y) = deslocamento do grupo
  pieceGroup: number[]                                     // pieceGroup[pieceId] = groupId
}
```

O `guestId` de cada jogador fica só no servidor (nunca vai para o estado público).

Guardar posição **por grupo** (não por peça) reduz muito o tráfego: arrastar um bloco de
200 peças = 1 atualização. Dentro de um grupo as peças estão sempre na posição relativa
correta, então o grupo guarda só um deslocamento: posição da peça = posição correta + (x, y).
Um encaixe aparece no cliente como `pieceGroup` mudando e o grupo absorvido sumindo do mapa.

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
| `start` (só o anfitrião, no lobby)       | `phase = playing`, começa o relógio. Antes disso `grab` é ignorado                                                                                                                                        |

Extras (implementados):

- **Validação:** cada mensagem passa por um schema zod (`packages/shared/src/protocol.ts`) via
  `validate()` do Colyseus. Payload inválido = o Colyseus **desconecta** o cliente (cliente
  legítimo nunca faz isso). Limite de 100 mensagens/s por cliente.
- **Encaixe não "rouba":** o snap ignora grupos que outro jogador está segurando.
- **Quedas:** `onDrop` solta o que o jogador segurava e chama `allowReconnection(30s)`; o SDK
  reconecta sozinho, e após um F5 o cliente usa o token salvo no `sessionStorage`.
- **Cliente:** predição local só do grupo que eu arrasto; o resto (incluindo o meu grupo depois
  do drop) desliza até a posição do servidor. A borda da peça segurada ganha a cor de quem
  segura (é o “ver o que o outro está montando”).
- A camada de cursores fica fora do hit test (`eventMode: 'none'`), senão o cursor de um amigo
  em cima de uma peça bloquearia o clique nela.

---

## Cronômetro e ranking

Implementado na fase 3:

- **Relógio:** o tempo é **medido só no servidor** (do "Começar" ao último encaixe), então o
  cliente não consegue trapacear. O servidor publica `elapsedMs` a cada 1 s e o cliente só
  interpola entre atualizações — sem sincronizar relógios, o horário do PC não interfere.
- **Fim:** a sala trava (ninguém novo entra), grava a partida **sem bloquear o jogo** e depois
  preenche `rank`/`rankStatus`. Sem `DATABASE_URL`, o jogo funciona e o ranking fica
  "indisponível".
- **Banco:** Postgres no Neon via Drizzle (`pg`). Migrações geradas com `pnpm db:generate` e
  aplicadas automaticamente quando o servidor sobe. Os testes usam PGlite (Postgres em WASM, em
  memória) com as mesmas migrações.

**Tabelas (`apps/server/src/db/schema.ts`):**

- `players` (id, guest_id único, nickname, created_at) — convidado = um navegador
- `games` (id, room_code, piece_count, rows, cols, seed, team_size, team_key, duration_ms,
  started_at, finished_at) — índice em (piece_count, team_size, duration_ms)
- `game_players` (game_id, player_id, nickname no momento da partida)

**Categoria do ranking = imagem + tamanho escolhido + tamanho da equipe.** Na fase 3 ainda não
havia imagem (cada sala gerava uma por código); a fase 5 acrescentou `games.image_id` — as
partidas antigas ficaram como `'gerada'` (migração `0001`, ajustada à mão para não falhar com
linhas existentes). Como o catálogo é um arquivo versionado e não uma tabela, não foi preciso
criar `images`/`puzzles`: isso volta a fazer sentido no upload de fotos (fase 6).

`team_key` = ids dos jogadores ordenados e unidos → identifica "a mesma equipe" entre partidas.
O ranking (`GET /api/ranking?pieces=100&players=2`) mostra o **melhor tempo de cada equipe**
(`DISTINCT ON team_key`); a posição de uma partida = 1 + equipes _diferentes_ com melhor
tempo menor.

---

## Áudio

Implementado na fase 4 (`apps/server/src/voice.ts`, `apps/web/src/voice/`):

1. O token é pedido **pela conexão do jogo** (`room.request('voiceToken')`), não por uma rota
   REST: só quem está na sala recebe um, e o servidor já sabe quem é. O servidor assina o JWT
   do LiveKit (`LIVEKIT_*` no `.env`) com identidade = `sessionId`, nome = apelido e permissão
   só para a chamada `quebra-cabeca-<código>`: falar e ouvir, sem canal de dados.
2. O cliente entra por clique (navegadores só liberam microfone/som após um gesto), publica o
   microfone com cancelamento de eco e supressão de ruído. Como identidade = `sessionId`, a
   lista de jogadores mostra 🎤/🔇 e um anel na cor do jogador enquanto ele fala, sem
   mapeamento extra.
3. Microfone negado não derruba a chamada (a pessoa fica só ouvindo). O SDK do LiveKit
   (~570 kB) só é baixado quando alguém entra na chamada, e só depois de o servidor confirmar
   que há LiveKit configurado.
4. Áudio é totalmente independente do Colyseus — se cair, o jogo continua. Sem `LIVEKIT_*`, o
   jogo funciona e o ícone do microfone aparece cortado.

Depois (polimento antes do deploy): quem entra na sala já entra na chamada (entrar na sala foi
o gesto que o navegador exige); para não falar ou não ouvir, desliga microfone e/ou som. Há
câmera opcional (começa desligada; 384×216 a 15 fps, sem simulcast, `adaptiveStream`): quem
liga vira um quadro de vídeo na coluna da direita. O token só permite publicar microfone e
câmera (`canPublishSources`), nunca compartilhamento de tela.

## Upload de foto

Implementado na fase 6 (`apps/server/src/uploads/`, `apps/web/src/net/uploads.ts`). Decisão: as
fotos ficam **no próprio Postgres (Neon)** em vez do R2 — o R2 exige cartão de crédito mesmo no
plano grátis, e na escala do projeto (amigos, fotos expirando em 7 dias) os 0,5 GB do Neon bastam.
A interface `UploadStore` isola isso: trocar por R2 depois não muda rotas nem sala.

1. O navegador reduz a foto (≤ 2048 px, JPEG) antes de enviar: 8 MB viram ~600 kB.
2. `POST /api/uploads` (bytes crus, ≤ 15 MB, 20 por hora por IP): o servidor **não confia no
   arquivo** — decodifica com `sharp` com teto de 50 MP (barra "bombas de descompressão"),
   aplica a rotação, recodifica em WebP (descarta EXIF/GPS e qualquer conteúdo embutido) e
   recusa foto pequena (< 400 px) ou panorâmica (> 3:1).
3. Guarda em `uploads` (bytea) com id aleatório de 128 bits; a sala usa `imageId =
"upload:<id>"`. `GET /api/uploads/:id` serve com CORS (o WebGL exige para textura de outra
   origem; o cliente usa `crossOrigin = 'anonymous'`) e cache imutável.
4. Criar sala com a foto renova `last_used_at`; uma limpeza a cada 6 h apaga fotos sem uso há 7
   dias. Partidas com foto própria terminam com `rankStatus = 'unranked'` (fora do ranking).

## Fluxo de sala

Home → “Criar sala” (escolhe tamanho) → `client.create('puzzle')` pelo matchmaker do Colyseus
(não precisou de rota REST) → a sala usa como `roomId` um código de 5 caracteres sem
ambíguos (ex.: `K7QF2`) → link `/{code}` → amigo abre o link, digita apelido,
`client.joinById(code)` → jogo.

**Catálogo (fase 5):** a imagem vem de um catálogo fixo de fotos escolhidas pelo dono do projeto.
`pnpm catalog` (`scripts/build-catalog.ts`, com `sharp`) processa `catalogo/originais/` (fora do
git): aplica a rotação EXIF, **descarta os metadados (GPS)**, gera WebP ≤ 2048 px + miniatura
em `apps/web/public/catalog/` (servido pelo próprio front, sem R2 por enquanto) e escreve
`packages/shared/src/catalog.ts`. O servidor só aceita `imageId` do catálogo (zod) e usa o
tamanho real da foto para montar a grade. Título e crédito (atribuição) aparecem no lobby e no
fim.

Na sala: lobby (anfitrião 👑 clica “Começar”) → jogo com relógio → painel de vitória com tempo
e posição no ranking, câmera enquadrando a imagem montada. _Fase 4:_ áudio no lobby e no jogo.

---

## Roadmap em fases (cada fase = branch de feature, commits atômicos feitos pelo Hugo)

0. **Setup** — `git init`, pnpm workspaces, `apps/web`, `apps/server`, `packages/shared`, TS/ESLint/Prettier, Vitest.
1. **Puzzle single-player local** — `generatePuzzle` (shared, com testes), render PixiJS com máscara, pan/zoom, arrastar, snap, grupos, detecção de fim. _Maior parte da dificuldade está aqui._
2. **Multiplayer** — PuzzleRoom + schema, criar/entrar por código, grab/move/drop com lock, snap autoritativo, cursores interpolados, reconexão.
3. **Tempo + persistência + ranking** — Postgres/Drizzle, gravar sessão, página de ranking.
4. **Áudio** — LiveKit token + UI.
5. **Catálogo e tamanhos** — algumas imagens fixas no R2, presets de peças.
6. **Upload de foto** — fluxo R2 + sharp.
7. **Polimento e deploy** — feito: redesign da sala, câmera, ferramentas da mesa (zoom, centralizar, ver imagem, espalhar), tela de resultado com encaixes por jogador, deploy no Render. Ideias para depois: snapshot do estado da sala (sobreviver a restart), contas OAuth, sons, rotação de peças opcional.

---

## Verificação

- **Unit (Vitest):** `generatePuzzle` determinístico (mesmo seed ⇒ mesma saída; bordas vizinhas complementares macho/fêmea); snap/merge (union-find) e detecção de fim.
- **Integração do servidor:** `@colyseus/testing` — dois clientes simulados: lock (2º `grab` é ignorado), `move` de quem não segura é rejeitado, snap funde grupos, fim grava sessão no banco.
- **Manual end-to-end:** `pnpm dev` → abrir a mesma sala em duas janelas (uma anônima) → conferir cursores, peças sincronizadas, encaixe, cronômetro, entrada no ranking; áudio testado com dois dispositivos.
- **Carga leve:** puzzle de 1000 peças mantendo ~60 fps e tráfego estável com 4 clientes.
