/**
 * Limite simples por chave (IP): no máximo `max` ações por janela de `windowMs`. Fica em memória
 * — basta para um servidor só; com vários servidores precisaria de algo compartilhado (Redis).
 */
export function createRateLimiter({ max, windowMs }: { max: number; windowMs: number }) {
  const hits = new Map<string, number[]>();

  return {
    /** Registra a tentativa e diz se ela está dentro do limite. */
    allow(key: string, now = Date.now()): boolean {
      const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}
