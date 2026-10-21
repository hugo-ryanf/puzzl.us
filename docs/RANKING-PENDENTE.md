# Ranking — métricas do design

A tela de Ranking segue o desenho "Ranking — opção gamificada" do canvas "Quebra-cabeça online"
(Claude Design).

## Já no site

- **Tendência** das fotos mais jogadas (`▲ 32%` / `▼ 4%`): partidas na semana × semana passada
  (`/api/ranking/popular` devolve `previousPlays`; `playsTrend` no shared).
- Selo **"EM ALTA"**: cresceu pelo menos 20% (ou estreou) com pelo menos 3 partidas
  (`isTrending` no shared).
- **"Ver todos"** os mais jogados: a faixa vira uma grade com até 48 fotos.
- **Variação de posição** (coluna `±`): posição no período anterior equivalente (ontem, semana
  passada, mês passado); `NOVO` para quem não estava lá; `—` em "Sempre".
- **Sequência** de dias (coluna com chama): dias seguidos em que a equipe terminou uma partida,
  até hoje ou ontem (horário de Brasília); a chama acende a partir de 3 dias.
- **"mais N jogadores/equipes"** no fim da tabela (a API devolve o `total`).
- **Sua posição** fixa embaixo: a melhor posição de quem está vendo (conta logada ou o convidado
  deste navegador, pelo cabeçalho `x-guest-id`), quanto falta para o próximo e a barra "Rumo ao
  Nº".

## Ainda não implementado

| No desenho                                        | O que precisa                                                                                              | Onde entra                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **Temporada** ("Temporada 1 · termina em 9 dias") | Definir temporadas (datas de início/fim, ex.: mensais); o ranking por pontos passa a filtrar por temporada | Ao lado do título "Ranking"   |
| **Nível** do jogador (`Nv 48`)                    | Sistema de XP: pontos acumulados de sempre → nível (curva de níveis); por jogador, não por equipe          | Pódio, linhas e "Sua posição" |

Observações:

- O desenho usa avatares com iniciais; o site também (a API do ranking só tem os apelidos). Fotos
  do Google no ranking dependeriam de a API devolver o `avatarUrl` de cada jogador com conta.
- O seletor "Imagem" do desenho é um `<select>` com poucas fotos; no site virou uma busca com as
  mais jogadas, porque o catálogo vai ter milhares de fotos.
- Nível é por pessoa; numa linha de equipe, mostrar o de cada avatar (ou o maior).
