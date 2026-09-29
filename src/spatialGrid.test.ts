import { describe, it, expect, beforeEach } from 'vitest';
import { SpatialGrid } from './spatialGrid';
import type { ITrail } from './types/index';

// Minimal mock trail for tests — only `points` is read by the grid
const mockTrail = (points: Array<{x: number; z: number}> = []) =>
  ({ points } as unknown as ITrail);
const nullTrail = null as unknown as ITrail;

describe('SpatialGrid', () => {
  let grid: SpatialGrid;

  beforeEach(() => {
    grid = new SpatialGrid();
  });

  describe('insertSegment + checkCollision', () => {
    it('detects collision with nearby segment', () => {
      // Insert horizontal segment from (0,0) to (10,0)
      grid.insertSegment(0, 0, 10, 0, nullTrail, 0);
      // Check point at (5, 0.5) — should be within hitRadius 1
      expect(grid.checkCollision(5, 0.5, 1, nullTrail, 0)).toBe(true);
    });

    it('returns false when no segments nearby', () => {
      grid.insertSegment(0, 0, 10, 0, nullTrail, 0);
      // Check point far away
      expect(grid.checkCollision(100, 100, 1, nullTrail, 0)).toBe(false);
    });

    it('returns false when beyond hitRadius', () => {
      grid.insertSegment(0, 0, 10, 0, nullTrail, 0);
      // Point at (5, 5) is 5 units away, hitRadius is 1
      expect(grid.checkCollision(5, 5, 1, nullTrail, 0)).toBe(false);
    });

    it('skips own trail segments when skipTrail is set', () => {
      const myTrail = mockTrail([{x:0,z:0}, {x:10,z:0}]);
      grid.insertSegment(0, 0, 10, 0, myTrail, 0);
      // With skipTrail and skipN=1, segment 0 is within skip range (trailLen-1-skipN = 2-1-1 = 0)
      expect(grid.checkCollision(5, 0.5, 1, myTrail, 1)).toBe(false);
    });

    it('detects collision with other trail even when skipping own', () => {
      const myTrail = mockTrail([{x:0,z:0}, {x:5,z:0}]);
      const otherTrail = mockTrail([{x:0,z:0}, {x:10,z:0}]);
      grid.insertSegment(0, 0, 10, 0, otherTrail, 0);
      // Should still hit other trail
      expect(grid.checkCollision(5, 0.5, 1, myTrail, 1)).toBe(true);
    });
  });

  describe('nearestDist', () => {
    it('returns Infinity when grid is empty', () => {
      expect(grid.nearestDist(5, 5, 10, nullTrail, 0)).toBe(Infinity);
    });

    it('returns correct distance to nearest segment', () => {
      grid.insertSegment(0, 0, 10, 0, nullTrail, 0);
      const dist = grid.nearestDist(5, 3, 10, nullTrail, 0);
      expect(dist).toBeCloseTo(3);
    });

    it('returns nearest of multiple segments', () => {
      grid.insertSegment(0, 0, 10, 0, nullTrail, 0); // 3 units away from (5,3)
      grid.insertSegment(0, 2, 10, 2, nullTrail, 0); // 1 unit away from (5,3)
      const dist = grid.nearestDist(5, 3, 10, nullTrail, 0);
      expect(dist).toBeCloseTo(1);
    });

    it('respects searchRadius', () => {
      grid.insertSegment(100, 100, 110, 100, nullTrail, 0);
      // Search near origin with small radius — should not find distant segment
      const dist = grid.nearestDist(0, 0, 5, nullTrail, 0);
      expect(dist).toBe(Infinity);
    });
  });

  describe('nearestSegment', () => {
    it('returns null seg when grid is empty', () => {
      const result = grid.nearestSegment(5, 5, 10, nullTrail, 0);
      expect(result.seg).toBeNull();
      expect(result.dist).toBe(Infinity);
    });

    it('returns the nearest segment reference', () => {
      const trail1 = mockTrail();
      const trail2 = mockTrail();
      grid.insertSegment(0, 0, 10, 0, trail1, 0); // farther
      grid.insertSegment(0, 2, 10, 2, trail2, 0); // closer to (5,3)
      const result = grid.nearestSegment(5, 3, 10, nullTrail, 0);
      expect(result.seg).not.toBeNull();
      expect(result.seg!.trail).toBe(trail2);
      expect(result.dist).toBeCloseTo(1);
    });
  });

  describe('clear', () => {
    it('removes all segments', () => {
      grid.insertSegment(0, 0, 10, 0, nullTrail, 0);
      expect(grid.checkCollision(5, 0.5, 1, nullTrail, 0)).toBe(true);
      grid.clear();
      expect(grid.checkCollision(5, 0.5, 1, nullTrail, 0)).toBe(false);
    });
  });

  describe('segments spanning multiple cells', () => {
    it('detects collision at both ends of a long segment', () => {
      // Segment spanning many cells (0,0) to (100,0)
      grid.insertSegment(0, 0, 100, 0, nullTrail, 0);
      expect(grid.checkCollision(0, 0.5, 1, nullTrail, 0)).toBe(true);
      expect(grid.checkCollision(50, 0.5, 1, nullTrail, 0)).toBe(true);
      expect(grid.checkCollision(100, 0.5, 1, nullTrail, 0)).toBe(true);
    });
  });
});
