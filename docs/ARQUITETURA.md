# Arquitetura — puzzl.us (quebra-cabeça colaborativo online)

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

### Ranking por período e ranking geral

Implementado depois do deploy (`apps/server/src/db/gameStore.ts`):

- **Período** (`period=day|week|month|all`): filtra `finished_at` a partir do começo do dia, da
  semana (segunda) ou do mês **no horário de Brasília** (`date_trunc` com `America/Sao_Paulo`;
  o servidor roda em UTC). O resultado da partida mostra a posição de sempre e a de hoje.
- **Ranking por pontos** (`GET /api/ranking/general?players=&period=`): cada partida vale
  peças × fator de velocidade, gravado em `games.points` quando ela termina. O fator é o tempo
  típico (mediana) das partidas com o mesmo número de peças e a mesma modalidade, em qualquer
  foto, dividido pelo tempo da partida, entre 0,5× e 2× (com menos de 5 partidas para comparar,
  1×). O ranking soma, no período, a melhor partida de cada equipe em cada foto e tamanho
  (repetir não acumula); empate, mais quebra-cabeças diferentes. Partidas de antes dos pontos
  ficaram com as peças (fator 1×).
- **Resposta das rotas de ranking** (`RankingPage`): o topo (20), o `total` de equipes e `me`
  (a melhor posição de quem pede, com quem está logo à frente). Quem pede é achado pela conta
  (cookie) ou pelo convidado do navegador (cabeçalho `x-guest-id`). Cada linha traz `change`
  (posições ganhas/perdidas desde o período anterior equivalente; null = estreou; ausente em
  "sempre") e `streak` (dias seguidos jogando). Detalhes e o que falta em
  `docs/RANKING-PENDENTE.md`.
- **Escolher a foto do ranking por foto:** busca pelo título e as mais jogadas
  (`GET /api/ranking/popular?players=&period=`), em vez de listar todas as fotos.
- Índice `games(team_size, finished_at)` para as duas consultas.

## Contas (login com Google)

Implementado na fase C (`apps/server/src/auth/`). Quem não entra continua jogando como
convidado; a conta é o que permite amigos, partidas salvas, favoritos e publicar fotos.

1. **Fluxo:** `/auth/google` gera `state` e o verificador PKCE (cookies httpOnly de 10 min) e vai
   para o Google (lib `arctic`, escopos `openid profile email`). O Google devolve em
   `/auth/google/callback`; conferido o `state`, o código vira o perfil (id_token), a conta é
   criada/atualizada e nasce uma **sessão**: token aleatório no cookie `sid` (httpOnly,
   SameSite=Lax, Secure em produção, 30 dias) e só o **hash SHA-256** dele na tabela `sessions`.
2. **Dados:** `users` guarda o `sub` do Google, nome, foto, código de amigo e `is_admin`. O
   e-mail **não** é guardado: só é comparado com `ADMIN_EMAILS` no login.
3. **Jogador × conta:** `players.user_id` liga o jogador do ranking à conta. Na primeira partida
   logado (ou pelo `POST /api/me/link-guest` que o site chama uma vez), o convidado deste
   navegador vira o jogador da conta; se a conta já tinha outro, as partidas dele passam para
   ela e o `team_key` é recalculado. A mesma conta em dois aparelhos conta como uma pessoa só.
4. **Na sala:** o `onAuth` da `PuzzleRoom` lê o cookie da conexão do WebSocket (cookie não
   depende de porta, então em dev também chega na 2567). Sem sessão, entra como convidado.
5. **Dev:** o Vite repassa `/api` e `/auth` ao servidor, então o site e a API são a mesma origem
   e o cookie vai junto sem CORS. Testes trocam o Google por um falso (`GoogleAuth`).

## Concluídos, favoritos e "Meus records"

Implementado na fase D (`apps/server/src/library/library.ts`), só para quem tem conta:

- **Concluídos/records** não têm tabela própria: saem das partidas já gravadas (`games` +
  `game_players` do jogador ligado à conta), agrupadas por foto + peças + modalidade, com o
  melhor tempo, quantas vezes e a última data. O card do catálogo mostra **✓ Montado** se há
  algum record daquela foto.
- **Favoritos:** tabela `favorites (user_id, image_id)`; o marcador do card favorita (otimista
  no cliente). A aba **Favoritos** é o Explorar filtrado; convidado que toca o marcador vai
  para o login.
