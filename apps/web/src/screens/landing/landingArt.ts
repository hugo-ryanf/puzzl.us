/**
 * A arte da landing: a malha low-poly atrás do camaleão, as peças que saem do lugar e voltam (com
 * o cursor de quem está montando) e os cacos que flutuam. Tudo calculado uma vez, com sementes
 * fixas: a página desenha sempre a mesma coisa. Há uma versão clara (verde) e uma escura (neon).
 */

export interface Triangle {
  points: string;
  fill: string;
  stroke: string;
  width: number;
}

export interface Mover {
  id: string;
  path: string;
  dx: number;
  dy: number;
  rotate: number;
  delay: number;
  /** Centro da peça: em volta dele ela gira (a caixa do grupo é a arte inteira). */
  centerX: number;
  centerY: number;
  cursorX: number;
  cursorY: number;
  name: string;
  color: string;
  tagWidth: number;
}

export interface Shard {
  points: string;
  fill: string;
  stroke: string;
  delay: number;
}

export interface BannerArt {
  mesh: Triangle[];
  movers: Mover[];
  shards: Shard[];
  /** O fundo da galeria. */
  backdrop: Triangle[];
}

const round = (n: number) => Math.round(n * 10) / 10;
const pt = ([x, y]: [number, number]) => `${round(x)},${round(y)}`;

function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Malha de triângulos sobre uma grade com os vértices internos deslocados. */
function mesh(
  cols: number,
  rows: number,
  width: number,
  height: number,
  seed: number,
  jitter: number,
  shade: (cx: number, cy: number, side: number, rnd: () => number) => Omit<Triangle, 'points'>,
): Triangle[] {
  const rnd = random(seed);
  const cw = width / cols;
  const rh = height / rows;
  const grid: Array<Array<[number, number]>> = [];
  for (let r = 0; r <= rows; r++) {
    const row: Array<[number, number]> = [];
    for (let c = 0; c <= cols; c++) {
      const edgeX = c === 0 || c === cols;
      const edgeY = r === 0 || r === rows;
      row.push([
        c * cw + (edgeX ? 0 : (rnd() - 0.5) * cw * jitter),
        r * rh + (edgeY ? 0 : (rnd() - 0.5) * rh * jitter),
      ]);
    }
    grid.push(row);
  }
  const out: Triangle[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = grid[r]![c]!;
      const b = grid[r]![c + 1]!;
      const d = grid[r + 1]![c]!;
      const e = grid[r + 1]![c + 1]!;
      const tris =
        (r + c) % 2
          ? [
              [a, b, e],
              [a, e, d],
            ]
          : [
              [a, b, d],
              [b, e, d],
            ];
      for (const [p, q, s] of tris as Array<[typeof a, typeof a, typeof a]>) {
        const cx = (p[0] + q[0] + s[0]) / 3 / width;
        const cy = (p[1] + q[1] + s[1]) / 3 / height;
        const normal = (q[1] - p[1]) * (s[0] - p[0]) - (q[0] - p[0]) * (s[1] - p[1]);
        out.push({
          points: `${pt(p)} ${pt(q)} ${pt(s)}`,
          ...shade(cx, cy, Math.sign(normal), rnd),
        });
      }
    }
  }
  return out;
}

