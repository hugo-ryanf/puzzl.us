#!/usr/bin/env python3
"""Trilha de efeitos do vídeo de lançamento, na paleta da skill onetake (scripts/sfx_palette.py).

Rodar:  python sfx_score.py  → sfx.wav (48 kHz, pico −8 dBFS). Os tempos seguem a linha do tempo T do comp.html.
Menos sons que acontecimentos: cada material num mesmo ambiente; as pausas ficam quase em silêncio.
"""
import os
import sys

SKILL = os.path.expanduser('~/.claude/skills/onetake/scripts')
sys.path.insert(0, SKILL)
import numpy as np  # noqa: E402
from sfx_palette import Score, air, bubble, glass, pan_of, sub, wood  # noqa: E402

rng = np.random.default_rng(11)
s = Score(dur=51.4, T60=1.1)
# a linha do tempo do comp.html: do relógio em diante tudo anda D1 (o trecho do Explorar entrou antes)
D1 = 7.4
END = 12.8  # o fim (a dobra e o ponto) andou mais: depois do ranking
SA, DS = 12.3, 7.9  # a sala com os amigos entrou em SA: do relógio em diante, mais DS
_place = s.place


def _after(t):
    return t + DS if t >= SA else t


def place(sig, t, *a, **k):
    # tempos do roteiro antigo: até 5,0 s ficam; do relógio ao tabuleiro, +D1; do fim, +END
    t = t if t < 4.99 else t + D1 if t < 24.9 else t + END
    _place(sig, _after(t), *a, **k)


def at(sig, t, *a, **k):
    # tempos na linha do tempo de antes da sala
    _place(sig, _after(t), *a, **k)


def sala_at(sig, t, *a, **k):
    # tempos finais, dentro da sala (SA a SA + DS)
    _place(sig, t, *a, **k)

# ── ato 1 ──────────────────────────────────────────────────────────────────────────────────────
# a peça cai: um sopro curto e o baque na mesa
place(air(0.42, 1800, 300, 1.4, 0.4), 0.62, 0.22, 0.0, 0.4)
place(wood(150, 0.14), 1.00, 0.55, 0.0, 0.2); place(sub(70, 0.45), 1.00, 0.30, 0.0, 0.25)
# o clique direito e o giro
place(wood(250, 0.07), 1.55, 0.30, pan_of(1000), 0.2); place(air(0.22, 600, 2400, 1.8), 1.58, 0.12, 0.0, 0.35)
# as três vizinhas encaixam: madeira + um vidro que sobe (o brilho dourado, o combo)
for t, f, x in ((2.25, 659, 1140), (2.75, 784, 960), (3.25, 988, 1140)):
    place(wood(205 + rng.uniform(-10, 10), 0.10), t, 0.40, pan_of(x), 0.2)
    place(glass(f, 0.7, 0.8), t + 0.01, 0.12, pan_of(x), 0.45)
# 3,5–5,0: quase silêncio (a pausa)

# o bloco vira relógio
place(air(0.6, 220, 2000, 1.2, 0.5), 5.0, 0.26, 0.05, 0.5)
# o tempo despencando: tique-taque acelerando; cada "+1" é uma bolha
for t in np.concatenate([np.linspace(6.0, 7.0, 6), np.linspace(7.1, 7.95, 9)]):
    place(wood(330, 0.045), float(t), 0.16, 0.08, 0.15)
for i, t in enumerate((6.3, 6.75, 7.05, 7.35, 7.58, 7.76, 7.9)):
    place(bubble(500 + i * 35, 0.2), t, 0.22, pan_of(900 + i * 52), 0.3)
# os últimos segundos: o fogo pega, o relógio bate forte
place(sub(55, 1.0), 8.0, 0.45, 0.0, 0.4); place(air(1.0, 200, 1400, 0.9, 0.7), 8.0, 0.30, 0.0, 0.5)
for t in (8.0, 8.5, 9.0):
    place(wood(280, 0.09), t, 0.42, 0.0, 0.2)
# o anel desaba numa linha
place(air(0.5, 2200, 280, 1.4), 9.2, 0.26, 0.0, 0.4); place(sub(62, 0.5), 9.8, 0.30, 0.0, 0.3)

