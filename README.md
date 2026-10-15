# Quebra-cabeça

Quebra-cabeça colaborativo online: amigos entram na mesma sala, montam juntos em tempo real,
veem o cursor uns dos outros, conversam por áudio e disputam o ranking de tempo.

Arquitetura e roadmap: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Estrutura

| Pacote            | O que é                                                             |
| ----------------- | ------------------------------------------------------------------- |
| `apps/web`        | Front — Vite + React (PixiJS entra na fase 1)                       |
| `apps/server`     | Servidor — Node + Express (Colyseus entra na fase 2)                |
| `packages/shared` | Código usado pelos dois lados: tipos, constantes, geração do puzzle |

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
```
