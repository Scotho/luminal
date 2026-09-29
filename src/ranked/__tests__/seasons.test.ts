// ── Season System Tests ─────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { softResetMmr, computeDecayLp, isDecayEligible, daysUntilDecay } from '../seasons';

describe('softResetMmr', () => {
  it('pulls MMR toward 1000 by 50%', () => {
    expect(softResetMmr(2000)).toBe(1500); // (2000 + 1000) / 2
    expect(softResetMmr(600)).toBe(800);   // (600 + 1000) / 2
    expect(softResetMmr(1000)).toBe(1000); // already at default
  });

  it('rounds to integer', () => {
    expect(Number.isInteger(softResetMmr(1001))).toBe(true);
    expect(softResetMmr(1001)).toBe(1001); // (1001 + 1000) / 2 = 1000.5 → 1001
  });

  it('handles edge cases', () => {
    expect(softResetMmr(0)).toBe(500);
    expect(softResetMmr(3000)).toBe(2000);
  });
});

describe('computeDecayLp', () => {
  it('returns 0 within grace period', () => {
    expect(computeDecayLp(0)).toBe(0);
    expect(computeDecayLp(14)).toBe(0);
    expect(computeDecayLp(10)).toBe(0);
  });

  it('returns 25 LP per day past grace period', () => {
    expect(computeDecayLp(15)).toBe(25);   // 1 day past
    expect(computeDecayLp(17)).toBe(75);   // 3 days past
    expect(computeDecayLp(21)).toBe(175);  // 7 days past
  });

  it('respects custom grace period', () => {
    expect(computeDecayLp(5, 7)).toBe(0);  // within custom 7-day grace
    expect(computeDecayLp(10, 7)).toBe(75); // 3 days past custom grace
  });
});

describe('isDecayEligible', () => {
  it('Diamond+ tiers are decay eligible', () => {
    expect(isDecayEligible('diamond')).toBe(true);
    expect(isDecayEligible('master')).toBe(true);
    expect(isDecayEligible('luminal')).toBe(true);
  });

  it('lower tiers are not decay eligible', () => {
    expect(isDecayEligible('bronze')).toBe(false);
    expect(isDecayEligible('silver')).toBe(false);
    expect(isDecayEligible('gold')).toBe(false);
    expect(isDecayEligible('platinum')).toBe(false);
  });
});

describe('daysUntilDecay', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns full grace period for fresh match', () => {
    vi.setSystemTime(new Date('2026-04-07'));
    const lastMatch = new Date('2026-04-07').getTime();
    expect(daysUntilDecay(lastMatch)).toBe(14);
  });

  it('returns 0 when past grace period', () => {
    vi.setSystemTime(new Date('2026-04-21'));
    const lastMatch = new Date('2026-04-01').getTime(); // 20 days ago
    expect(daysUntilDecay(lastMatch)).toBe(0);
  });

  it('counts down correctly mid-grace', () => {
    vi.setSystemTime(new Date('2026-04-17'));
    const lastMatch = new Date('2026-04-07').getTime(); // 10 days ago
    const days = daysUntilDecay(lastMatch);
    expect(days).toBeCloseTo(4, 0); // 14 - 10 = 4
  });
});
