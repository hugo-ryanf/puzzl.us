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
- **Nível** do jogador (`Nv 12` no avatar do pódio, das linhas e de "Sua posição"; no perfil,
  com a barra até o próximo): vem dos pontos de sempre da pessoa (a melhor partida de cada foto e
  tamanho, a mesma conta do perfil). O nível n começa em 50 × (n − 1)² pontos (`levelOf` e
  `levelStart` no shared). Numa equipe, cada avatar mostra o seu.
- **Avatares de verdade** no ranking: a foto do Google ou as iniciais na cor escolhida no perfil
  (convidado: iniciais na cor automática).

## Ainda não implementado

| No desenho                                        | O que precisa                                                                                              | Onde entra                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Temporada** ("Temporada 1 · termina em 9 dias") | Definir temporadas (datas de início/fim, ex.: mensais); o ranking por pontos passa a filtrar por temporada | Ao lado do título "Ranking" |

Observações:

- O seletor "Imagem" do desenho é um `<select>` com poucas fotos; no site virou uma busca com as
  mais jogadas, porque o catálogo vai ter milhares de fotos.
