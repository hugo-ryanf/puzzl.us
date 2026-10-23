import { useSyncExternalStore } from 'react';

/**
 * Sons do jogo. A contagem regressiva é um arquivo (public/sounds); os outros são sintetizados
 * na hora com a Web Audio API (nada para baixar). Um volume geral liga e desliga tudo, e a
 * escolha fica neste navegador. Independente do áudio da chamada de voz.
 */
export type GameSound =
  | 'snap'
  | 'solved'
  | 'win'
  | 'lose'
  | 'draw'
  | 'end'
  | 'invite'
  | 'bonus'
  | 'lightning'
  | 'magnet'
  | 'shield'
  | 'fog'
  | 'freeze'
  | 'shuffle'
  | 'suddenDeath'
  | 'record';

/** Mesma família das outras chaves do site; 'off' = sons desligados. */
const KEY = 'quebra-cabeca:som';
const COUNTDOWN_URL = '/sounds/countdown.mp3';
/**
 * O arquivo da contagem em dois trechos, cada um com um bipe de referência (`cue`, em s) e o
 * número do relógio em que ele deve cair (`second`): 5 bipes de 1 em 1 s (0,03 s a 4,03 s) para
 * 9…5, e 4 bipes mais fortes (4,87 s a 7,87 s) para 4…1 com o som final (8,87 s) no zero. Entre
 * o 5º e o 6º bipe o arquivo tem só 0,85 s; tocado de uma vez, a primeira metade adiantaria.
 */
const COUNTDOWN_PARTS = [
  { from: 0, to: 4.8, cue: 0.025, second: 9 },
  { from: 4.8, to: Infinity, cue: 4.872, second: 4 },
];
const VOLUME = 0.6;

let enabled = loadEnabled();
const listeners = new Set<() => void>();
let context: AudioContext | undefined;
let master: GainNode | undefined;
let countdown: Promise<AudioBuffer | undefined> | undefined;

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

/** O contexto de áudio, criado no primeiro uso (o navegador só deixa tocar depois de um clique). */
function audio(): { ctx: AudioContext; out: GainNode } | undefined {
  if (typeof AudioContext === 'undefined') return undefined;
  if (!context || !master) {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = enabled ? VOLUME : 0;
    master.connect(context.destination);
  }
  if (context.state === 'suspended') void context.resume();
  return { ctx: context, out: master };
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, 'off');
  } catch {
    // sem storage: vale só nesta aba
  }
  // Desligar no meio de um som (a contagem, por exemplo) corta na hora.
  if (master && context) master.gain.setTargetAtTime(on ? VOLUME : 0, context.currentTime, 0.02);
  listeners.forEach((listener) => listener());
}

/** Sons ligados? Re-renderiza quando muda (o botão da sala). */
export function useSoundEnabled(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => enabled,
  );
}

function loadCountdown(ctx: AudioContext): Promise<AudioBuffer | undefined> {
  countdown ??= fetch(COUNTDOWN_URL)
    .then((response) => response.arrayBuffer())
    .then((data) => ctx.decodeAudioData(data))
    .catch(() => {
      countdown = undefined; // tenta de novo na próxima
      return undefined;
    });
  return countdown;
}

/** Baixa a contagem antes da hora (ao entrar numa sala com relógio), para não atrasar o início. */
export function preloadCountdown() {
  if (!enabled || typeof AudioContext === 'undefined') return;
  const sound = audio();
  if (sound) void loadCountdown(sound.ctx);
}

/**
 * Toca a contagem com cada bipe no segundo certo, sabendo que o zero é daqui a `leftMs`: no
 * "3, 2, 1", só os três últimos bipes e o som final no "Já!"; nos últimos 10 s, os dois trechos.
 * O que já passou fica de fora e o que ainda não chegou espera. Devolve a função que interrompe
 * (saiu da sala no meio).
 */
