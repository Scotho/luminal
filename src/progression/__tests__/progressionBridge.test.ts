import { describe, it, expect, beforeEach, vi } from 'vitest';
import { awardMatchXp, processLevelUp, _resetBridgeForTesting } from '../progressionBridge';
import type { XpState } from '../progressionTypes';
import { createXpState } from '../xpState';

vi.mock('../progressionEvents', () => ({
  emitProgressionEvent: vi.fn(),
  EVT_LEVEL_UP: 'luminal:levelUp',
  EVT_UNLOCK: 'luminal:unlock',
}));

import { emitProgressionEvent } from '../progressionEvents';

describe('progressionBridge', () => {
  let state: XpState;
  beforeEach(() => { state = createXpState(); vi.clearAllMocks(); _resetBridgeForTesting(); });

  describe('awardMatchXp', () => {
    it('adds XP to state and returns award breakdown', () => {
      const result = awardMatchXp(state, { won: true, matchStreak: 0, seriesLength: 1 });
      expect(result!.award.total).toBe(120);
      expect(state.totalXp).toBe(120);
      expect(state.level).toBe(2);
    });
    it('returns levelsGained when level up occurs', () => {
      const result = awardMatchXp(state, { won: true, matchStreak: 5, seriesLength: 3 });
      expect(result!.levelsGained).toBeGreaterThan(0);
    });
    it('does not award XP if state is null (anon)', () => {
      expect(awardMatchXp(null, { won: true, matchStreak: 0, seriesLength: 1 })).toBeNull();
    });
  });

  describe('processLevelUp', () => {
    it('grants auto-unlocks for new levels', () => {
      state.totalXp = 100; state.level = 2;
      const newUnlocks = processLevelUp(state, 1, 2);
      expect(newUnlocks).toContain('color:blue');
      expect(state.unlockedItems).toContain('color:blue');
    });
    it('grants car at level 3 as direct unlock', () => {
      state.totalXp = 250; state.level = 3;
      const newUnlocks = processLevelUp(state, 2, 3);
      expect(newUnlocks).toContain('vehicle:car');
      expect(newUnlocks).toContain('color:green');
    });
    it('skips already-owned items', () => {
      state.totalXp = 250; state.level = 3;
      state.unlockedItems.push('vehicle:car');
      const newUnlocks = processLevelUp(state, 2, 3);
      expect(newUnlocks).not.toContain('vehicle:car');
      expect(newUnlocks).toContain('color:green');
    });
    it('emits levelUp event', () => {
      state.totalXp = 100; state.level = 2;
      processLevelUp(state, 1, 2);
      expect(emitProgressionEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'levelUp', level: 2 }));
    });
  });
});
