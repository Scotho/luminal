import { describe, it, expect, beforeEach } from 'vitest';
import { useToken, canUseToken, getTokenStatus, getPendingTokens } from '../tokenSystem';
import type { XpState } from '../progressionTypes';
import { createXpState } from '../xpState';

describe('tokenSystem', () => {
  let state: XpState;
  beforeEach(() => { state = createXpState(); });

  describe('canUseToken', () => {
    it('returns false if level not reached', () => {
      state.level = 5;
      expect(canUseToken(state, 6)).toBe(false);
    });
    it('returns true if level reached and not used', () => {
      state.level = 6;
      expect(canUseToken(state, 6)).toBe(true);
    });
    it('returns false if already used', () => {
      state.level = 6;
      state.tokensUsed[6] = 'vehicle:car';
      expect(canUseToken(state, 6)).toBe(false);
    });
    it('returns false for invalid group', () => {
      state.level = 15;
      expect(canUseToken(state, 3)).toBe(false);
    });
  });

  describe('useToken', () => {
    it('records choice and unlocks item', () => {
      state.level = 6;
      expect(useToken(state, 6, 'vehicle:car')).toBe(true);
      expect(state.tokensUsed[6]).toBe('vehicle:car');
      expect(state.unlockedItems).toContain('vehicle:car');
    });
    it('handles color bundles', () => {
      state.level = 6;
      expect(useToken(state, 6, 'color:white+teal')).toBe(true);
      expect(state.unlockedItems).toContain('color:white');
      expect(state.unlockedItems).toContain('color:teal');
    });
    it('returns false if cannot use', () => {
      state.level = 5;
      expect(useToken(state, 6, 'vehicle:car')).toBe(false);
    });
    it('returns false for invalid option', () => {
      state.level = 6;
      expect(useToken(state, 6, 'invalid:item')).toBe(false);
    });
    it('prevents double use', () => {
      state.level = 6;
      useToken(state, 6, 'vehicle:car');
      expect(useToken(state, 6, 'map:synth_city')).toBe(false);
    });
  });

  describe('getTokenStatus', () => {
    it('locked when level not reached', () => {
      state.level = 5;
      expect(getTokenStatus(state, 6)).toBe('locked');
    });
    it('available when level reached', () => {
      state.level = 6;
      expect(getTokenStatus(state, 6)).toBe('available');
    });
    it('used when claimed', () => {
      state.level = 6;
      state.tokensUsed[6] = 'vehicle:car';
      expect(getTokenStatus(state, 6)).toBe('used');
    });
  });

  describe('getPendingTokens', () => {
    it('empty when no tokens available', () => {
      state.level = 5;
      expect(getPendingTokens(state)).toEqual([]);
    });
    it('returns group 6 at level 6', () => {
      state.level = 6;
      expect(getPendingTokens(state)).toEqual([6]);
    });
    it('both groups at level 9+', () => {
      state.level = 9;
      expect(getPendingTokens(state)).toEqual([6, 9]);
    });
    it('excludes used tokens', () => {
      state.level = 9;
      state.tokensUsed[6] = 'vehicle:car';
      expect(getPendingTokens(state)).toEqual([9]);
    });
  });
});