- Rotas: `GET /api/me/library` (`{ records, favorites }`) e `PUT`/`DELETE
/api/me/favorites/:imageId`, todas exigindo sessão (401 sem login).
- Partidas com foto própria não publicada ficam fora do ranking e, por isso, fora dos records.

## Partidas salvas ("Em andamento")

Implementado na fase E (`apps/server/src/rooms/savedGames.ts`), reaproveitando o formato do
snapshot da sala (`RoomSnapshot`):

1. **Dono:** quem cria a sala logado (o primeiro a entrar numa sala nova). Sala criada por
   convidado não tem dono e não salva. O estado leva `ownerId` (o `sessionId` do dono enquanto
   ele está na sala) para o site mostrar o botão só para ele.
2. **Salvar e sair** (mensagem `saveAndLeave`, só o dono, durante a partida): grava em
   `saved_games` (snapshot em jsonb + foto, tamanho, vagas, peças encaixadas e tempo para a
   lista), avisa todo mundo (`saved`) e fecha a sala.
3. **Autosave:** se a sala esvazia no meio da partida, ou o servidor desliga
   (`onBeforeShutdown`), a partida também vai para o "Em andamento" do dono.
4. **Retomar:** `client.create('puzzle', { resume: id })`. O `onAuth` só deixa entrar a conta
   que salvou. A sala nasce com **outro código**, no lobby, com a mesa e os encaixes de antes;
   o relógio mostra o tempo acumulado e continua dele no "Começar" (solo começa sozinho). A
   mesma entrada é atualizada se salvar de novo; ao completar, ela é apagada e o ranking recebe
   o tempo total.
5. **Limites:** até 20 por conta (a mais antiga sai). Foto enviada usada por uma partida salva
   não é apagada pela limpeza de 7 dias.
6. Rotas: `GET /api/me/saved` e `DELETE /api/me/saved/:id` (só apaga se for da conta).

## Modos Bullet e Batalha

Implementados na fase H. Cada modo é um tipo de sala no Colyseus (`puzzle`, `bullet`, `battle`),
todos herdando de `BaseGameRoom` (`apps/server/src/rooms/BaseGameRoom.ts`): jogadores e cores,
conta pelo cookie, anfitrião, reconexão, voz, cursores, presença e relógio. A lógica de um
tabuleiro (pegar/mover/soltar/espalhar) fica em `BoardRuntime` (`rooms/board.ts`) e serve tanto
para a raiz do estado (clássico) quanto para um `BoardSchema` (modos novos, em `state.boards`).
No cliente, o `BoardScene` desenha qualquer um desses tabuleiros (`source`), manda a chave dele
nas mensagens (`board`) e pode ficar só assistindo (`readOnly`). O `state.mode` diz qual tela
mostrar; entrar pelo código funciona para qualquer modo.

- **Bullet** (`BulletRoom`): 3, 5 ou 10 min; quebra-cabeças de 12 ou 24 peças, fotos sorteadas
  de um baralho do catálogo (sem repetir até acabar). Montou um, `solved` sobe e ~0,9 s depois
  entra um tabuleiro novo em `boards.main` (`round` sobe e o cliente remonta a mesa). No fim do
  tempo vale `solved`; empate, `partial` (peças encaixadas no que ficou pela metade). Grava em
  `bullet_runs` e o ranking (`GET /api/ranking/bullet`) usa a melhor corrida de cada equipe.
- **Batalha** (`BattleRoom`): 1v1 ou 2v2. Um puzzle só, espalhado uma vez; o lado B recebe as
  mesmas posições do A. Cada um só mexe na mesa do seu lado (`boards.a`/`boards.b`); o primeiro
  a montar ganha (`winner`); um lado que sai inteiro perde por W.O. O anfitrião pede revanche
  (mesas novas, mesmos lados). Sem ranking. Na tela, o seu lado à esquerda e o do adversário à
  direita (só assistir); no celular, abas.
- Os modos novos não têm snapshot nem "Salvar e sair": se o servidor reiniciar no meio, a
  partida acaba.
- **Jogar novamente** (mensagem `playAgain`, só o anfitrião, depois do fim e com o resultado já
  gravado): começa outra partida na mesma sala, então ninguém sai e a chamada continua. No
  clássico, mesa nova com a mesma foto e o mesmo tamanho (outra foto se a sala era aleatória),
  de volta ao lobby. No Bullet, placar e relógio zerados com foto nova. Na Batalha, é a revanche.
  `round` sobe e o cliente remonta a mesa e o resultado; solo começa sozinho.