# lado contra lado: as peças surgindo em cada lado, o cabo puxando
for t in (10.45, 10.8, 11.05, 11.55, 11.9, 12.6):
    place(bubble(560 + rng.uniform(-30, 30), 0.18), t, 0.16, -0.5, 0.3)
for t in (10.7, 11.3, 11.75, 12.85):
    place(bubble(520 + rng.uniform(-30, 30), 0.18), t, 0.16, 0.5, 0.3)
for t, p in ((10.55, -0.25), (11.1, 0.2), (11.7, -0.3), (12.95, -0.4)):
    place(air(0.22, 400, 1600, 1.8), t, 0.12, p, 0.3)
# neblina: um sopro longo que atravessa da esquerda para a direita
place(air(1.1, 300, 1200, 0.8, 0.6), 11.15, 0.32, -0.55, 0.6, pan_to=0.55)
# gelo: cristais agudos no meu lado
for f, dt in ((2093, 0), (2637, 0.05), (3136, 0.11)):
    place(glass(f, 0.5, 1.0), 12.25 + dt, 0.09, -0.5, 0.5)

# relâmpago: o estalo
place(sub(48, 0.9), 13.5, 0.55, 0.0, 0.3); place(glass(1568, 1.0, 1.0), 13.5, 0.14, 0.0, 0.6)
place(air(0.35, 3200, 600, 1.6), 13.5, 0.25, 0.0, 0.4)
# as casas deslizando e a grade completa
for t in (14.2, 14.55, 14.9):
    place(wood(260 + rng.uniform(-15, 15), 0.06), t, 0.34, 0.0, 0.2)
place(glass(784, 1.2, 0.8), 15.15, 0.16, 0.0, 0.6); place(glass(1175, 1.2, 0.7), 15.17, 0.12, 0.0, 0.6)
# o mergulho no olho e a íris do outro lado
place(air(1.3, 180, 1600, 0.9, 0.7), 15.7, 0.36, 0.0, 0.6)
place(sub(46, 1.1), 16.85, 0.42, 0.0, 0.4)
place(air(0.6, 1800, 260, 1.2, 0.5), 16.95, 0.24, 0.0, 0.5)

# ── ato 2 ──────────────────────────────────────────────────────────────────────────────────────
# os cliques que desviram cada peça
for t, x in zip((17.75, 18.0, 18.25, 18.5, 18.75), (520, 1120, 1420, 610, 1380)):
    place(wood(245 + rng.uniform(-12, 12), 0.07), t, 0.30, pan_of(x), 0.2)
# as oito encaixando em sequência
for i in range(8):
    place(wood(200 + i * 6, 0.08), 19.45 + i * 0.05, 0.20, pan_of(700 + (i % 4) * 140), 0.2)
place(sub(60, 0.6), 19.65, 0.38, 0.0, 0.3); place(glass(988, 0.9, 0.7), 19.66, 0.12, 0.0, 0.5)   # "Vença."
# três palavras secas
for t, f in ((20.25, 70), (20.7, 66), (21.15, 62)):
    place(sub(f, 0.4), t, 0.34, 0.0, 0.25)
# as de baixo chegando
for j in range(8):
    t = 20.05 + j * 0.22 + 0.55
    place(wood(190 + rng.uniform(-15, 15), 0.08), t, 0.18, pan_of(700 + (j % 4) * 140), 0.2)
# o tabuleiro completo: um vidro longo, e depois silêncio até 25 s
place(glass(659, 2.2, 0.5), 22.4, 0.12, 0.0, 0.7)

# a dobra: o tabuleiro vira a peça; ela salta e pousa como o ponto
place(air(0.8, 2400, 300, 1.1, 0.5), 25.0, 0.26, 0.0, 0.5)
place(air(0.55, 300, 2200, 1.3, 0.5), 26.25, 0.22, 0.0, 0.4, pan_to=0.1)
for i in range(5):
    place(wood(230 + i * 12, 0.05), 26.38 + i * 0.055, 0.12, -0.2 + i * 0.05, 0.2)