export function playCountdown(leftMs: number): () => void {
  const sound = enabled ? audio() : undefined;
  if (!sound) return () => {};
  const { ctx, out } = sound;
  const requestedAt = performance.now();
  const sources: AudioBufferSourceNode[] = [];
  let stopped = false;
  void loadCountdown(ctx).then((buffer) => {
    // O tempo que levou para baixar já passou no relógio do jogo.
    const left = (leftMs - (performance.now() - requestedAt)) / 1000;
    if (stopped || !buffer || left < 0.2) return;
    const now = ctx.currentTime;
    for (const part of COUNTDOWN_PARTS) {
      const to = Math.min(part.to, buffer.duration);
      // Daqui a quanto tempo o ponto `from` do arquivo deve tocar (negativo = já passou).
      const delay = left - part.second + part.from - part.cue;
      const skip = Math.max(0, -delay);
      if (part.from + skip >= to) continue;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(out);
      source.start(now + Math.max(0, delay), part.from + skip, to - part.from - skip);
      sources.push(source);
    }
  });
  return () => {
    stopped = true;
    for (const source of sources) source.stop();
  };
}

interface Note {
  freq: number;
  /** Segundos depois do início do som. */
  at: number;
  duration: number;
  type?: OscillatorType;
  volume?: number;
  /** Desliza até esta frequência (o "toc" do encaixe). */
  glideTo?: number;
}