/** O contorno de uma peça (lado de 100 no banner 1440×600), com encaixes de um hash da posição. */
function piecePath(row: number, col: number, rows: number, cols: number, size: number): string {
  const hash = (a: number, b: number, c: number) =>
    ((((a + 3) * 73856093) ^ ((b + 5) * 19349663) ^ (c * 83492791)) >>> 4) & 1 ? 1 : -1;
  const k = size / 100;
  const edge = (
    x0: number,
    y0: number,
    ux: number,
    uy: number,
    nx: number,
    ny: number,
    tab: number,
    lead: string,
  ) => {
    const P = (a: number, o: number) =>
      `${round(x0 + ux * a * k + nx * o * tab * k)},${round(y0 + uy * a * k + ny * o * tab * k)}`;
    if (!tab) return `${lead}${P(0, 0)}L${P(100, 0)}`;
    return (
      `${lead}${P(0, 0)}L${P(37, 0)}C${P(40, 0)} ${P(41, 5)} ${P(38, 10)}` +
      `C${P(34, 18)} ${P(40, 25)} ${P(50, 25)}C${P(60, 25)} ${P(66, 18)} ${P(62, 10)}` +
      `C${P(59, 5)} ${P(60, 0)} ${P(63, 0)}L${P(100, 0)}`
    );
  };
  const x = col * size;
  const y = row * size;
  const top = row > 0 ? -hash(row, col, 2) : 0;
  const bottom = row < rows - 1 ? hash(row + 1, col, 2) : 0;
  const left = col > 0 ? -hash(row, col, 1) : 0;
  const right = col < cols - 1 ? hash(row, col + 1, 1) : 0;
  return (
    edge(x, y, 1, 0, 0, -1, top, 'M') +
    edge(x + size, y, 0, 1, 1, 0, right, 'L') +
    edge(x + size, y + size, -1, 0, 0, 1, bottom, 'L') +
    edge(x, y + size, 0, -1, -1, 0, left, 'L') +
    'Z'
  );
}

/** As quatro peças que saem do lugar, cada uma com o cursor de um amigo. */
function movers(prefix: string, colors: [string, string, string, string]): Mover[] {
  // um T de cabeça para baixo: três na última linha, rentes à borda do banner, e uma em cima da
  // do meio; cada uma sai por baixo, atravessando a borda do banner (por cima da galeria)
  const defs = [
    { r: 4, c: 12, dx: -40, dy: 230, rotate: -14, delay: 0, name: 'Ana' },
    { r: 5, c: 11, dx: -150, dy: 140, rotate: -10, delay: -1.75, name: 'Léo' },
    { r: 5, c: 12, dx: 30, dy: 170, rotate: 12, delay: -3.5, name: 'Bia' },
    { r: 5, c: 13, dx: 130, dy: 130, rotate: 16, delay: -5.25, name: 'Caio' },
  ];
  const size = 100;
  return defs.map((m, i) => ({
    id: `${prefix}${i}`,
    path: piecePath(m.r, m.c, 6, 15, size),
    dx: m.dx,
    dy: m.dy,
    rotate: m.rotate,
    delay: m.delay,
    centerX: m.c * size + size / 2,
    centerY: m.r * size + size / 2,
    cursorX: m.c * size + 58,
    cursorY: m.r * size + 52,
    name: m.name,
    color: colors[i]!,
    tagWidth: m.name.length * 9 + 24,
  }));
}

function mix(
  stops: Array<[number, [number, number, number]]>,
  t: number,
): [number, number, number] {
  const k = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const [ta, a] = stops[i]!;
    const [tb, b] = stops[i + 1]!;
    if (k <= tb) {
      const f = (k - ta) / (tb - ta || 1);
      return [0, 1, 2].map((j) => a[j]! + (b[j]! - a[j]!) * f) as [number, number, number];
    }
  }
  return stops[stops.length - 1]![1];
}

