import { describe, it, expect, beforeEach } from 'vitest';
import { createXpState, addXp, getLevelFromXp, getXpToNextLevel, getSnapshot, addUnlock, isMaxLevel } from '../xpState';
import type { XpState } from '../progressionTypes';

describe('xpState', () => {
  let state: XpState;
  beforeEach(() => { state = createXpState(); });

  describe('createXpState', () => {
    it('starts at level 1 with 0 XP', () => {
      expect(state.level).toBe(1);
      expect(state.xp).toBe(0);
      expect(state.totalXp).toBe(0);
    });
    it('starts with default unlocks', () => {
      expect(state.unlockedItems).toContain('vehicle:bike');
      expect(state.unlockedItems).toContain('map:midtown_bowl');
      expect(state.unlockedItems).toContain('color:red');
      expect(state.unlockedItems).toContain('color:cyan');
    });
    it('starts with empty challenge progress and tokens', () => {
      expect(state.challengeProgress).toEqual({});
      expect(state.tokensUsed).toEqual({});
    });
  });

  describe('getLevelFromXp', () => {
    it('0 XP = level 1', () => { expect(getLevelFromXp(0)).toBe(1); });
    it('100 XP = level 2', () => { expect(getLevelFromXp(100)).toBe(2); });
    it('99 XP = still level 1', () => { expect(getLevelFromXp(99)).toBe(1); });
    it('11700+ XP = level 15', () => { expect(getLevelFromXp(11700)).toBe(15); expect(getLevelFromXp(99999)).toBe(15); });
    it('boundary: exactly at threshold = that level', () => { expect(getLevelFromXp(500)).toBe(4); expect(getLevelFromXp(499)).toBe(3); });
  });

  describe('addXp', () => {
    it('adds XP and updates totalXp', () => {
      const result = addXp(state, 80);
      expect(result.state.xp).toBe(80);
      expect(result.state.totalXp).toBe(80);
    });
    it('triggers level up when threshold crossed', () => {
      const result = addXp(state, 100);
      expect(result.state.level).toBe(2);
      expect(result.levelsGained).toBe(1);
    });
    it('can gain multiple levels at once', () => {
      const result = addXp(state, 500);
      expect(result.state.level).toBe(4);
      expect(result.levelsGained).toBe(3);
    });
    it('does not exceed max level', () => {
      const result = addXp(state, 99999);
      expect(result.state.level).toBe(15);
    });
    it('XP continues accumulating past max level', () => {
      const result = addXp(state, 99999);
      expect(result.state.totalXp).toBe(99999);
    });
  });

  describe('getXpToNextLevel', () => {
    it('at level 1 with 0 XP, needs 100 for level 2', () => { expect(getXpToNextLevel(state)).toBe(100); });
    it('at level 1 with 50 XP, needs 50 more', () => { state.xp = 50; state.totalXp = 50; expect(getXpToNextLevel(state)).toBe(50); });
    it('at max level, returns 0', () => { state.level = 15; state.xp = 11700; state.totalXp = 11700; expect(getXpToNextLevel(state)).toBe(0); });
  });

  describe('isMaxLevel', () => {
    it('returns false for level < 15', () => { expect(isMaxLevel(state)).toBe(false); });
    it('returns true for level 15', () => { state.level = 15; expect(isMaxLevel(state)).toBe(true); });
  });

  describe('addUnlock', () => {
    it('adds item to unlockedItems', () => { addUnlock(state, 'vehicle:car'); expect(state.unlockedItems).toContain('vehicle:car'); });
    it('does not duplicate existing unlocks', () => {
      addUnlock(state, 'color:red');
      expect(state.unlockedItems.filter(i => i === 'color:red').length).toBe(1);
    });
  });

  describe('getSnapshot', () => {
    it('returns correct progression snapshot', () => {
      const snap = getSnapshot(state);
      expect(snap.level).toBe(1);
      expect(snap.xp).toBe(0);
      expect(snap.xpToNextLevel).toBe(100);
      expect(snap.unlockedVehicles).toContain('bike');
      expect(snap.unlockedMaps).toContain('midtown_bowl');
      expect(snap.unlockedColors).toContain('red');
      expect(snap.unlockedColors).toContain('cyan');
    });
  });
});
