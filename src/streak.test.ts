import { describe, it, expect, beforeEach } from 'vitest';
import {
  STREAK_TIER_1, STREAK_TIER_2, STREAK_TIER_3, STREAK_TIER_4,
  STREAK_PROXIMITY_CUE,
  getStreakTier,
  getStreakKey,
  getStreakForMode,
  getBestStreakForMode,
  isNewRecord,
  getDistanceToBest,
  incrementStreak,
  resetStreak,
  loadStreaks,
  saveStreaks,
} from './streak';
import type { StreakData } from './types';

// ── Helper ────────────────────────────────────────────────
function makeDefault(): StreakData {
  return {
    bo1: { currentStreak: 0, bestStreak: 0 },
    bo3: { currentStreak: 0, bestStreak: 0 },
    bo5: { currentStreak: 0, bestStreak: 0 },
  };
}

// ═════════════════════════════════════════════════════════
// Group 1: Constants
// ═════════════════════════════════════════════════════════
describe('streak constants', () => {
  it('STREAK_TIER_1 is 3', () => {
    expect(STREAK_TIER_1).toBe(3);
  });

  it('STREAK_TIER_2 is 5', () => {
    expect(STREAK_TIER_2).toBe(5);
  });

  it('STREAK_TIER_3 is 10', () => {
    expect(STREAK_TIER_3).toBe(10);
  });

  it('STREAK_TIER_4 is 20', () => {
    expect(STREAK_TIER_4).toBe(20);
  });

  it('STREAK_PROXIMITY_CUE is 3', () => {
    expect(STREAK_PROXIMITY_CUE).toBe(3);
  });
});

// ═════════════════════════════════════════════════════════
// Group 2: getStreakTier
// ═════════════════════════════════════════════════════════
describe('getStreakTier', () => {
  it('returns 0 for streak of 0', () => {
    expect(getStreakTier(0)).toBe(0);
  });

  it('returns 0 for streak of 1', () => {
    expect(getStreakTier(1)).toBe(0);
  });

  it('returns 0 for streak of 2 (one below tier 1 threshold)', () => {
    expect(getStreakTier(2)).toBe(0);
  });

  it('returns 1 at exactly STREAK_TIER_1 (3)', () => {
    expect(getStreakTier(STREAK_TIER_1)).toBe(1);
  });

  it('returns 1 for streaks 3–4', () => {
    expect(getStreakTier(3)).toBe(1);
    expect(getStreakTier(4)).toBe(1);
  });

  it('returns 2 at exactly STREAK_TIER_2 (5)', () => {
    expect(getStreakTier(STREAK_TIER_2)).toBe(2);
  });

  it('returns 2 for streaks 5–9', () => {
    expect(getStreakTier(5)).toBe(2);
    expect(getStreakTier(9)).toBe(2);
  });

  it('returns 3 at exactly STREAK_TIER_3 (10)', () => {
    expect(getStreakTier(STREAK_TIER_3)).toBe(3);
  });

  it('returns 3 for streaks 10–19', () => {
    expect(getStreakTier(10)).toBe(3);
    expect(getStreakTier(19)).toBe(3);
  });

  it('returns 4 at exactly STREAK_TIER_4 (20)', () => {
    expect(getStreakTier(STREAK_TIER_4)).toBe(4);
  });

  it('returns 4 for streaks well above tier 4', () => {
    expect(getStreakTier(50)).toBe(4);
    expect(getStreakTier(100)).toBe(4);
  });
});

// ═════════════════════════════════════════════════════════
// Group 3: getStreakKey
// ═════════════════════════════════════════════════════════
describe('getStreakKey', () => {
  it('maps seriesLength=1 to bo1', () => {
    expect(getStreakKey(1)).toBe('bo1');
  });

  it('maps seriesLength=3 to bo3', () => {
    expect(getStreakKey(3)).toBe('bo3');
  });

  it('maps seriesLength=5 to bo5', () => {
    expect(getStreakKey(5)).toBe('bo5');
  });

  it('defaults unrecognised values to bo1', () => {
    expect(getStreakKey(0)).toBe('bo1');
    expect(getStreakKey(2)).toBe('bo1');
    expect(getStreakKey(7)).toBe('bo1');
    expect(getStreakKey(99)).toBe('bo1');
  });
});

