# puzzl.us

Quebra-cabeça colaborativo online: amigos entram na mesma sala, montam juntos em tempo real,
veem o cursor uns dos outros, conversam por áudio e disputam o ranking de tempo.

Arquitetura e roadmap: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Estrutura

| Pacote            | O que é                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `apps/web`        | Front — Vite + React + PixiJS (tabuleiro) + SDK do Colyseus                                          |
| `apps/server`     | Servidor — Node + Colyseus (salas em tempo real) + Express (REST)                                    |
| `packages/shared` | Código usado pelos dois lados: geração do puzzle, regras de encaixe, protocolo e estado sincronizado |

## Requisitos

- Node >= 22
- pnpm 10 (`npm i -g pnpm@10`)

## Comandos

```sh
pnpm install       # instala tudo
pnpm dev           # sobe web (http://localhost:5173) e server (http://localhost:2567)
pnpm test          # testes (Vitest)
pnpm typecheck     # checagem de tipos em todos os pacotes
pnpm lint          # ESLint
pnpm format        # Prettier
pnpm build         # build de produção
pnpm --filter @puzzle/server db:generate   # cria migração após mudar src/db/schema.ts
```

## Catálogo de imagens

As salas usam fotos de um catálogo fixo.

1. Coloque as fotos em `catalogo/originais/` (JPG, PNG ou WEBP; de preferência horizontais,
   ≥ 1600 px, com bastante cor e detalhe). Essa pasta fica fora do git.
2. Rode `pnpm catalog`. Ele aplica a rotação do celular, **apaga os metadados EXIF (inclusive
   GPS)**, gera `apps/web/public/catalog/<id>.webp` (≤ 2048 px) e a miniatura `<id>-mini.webp`,
   e escreve `packages/shared/src/catalog.ts`.
3. Ajuste título e crédito em `catalogo/catalogo.json` (o nome do arquivo vira o título; fotos
   baixadas do Unsplash/Pexels já ganham o crédito do autor) e rode `pnpm catalog` de novo.
   Para tirar uma foto do jogo, tire o original de `catalogo/originais/` (subpastas são
   ignoradas, ex.: `originais/duplicadas/`), apague a entrada dela desse arquivo e rode
   `pnpm catalog` — com o original ainda na pasta, ela voltaria como foto nova.

> **Não renomeie fotos que já estão no jogo:** o id da imagem vem do nome do arquivo e o
> ranking é guardado por id — renomear "zera" o ranking daquela foto. Trocar o **título** no
> `catalogo.json` é seguro.

O ranking é separado por imagem + número de peças + tamanho da equipe.

### Como jogar: solo, multiplayer e sala personalizada

- **Clique numa foto do catálogo** → **Solo** (começa na hora, sem sala de espera nem chamada) ou
  **Multiplayer** (escolhe 2, 3 ou 4 jogadores e se a foto é a clicada ou **aleatória**, sorteada
  pelo servidor). A sala trava quando enche; o máximo é o quarteto.
- **Criar sala** (barra lateral) = **sala personalizada**: é o único lugar para jogar com uma foto
  sua, também em solo ou multiplayer.

### Foto própria

Na sala personalizada, **Escolher foto** usa uma foto do computador. O navegador reduz a foto
antes de enviar; o servidor reprocessa tudo (confere que é imagem, apaga EXIF/GPS, WebP ≤ 2048 px)
e guarda no banco com um id aleatório. Partidas com foto própria **ficam fora do ranking**, e a
foto é apagada depois de **7 dias sem uso**. Precisa do banco configurado (`DATABASE_URL`).

Quem enviou a foto logado pode **publicá-la** no fim da partida (título, autor e a confirmação de
que tem direito de compartilhar). A foto publicada aparece no Explorar com o selo "Comunidade",
ganha ranking próprio e não expira. Qualquer conta pode **denunciar**; com 3 denúncias a foto sai
do ar até o admin (`ADMIN_EMAILS`) decidir entre voltar ao ar e remover. O autor também remove a
sua.

## Banco de dados (ranking)