## Perfil

- **Dados** (em `users`): `nickname` (null = o primeiro nome do Google), `bio` (até 120),
  `avatar_style` (`google` ou `initials`) e `avatar_color` (paleta `AVATAR_COLORS`; null = cor
  automática pelo nome). O login com Google atualiza só o nome e a foto _do Google_
  (`display_name`, `avatar_url`), nunca o que a pessoa escolheu no perfil.
- **Nome e foto mostrados** saem de `profileName`/`profileAvatar` (`auth/accounts.ts`), os mesmos
  na conta, nos amigos e no ranking (que mostra o nickname atual de quem tem conta).
- **Nas salas**, quem está logado entra com o nickname do perfil: o `onAuth` devolve o nome e o
  `onJoin` usa ele em vez do digitado (o site nem mostra o campo "Seu nome").
- `PATCH /api/me/profile` edita; `GET /api/profiles/:codigo-de-amigo` é o perfil público
  (`/perfil/K7QF-2M9D` no site): nickname, avatar, bio, desde quando joga, estatísticas
  (montados, fotos, peças, pontos da semana e de sempre, sequência, melhor Bullet, amigos) e a
  relação com quem vê (próprio, amigo, pedido pendente, nenhuma, convidado).
- O ranking devolve, junto dos nomes, o código de amigo de cada jogador com conta: o nome vira
  link para o perfil.

## Amigos, presença e convites

Implementado na fase G (`apps/server/src/friends/`):

1. **Amizade:** `friendships (user_low, user_high, status, requested_by)`, uma linha por par (o
   menor id primeiro). Pede-se pelo código de amigo (`POST /api/me/friends`, aceita sem hífen e em
   minúsculas); se a outra pessoa já tinha pedido, vira amizade na hora. Aceitar, recusar, cancelar
   e desfazer: `POST /api/me/friends/:id/accept` e `DELETE /api/me/friends/:id`.
2. **Presença:** todo cliente logado mantém aberta a sala Colyseus **`presence`** (auth pelo
   cookie; convidado é recusado). O `PresenceHub` (em memória, uma instância só no Render) conta
   as abas abertas (online) e as salas do jogo em que a conta está (`PuzzleRoom` avisa no
   `onJoin`/`onLeave`: jogando). Quando o status de alguém muda, os amigos dele recebem
   `friendsChanged` e buscam a lista de novo; pedidos e aceites também avisam a outra pessoa.
3. **Convite:** `POST /api/me/invites { friendId, roomCode }` só passa se forem amigos, se quem
   chama estiver mesmo naquela sala e se o amigo estiver online; o mesmo amigo só pode ser chamado
   de novo depois de 15 s. O amigo recebe `invite` (nome, foto da sala, código) e vê um aviso com
   **Entrar** (sai da sala atual, se estiver numa) e **Agora não**.
4. O status de jogo não revela o código da sala: só o convite leva até ela.

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
   dias. Partidas com foto própria terminam com `rankStatus = 'unranked'` (fora do ranking),
   a não ser que a foto tenha sido publicada (abaixo).
5. Enviada com sessão, a foto guarda a conta em `uploads.owner_user_id`: só ela pode publicar.

## Quebra-cabeças da comunidade

Implementado na fase F (`apps/server/src/community/`):

1. **Publicar:** no resultado de uma sala com foto própria, quem criou a sala (logado) vê
   "Publicar": título, autor (padrão: nome da conta) e a confirmação "a foto é minha / tenho
   direito de compartilhar". `POST /api/puzzles` confere que a foto é da conta (403 se não),
   gera a miniatura (WebP 480 px, em `community_puzzles.mini`) e publica na hora. Cada foto se
   publica uma vez só (409), mesmo depois de removida.
2. **Explorar:** `GET /api/puzzles` lista as publicadas; o site junta catálogo + comunidade (selo
   "Comunidade", "por Autor", busca também pelo autor). O `imageId` continua `upload:<id>`, então
   salas, favoritos, partidas salvas e records funcionam sem mudança.
3. **Ranking:** na hora do fim, a sala pergunta se a foto está publicada; se está, grava como uma
   do catálogo. `RankingQuery` aceita `upload:<id>` e o Ranking lista as publicadas nos filtros.
