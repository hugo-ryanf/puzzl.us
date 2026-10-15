/** Gerador pseudoaleatório: devolve números em [0, 1) e repete a sequência para o mesmo seed. */
export type Random = () => number;

/** Transforma um texto (ex.: "K7QF-1") num inteiro de 32 bits usável como seed (hash FNV-1a). */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Mulberry32: pequeno, rápido e determinístico. Não serve para criptografia,
 * só para garantir que cliente e servidor gerem o mesmo puzzle a partir do mesmo seed.
 */
export function createRandom(seed: string): Random {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Número uniforme em [min, max). */
export function uniform(random: Random, min: number, max: number): number {
  return min + random() * (max - min);
}
