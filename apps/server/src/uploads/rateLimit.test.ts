import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rateLimit';

describe('createRateLimiter', () => {
  it('libera até o limite dentro da janela e bloqueia o resto', () => {
    const limiter = createRateLimiter({ max: 3, windowMs: 1000 });
    const results = [0, 100, 200, 300].map((t) => limiter.allow('1.2.3.4', t));
    expect(results).toEqual([true, true, true, false]);
  });

  it('libera de novo quando as tentativas antigas saem da janela', () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 1000 });
    limiter.allow('ip', 0);
    limiter.allow('ip', 500);
    expect(limiter.allow('ip', 900)).toBe(false);
    expect(limiter.allow('ip', 1001)).toBe(true); // a de t=0 expirou
  });

  it('conta cada IP separado', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('b', 0)).toBe(true);
    expect(limiter.allow('a', 10)).toBe(false);
  });
});
