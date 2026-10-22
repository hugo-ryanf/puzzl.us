import { describe, expect, it } from 'vitest';
import { longestStreak } from './rankingPage';

describe('longestStreak', () => {
  it('acha a maior sequência de dias seguidos, em qualquer ordem', () => {
    const days = ['2026-10-01', '2026-10-03', '2026-10-04', '2026-10-05', '2026-09-30'];
    expect(longestStreak(new Set(days))).toBe(3);
  });

  it('atravessa a virada do mês e não conta dia repetido', () => {
    expect(longestStreak(new Set(['2026-09-30', '2026-10-01', '2026-10-02']))).toBe(3);
    expect(longestStreak(new Set(['2026-10-01']))).toBe(1);
    expect(longestStreak(new Set())).toBe(0);
  });
});
