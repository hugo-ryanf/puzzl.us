#!/usr/bin/env python3
"""Trechos do vídeo de lançamento para a landing (sem legendas, em laço) e o vídeo completo.

Rodar:  python render_clips.py [nome ...]   (sem nomes: todos; o que já existe é pulado)

1. cada trecho × idioma: render.py "comp.html?from=A&to=B&nocap[&lang=en]" → cortes/<lang>/<nome>.mp4
   (com --resume: se a memória acabar no meio, rodar de novo continua de onde parou);
2. ffmpeg para a web: 1280 px, H.264, sem áudio, laço suave (o fim se funde no começo em 0,4 s)
   → apps/web/public/landing/<lang>/<nome>.mp4 e o pôster <nome>.jpg;
3. "completo": o filme inteiro com a trilha (mix.wav), 1080p, só em cortes/ (não vai para a landing).
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RENDER = os.path.expanduser('~/.claude/skills/onetake/scripts/render.py')
WEB = os.path.join(HERE, '..', '..', 'apps', 'web', 'public', 'landing')
FADE = 0.4  # o laço: quanto do fim se funde no começo

# nome: (de, até, seção da landing) — tempos da linha do tempo final do comp.html (51,4 s)
CLIPS = {
    'junto': (0.8, 4.9, 'Como funciona · passo 3'),
    'explorar': (5.6, 12.2, 'Como funciona · passo 1'),
    'convite': (12.8, 16.0, 'Como funciona · passo 2'),
    'sala': (12.6, 20.0, 'Jogue junto'),
    'bullet': (21.0, 24.4, 'Modos · Bullet'),
    'batalha': (25.6, 30.9, 'Modos · Batalha'),
    'classico': (32.5, 35.4, 'Modos · Clássico'),
    'perfil': (40.3, 45.7, 'Seu perfil'),
}
LANGS = ('pt', 'en')


def run(cmd):
    print('$', ' '.join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def render(name, lang, query, out, sfx=None):
    if os.path.exists(out):
        return
    os.makedirs(os.path.dirname(out), exist_ok=True)
    cmd = [sys.executable, RENDER, f'comp.html?{query}', '--out', out, '--workers', '2', '--resume']
    if sfx:
        cmd += ['--sfx', sfx]
    run(cmd)


def web_loop(src, dst, dur):
    """1280 px, sem áudio; os últimos FADE s se fundem no começo, então o laço não salta."""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    end = dur - FADE
    graph = (
        f'[0:v]scale=1280:-2,setsar=1,split=3[a][b][c];'
        f'[a]trim={end}:{dur},setpts=PTS-STARTPTS[tail];'
        f'[b]trim=0:{FADE},setpts=PTS-STARTPTS[head];'
        f'[c]trim={FADE}:{end},setpts=PTS-STARTPTS[mid];'
        f'[tail][head]xfade=transition=fade:duration={FADE}:offset=0[seam];'
        f'[seam][mid]concat=n=2:v=1:a=0,format=yuv420p[v]'
    )
    run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-filter_complex', graph, '-map', '[v]', '-an',
         '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-movflags', '+faststart', dst])
    run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{min(1.0, end / 2):.2f}', '-i', dst, '-frames:v', '1',
         '-q:v', '4', dst[:-4] + '.jpg'])


def main():
    names = sys.argv[1:] or list(CLIPS)
    os.chdir(HERE)
    for name in names:
        for lang in LANGS:
            lq = '&lang=en' if lang == 'en' else ''
            raw = os.path.join(HERE, 'cortes', lang, f'{name}.mp4')
            dst = os.path.join(WEB, lang, f'{name}.mp4')
            if name == 'completo':
                # o filme inteiro com a trilha (para postar fora); a landing usa só os trechos
                render(name, lang, f'full{lq}', raw, sfx='mix.wav')
                continue
            a, b, _ = CLIPS[name]
            render(name, lang, f'from={a}&to={b}&nocap{lq}', raw)
            web_loop(raw, dst, b - a)
    total = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(WEB) for f in fs)
    print(f'landing: {total / 1e6:.1f} MB', flush=True)


if __name__ == '__main__':
    main()
