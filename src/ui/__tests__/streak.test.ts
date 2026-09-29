import { describe, it, expect, beforeEach } from 'vitest';
import {
  STREAK_TIER_1, STREAK_TIER_2, STREAK_TIER_3, STREAK_TIER_4,
  STREAK_PROXIMITY_CUE,
  getStreakTier, getStreakKey, getStreakForMode,
  incrementStreak, resetStreak, loadStreaks, saveStreaks,
  getBestStreakForMode, isNewRecord, getDistanceToBest,
} from '../../streak';

describe('streak constants', () => {
  it('has correct tier thresholds', () => {
    expect(STREAK_TIER_1).toBe(3);
    expect(STREAK_TIER_2).toBe(5);
    expect(STREAK_TIER_3).toBe(10);
    expect(STREAK_TIER_4).toBe(20);
  });

  it('has proximity cue distance', () => {
    expect(STREAK_PROXIMITY_CUE).toBe(3);
  });
});

describe('getStreakTier', () => {
  it('returns 0 for streak below tier 1', () => {
    expect(getStreakTier(0)).toBe(0);
    expect(getStreakTier(2)).toBe(0);
  });
  it('returns 1 for streak 3-4', () => {
    expect(getStreakTier(3)).toBe(1);
    expect(getStreakTier(4)).toBe(1);
  });
  it('returns 2 for streak 5-9', () => {
    expect(getStreakTier(5)).toBe(2);
    expect(getStreakTier(9)).toBe(2);
  });
  it('returns 3 for streak 10-19', () => {
    expect(getStreakTier(10)).toBe(3);
    expect(getStreakTier(19)).toBe(3);
  });
  it('returns 4 for streak 20+', () => {
    expect(getStreakTier(20)).toBe(4);
    expect(getStreakTier(100)).toBe(4);
  });
});

describe('getStreakKey', () => {
  it('maps series length to key', () => {
    expect(getStreakKey(1)).toBe('bo1');
    expect(getStreakKey(3)).toBe('bo3');
    expect(getStreakKey(5)).toBe('bo5');
  });
  it('defaults to bo1 for unexpected values', () => {
    expect(getStreakKey(7)).toBe('bo1');
  });
});

describe('incrementStreak', () => {
  it('increments current streak for mode', () => {
    const data = makeDefault();
    const result = incrementStreak(data, 'bo1');
    expect(result.bo1.currentStreak).toBe(1);
  });
  it('updates bestStreak when current exceeds it', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 4;
    data.bo1.bestStreak = 4;
    const result = incrementStreak(data, 'bo1');
    expect(result.bo1.currentStreak).toBe(5);
    expect(result.bo1.bestStreak).toBe(5);
  });
  it('does not update bestStreak when current is below', () => {
    const data = makeDefault();
    data.bo1.bestStreak = 10;
    const result = incrementStreak(data, 'bo1');
    expect(result.bo1.bestStreak).toBe(10);
  });
  it('does not affect other modes', () => {
    const data = makeDefault();
    data.bo3.currentStreak = 5;
    const result = incrementStreak(data, 'bo1');
    expect(result.bo3.currentStreak).toBe(5);
  });
});

describe('resetStreak', () => {
  it('resets current streak to 0 for mode', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 7;
    const result = resetStreak(data, 'bo1');
    expect(result.bo1.currentStreak).toBe(0);
  });
  it('preserves bestStreak', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 7;
    data.bo1.bestStreak = 12;
    const result = resetStreak(data, 'bo1');
    expect(result.bo1.bestStreak).toBe(12);
  });
});

describe('isNewRecord', () => {
  it('returns true when current exceeds best', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 5;
    data.bo1.bestStreak = 4;
    expect(isNewRecord(data, 'bo1')).toBe(true);
  });
  it('returns false when current equals best', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 4;
    data.bo1.bestStreak = 4;
    expect(isNewRecord(data, 'bo1')).toBe(false);
  });
});

describe('getDistanceToBest', () => {
  it('returns distance to best streak', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 5;
    data.bo1.bestStreak = 8;
    expect(getDistanceToBest(data, 'bo1')).toBe(3);
  });
  it('returns 0 when current equals or exceeds best', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 8;
    data.bo1.bestStreak = 8;
    expect(getDistanceToBest(data, 'bo1')).toBe(0);
  });
});

describe('getStreakForMode', () => {
  it('returns the current streak for a given mode', () => {
    const data = makeDefault();
    data.bo3.currentStreak = 6;
    expect(getStreakForMode(data, 'bo3')).toBe(6);
  });
  it('returns 0 when no streak has been set', () => {
    const data = makeDefault();
    expect(getStreakForMode(data, 'bo5')).toBe(0);
  });
});

describe('getBestStreakForMode', () => {
  it('returns the best streak for a given mode', () => {
    const data = makeDefault();
    data.bo1.bestStreak = 15;
    expect(getBestStreakForMode(data, 'bo1')).toBe(15);
  });
  it('returns 0 when no best streak has been recorded', () => {
    const data = makeDefault();
    expect(getBestStreakForMode(data, 'bo3')).toBe(0);
  });
});

describe('loadStreaks / saveStreaks', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  it('returns default when nothing stored', () => {
    const data = loadStreaks();
    expect(data.bo1.currentStreak).toBe(0);
    expect(data.bo1.bestStreak).toBe(0);
  });
  it('round-trips correctly', () => {
    const data = makeDefault();
    data.bo1.currentStreak = 5;
    data.bo1.bestStreak = 12;
    saveStreaks(data);
    const loaded = loadStreaks();
    expect(loaded.bo1.currentStreak).toBe(5);
    expect(loaded.bo1.bestStreak).toBe(12);
  });
  it('migrates legacy flat stats into bo1', () => {
    localStorage.setItem('luminal-stats', JSON.stringify({
      wins: 10, losses: 5, draws: 1, bestStreak: 7, totalTime: 300, matchCount: 16
    }));
    const data = loadStreaks();
    expect(data.bo1.bestStreak).toBe(7);
    expect(data.bo1.currentStreak).toBe(0);
  });
});

function makeDefault(): import('../../types').StreakData {
  return {
    bo1: { currentStreak: 0, bestStreak: 0 },
    bo3: { currentStreak: 0, bestStreak: 0 },
    bo5: { currentStreak: 0, bestStreak: 0 },
  };
}