4. **Moderação:** `POST /api/puzzles/:id/report` (uma denúncia por conta; o autor não denuncia a
   própria). Com `COMMUNITY_HIDE_REPORTS` (3) a foto vira `hidden`: some para todos menos o admin,
   que vê o número de denúncias e escolhe **Voltar ao ar** (`/restore`, zera as denúncias) ou
   **Remover** (`DELETE`, `removed`). O autor também remove a sua.
5. **Limpeza:** foto publicada (não removida) fica fora da limpeza de 7 dias; removida volta a
   expirar normalmente.

## Snapshot da sala

Implementado na fase 8 (`apps/server/src/rooms/snapshots.ts`). O estado da sala vive na memória
do processo, e o Render reinicia o processo a cada deploy, quando dorme e quando cai. Sem
snapshot, a partida em andamento sumia. Agora:

1. **Gravação:** a sala grava um `RoomSnapshot` (JSON em `room_snapshots`, uma linha por código)
   assim que é criada, a cada 10 s se algo mudou e, no desligamento gracioso (SIGTERM do deploy),
   em `onBeforeShutdown`, **antes** de derrubar os jogadores. Numa queda sem aviso perde-se no
   máximo ~10 s. As gravações passam por uma fila, então nunca chegam fora de ordem ao banco.
2. **Conteúdo:** config do puzzle, fase, tempo de jogo, grupos (id, deslocamento, peças) e
   jogadores **por `guestId`** (nome, cor, encaixes), porque o `sessionId` muda ao voltar.
   Quem segura o quê e quem está conectado não entram.
3. **Restauração:** `joinById(code)` dá "not found" → o cliente pede
   `joinOrCreate('puzzle', { restore: code })`. A sala é registrada com `filterBy(['restore'])`,
   então pedidos simultâneos de vários amigos caem na **mesma** sala. O `onCreate` carrega o
   snapshot, recria o engine com `PuzzleEngine.fromGroups` e usa o próprio código como `roomId`.
   Sem snapshot, devolve o mesmo "not found" do `joinById`.
4. **Relógio:** o tempo com o servidor fora do ar **não conta**: a sala restaurada retoma de
   `elapsedMs`. O `startedAt` gravado no ranking continua sendo o início real.
5. **Quem volta** recupera a cor (se ainda livre) e os encaixes. O primeiro a voltar vira o
   anfitrião, como numa sala nova.
6. **Cliente:** se a conexão cai de vez (`SERVER_SHUTDOWN`, ou a reconexão automática desiste),
   a sala tenta entrar de novo pelo código por ~1 min (cobre um deploy e o Render acordando) e
   troca para a nova conexão sem sair da tela. Depois de um F5 com o servidor reiniciado, o token
   de reconexão não vale mais: o cliente entra de novo pelo código com o nome lembrado.
7. **Fim da vida:** partida terminada apaga o snapshot (o resultado já está no ranking); sala que
   esvazia também (não há a quem devolver). Snapshots esquecidos (servidor caiu e ninguém
   voltou) somem após 24 h. Um código guardado por snapshot não é sorteado para sala nova.

Limite conhecido: durante um deploy o Render mantém a instância velha e a nova no ar por alguns
segundos. Se alguém entrar pelo código na nova **antes** de a velha desligar, a sala é
restaurada de um snapshot de até 10 s atrás, e quem ainda estava na velha perde esse trecho.

Sem `DATABASE_URL` não há snapshots: o jogo funciona como antes.

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
7. **Polimento e deploy** — feito: redesign da sala, câmera, ferramentas da mesa (zoom, centralizar, ver imagem, espalhar), tela de resultado com encaixes por jogador, deploy no Render.
8. **Snapshot da sala** — salas em andamento sobrevivem a deploy/restart do servidor (ver "Snapshot da sala"). Ideias para depois: contas OAuth, sons, rotação de peças opcional.

---

## Verificação

- **Unit (Vitest):** `generatePuzzle` determinístico (mesmo seed ⇒ mesma saída; bordas vizinhas complementares macho/fêmea); snap/merge (union-find) e detecção de fim.
- **Integração do servidor:** `@colyseus/testing` — dois clientes simulados: lock (2º `grab` é ignorado), `move` de quem não segura é rejeitado, snap funde grupos, fim grava sessão no banco.
- **Manual end-to-end:** `pnpm dev` → abrir a mesma sala em duas janelas (uma anônima) → conferir cursores, peças sincronizadas, encaixe, cronômetro, entrada no ranking; áudio testado com dois dispositivos.
- **Carga leve:** puzzle de 1000 peças mantendo ~60 fps e tráfego estável com 4 clientes.
