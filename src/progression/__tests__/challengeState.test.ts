import { describe, it, expect, beforeEach } from 'vitest';
import { incrementChallenge, isChallengeComplete, getAllChallengeViews, getChallengeProgress } from '../challengeState';
import type { XpState } from '../progressionTypes';
import { createXpState } from '../xpState';

describe('challengeState', () => {
  let state: XpState;
  beforeEach(() => { state = createXpState(); });

  describe('incrementChallenge', () => {
    it('increments progress for a matching tracking event', () => {
      incrementChallenge(state, 'match_complete');
      expect(state.challengeProgress['first_steps']).toBe(1);
    });
    it('increments by specified amount', () => {
      incrementChallenge(state, 'match_complete', 2);
      expect(state.challengeProgress['first_steps']).toBe(2);
    });
    it('does not exceed target', () => {
      incrementChallenge(state, 'match_complete', 10);
      expect(state.challengeProgress['first_steps']).toBe(3);
    });
    it('tracks all challenges (no level gating)', () => {
      incrementChallenge(state, 'match_vehicle_hoverboard');
      expect(state.challengeProgress['grid_rider']).toBe(1);
    });
  });

  describe('isChallengeComplete', () => {
    it('returns false when progress < target', () => {
      state.challengeProgress['first_steps'] = 2;
      expect(isChallengeComplete(state, 'first_steps')).toBe(false);
    });
    it('returns true when progress >= target', () => {
      state.challengeProgress['first_steps'] = 3;
      expect(isChallengeComplete(state, 'first_steps')).toBe(true);
    });
    it('returns false for unknown challenge', () => {
      expect(isChallengeComplete(state, 'nonexistent')).toBe(false);
    });
  });

  describe('getAllChallengeViews', () => {
    it('returns all 4 challenges with progress info', () => {
      const views = getAllChallengeViews(state);
      expect(views).toHaveLength(4);
      expect(views[0]).toHaveProperty('progress');
      expect(views[0]).toHaveProperty('complete');
    });
    it('marks completed challenges correctly', () => {
      state.challengeProgress['first_steps'] = 3;
      state.unlockedItems.push('color:orange');
      const views = getAllChallengeViews(state);
      const firstSteps = views.find(v => v.id === 'first_steps');
      expect(firstSteps!.complete).toBe(true);
    });
  });

  describe('getChallengeProgress', () => {
    it('returns 0 for unstarted challenge', () => {
      expect(getChallengeProgress(state, 'first_steps')).toBe(0);
    });
    it('returns current progress value', () => {
      state.challengeProgress['first_steps'] = 2;
      expect(getChallengeProgress(state, 'first_steps')).toBe(2);
    });
  });
});