// ═════════════════════════════════════════════════════════
// Group 4: getStreakForMode
// ═════════════════════════════════════════════════════════
describe('getStreakForMode', () => {
  it('returns currentStreak for bo1', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 7;
    expect(getStreakForMode(data, 'bo1')).toBe(7);
  });

  it('returns currentStreak for bo3', () => {
    const data = makeDefault();
    data.bo3.currentStreak = 3;
    expect(getStreakForMode(data, 'bo3')).toBe(3);
  });

  it('returns currentStreak for bo5', () => {
    const data = makeDefault();
    data.bo5.currentStreak = 11;
    expect(getStreakForMode(data, 'bo5')).toBe(11);
  });

  it('returns 0 for a fresh default structure', () => {
    const data = makeDefault();
    expect(getStreakForMode(data, 'bo1')).toBe(0);
    expect(getStreakForMode(data, 'bo3')).toBe(0);
    expect(getStreakForMode(data, 'bo5')).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════
// Group 5: getBestStreakForMode
// ═════════════════════════════════════════════════════════
describe('getBestStreakForMode', () => {
  it('returns bestStreak for bo1', () => {
    const data = makeDefault();
    data.bo1.bestStreak = 15;
    expect(getBestStreakForMode(data, 'bo1')).toBe(15);
  });

  it('returns bestStreak for bo3', () => {
    const data = makeDefault();
    data.bo3.bestStreak = 9;
    expect(getBestStreakForMode(data, 'bo3')).toBe(9);
  });

  it('returns 0 for a fresh default structure', () => {
    const data = makeDefault();
    expect(getBestStreakForMode(data, 'bo5')).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════
// Group 6: isNewRecord
// ═════════════════════════════════════════════════════════
describe('isNewRecord', () => {
  it('returns true when currentStreak strictly exceeds bestStreak', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 6;
    data.bo1.bestStreak = 5;
    expect(isNewRecord(data, 'bo1')).toBe(true);
  });

  it('returns false when currentStreak equals bestStreak', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 5;
    data.bo1.bestStreak = 5;
    expect(isNewRecord(data, 'bo1')).toBe(false);
  });

  it('returns false when currentStreak is below bestStreak', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 3;
    data.bo1.bestStreak = 10;
    expect(isNewRecord(data, 'bo1')).toBe(false);
  });

  it('returns false at zero streak (both zero)', () => {
    const data = makeDefault();
    expect(isNewRecord(data, 'bo3')).toBe(false);
  });

  it('works independently per mode key', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 5;
    data.bo1.bestStreak = 4;
    data.bo3.currentStreak = 2;
    data.bo3.bestStreak = 9;
    expect(isNewRecord(data, 'bo1')).toBe(true);
    expect(isNewRecord(data, 'bo3')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════
// Group 7: getDistanceToBest
// ═════════════════════════════════════════════════════════
describe('getDistanceToBest', () => {
  it('returns positive distance when current is below best', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 5;
    data.bo1.bestStreak = 8;
    expect(getDistanceToBest(data, 'bo1')).toBe(3);
  });

  it('returns 0 when current equals best', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 8;
    data.bo1.bestStreak = 8;
    expect(getDistanceToBest(data, 'bo1')).toBe(0);
  });

  it('returns 0 when current exceeds best (clamps to 0)', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 10;
    data.bo1.bestStreak = 7;
    expect(getDistanceToBest(data, 'bo1')).toBe(0);
  });

  it('returns 0 for fresh default (both zero)', () => {
    const data = makeDefault();
    expect(getDistanceToBest(data, 'bo5')).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════
// Group 8: incrementStreak
// ═════════════════════════════════════════════════════════
describe('incrementStreak', () => {
  it('increments currentStreak by 1 for bo1', () => {
    const data = makeDefault();
    const result = incrementStreak(data, 'bo1');
    expect(result.bo1.currentStreak).toBe(1);
  });

  it('increments currentStreak by 1 for bo3', () => {
    const data = makeDefault();
    const result = incrementStreak(data, 'bo3');
    expect(result.bo3.currentStreak).toBe(1);
  });

  it('increments currentStreak by 1 for bo5', () => {
    const data = makeDefault();
    const result = incrementStreak(data, 'bo5');
    expect(result.bo5.currentStreak).toBe(1);
  });

  it('promotes bestStreak when currentStreak exceeds it', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 4;
    data.bo1.bestStreak = 4;
    const result = incrementStreak(data, 'bo1');
    expect(result.bo1.currentStreak).toBe(5);
    expect(result.bo1.bestStreak).toBe(5);
  });

  it('does not update bestStreak when current stays below it', () => {
    const data = makeDefault();
    data.bo1.bestStreak = 10;
    data.bo1.currentStreak = 2;
    const result = incrementStreak(data, 'bo1');
    expect(result.bo1.currentStreak).toBe(3);
    expect(result.bo1.bestStreak).toBe(10);
  });

  it('returns a new object (does not mutate input)', () => {
    const data = makeDefault();
    const result = incrementStreak(data, 'bo1');
    expect(result).not.toBe(data);
    expect(data.bo1.currentStreak).toBe(0); // original unchanged
  });

  it('does not affect other modes', () => {
    const data = makeDefault();
    data.bo3.currentStreak = 5;
    data.bo5.currentStreak = 2;
    const result = incrementStreak(data, 'bo1');
    expect(result.bo3.currentStreak).toBe(5);
    expect(result.bo5.currentStreak).toBe(2);
  });

  it('can be chained to simulate multiple wins', () => {
    let data = makeDefault();
    for (let i = 0; i < 5; i++) {
      data = incrementStreak(data, 'bo1');
    }
    expect(data.bo1.currentStreak).toBe(5);
    expect(data.bo1.bestStreak).toBe(5);
  });
});

// ═════════════════════════════════════════════════════════
// Group 9: resetStreak
// ═════════════════════════════════════════════════════════
describe('resetStreak', () => {
  it('resets currentStreak to 0 for bo1', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 7;
    const result = resetStreak(data, 'bo1');
    expect(result.bo1.currentStreak).toBe(0);
  });

  it('resets currentStreak to 0 for bo3', () => {
    const data = makeDefault();
    data.bo3.currentStreak = 3;
    const result = resetStreak(data, 'bo3');
    expect(result.bo3.currentStreak).toBe(0);
  });

  it('resets currentStreak to 0 for bo5', () => {
    const data = makeDefault();
    data.bo5.currentStreak = 12;
    const result = resetStreak(data, 'bo5');
    expect(result.bo5.currentStreak).toBe(0);
  });

  it('preserves bestStreak after reset', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 7;
    data.bo1.bestStreak = 12;
    const result = resetStreak(data, 'bo1');
    expect(result.bo1.bestStreak).toBe(12);
  });

  it('returns a new object (does not mutate input)', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 7;
    const result = resetStreak(data, 'bo1');
    expect(result).not.toBe(data);
    expect(data.bo1.currentStreak).toBe(7); // original unchanged
  });

  it('does not affect other modes', () => {
    const data = makeDefault();
    data.bo3.currentStreak = 5;
    data.bo5.currentStreak = 3;
    const result = resetStreak(data, 'bo1');
    expect(result.bo3.currentStreak).toBe(5);
    expect(result.bo5.currentStreak).toBe(3);
  });

  it('resetting an already-zero streak leaves it at 0', () => {
    const data = makeDefault();
    const result = resetStreak(data, 'bo1');
    expect(result.bo1.currentStreak).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════
// Group 10: loadStreaks / saveStreaks
// ═════════════════════════════════════════════════════════
describe('loadStreaks / saveStreaks', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns all-zero default when localStorage is empty', () => {
    const data = loadStreaks();
    expect(data.bo1.currentStreak).toBe(0);
    expect(data.bo1.bestStreak).toBe(0);
    expect(data.bo3.currentStreak).toBe(0);
    expect(data.bo3.bestStreak).toBe(0);
    expect(data.bo5.currentStreak).toBe(0);
    expect(data.bo5.bestStreak).toBe(0);
  });

  it('round-trips all three modes correctly', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 5;
    data.bo1.bestStreak = 12;
    data.bo3.currentStreak = 2;
    data.bo3.bestStreak = 7;
    data.bo5.currentStreak = 1;
    data.bo5.bestStreak = 3;
    saveStreaks(data);
    const loaded = loadStreaks();
    expect(loaded.bo1.currentStreak).toBe(5);
    expect(loaded.bo1.bestStreak).toBe(12);
    expect(loaded.bo3.currentStreak).toBe(2);
    expect(loaded.bo3.bestStreak).toBe(7);
    expect(loaded.bo5.currentStreak).toBe(1);
    expect(loaded.bo5.bestStreak).toBe(3);
  });

  it('saveStreaks writes JSON to the correct localStorage key', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 3;
    saveStreaks(data);
    const raw = localStorage.getItem('luminal-streaks');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.bo1.currentStreak).toBe(3);
  });

  it('falls back to default when stored JSON is corrupt', () => {
    localStorage.setItem('luminal-streaks', '{not valid json!!!}');
    const data = loadStreaks();
    expect(data.bo1.currentStreak).toBe(0);
    expect(data.bo1.bestStreak).toBe(0);
  });

  it('falls back to default when stored value is empty string', () => {
    localStorage.setItem('luminal-streaks', '');
    // empty string is falsy — falls through to legacy check then default
    const data = loadStreaks();
    expect(data.bo1.currentStreak).toBe(0);
  });

  it('handles partial storage: missing bo3/bo5 keys default to 0', () => {
    localStorage.setItem('luminal-streaks', JSON.stringify({ bo1: { currentStreak: 4, bestStreak: 9 } }));
    const data = loadStreaks();
    expect(data.bo1.currentStreak).toBe(4);
    expect(data.bo1.bestStreak).toBe(9);
    expect(data.bo3.currentStreak).toBe(0);
    expect(data.bo3.bestStreak).toBe(0);
    expect(data.bo5.currentStreak).toBe(0);
    expect(data.bo5.bestStreak).toBe(0);
  });

  it('handles partial mode entry: missing fields default to 0', () => {
    localStorage.setItem('luminal-streaks', JSON.stringify({
      bo1: { currentStreak: 7 }, // bestStreak missing
      bo3: { bestStreak: 5 },    // currentStreak missing
      bo5: {},
    }));
    const data = loadStreaks();
    expect(data.bo1.currentStreak).toBe(7);
    expect(data.bo1.bestStreak).toBe(0);
    expect(data.bo3.currentStreak).toBe(0);
    expect(data.bo3.bestStreak).toBe(5);
    expect(data.bo5.currentStreak).toBe(0);
    expect(data.bo5.bestStreak).toBe(0);
  });

  it('migrates legacy luminal-stats bestStreak into bo1.bestStreak', () => {
    localStorage.setItem('luminal-stats', JSON.stringify({
      wins: 10, losses: 5, draws: 1, bestStreak: 7, totalTime: 300, matchCount: 16,
    }));
    const data = loadStreaks();
    expect(data.bo1.bestStreak).toBe(7);
    expect(data.bo1.currentStreak).toBe(0);
    expect(data.bo3.bestStreak).toBe(0);
    expect(data.bo5.bestStreak).toBe(0);
  });

  it('ignores legacy stats when no bestStreak field present', () => {
    localStorage.setItem('luminal-stats', JSON.stringify({ wins: 5, losses: 3 }));
    const data = loadStreaks();
    expect(data.bo1.bestStreak).toBe(0);
  });

  it('falls back to default when legacy JSON is corrupt', () => {
    localStorage.setItem('luminal-stats', '{bad json}');
    const data = loadStreaks();
    expect(data.bo1.bestStreak).toBe(0);
  });

  it('primary storage takes precedence over legacy stats', () => {
    localStorage.setItem('luminal-streaks', JSON.stringify({
      bo1: { currentStreak: 2, bestStreak: 6 },
      bo3: { currentStreak: 0, bestStreak: 0 },
      bo5: { currentStreak: 0, bestStreak: 0 },
    }));
    localStorage.setItem('luminal-stats', JSON.stringify({ bestStreak: 99 }));
    const data = loadStreaks();
    // Primary key wins — legacy value of 99 must NOT be used
    expect(data.bo1.bestStreak).toBe(6);
  });

  it('saveStreaks is idempotent — re-saving same data yields same result', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 4;
    saveStreaks(data);
    saveStreaks(data);
    const loaded = loadStreaks();
    expect(loaded.bo1.currentStreak).toBe(4);
  });
});
