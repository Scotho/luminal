import { describe, it, expect } from 'vitest';
import { getSpawnPositions } from './net/spawns';

describe('getSpawnPositions', () => {
  it('returns correct number of spawn positions', () => {
    for (let count = 1; count <= 6; count++) {
      const spawns = getSpawnPositions(42, count);
      expect(spawns).toHaveLength(count);
    }
  });

  it('each spawn has x, z, angle properties', () => {
    const spawns = getSpawnPositions(12345, 2);
    for (const s of spawns) {
      expect(s).toHaveProperty('x');
      expect(s).toHaveProperty('z');
      expect(s).toHaveProperty('angle');
    }
  });

  it('is deterministic for the same seed and count', () => {
    const r1 = getSpawnPositions(42, 3);
    const r2 = getSpawnPositions(42, 3);
    for (let i = 0; i < 3; i++) {
      expect(r1[i].x).toBe(r2[i].x);
      expect(r1[i].z).toBe(r2[i].z);
      expect(r1[i].angle).toBe(r2[i].angle);
    }
  });

  it('produces different spawns for different seeds', () => {
    const r1 = getSpawnPositions(100, 2);
    const r2 = getSpawnPositions(200, 2);
    // Very unlikely to match
    expect(r1[0].x).not.toBe(r2[0].x);
  });

  it('spawns within arena bounds', () => {
    // Arena halfsize is 192, maxDist is 192 * 0.85 = 163
    for (let seed = 0; seed < 100; seed++) {
      const spawns = getSpawnPositions(seed, 4);
      for (const s of spawns) {
        expect(Math.abs(s.x)).toBeLessThan(192);
        expect(Math.abs(s.z)).toBeLessThan(192);
      }
    }
  });

  it('count=2 produces two opposite spawns (angles ~π apart)', () => {
    const spawns = getSpawnPositions(42, 2);
    expect(spawns).toHaveLength(2);
    const a1 = Math.atan2(spawns[0].z, spawns[0].x);
    const a2 = Math.atan2(spawns[1].z, spawns[1].x);
    let diff = Math.abs(a1 - a2);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    expect(diff).toBeCloseTo(Math.PI, 0);
  });

  it('spawns are evenly distributed around arena for N=4', () => {
    const spawns = getSpawnPositions(42, 4);
    const angles = spawns.map(s => Math.atan2(s.z, s.x));
    angles.sort((a, b) => a - b);
    const expected = (2 * Math.PI) / 4;
    for (let i = 1; i < angles.length; i++) {
      const diff = angles[i] - angles[i - 1];
      expect(diff).toBeCloseTo(expected, 0);
    }
  });

  it('different seeds produce different layouts', () => {
    const s1 = getSpawnPositions(100, 4);
    const s2 = getSpawnPositions(200, 4);
    const allSame = s1.every((s, i) => s.x === s2[i].x && s.z === s2[i].z);
    expect(allSame).toBe(false);
  });

  it('count=1 returns single valid spawn', () => {
    const spawns = getSpawnPositions(42, 1);
    expect(spawns).toHaveLength(1);
    expect(spawns[0]).toHaveProperty('x');
    expect(spawns[0]).toHaveProperty('z');
    expect(spawns[0]).toHaveProperty('angle');
    expect(Math.abs(spawns[0].x)).toBeLessThan(192);
    expect(Math.abs(spawns[0].z)).toBeLessThan(192);
  });

  it('each spawn has correct angle property', () => {
    const spawns = getSpawnPositions(42, 4);
    for (const s of spawns) {
      expect(s.angle).toBeCloseTo(Math.atan2(s.x, s.z), 10);
    }
  });
});