O ranking usa Postgres no [Neon](https://neon.tech) (plano gratuito). Sem banco o jogo funciona
normalmente, só o ranking fica indisponível. Há o ranking **por quebra-cabeça** (melhor tempo
numa foto + tamanho) e o **geral** (peças somadas de todas as fotos), ambos por modalidade (solo,
dupla, trio, quarteto) e período (hoje, semana, mês, sempre — no horário de Brasília).

1. Crie um projeto no Neon e copie a connection string (**Connect** no painel).
2. Copie `apps/server/.env.example` para `apps/server/.env` e cole em `DATABASE_URL`.
3. Reinicie o `pnpm dev`: o servidor aplica as migrações sozinho e mostra
   `[server] banco conectado, migrações em dia`.

O `.env` é ignorado pelo git. Os testes não usam o Neon: rodam num Postgres em memória (PGlite).

## Chamada de voz e câmera

A chamada usa o [LiveKit Cloud](https://cloud.livekit.io) (plano gratuito). Quem entra na sala
já entra na chamada (microfone, som e câmera se controlam na barra do topo; a câmera começa
desligada). Sem LiveKit o jogo funciona normalmente e o ícone do microfone aparece cortado.

1. Crie um projeto no LiveKit Cloud e vá em **Settings → API Keys → Create key**.
2. **Na janela que abre logo após criar a chave**, copie o bloco _Environment variables_ e cole
   no `apps/server/.env`. O secret só aparece nesse momento; depois o painel mostra `••••` (se
   copiar a máscara, o LiveKit recusa com "invalid token" — revogue e crie outra chave).
3. Reinicie o `pnpm dev`: deve aparecer `[server] chamada de áudio via wss://…`.

## Login com Google

Opcional: sem ele todo mundo joga como convidado. Com ele, a conta guarda amigos, partidas salvas e
favoritos em qualquer aparelho.

1. No [Google Cloud Console](https://console.cloud.google.com), crie um projeto e vá em
   **APIs e serviços → Tela de permissão OAuth**: tipo **Externo**, nome do app, seu e-mail.
2. **Credenciais → Criar credenciais → ID do cliente OAuth** → **Aplicativo da Web**, com estes
   **URIs de redirecionamento autorizados**:
   - `http://localhost:5173/auth/google/callback` (dev)
   - `https://<seu-site>.onrender.com/auth/google/callback` (produção)
3. Copie o ID e a chave secreta para `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no
   `apps/server/.env` (e no painel do Render, junto com `PUBLIC_URL=https://<seu-site>.onrender.com`).
4. Reinicie o servidor: deve aparecer `[server] login com Google ligado`.

## Deploy (Render)

Em produção um único serviço Node entrega o site (`apps/web/dist`), a API e o WebSocket, então
o jogo tem uma URL só. A configuração está em [`render.yaml`](render.yaml) (plano gratuito,
região Ohio, a mesma do banco no Neon).

1. No [Render](https://render.com), entre com o GitHub e vá em **New → Blueprint**.
2. Escolha este repositório. O Render lê o `render.yaml` e pede os segredos: `DATABASE_URL` e
   as três `LIVEKIT_*` (os mesmos valores do seu `apps/server/.env`).
3. Ao terminar o build, o jogo fica em `https://<nome-do-serviço>.onrender.com`. Cada push na
   `main` faz um deploy novo.

No plano gratuito o serviço dorme depois de ~15 min sem visitas; a primeira visita depois disso
leva cerca de 1 min para acordar. Salas abertas se perdem quando ele dorme ou reinicia.

Para testar a versão de produção no seu PC:

```sh
pnpm build:deploy
node apps/server/dist/index.js   # abre em http://localhost:2567
```

## Jogando com amigos na mesma rede

O front procura o servidor na porta 2567 do mesmo endereço em que a página foi aberta, então
basta expor o Vite na rede:

```sh
pnpm --filter @puzzle/server dev
pnpm --filter @puzzle/web dev --host   # mostra o endereço de rede, ex.: http://192.168.0.10:5173
```

Crie a sala, clique em **Copiar convite** e mande o link. O Windows pode pedir para liberar
o Node no firewall. Para apontar para outro servidor, defina `VITE_SERVER_URL`.
