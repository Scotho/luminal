// ── MMR Elo Calculation Tests ────────────────────────────
import { describe, it, expect } from 'vitest';
import { expectedScore, getKFactor, calculateNewMmr, DEFAULT_MMR, PLACEMENT_MATCHES } from '../mmr';

describe('expectedScore', () => {
  it('returns 0.5 for equal MMR', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5);
  });

  it('returns ~0.76 for 200-point advantage', () => {
    expect(expectedScore(1200, 1000)).toBeCloseTo(0.76, 1);
  });

  it('returns ~0.24 for 200-point disadvantage', () => {
    expect(expectedScore(1000, 1200)).toBeCloseTo(0.24, 1);
  });

  it('returns ~0.91 for 400-point advantage', () => {
    expect(expectedScore(1400, 1000)).toBeCloseTo(0.909, 2);
  });

  it('expected scores of A vs B and B vs A sum to 1', () => {
    const a = expectedScore(1300, 900);
    const b = expectedScore(900, 1300);
    expect(a + b).toBeCloseTo(1.0);
  });

  it('handles very large MMR differences', () => {
    const e = expectedScore(3000, 500);
    expect(e).toBeGreaterThan(0.99);
    expect(e).toBeLessThanOrEqual(1.0);
  });

  it('handles zero MMR', () => {
    const e = expectedScore(0, 1000);
    expect(e).toBeGreaterThan(0);
    expect(e).toBeLessThan(0.5);
  });
});

describe('getKFactor', () => {
  it('returns 64 during placement (games < 5)', () => {
    expect(getKFactor(1000, 0)).toBe(64);
    expect(getKFactor(1000, 4)).toBe(64);
    expect(getKFactor(2500, 3)).toBe(64); // placement overrides MMR
  });

  it('returns 32 for normal MMR after placement', () => {
    expect(getKFactor(1000, 5)).toBe(32);
    expect(getKFactor(1999, 100)).toBe(32);
  });

  it('returns 24 for high MMR (>=2000)', () => {
    expect(getKFactor(2000, 50)).toBe(24);
    expect(getKFactor(2399, 50)).toBe(24);
  });

  it('returns 16 for Master+ MMR (>=2400)', () => {
    expect(getKFactor(2400, 50)).toBe(16);
    expect(getKFactor(3000, 200)).toBe(16);
  });

  it('placement K takes priority over high MMR', () => {
    expect(getKFactor(2500, 2)).toBe(64);
  });
});

describe('calculateNewMmr', () => {
  it('equal MMR: winner gains ~16, loser loses ~16 (K=32)', () => {
    const { winnerNew, loserNew } = calculateNewMmr(1000, 1000, 10, 10);
    expect(winnerNew).toBe(1016); // 1000 + 32 * 0.5 = 1016
    expect(loserNew).toBe(984);   // 1000 + 32 * (0 - 0.5) = 984
  });

  it('upset: lower MMR player beats higher', () => {
    const { winnerNew, loserNew } = calculateNewMmr(800, 1200, 10, 10);
    // Winner expected ~0.09, gains more
    expect(winnerNew).toBeGreaterThan(800 + 20);
    expect(loserNew).toBeLessThan(1200 - 20);
  });

  it('expected: higher MMR player beats lower — gains less', () => {
    const { winnerNew, loserNew } = calculateNewMmr(1200, 800, 10, 10);
    // Winner expected ~0.91, so gains small amount
    expect(winnerNew - 1200).toBeLessThan(10);
    expect(winnerNew).toBeGreaterThan(1200);
    // Loser expected ~0.09, so loses small amount
    expect(loserNew).toBeLessThan(800);
    expect(800 - loserNew).toBeLessThan(10);
  });

  it('placement K (64) produces larger swings', () => {
    const placement = calculateNewMmr(1000, 1000, 2, 2);
    const normal = calculateNewMmr(1000, 1000, 10, 10);
    expect(placement.winnerNew - 1000).toBeGreaterThan(normal.winnerNew - 1000);
  });

  it('MMR cannot go below 0', () => {
    const { loserNew } = calculateNewMmr(500, 10, 10, 10);
    expect(loserNew).toBeGreaterThanOrEqual(0);
  });

  it('MMR floor at 0 for extreme case', () => {
    const { loserNew } = calculateNewMmr(2000, 0, 10, 10);
    expect(loserNew).toBe(0);
  });

  it('mixed K-factors: placement winner vs normal loser', () => {
    const { winnerNew, loserNew } = calculateNewMmr(1000, 1000, 3, 50);
    // Winner K=64 (placement), loser K=32 (normal)
    expect(winnerNew).toBe(1032); // 1000 + 64 * 0.5
    expect(loserNew).toBe(984);   // 1000 + 32 * (0 - 0.5)
  });

  it('returns integer MMR values', () => {
    const { winnerNew, loserNew } = calculateNewMmr(1137, 982, 7, 12);
    expect(Number.isInteger(winnerNew)).toBe(true);
    expect(Number.isInteger(loserNew)).toBe(true);
  });
});

describe('constants', () => {
  it('DEFAULT_MMR is 1000', () => {
    expect(DEFAULT_MMR).toBe(1000);
  });

  it('PLACEMENT_MATCHES is 5', () => {
    expect(PLACEMENT_MATCHES).toBe(5);
  });
});
