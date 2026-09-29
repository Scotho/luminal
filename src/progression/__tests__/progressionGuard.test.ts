import { describe, it, expect, beforeEach } from 'vitest';
import { isUnlocked, getAvailableVehicles, getAvailableMaps, getAvailableColors, getLockedReason } from '../progressionGuard';
import type { XpState } from '../progressionTypes';
import { createXpState } from '../xpState';

describe('progressionGuard', () => {
  let state: XpState;
  beforeEach(() => { state = createXpState(); });

  describe('isUnlocked', () => {
    it('returns true for null state (anonymous user)', () => {
      expect(isUnlocked('vehicle:car', null)).toBe(true);
    });
    it('returns true for items in unlockedItems', () => {
      expect(isUnlocked('vehicle:bike', state)).toBe(true);
    });
    it('returns false for items not in unlockedItems', () => {
      expect(isUnlocked('vehicle:car', state)).toBe(false);
    });
  });

  describe('getAvailableVehicles', () => {
    it('returns all vehicles for null state', () => {
      const v = getAvailableVehicles(null);
      expect(v).toContain('bike');
      expect(v).toContain('car');
      expect(v).toContain('hoverboard');
    });
    it('returns only unlocked vehicles for authenticated user', () => {
      const v = getAvailableVehicles(state);
      expect(v).toContain('bike');
      expect(v).not.toContain('car');
    });
  });

  describe('getAvailableMaps', () => {
    it('returns all maps for null state', () => {
      expect(getAvailableMaps(null)).toHaveLength(3);
    });
    it('returns only midtown_bowl for fresh state', () => {
      const m = getAvailableMaps(state);
      expect(m).toContain('midtown_bowl');
      expect(m).not.toContain('synth_pit');
    });
  });

  describe('getAvailableColors', () => {
    it('returns all colors for null state', () => {
      expect(getAvailableColors(null)).toHaveLength(10);
    });
    it('returns only red and cyan for fresh state', () => {
      const c = getAvailableColors(state);
      expect(c).toContain('red');
      expect(c).toContain('cyan');
      expect(c).not.toContain('blue');
    });
  });

  describe('getLockedReason', () => {
    it('returns level info for level-gated items', () => {
      // vehicle:hoverboard is now in DEFAULT_UNLOCKS, so use a still-gated item
      const reason = getLockedReason('emissive:enhanced_glow', state);
      expect(reason).not.toBeNull();
      expect(reason!.type).toBe('level');
      expect(reason!.level).toBe(11);
    });
    it('returns level info for car (now direct level unlock)', () => {
      const reason = getLockedReason('vehicle:car', state);
      expect(reason).not.toBeNull();
      expect(reason!.type).toBe('level');
      expect(reason!.level).toBe(3);
    });
    it('returns challenge info for challenge-gated maps', () => {
      const reason = getLockedReason('map:synth_pit', state);
      expect(reason).not.toBeNull();
      expect(reason!.type).toBe('challenge');
      expect(reason!.challengeId).toBe('win_streak');
    });
    it('returns level for items that are both level and shop', () => {
      const reason = getLockedReason('color:magenta', state);
      expect(reason).not.toBeNull();
      expect(reason!.type).toBe('level');
    });
    it('returns null for already-unlocked items', () => {
      expect(getLockedReason('vehicle:bike', state)).toBeNull();
    });
  });
});