place(wood(170, 0.12), 26.85, 0.48, 0.05, 0.2); place(sub(58, 0.9), 26.85, 0.36, 0.0, 0.35)
place(bubble(620, 0.3), 26.88, 0.22, 0.05, 0.35)
for i in range(2):
    place(wood(260 + i * 15, 0.05), 26.92 + i * 0.055, 0.12, 0.25, 0.2)
place(glass(784, 1.6, 0.5), 27.5, 0.10, 0.0, 0.7); place(glass(1175, 1.6, 0.4), 27.52, 0.07, 0.0, 0.7)

# ── trechos novos: as janelas do site ──────────────────────────────────────────────────────────
# o bloco se abre no Explorar; a rolagem; os dois cliques (a foto, o Bullet)
at(air(0.6, 300, 2600, 1.2, 0.5), 5.0, 0.28, 0.0, 0.5)
for i in range(8):
    at(wood(300 + i * 4, 0.03), 5.8 + i * 0.32, 0.06, 0.1, 0.1)
for t, x in ((9.9, 903), (11.33, 1127), (12.22, 1036)):
    at(wood(250, 0.07), t, 0.32, pan_of(x), 0.2); at(wood(190, 0.06), t + 0.06, 0.2, pan_of(x), 0.2)
at(bubble(540, 0.22), 10.0, 0.18, 0.1, 0.3)                 # o diálogo abre
at(air(0.5, 2400, 300, 1.3), 12.3, 0.24, 0.05, 0.4)          # a janela se fecha no relógio
# o tabuleiro se abre no ranking; o clique na Ana; o perfil
at(air(0.6, 300, 2600, 1.2, 0.5), 31.6, 0.28, 0.0, 0.5)
at(glass(988, 1.0, 0.6), 32.5, 0.10, 0.0, 0.6); at(glass(1318, 1.0, 0.5), 32.55, 0.08, 0.0, 0.6)
at(wood(250, 0.07), 34.3, 0.32, pan_of(690), 0.2); at(wood(190, 0.06), 34.36, 0.2, pan_of(690), 0.2)
at(bubble(600, 0.22), 35.25, 0.16, 0.0, 0.3)
for i in range(3):
    at(wood(300, 0.03), 36.0 + i * 0.3, 0.06, 0.0, 0.1)

# ── a sala: "Criar sala", os amigos chegando com a câmera, todos montando ─────────────────────────
sala_at(wood(250, 0.07), SA + 0.48, 0.32, pan_of(1157), 0.2); sala_at(wood(190, 0.06), SA + 0.54, 0.2, pan_of(1157), 0.2)
sala_at(air(0.5, 300, 2000, 1.3, 0.4), SA + 0.55, 0.2, 0.1, 0.4)
for i, u in enumerate((1.3, 1.9, 2.5, 3.0)):   # cada câmera que liga: uma bolha que sobe
    sala_at(bubble(520 + i * 70, 0.24), SA + u, 0.22, 0.45, 0.35)
    sala_at(glass(988 + i * 120, 0.6, 0.6), SA + u + 0.02, 0.06, 0.45, 0.5)
sala_at(wood(250, 0.07), SA + 3.5, 0.32, pan_of(960), 0.2); sala_at(wood(190, 0.06), SA + 3.56, 0.2, pan_of(960), 0.2)
sala_at(sub(64, 0.6), SA + 4.1, 0.3, 0.0, 0.3)
for u, x in ((4.55, 700), (4.95, 1180), (5.4, 860), (5.85, 1050), (6.2, 640), (6.95, 1000), (7.35, 760)):   # as peças encaixando
    sala_at(wood(200 + rng.uniform(-12, 12), 0.08), SA + u, 0.2, pan_of(x), 0.2)
sala_at(air(0.6, 400, 1800, 1.2, 0.5), SA + 5.95, 0.2, 0.3, 0.4, pan_to=0.5)   # a câmera vai às câmeras
sala_at(air(0.45, 1800, 400, 1.3), SA + DS - 0.5, 0.18, 0.3, 0.4, pan_to=0.0)

s.write(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sfx.wav'))