/** Cada som do jogo como uma sequência curta de notas. */
const SOUNDS: Record<GameSound, Note[]> = {
  // Encaixe: um "toc" curto e grave, levemente variado para não cansar.
  snap: [{ freq: 520, glideTo: 300, at: 0, duration: 0.09, type: 'triangle', volume: 0.5 }],
  // Montou um: arpejo subindo (dó, mi, sol, dó).
  solved: [
    { freq: 523.25, at: 0, duration: 0.16, type: 'triangle' },
    { freq: 659.25, at: 0.08, duration: 0.16, type: 'triangle' },
    { freq: 783.99, at: 0.16, duration: 0.16, type: 'triangle' },
    { freq: 1046.5, at: 0.24, duration: 0.35, type: 'triangle' },
  ],
  // Vitória: fanfarra curta terminando num acorde.
  win: [
    { freq: 523.25, at: 0, duration: 0.14, type: 'square', volume: 0.12 },
    { freq: 659.25, at: 0.12, duration: 0.14, type: 'square', volume: 0.12 },
    { freq: 783.99, at: 0.24, duration: 0.14, type: 'square', volume: 0.12 },
    { freq: 1046.5, at: 0.36, duration: 0.7, type: 'triangle' },
    { freq: 783.99, at: 0.36, duration: 0.7, type: 'triangle', volume: 0.2 },
    { freq: 659.25, at: 0.36, duration: 0.7, type: 'triangle', volume: 0.2 },
  ],
  // Derrota: três notas descendo, devagar.
  lose: [
    { freq: 392, at: 0, duration: 0.25, type: 'triangle' },
    { freq: 329.63, at: 0.22, duration: 0.25, type: 'triangle' },
    { freq: 261.63, at: 0.44, duration: 0.6, type: 'triangle' },
  ],
  // Empate: a mesma nota duas vezes.
  draw: [
    { freq: 587.33, at: 0, duration: 0.2, type: 'triangle' },
    { freq: 587.33, at: 0.25, duration: 0.45, type: 'triangle' },
  ],
  // Fim do Bullet: dois toques de sino.
  end: [
    { freq: 783.99, at: 0, duration: 0.5, type: 'sine', volume: 0.35 },
    { freq: 1046.5, at: 0.18, duration: 0.8, type: 'sine', volume: 0.35 },
  ],
  // Bônus de tempo: moedinha (duas notas rápidas e agudas).
  bonus: [
    { freq: 987.77, at: 0, duration: 0.08, type: 'square', volume: 0.1 },
    { freq: 1318.5, at: 0.07, duration: 0.3, type: 'square', volume: 0.1 },
  ],
  // Rodada relâmpago: um "zap" descendo rápido, duas vezes.
  lightning: [
    { freq: 1800, glideTo: 300, at: 0, duration: 0.12, type: 'sawtooth', volume: 0.12 },
    { freq: 1600, glideTo: 250, at: 0.1, duration: 0.18, type: 'sawtooth', volume: 0.1 },
  ],
  // Ímã: zumbido subindo.
  magnet: [{ freq: 220, glideTo: 880, at: 0, duration: 0.35, type: 'sine', volume: 0.3 }],
  // Escudo: "tlim" metálico (duas notas juntas, agudas).
  shield: [
    { freq: 1046.5, at: 0, duration: 0.4, type: 'triangle', volume: 0.25 },
    { freq: 1568, at: 0, duration: 0.4, type: 'sine', volume: 0.15 },
  ],
  // Neblina: sopro grave descendo.
  fog: [{ freq: 520, glideTo: 160, at: 0, duration: 0.6, type: 'sine', volume: 0.3 }],
  // Congelar: cristais (notas agudas rápidas).
  freeze: [
    { freq: 2093, at: 0, duration: 0.12, type: 'sine', volume: 0.18 },
    { freq: 2637, at: 0.06, duration: 0.12, type: 'sine', volume: 0.16 },
    { freq: 3136, at: 0.12, duration: 0.25, type: 'sine', volume: 0.14 },
  ],
  // Embaralhar: notas alternando rápido, como peças voando.
  shuffle: [
    { freq: 440, at: 0, duration: 0.06, type: 'square', volume: 0.1 },
    { freq: 660, at: 0.05, duration: 0.06, type: 'square', volume: 0.1 },
    { freq: 494, at: 0.1, duration: 0.06, type: 'square', volume: 0.1 },
    { freq: 740, at: 0.15, duration: 0.06, type: 'square', volume: 0.1 },
    { freq: 554, at: 0.2, duration: 0.1, type: 'square', volume: 0.1 },
  ],
  // Morte súbita: gongo grave, duas batidas.
  suddenDeath: [
    { freq: 98, at: 0, duration: 1.1, type: 'triangle', volume: 0.5 },
    { freq: 147, at: 0, duration: 0.9, type: 'sine', volume: 0.25 },
    { freq: 98, at: 0.45, duration: 1.2, type: 'triangle', volume: 0.45 },
  ],
  // Novo recorde: fanfarra subindo mais alto que a vitória.
  record: [
    { freq: 659.25, at: 0, duration: 0.12, type: 'square', volume: 0.12 },
    { freq: 783.99, at: 0.1, duration: 0.12, type: 'square', volume: 0.12 },
    { freq: 1046.5, at: 0.2, duration: 0.12, type: 'square', volume: 0.12 },
    { freq: 1318.5, at: 0.3, duration: 0.8, type: 'triangle', volume: 0.3 },
    { freq: 1046.5, at: 0.3, duration: 0.8, type: 'triangle', volume: 0.18 },
  ],
  // Convite de amigo: um "plim" suave.
  invite: [
    { freq: 1318.5, at: 0, duration: 0.25, type: 'sine', volume: 0.22 },
    { freq: 987.77, at: 0.12, duration: 0.45, type: 'sine', volume: 0.22 },
  ],
};

/** `combo`: no encaixe, cada nível de combo sobe o tom um pouco (até ~1,5×). */
export function playSound(name: GameSound, { combo = 1 }: { combo?: number } = {}) {
  const sound = enabled ? audio() : undefined;
  if (!sound) return;
  const { ctx, out } = sound;
  const now = ctx.currentTime + 0.01;
  const detune =
    name === 'snap' ? (0.94 + Math.random() * 0.12) * (1 + 0.06 * Math.max(0, combo - 1)) : 1;
  for (const note of SOUNDS[name]) {
    const start = now + note.at;
    const end = start + note.duration;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = note.type ?? 'sine';
    osc.frequency.setValueAtTime(note.freq * detune, start);
    if (note.glideTo) osc.frequency.exponentialRampToValueAtTime(note.glideTo * detune, end);
    // Ataque rápido e queda exponencial: soa como um toque, sem estalo no começo nem no fim.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(note.volume ?? 0.3, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(out);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}
