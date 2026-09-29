// ── Rank Tiers & LP Calculation Tests ────────────────────
import { describe, it, expect } from 'vitest';
import {
  TIER_MMR_RANGES, TIER_COLORS, DIVISIONS,
  getRankFromMmr, getRankMidpointMmr, calculateLpChange,
  getTierDisplayName, getRankCompact, getTierIndex, hasDivisions,
} from '../ranks';
import { TIERS } from '../types';

describe('constants', () => {
  it('has 7 tiers', () => {
    expect(TIERS).toHaveLength(7);
  });

  it('has 4 divisions', () => {
    expect(DIVISIONS).toEqual([4, 3, 2, 1]);
  });

  it('every tier has a color', () => {
    for (const tier of TIERS) {
      expect(TIER_COLORS[tier]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('every tier has an MMR range', () => {
    for (const tier of TIERS) {
      expect(TIER_MMR_RANGES[tier].min).toBeDefined();
      expect(TIER_MMR_RANGES[tier].max).toBeDefined();
    }
  });

  it('tier ranges are contiguous (no gaps)', () => {
    const ordered = ['bronze', 'silver', 'gold', 'platinum', 'diamond'] as const;
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(TIER_MMR_RANGES[ordered[i + 1]].min).toBe(TIER_MMR_RANGES[ordered[i]].max + 1);
    }
  });
});

describe('getRankFromMmr', () => {
  it('MMR 0 → Bronze IV', () => {
    const r = getRankFromMmr(0);
    expect(r.tier).toBe('bronze');
    expect(r.division).toBe(4);
  });

  it('MMR 500 → Bronze II', () => {
    const r = getRankFromMmr(500);
    expect(r.tier).toBe('bronze');
    expect(r.division).toBe(2);
  });

  it('MMR 1000 → Silver III (default placement)', () => {
    const r = getRankFromMmr(1000);
    expect(r.tier).toBe('silver');
    expect(r.division).toBe(3);
  });

  it('MMR 1200 → Gold IV', () => {
    const r = getRankFromMmr(1200);
    expect(r.tier).toBe('gold');
    expect(r.division).toBe(4);
  });

  it('MMR 1600+ caps at Platinum IV (max placement)', () => {
    const r = getRankFromMmr(2000);
    expect(r.tier).toBe('platinum');
    expect(r.division).toBe(4);
  });

  it('all placements start with 50 LP', () => {
    for (const mmr of [0, 500, 1000, 1500, 2000]) {
      expect(getRankFromMmr(mmr).lp).toBe(50);
    }
  });
});

describe('getRankMidpointMmr', () => {
  it('Bronze IV midpoint is ~100', () => {
    const mid = getRankMidpointMmr('bronze', 4);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(200);
  });

  it('Bronze I midpoint is ~700', () => {
    const mid = getRankMidpointMmr('bronze', 1);
    expect(mid).toBeGreaterThan(600);
    expect(mid).toBeLessThan(800);
  });

  it('Gold III midpoint is in gold range', () => {
    const mid = getRankMidpointMmr('gold', 3);
    expect(mid).toBeGreaterThanOrEqual(1200);
    expect(mid).toBeLessThanOrEqual(1599);
  });

  it('Master midpoint is 2600', () => {
    expect(getRankMidpointMmr('master', 1)).toBe(2600);
  });

  it('higher divisions have higher midpoints within a tier', () => {
    const div4 = getRankMidpointMmr('silver', 4);
    const div3 = getRankMidpointMmr('silver', 3);
    const div2 = getRankMidpointMmr('silver', 2);
    const div1 = getRankMidpointMmr('silver', 1);
    expect(div4).toBeLessThan(div3);
    expect(div3).toBeLessThan(div2);
    expect(div2).toBeLessThan(div1);
  });
});

describe('calculateLpChange', () => {
  it('returns 25 when MMR matches rank midpoint', () => {
    const mid = getRankMidpointMmr('silver', 3);
    expect(calculateLpChange(mid, 'silver', 3, true)).toBe(25);
    expect(calculateLpChange(mid, 'silver', 3, false)).toBe(25);
  });

  it('win gains more LP when MMR is above rank', () => {
    const gain = calculateLpChange(1500, 'silver', 3, true);
    expect(gain).toBeGreaterThan(25);
    expect(gain).toBeLessThanOrEqual(35);
  });

  it('win gains less LP when MMR is below rank', () => {
    const gain = calculateLpChange(500, 'silver', 3, true);
    expect(gain).toBeLessThan(25);
    expect(gain).toBeGreaterThanOrEqual(15);
  });

  it('loss costs less LP when MMR is above rank', () => {
    const loss = calculateLpChange(1500, 'silver', 3, false);
    expect(loss).toBeLessThan(25);
    expect(loss).toBeGreaterThanOrEqual(15);
  });

  it('loss costs more LP when MMR is below rank', () => {
    const loss = calculateLpChange(500, 'silver', 3, false);
    expect(loss).toBeGreaterThan(25);
    expect(loss).toBeLessThanOrEqual(35);
  });

  it('LP change is clamped between 15 and 35', () => {
    // Extreme MMR difference
    const highGain = calculateLpChange(5000, 'bronze', 4, true);
    const lowGain = calculateLpChange(0, 'diamond', 1, true);
    expect(highGain).toBe(35);
    expect(lowGain).toBe(15);
  });
});

describe('getTierDisplayName', () => {
  it('formats tiered ranks correctly', () => {
    expect(getTierDisplayName('gold', 2)).toBe('Gold II');
    expect(getTierDisplayName('bronze', 4)).toBe('Bronze IV');
    expect(getTierDisplayName('diamond', 1)).toBe('Diamond I');
  });

  it('master and luminal have no division suffix', () => {
    expect(getTierDisplayName('master', 1)).toBe('Master');
    expect(getTierDisplayName('luminal', 1)).toBe('Luminal');
  });
});

describe('getRankCompact', () => {
  it('formats compact rank string', () => {
    expect(getRankCompact('gold', 2, 72)).toBe('G2 72LP');
    expect(getRankCompact('master', 1, 450)).toBe('M 450LP');
  });
});

describe('getTierIndex', () => {
  it('bronze is 0, luminal is 6', () => {
    expect(getTierIndex('bronze')).toBe(0);
    expect(getTierIndex('luminal')).toBe(6);
  });
});

describe('hasDivisions', () => {
  it('returns true for tiered ranks', () => {
    expect(hasDivisions('bronze')).toBe(true);
    expect(hasDivisions('diamond')).toBe(true);
  });

  it('returns false for master and luminal', () => {
    expect(hasDivisions('master')).toBe(false);
    expect(hasDivisions('luminal')).toBe(false);
  });
});
