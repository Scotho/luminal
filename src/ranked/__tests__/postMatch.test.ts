// ── Post-Match Result Diff Tests ─────────────────────────
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../firebase', () => ({
  db: { __db: true },
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
}));

import { compareRankedData } from '../postMatch';
import type { RankedData } from '../types';

function makeRanked(overrides: Partial<RankedData> = {}): RankedData {
  return {
    mmr: 1000,
    rank: { tier: 'silver', division: 3, lp: 50 },
    placementGamesPlayed: 10,
    placementComplete: true,
    rankedWins: 5,
    rankedLosses: 5,
    rankedGamesPlayed: 10,
    lastRankedMatch: Date.now(),
    demotionShield: false,
    seasonId: 1,
    ...overrides,
  };
}

describe('compareRankedData', () => {
  it('detects LP gain on win', () => {
    const before = makeRanked({ rank: { tier: 'silver', division: 3, lp: 50 } });
    const after = makeRanked({ rank: { tier: 'silver', division: 3, lp: 75 }, mmr: 1016 });
    const diff = compareRankedData(before, after);
    expect(diff.lpChange).toBe(25);
    expect(diff.mmrChange).toBe(16);
    expect(diff.promoted).toBe(false);
    expect(diff.demoted).toBe(false);
  });

  it('detects promotion within tier', () => {
    const before = makeRanked({ rank: { tier: 'silver', division: 3, lp: 85 } });
    const after = makeRanked({ rank: { tier: 'silver', division: 2, lp: 10 } });
    const diff = compareRankedData(before, after);
    expect(diff.promoted).toBe(true);
    expect(diff.tierChange).toBe(false);
  });

  it('detects tier promotion', () => {
    const before = makeRanked({ rank: { tier: 'silver', division: 1, lp: 90 } });
    const after = makeRanked({ rank: { tier: 'gold', division: 4, lp: 15 } });
    const diff = compareRankedData(before, after);
    expect(diff.promoted).toBe(true);
    expect(diff.tierChange).toBe(true);
    expect(diff.newTier).toBe('gold');
  });

  it('detects demotion', () => {
    const before = makeRanked({ rank: { tier: 'gold', division: 3, lp: 10 } });
    const after = makeRanked({ rank: { tier: 'gold', division: 4, lp: 75 } });
    const diff = compareRankedData(before, after);
    expect(diff.demoted).toBe(true);
  });

  it('detects placement completion', () => {
    const before = makeRanked({ placementComplete: false, placementGamesPlayed: 4 });
    const after = makeRanked({ placementComplete: true, placementGamesPlayed: 5, rank: { tier: 'silver', division: 3, lp: 50 } });
    const diff = compareRankedData(before, after);
    expect(diff.placementComplete).toBe(true);
    expect(diff.placementRank).toEqual({ tier: 'silver', division: 3, lp: 50 });
  });

  it('handles null before (first game)', () => {
    const after = makeRanked({ rankedGamesPlayed: 1, mmr: 1032 });
    const diff = compareRankedData(null, after);
    expect(diff.gamesPlayed).toBe(1);
    expect(diff.mmrChange).toBe(32);
  });

  it('handles null after gracefully', () => {
    const diff = compareRankedData(makeRanked(), null);
    expect(diff.lpChange).toBe(0);
    expect(diff.mmrChange).toBe(0);
  });
});