/** Tema claro: verde-claro, quase branco, com alguns traços na cor do camaleão. */
export const LIGHT_ART: BannerArt = {
  mesh: mesh(18, 8, 1440, 600, 42, 0.7, (cx, cy, side, rnd) => {
    const light = side * 1.6 + (rnd() - 0.5) * 3.2;
    const fill = `hsl(${(150 + cx * 22 - cy * 10).toFixed(0)}, ${(18 + cx * 26 + cy * 14).toFixed(0)}%, ${Math.min(99, 97.5 - cx * 5 - cy * 6 + light).toFixed(1)}%)`;
    const accent = rnd() < 0.05;
    return { fill, stroke: accent ? 'rgba(18,138,94,0.55)' : fill, width: accent ? 1.3 : 0.6 };
  }),
  movers: movers('lp-light-', ['#2B59FF', '#B4235A', '#E5862D', '#7B3FE4']),
  shards: [
    {
      points: '980,520 1040,470 1060,560',
      fill: 'rgba(47,179,110,0.2)',
      stroke: 'rgba(18,138,94,0.75)',
      delay: 0,
    },
    {
      points: '1380,90 1420,40 1430,120',
      fill: 'rgba(27,156,143,0.18)',
      stroke: 'rgba(27,156,143,0.75)',
      delay: -2,
    },
    {
      points: '900,60 940,30 950,90',
      fill: 'rgba(166,207,62,0.25)',
      stroke: 'rgba(92,150,40,0.75)',
      delay: -4,
    },
    {
      points: '1360,420 1410,390 1400,460',
      fill: 'rgba(18,138,94,0.18)',
      stroke: 'rgba(13,59,50,0.6)',
      delay: -1,
    },
    {
      points: '820,560 860,520 880,585',
      fill: 'rgba(124,194,74,0.2)',
      stroke: 'rgba(18,138,94,0.7)',
      delay: -3,
    },
  ],
  backdrop: mesh(18, 8, 1440, 640, 23, 0.75, (cx, cy, side, rnd) => {
    const fill = `hsl(${(148 + cx * 16).toFixed(0)}, 32%, ${(97 - cy * 2.5 - cx * 1.5 + side * 0.9 + (rnd() - 0.5) * 1.8).toFixed(1)}%)`;
    return { fill, stroke: fill, width: 0.6 };
  }),
};

const NEON: Array<[number, [number, number, number]]> = [
  [0, [14, 28, 92]],
  [0.45, [24, 46, 140]],
  [0.75, [40, 58, 170]],
  [1, [58, 72, 196]],
];

/** Tema escuro: do azul-marinho ao índigo, com alguns traços ciano. */
export const DARK_ART: BannerArt = {
  mesh: mesh(20, 9, 1440, 600, 91, 0.75, (cx, cy, side, rnd) => {
    const base = mix(NEON, cx * 0.7 + (1 - cy) * 0.45 - 0.08);
    const k = 0.62 + side * 0.07 + (rnd() - 0.5) * 0.22;
    const fill = `rgb(${base.map((x) => Math.round(Math.min(255, x * k))).join(',')})`;
    const neon = rnd() < 0.05;
    return { fill, stroke: neon ? 'rgba(125,249,255,0.55)' : fill, width: neon ? 1.4 : 0.6 };
  }),
  movers: movers('lp-dark-', ['#2F6BFF', '#E52BBF', '#8B3DFF', '#00B8C9']),
  shards: [
    {
      points: '980,520 1040,470 1060,560',
      fill: 'rgba(61,140,255,0.16)',
      stroke: 'rgba(110,170,255,0.8)',
      delay: 0,
    },
    {
      points: '1380,90 1420,40 1430,120',
      fill: 'rgba(61,245,255,0.14)',
      stroke: 'rgba(125,249,255,0.75)',
      delay: -2,
    },
    {
      points: '900,60 940,30 950,90',
      fill: 'rgba(90,110,255,0.2)',
      stroke: 'rgba(130,150,255,0.8)',
      delay: -4,
    },
    {
      points: '1360,420 1410,390 1400,460',
      fill: 'rgba(47,107,255,0.2)',
      stroke: 'rgba(110,150,255,0.85)',
      delay: -1,
    },
    {
      points: '820,560 860,520 880,585',
      fill: 'rgba(61,245,255,0.12)',
      stroke: 'rgba(125,249,255,0.7)',
      delay: -3,
    },
  ],
  backdrop: mesh(18, 8, 1440, 640, 17, 0.75, (cx, cy, side, rnd) => {
    const fill = `hsl(${(222 + cx * 14).toFixed(0)}, 48%, ${(8 + cy * 4 + side * 1.2 + rnd() * 2.6).toFixed(1)}%)`;
    return { fill, stroke: fill, width: 0.6 };
  }),
};
