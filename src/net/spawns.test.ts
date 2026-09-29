import { describe, it, expect, vi } from 'vitest';

// Mock simulation to provide arena values
vi.mock('../core/simulation', () => ({
  getArenaCircular: vi.fn(() => false),
  getArenaRadius: vi.fn(() => 200),
  ARENA_HALF: 200,
}));

import { getSpawnPositions } from './spawns';

describe('getSpawnPositions', () => {
  it('returns correct number of positions', () => {
    expect(getSpawnPositions(42, 4)).toHaveLength(4);
  });

  it('each position has x, z, angle fields', () => {
    const spawns = getSpawnPositions(42, 2);
    for (const s of spawns) {
      expect(typeof s.x).toBe('number');
      expect(typeof s.z).toBe('number');
      expect(typeof s.angle).toBe('number');
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.z)).toBe(true);
      expect(Number.isFinite(s.angle)).toBe(true);
    }
  });

  it('is deterministic — same seed same result', () => {
    const a = getSpawnPositions(123, 3);
    const b = getSpawnPositions(123, 3);
    expect(a).toEqual(b);
  });

  it('different seeds produce different positions', () => {
    const a = getSpawnPositions(100, 2);
    const b = getSpawnPositions(200, 2);
    expect(a).not.toEqual(b);
  });

  it('single player spawn works', () => {
    const spawns = getSpawnPositions(1, 1);
    expect(spawns).toHaveLength(1);
  });

  it('positions are within arena bounds', () => {
    const spawns = getSpawnPositions(42, 8);
    for (const s of spawns) {
      const dist = Math.sqrt(s.x * s.x + s.z * s.z);
      expect(dist).toBeGreaterThan(0);
      // MAX_DIST_FACTOR is 0.75, ARENA_HALF is 200, so max ~150
      expect(dist).toBeLessThan(200);
    }
  });
});
