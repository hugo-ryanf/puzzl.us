#!/usr/bin/env python3
"""Junta a música de fundo aos efeitos: a música abaixa sob cada efeito (sidechain), entra num fade curto,
sai num fade sob o logo, e a mistura vai a −16 LUFS com teto de −4 dBTP (o AAC do render fica abaixo de −3 dBFS).

Rodar:  python sfx_score.py && python mix_music.py  → mix.wav (48 kHz)
Música: musica/funk_game_loop.mp3 — créditos em musica/CREDITOS.md.
"""
import os
import re
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DUR = 51.4          # o comp.html
ENTER = 5.0         # a música entra quando o bloco se abre no site (o começo fica só nos efeitos)
# respiros: o relâmpago corta a música (volta com o ato 2, depois do olho); o tabuleiro completo
# respira até a janela do ranking abrir
BREAKS = [(28.8, 33.0), (37.8, 39.5)]
END = 45.9          # some com a dobra da janela; o logo se assenta em silêncio
FADE_OUT = 2.0
MUSIC_DB = -15      # a música por baixo dos efeitos

music = os.path.join(HERE, 'musica', 'funk_game_loop.mp3')
sfx = os.path.join(HERE, 'sfx.wav')
out = os.path.join(HERE, 'mix.wav')
graph = ''.join([
    f'[0:a]aresample=48000,adelay={int(ENTER * 1000)}:all=1,atrim=0:{DUR},asetpts=N/SR/TB,volume={MUSIC_DB}dB,',
    *(f"volume='max(0.02, 1 - clip((t-{a})/0.4,0,1) + clip((t-{b})/0.4,0,1))':eval=frame," for a, b in BREAKS),
    f'afade=t=in:st={ENTER}:d=0.4,afade=t=out:st={END}:d={FADE_OUT}[m];',
    '[1:a]aresample=48000,asplit=2[sc][fx];',
    '[m][sc]sidechaincompress=threshold=0.03:ratio=4:attack=8:release=280:makeup=1[duck];',
    '[duck][fx]amix=inputs=2:normalize=0:duration=longest[out]',
])
pre = os.path.join(HERE, 'mix_pre.wav')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', music, '-i', sfx, '-filter_complex', graph,
                '-map', '[out]', '-t', str(DUR), '-c:a', 'pcm_f32le', pre], check=True)
# mede a sonoridade integrada e leva a −16 LUFS com ganho fixo; o limitador segura os picos em −4,5 dB
meter = subprocess.run(['ffmpeg', '-hide_banner', '-i', pre, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
lufs = float(re.findall(r'I:\s+(-?[\d.]+) LUFS', meter)[-1])
gain = -16 - lufs
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', pre, '-af', f'volume={gain:.2f}dB,alimiter=limit=0.6:attack=2:release=60:level=0',
                '-ar', '48000', '-c:a', 'pcm_s16le', out], check=True)
os.remove(pre)
print(f'{lufs:.1f} LUFS, ganho {gain:+.1f} dB')
print('wrote', out)
