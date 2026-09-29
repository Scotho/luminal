import { describe, it, expect } from 'vitest';
import { LEVEL_UNLOCKS, CHALLENGES, getUnlocksForLevel, getAutoUnlocksUpToLevel, getAllChallenges, getChallengeById } from '../unlockRegistry';

describe('unlockRegistry', () => {
  it('defines unlocks for levels 1-15', () => {
    expect(LEVEL_UNLOCKS).toHaveLength(15);
    expect(LEVEL_UNLOCKS[0].level).toBe(1);
    expect(LEVEL_UNLOCKS[14].level).toBe(15);
  });

  describe('getUnlocksForLevel', () => {
    it('level 1 unlocks bike, midtown_bowl, red, cyan', () => {
      const ids = getUnlocksForLevel(1).map(u => u.id);
      expect(ids).toContain('vehicle:bike');
      expect(ids).toContain('map:midtown_bowl');
      expect(ids).toContain('color:red');
      expect(ids).toContain('color:cyan');
    });
    it('level 2 unlocks blue only', () => {
      const unlocks = getUnlocksForLevel(2);
      expect(unlocks).toHaveLength(1);
      expect(unlocks[0].id).toBe('color:blue');
    });
    it('level 3 unlocks car and green', () => {
      const ids = getUnlocksForLevel(3).map(u => u.id);
      expect(ids).toContain('vehicle:car');
      expect(ids).toContain('color:green');
    });
    it('level 10 unlocks hoverboard', () => {
      const ids = getUnlocksForLevel(10).map(u => u.id);
      expect(ids).toContain('vehicle:hoverboard');
    });
    it('level 15 has no unlocks (reserved)', () => {
      expect(getUnlocksForLevel(15)).toHaveLength(0);
    });
  });

  describe('getAutoUnlocksUpToLevel', () => {
    it('returns all unlocks from level 1 through specified level', () => {
      const ids = getAutoUnlocksUpToLevel(3).map(u => u.id);
      expect(ids).toContain('vehicle:bike');
      expect(ids).toContain('map:midtown_bowl');
      expect(ids).toContain('color:blue');
      expect(ids).toContain('vehicle:car');
      expect(ids).toContain('color:green');
    });
    it('level 3 includes car (direct unlock, not token-gated)', () => {
      const ids = getAutoUnlocksUpToLevel(3).map(u => u.id);
      expect(ids).toContain('vehicle:car');
    });
  });

  describe('challenges', () => {
    it('defines exactly 4 starter challenges', () => {
      expect(getAllChallenges()).toHaveLength(4);
    });
    it('each challenge has rewardType field', () => {
      for (const c of getAllChallenges()) {
        expect(['map', 'color', 'emissive']).toContain(c.rewardType);
      }
    });
    it('win_streak challenge unlocks synth_pit', () => {
      const c = getChallengeById('win_streak');
      expect(c).toBeDefined();
      expect(c!.unlockId).toBe('map:synth_pit');
      expect(c!.rewardType).toBe('map');
      expect(c!.target).toBe(5);
    });
    it('flow_master challenge unlocks synth_city', () => {
      const c = getChallengeById('flow_master');
      expect(c).toBeDefined();
      expect(c!.unlockId).toBe('map:synth_city');
      expect(c!.rewardType).toBe('map');
    });
    it('first_steps challenge unlocks orange', () => {
      const c = getChallengeById('first_steps');
      expect(c).toBeDefined();
      expect(c!.unlockId).toBe('color:orange');
      expect(c!.rewardType).toBe('color');
    });
    it('grid_rider challenge unlocks teal', () => {
      const c = getChallengeById('grid_rider');
      expect(c).toBeDefined();
      expect(c!.unlockId).toBe('color:teal');
      expect(c!.rewardType).toBe('color');
    });
    it('getChallengeById returns undefined for unknown', () => {
      expect(getChallengeById('nonexistent')).toBeUndefined();
    });
  });
});
