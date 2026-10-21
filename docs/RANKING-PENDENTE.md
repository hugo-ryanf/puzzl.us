# Ranking — métricas do design ainda não implementadas

A tela de Ranking segue o desenho "Ranking — opção gamificada" do canvas "Quebra-cabeça online"
(Claude Design). Este arquivo lista o que o desenho mostra e o site ainda não tem, com os dados
que faltam para cada item.

| #   | No desenho                                                                      | O que precisa                                                                                                                                                | Onde entra                            |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| 1   | **Tendência** das fotos em alta (`↑ 32%` / `↓ 4%`)                              | Partidas da foto nesta semana × semana anterior (`/api/ranking/popular` devolver também `previousPlays`)                                                     | Cards de "Mais jogados da semana"     |
| 2   | Selo **"EM ALTA"** nos cards                                                    | Regra sobre a tendência (ex.: subiu ≥ 10% e ≥ N partidas)                                                                                                    | Cards de "Mais jogados da semana"     |
| 3   | **"Ver todos"** os mais jogados                                                 | Página/lista paginada das fotos por partidas no período                                                                                                      | Cabeçalho de "Mais jogados da semana" |
| 4   | **Temporada** ("Temporada 1 · termina em 9 dias")                               | Definir temporadas (datas de início/fim, ex.: mensais); o ranking por pontos passa a filtrar por temporada                                                   | Ao lado do título "Ranking"           |
| 5   | **Nível** do jogador (`Nv 48`)                                                  | Sistema de XP: pontos acumulados de sempre → nível (curva de níveis); por jogador, não por equipe                                                            | Pódio, linhas e "Sua posição"         |
| 6   | **Variação de posição** (coluna `±`, `↑ 2` / `↓ 1`)                             | Posição da equipe no período anterior equivalente (ontem, semana passada, mês passado)                                                                       | Coluna "±" da tabela                  |
| 7   | **Sequência** de dias (coluna "SEQUÊNCIA" com chama)                            | Dias seguidos com pelo menos uma partida terminada (no fuso de Brasília), por jogador                                                                        | Coluna "SEQUÊNCIA" da tabela          |
| 8   | **"mais N jogadores"** no fim da tabela                                         | Total de equipes no ranking (a API devolve só os 20 primeiros)                                                                                               | Rodapé da tabela                      |
| 9   | **Sua posição** fixa embaixo (posição, valor, "Rumo ao 22º" com % de progresso) | Saber qual equipe é a de quem está vendo (conta logada ou convidado deste navegador), a posição dela mesmo fora do top 20, e o valor de quem está logo acima | Barra fixa no pé do ranking           |

Observações:

- O desenho usa avatares com iniciais; o site também (a API do ranking só tem os apelidos). Fotos
  do Google no ranking dependeriam de a API devolver o `avatarUrl` de cada jogador com conta.
- O seletor "Imagem" do desenho é um `<select>` com poucas fotos; no site virou uma busca com as
  mais jogadas, porque o catálogo vai ter milhares de fotos.
- Itens 5 e 7 são por pessoa; numa linha de equipe, mostrar o de cada avatar (ou o maior).
