#!/usr/bin/env python3
"""Grava a cena "Enviar sua foto" para a landing: a Ana (logada) abre "Criar sala", escolhe uma
foto dela (o camaleão), monta sozinha (48 peças), o atalho de teste completa o quebra-cabeça e ela publica
para a comunidade. Precisa do site de demonstração com a sessão da Ana:

  DEMO_SESSION_FILE=<arquivo> [DEMO_LANG=en] PORT=2570 npx tsx src/dev/demoServer.ts
  VITE_SERVER_URL=http://localhost:2570 npx vite --port 5181

  python record_upload.py <arquivo da sessão> [en]
    → apps/web/public/landing/<pt|en>/comunidade.mp4 e .jpg (sem áudio, 1280 px, acelerado)
"""
import asyncio
import os
import shutil
import subprocess
import sys
import time

from PIL import Image
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
BASE = os.environ.get('BASE', 'http://localhost:5181')
SESSION = open(sys.argv[1], encoding='utf-8').read().strip()
EN = len(sys.argv) > 2 and sys.argv[2] == 'en'
LANG = 'en' if EN else 'pt'
PHOTO = os.path.join(ROOT, 'apps', 'web', 'public', 'relampago', 'foto.webp')
RAW = os.path.join(HERE, 'cortes', LANG, 'raw_comunidade')
WEB = os.path.join(ROOT, 'apps', 'web', 'public', 'landing', LANG)
W, H = 1440, 810
SPEED = 2.2  # a cena real é mais lenta que os outros trechos
TXT = {
    'create': 'Create room', 'start': 'Start', 'publish_open': 'Publish…', 'publish': 'Publish', 'title': 'My chameleon',
} if EN else {
    'create': 'Criar sala', 'start': 'Começar', 'publish_open': 'Publicar…', 'publish': 'Publicar', 'title': 'Meu camaleão',
}
MARK = """(()=>{const d=document.createElement('div');d.style.cssText='position:fixed;left:0;bottom:0;width:24px;height:24px;background:#ff00ff;z-index:99999;pointer-events:none';document.body.appendChild(d);setTimeout(()=>d.remove(),140);})()"""
# idioma, painel de testes escondido e um cursor desenhado (o navegador sem tela não mostra o dele)
SETUP = (("try { localStorage.setItem('quebra-cabeca:idioma', 'en'); } catch {}" if EN else '') + r"""
addEventListener('DOMContentLoaded', () => {
  const s = document.createElement('style');
  s.textContent = '.dev-panel { display: none !important; }';
  document.head.appendChild(s);
  const c = document.createElement('div');
  c.innerHTML = '<svg width="26" height="32" viewBox="0 0 22 28"><path d="M1 1 L1 22 L7 17 L11 26 L15 24 L11 15 L19 15 Z" fill="#15171c" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
  c.style.cssText = 'position:fixed;left:0;top:0;z-index:100000;pointer-events:none;transition:transform .08s';
  document.body.appendChild(c);
  addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => { c.style.transform = 'scale(.85)'; }, true);
  addEventListener('mouseup', () => { c.style.transform = ''; }, true);
});"""
)


def log(*a):
    print(f'[{time.strftime("%H:%M:%S")}]', *a, flush=True)


async def glide(page, locator, pause=350):
    """Leva o mouse até o meio do elemento, em passos (dá para ver a mão andando)."""
    box = await locator.bounding_box()
    await page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2, steps=18)
    await page.wait_for_timeout(pause)


async def click(page, locator, pause=500):
    await glide(page, locator)
    await locator.click()
    await page.wait_for_timeout(pause)


async def main():
    shutil.rmtree(RAW, ignore_errors=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={'width': W, 'height': H}, locale='en-US' if EN else 'pt-BR',
                                        record_video_dir=RAW, record_video_size={'width': W, 'height': H})
        await ctx.add_cookies([{'name': 'sid', 'value': SESSION, 'url': BASE}])
        await ctx.add_init_script(SETUP)
        page = await ctx.new_page()
        page.set_default_timeout(30000)
        await page.goto(BASE + '/', wait_until='networkidle')
        await page.mouse.move(W * 0.6, H * 0.5)
        await page.wait_for_timeout(1200)
        await page.evaluate(MARK)
        log('gravando')

        # "Criar sala" da barra lateral → sala personalizada, com a foto da Ana
        await click(page, page.get_by_role('button', name=TXT['create']).first, 900)
        upload = page.locator('label.upload-card')
        await glide(page, upload, 500)
        await page.locator('label.upload-card input[type=file]').set_input_files(PHOTO)
        await page.wait_for_selector('label.upload-card', state='detached')
        await page.wait_for_timeout(900)
        dialog = page.locator('dialog[open]')
        await click(page, dialog.get_by_role('button', name=TXT['start']), 300)
        await page.wait_for_function('window.__puzzleRoom && window.__puzzleRoom.state.phase === "playing"')
        log('na sala')
        await page.mouse.move(W * 0.45, H * 0.55, steps=20)
        await page.wait_for_timeout(2200)

        # o atalho de teste completa; depois, publicar para todos
        await page.evaluate("window.__puzzleRoom.send('dev', { action: 'solve' })")
        publish = page.get_by_role('button', name=TXT['publish_open'])
        await publish.wait_for()
        await page.wait_for_timeout(1600)
        await click(page, publish, 500)
        title = page.locator('.publish-form input.input').first
        await glide(page, title, 200)
        await title.fill('')
        await title.type(TXT['title'], delay=70)
        await click(page, page.locator('.publish-form label.check input'), 400)
        await click(page, page.get_by_role('button', name=TXT['publish'], exact=True), 300)
        await page.locator('.publish-form').wait_for(state='detached')
        await page.wait_for_timeout(2000)
        log('publicado')
        await ctx.close()
        await browser.close()

    webm = next(f for f in os.listdir(RAW) if f.endswith('.webm'))
    frames = os.path.join(RAW, 'frames')
    os.makedirs(frames)
    subprocess.run(['ffmpeg', '-v', 'error', '-i', os.path.join(RAW, webm), '-vf', 'fps=10',
                    os.path.join(frames, '%04d.png')], check=True)
    mark = 0
    for i, f in enumerate(sorted(os.listdir(frames))):
        r, g, b = Image.open(os.path.join(frames, f)).convert('RGB').getpixel((8, H - 8))
        if r > 200 and g < 80 and b > 200:
            mark = i
            break
    start = mark / 10 + 0.3
    os.makedirs(WEB, exist_ok=True)
    out = os.path.join(WEB, 'comunidade.mp4')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{start:.2f}', '-i', os.path.join(RAW, webm),
                    '-vf', f'setpts=PTS/{SPEED},fps=30,scale=1280:-2,format=yuv420p', '-an',
                    '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-movflags', '+faststart', out], check=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-sseof', '-1', '-i', out, '-frames:v', '1', '-q:v', '4',
                    out[:-4] + '.jpg'], check=True)
    log('pronto:', out, os.path.getsize(out) // 1024, 'KB')


asyncio.run(main())
