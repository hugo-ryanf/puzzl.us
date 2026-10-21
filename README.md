# Quebra-cabeça

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
   Para tirar uma foto do jogo, apague a entrada dela desse arquivo.

> **Não renomeie fotos que já estão no jogo:** o id da imagem vem do nome do arquivo e o
> ranking é guardado por id — renomear "zera" o ranking daquela foto. Trocar o **título** no
> `catalogo.json` é seguro.

O ranking é separado por imagem + número de peças + tamanho da equipe.

### Foto própria

Na criação da sala, **📷 Enviar sua foto** usa uma foto do computador. O navegador reduz a foto
antes de enviar; o servidor reprocessa tudo (confere que é imagem, apaga EXIF/GPS, WebP ≤ 2048 px)
e guarda no banco com um id aleatório. Partidas com foto própria **ficam fora do ranking**, e a
foto é apagada depois de **7 dias sem uso**. Precisa do banco configurado (`DATABASE_URL`).

## Banco de dados (ranking)

O ranking usa Postgres no [Neon](https://neon.tech) (plano gratuito). Sem banco o jogo funciona
normalmente, só o ranking fica indisponível.

1. Crie um projeto no Neon e copie a connection string (**Connect** no painel).
2. Copie `apps/server/.env.example` para `apps/server/.env` e cole em `DATABASE_URL`.
3. Reinicie o `pnpm dev`: o servidor aplica as migrações sozinho e mostra
   `[server] banco conectado, migrações em dia`.

O `.env` é ignorado pelo git. Os testes não usam o Neon: rodam num Postgres em memória (PGlite).

## Chamada de áudio

A chamada usa o [LiveKit Cloud](https://cloud.livekit.io) (plano gratuito). Sem ele o jogo
funciona normalmente e aparece "Chamada indisponível".

1. Crie um projeto no LiveKit Cloud e vá em **Settings → API Keys → Create key**.
2. **Na janela que abre logo após criar a chave**, copie o bloco _Environment variables_ e cole
   no `apps/server/.env`. O secret só aparece nesse momento; depois o painel mostra `••••` (se
   copiar a máscara, o LiveKit recusa com "invalid token" — revogue e crie outra chave).
3. Reinicie o `pnpm dev`: deve aparecer `[server] chamada de áudio via wss://…`.

## Jogando com amigos na mesma rede

O front procura o servidor na porta 2567 do mesmo endereço em que a página foi aberta, então
basta expor o Vite na rede:

```sh
pnpm --filter @puzzle/server dev
pnpm --filter @puzzle/web dev --host   # mostra o endereço de rede, ex.: http://192.168.0.10:5173
```

Crie a sala, clique em **Copiar convite** e mande o link. O Windows pode pedir para liberar
o Node no firewall. Para apontar para outro servidor, defina `VITE_SERVER_URL`.
