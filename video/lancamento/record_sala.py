#!/usr/bin/env python3
"""Grava a sala multiplayer com chamada: Ana (quem grava) cria a sala com a foto "Rua da minha avó",
Bia, Caio e Duda entram pelo link, todos ligam a câmera (camaleões animados, câmera falsa do Chrome)
e os três montam o quebra-cabeça ao vivo. Precisa do site de demonstração com chamada:

  livekit-server --dev --bind 127.0.0.1
  PORT=2570 LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret npx tsx src/dev/demoServer.ts
  VITE_SERVER_URL=http://localhost:2570 npx vite --port 5181

  python record_sala.py <pasta das câmeras .webm>  → footage/sala.webm, footage/frames/sala/NNNN.jpg, info.json

Os quatro ficam num navegador só (quatro Chromiums não cabem na memória): cada contexto troca o
getUserMedia por um vídeo do seu camaleão em laço.
"""
import asyncio
import base64
import json
import os
import shutil
import subprocess
import sys
import time

from PIL import Image
from playwright.async_api import async_playwright

BASE = 'http://localhost:5181'
CAMS = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'footage')
W, H = 1920, 1080
RECORD_S = 16
MARK = """(()=>{const d=document.createElement('div');d.style.cssText='position:fixed;left:0;bottom:0;width:24px;height:24px;background:#ff00ff;z-index:99999;pointer-events:none';document.body.appendChild(d);setTimeout(()=>d.remove(),140);})()"""

# cada robô monta as peças da vez dele (p % total == idx), com o cursor andando junto
BOT = r"""async ([idx, total]) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const room = window.__puzzleRoom, st = room.state;
  const { rows, cols, width, height } = st.config, pw = width / cols, ph = height / rows;
  const rot = (x, y, r) => { r = ((r % 4) + 4) % 4; return r === 1 ? [-y, x] : r === 2 ? [-x, -y] : r === 3 ? [y, -x] : [x, y]; };
  const center = (p, g) => { const [x, y] = rot((p % cols + 0.5) * pw, (Math.floor(p / cols) + 0.5) * ph, g.rotation); return [x + g.x, y + g.y]; };
  // a contagem de 3 s: antes do "valendo" o servidor ignora o grab
  while (st.phase !== 'playing' || st.countdown > 0) await sleep(50);
  await sleep(idx * 450);
  for (let pass = 0; pass < 3 && !window.__botStop; pass++) for (let p = 1; p < rows * cols; p++) {
    if (p % total !== idx || window.__botStop) continue;
    const gid = st.pieceGroup[p], anchorId = st.pieceGroup[0];
    if (gid === anchorId) continue;
    const g = st.groups.get(String(gid)), a = st.groups.get(String(anchorId));
    if (!g || !a || g.heldBy !== '') continue;
    // o cursor vai até a peça
    const [sx, sy] = center(p, g);
    for (let s = 0; s < 8; s++) { room.send('cursor', { x: sx + (8 - s) * 12, y: sy + (8 - s) * 9 }); await sleep(40); }
    room.send('grab', { groupId: gid });
    await sleep(140);
    if (st.groups.get(String(gid))?.heldBy !== room.sessionId) continue;
    for (let k = 0; k < 4 && st.groups.get(String(gid)).rotation !== a.rotation; k++) { room.send('rotate', { groupId: gid }); await sleep(200); }
    const g2 = st.groups.get(String(gid)), x0 = g2.x, y0 = g2.y, x1 = a.x, y1 = a.y, steps = 20;
    for (let s = 1; s <= steps; s++) {
      const k = s / steps, e = k * k * (3 - 2 * k), x = x0 + (x1 - x0) * e, y = y0 + (y1 - y0) * e;
      room.send('move', { groupId: gid, x, y });
      const [cx, cy] = rot((p % cols + 0.5) * pw, (Math.floor(p / cols) + 0.5) * ph, g2.rotation);
      room.send('cursor', { x: cx + x, y: cy + y });
      await sleep(42);
    }
    room.send('drop', { groupId: gid, x: x1, y: y1 });
    await sleep(420 + ((p * 37) % 400));
  }
}"""


CHROME = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
# a câmera de cada um: o vídeo do camaleão em laço; o microfone, um silêncio
CAMERA = r"""(src => {
  const md = navigator.mediaDevices; if (!md) return;
  md.getUserMedia = async c => {
    const tracks = [];
    if (c && c.video) {
      const v = document.createElement('video'); v.src = src; v.muted = true; v.loop = true; v.playsInline = true;
      await v.play(); tracks.push(...v.captureStream(15).getVideoTracks());
    }
    if (c && c.audio) { const ac = new AudioContext(); tracks.push(...ac.createMediaStreamDestination().stream.getAudioTracks()); }
    return new MediaStream(tracks);
  };
})"""
T0 = time.time()


def log(*a):
    print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)


async def context(browser, cam, **kw):
    c = await browser.new_context(permissions=['camera', 'microphone'], **kw)
    data = base64.b64encode(open(f'{CAMS}/{cam}.webm', 'rb').read()).decode()
    await c.add_init_script(f'{CAMERA}("data:video/webm;base64,{data}")')
    return c


