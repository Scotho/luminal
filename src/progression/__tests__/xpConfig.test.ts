import { describe, it, expect } from 'vitest';
import { XP_THRESHOLDS, calculateMatchXp, getXpForLevel } from '../xpConfig';

describe('xpConfig', () => {
  it('has 15 levels defined', () => {
    expect(XP_THRESHOLDS).toHaveLength(15);
  });

  it('level 1 requires 0 XP', () => {
    expect(XP_THRESHOLDS[0]).toBe(0);
  });

  it('thresholds are strictly increasing', () => {
    for (let i = 1; i < XP_THRESHOLDS.length; i++) {
      expect(XP_THRESHOLDS[i]).toBeGreaterThan(XP_THRESHOLDS[i - 1]);
    }
  });

  it('level 15 requires 11700 XP', () => {
    expect(XP_THRESHOLDS[14]).toBe(11700);
  });

  it('getXpForLevel returns correct threshold', () => {
    expect(getXpForLevel(1)).toBe(0);
    expect(getXpForLevel(2)).toBe(100);
    expect(getXpForLevel(15)).toBe(11700);
  });

  it('getXpForLevel clamps to valid range', () => {
    expect(getXpForLevel(0)).toBe(0);
    expect(getXpForLevel(16)).toBe(11700);
  });

  describe('calculateMatchXp', () => {
    it('base XP is 80 for a loss with no streak', () => {
      const award = calculateMatchXp({ won: false, matchStreak: 0, seriesLength: 1 });
      expect(award.base).toBe(80);
      expect(award.winBonus).toBe(0);
      expect(award.streakBonus).toBe(0);
      expect(award.seriesBonus).toBe(0);
      expect(award.total).toBe(80);
    });

    it('adds 40 win bonus on victory', () => {
      const award = calculateMatchXp({ won: true, matchStreak: 0, seriesLength: 1 });
      expect(award.winBonus).toBe(40);
      expect(award.total).toBe(120);
    });

    it('adds streak bonus capped at 50', () => {
      const award = calculateMatchXp({ won: true, matchStreak: 3, seriesLength: 1 });
      expect(award.streakBonus).toBe(30);
      const capped = calculateMatchXp({ won: true, matchStreak: 10, seriesLength: 1 });
      expect(capped.streakBonus).toBe(50);
    });

    it('adds series bonus for BO3/BO5', () => {
      const bo3 = calculateMatchXp({ won: true, matchStreak: 0, seriesLength: 3 });
      expect(bo3.seriesBonus).toBe(40);
      const bo5 = calculateMatchXp({ won: true, matchStreak: 0, seriesLength: 5 });
      expect(bo5.seriesBonus).toBe(80);
    });

    it('totals all components correctly', () => {
      const award = calculateMatchXp({ won: true, matchStreak: 5, seriesLength: 3 });
      expect(award.total).toBe(80 + 40 + 50 + 40);
    });
  });
});