async def turn_camera_on(page):
    for _ in range(40):
        button = page.get_by_role('button', name='Ligar a câmera')
        if await button.count():
            await button.first.click()
            return True
        await page.wait_for_timeout(250)
    return False


async def main():
    shutil.rmtree(f'{OUT}/raw_sala', ignore_errors=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=CHROME)
        ctx = await context(browser, 'ana', viewport={'width': W, 'height': H}, record_video_dir=f'{OUT}/raw_sala',
                            record_video_size={'width': W, 'height': H})
        ana = await ctx.new_page()
        ana.set_default_timeout(30000)
        await ana.goto(BASE + '/', wait_until='networkidle'); await ana.wait_for_timeout(1200)
        # a foto da comunidade → Multiplayer, 4 jogadores → Começar
        card = ana.get_by_text('Rua da minha avó', exact=True)
        await card.scroll_into_view_if_needed(); await ana.wait_for_timeout(400)
        box = await card.bounding_box()
        await ana.mouse.click(box['x'] + 120, box['y'] - 160)   # a foto do card, acima do título
        await ana.wait_for_timeout(900)
        await ana.screenshot(path=f'{OUT}/debug_dialog.png')
        await ana.locator('label.mode-option', has_text='Multiplayer').click(); await ana.wait_for_timeout(300)
        four = ana.locator('label.radio-chip', has_text='4')
        if await four.count(): await four.first.click()
        await ana.get_by_role('textbox').last.fill('Ana')
        await ana.screenshot(path=f'{OUT}/debug_multi.png')
        await ana.get_by_role('button', name='Criar sala').last.click()   # o do diálogo (a barra lateral tem outro)
        await ana.wait_for_function('window.__puzzleRoom && window.__puzzleRoom.roomId', timeout=20000)
        code = await ana.evaluate('window.__puzzleRoom.roomId')
        log('sala', code)

        bots = []
        for name, cam in (('Bia', 'bia'), ('Caio', 'caio'), ('Duda', 'duda')):
            c = await context(browser, cam, viewport={'width': 560, 'height': 360})
            pg = await c.new_page()
            pg.set_default_timeout(30000)
            await pg.goto(f'{BASE}/{code}', wait_until='load'); await pg.wait_for_timeout(1500)
            await pg.get_by_role('textbox').first.fill(name)
            await pg.keyboard.press('Enter')
            await pg.wait_for_function('window.__puzzleRoom && window.__puzzleRoom.roomId', timeout=20000)
            bots.append((c, pg))
            log('entrou', name)
        for _, pg in bots:
            log('câmera', await turn_camera_on(pg))
        log('câmera Ana', await turn_camera_on(ana))
        await ana.screenshot(path=f'{OUT}/debug_call.png')
        await ana.wait_for_timeout(4000)   # a chamada conecta e os vídeos chegam
        # Ana (anfitriã) começa
        start = ana.get_by_role('button', name='Começar')
        if await start.count(): await start.first.click()
        tasks = [asyncio.ensure_future(pg.evaluate(BOT, [i, 3])) for i, (_, pg) in enumerate(bots)]
        await ana.wait_for_function("window.__puzzleRoom.state.phase === 'playing' && window.__puzzleRoom.state.countdown === 0")
        await ana.evaluate(MARK)
        log('gravando')
        await ana.wait_for_timeout(RECORD_S * 1000)
        for _, pg in bots:
            await pg.evaluate('window.__botStop = true')
        await asyncio.wait(tasks, timeout=8)
        await ana.screenshot(path=f'{OUT}/debug_end.png')
        log('fechando')
        for c, _ in bots:
            await asyncio.wait_for(c.close(), 30)
        await asyncio.wait_for(ctx.close(), 480)   # o codificador do webm alcança a gravação
        log('fechado')
        await browser.close()

    raw = f'{OUT}/raw_sala'
    webm = [f for f in os.listdir(raw) if f.endswith('.webm')][0]
    os.replace(f'{raw}/{webm}', f'{OUT}/sala.webm'); shutil.rmtree(raw)
    frames = f'{OUT}/frames/sala'
    shutil.rmtree(frames, ignore_errors=True); os.makedirs(frames)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', f'{OUT}/sala.webm', '-vf', 'fps=30', '-q:v', '3', f'{frames}/%04d.jpg'], check=True)
    files = sorted(os.listdir(frames))
    mark = 0
    for i, f in enumerate(files):
        r, g, b = Image.open(f'{frames}/{f}').convert('RGB').getpixel((8, H - 8))
        if r > 200 and g < 80 and b > 200: mark = i; break
    info_path = f'{OUT}/info.json'
    info = json.load(open(info_path)) if os.path.exists(info_path) else {}
    info['sala'] = {'n': len(files), 'mark': mark}
    json.dump(info, open(info_path, 'w'), indent=1)
    log('sala:', len(files), 'quadros, mark', mark)


asyncio.run(main())
