import { describe, it, expect, beforeEach } from 'vitest';
import { SimSpatialGrid } from './simSpatialGrid';

describe('SimSpatialGrid', () => {
  let grid: SimSpatialGrid;

  beforeEach(() => {
    grid = new SimSpatialGrid();
  });

  describe('rebuild', () => {
    it('handles empty trail array', () => {
      expect(() => grid.rebuild([])).not.toThrow();
    });

    it('handles single trail with one point (no segments)', () => {
      expect(() => grid.rebuild([[{ x: 0, z: 0 }]])).not.toThrow();
    });

    it('handles multiple trails with segments', () => {
      const trails = [
        [{ x: 0, z: 0 }, { x: 10, z: 0 }],
        [{ x: 0, z: 10 }, { x: 10, z: 10 }],
      ];
      expect(() => grid.rebuild(trails)).not.toThrow();
    });

    it('clears previous data on rebuild', () => {
      grid.rebuild([[{ x: 0, z: 0 }, { x: 5, z: 0 }]]);
      expect(grid.checkCollision(2, 0, 2, -1, 0)).toBe(true);
      // Rebuild with empty — old segments gone
      grid.rebuild([]);
      expect(grid.checkCollision(2, 0, 2, -1, 0)).toBe(false);
    });
  });

  describe('checkCollision', () => {
    it('returns false on empty grid', () => {
      grid.rebuild([]);
      expect(grid.checkCollision(0, 0, 1, -1, 0)).toBe(false);
    });

    it('returns false for single-point trail (no segments)', () => {
      grid.rebuild([[{ x: 0, z: 0 }]]);
      expect(grid.checkCollision(0, 0, 2, -1, 0)).toBe(false);
    });

    it('detects collision near a segment', () => {
      // Segment from (0,0) to (10,0)
      grid.rebuild([[{ x: 0, z: 0 }, { x: 10, z: 0 }]]);
      // Point at (5, 0.5) is 0.5 units from the segment — within hitRadius 2
      expect(grid.checkCollision(5, 0.5, 2, -1, 0)).toBe(true);
    });

    it('no collision far from trail', () => {
      grid.rebuild([[{ x: 0, z: 0 }, { x: 10, z: 0 }]]);
      expect(grid.checkCollision(100, 100, 1, -1, 0)).toBe(false);
    });

    it('skipTrailIdx skips all segments of specified trail', () => {
      grid.rebuild([[{ x: 0, z: 0 }, { x: 10, z: 0 }]]);
      // Without skip: collision
      expect(grid.checkCollision(5, 0, 2, -1, 0)).toBe(true);
      // Skip trail 0 with skipN=0: skips last (trailLen-1-0)= last 1 segment
      // Trail has 2 points → 1 segment → trailLen=2, segIndex=0, threshold = 2-1-0=1, 0>=1 false → NOT skipped
      // Actually skipN=0 means skip 0 segments from the end, so nothing is skipped except when segIndex >= trailLen-1
      // trailLen=2, segIndex=0: 0 >= 2-1-0 = 1? No → not skipped
      // Need larger skipN. With skipN covering all segments:
      // skipN=1: segIndex >= 2-1-1 = 0? Yes → skipped
      expect(grid.checkCollision(5, 0, 2, 0, 1)).toBe(false);
    });

    it('skipN skips last N segments of own trail', () => {
      // 4 points → 3 segments (indices 0, 1, 2)
      // trailLen = 4
      grid.rebuild([[{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }, { x: 30, z: 0 }]]);

      // Point near segment 2 (from (20,0) to (30,0))
      // skipN=1: skip segments where segIndex >= 4-1-1 = 2 → skips segment 2
      expect(grid.checkCollision(25, 0, 2, 0, 1)).toBe(false);
      // But segment 0 still active — collision near it
      expect(grid.checkCollision(5, 0, 2, 0, 1)).toBe(true);
    });

    it('only skips segments of the specified trail', () => {
      grid.rebuild([
        [{ x: 0, z: 0 }, { x: 10, z: 0 }], // trail 0
        [{ x: 0, z: 5 }, { x: 10, z: 5 }], // trail 1
      ]);
      // Skip trail 0, but trail 1 still active
      expect(grid.checkCollision(5, 5, 2, 0, 1)).toBe(true);
    });

    it('detects collision at segment endpoints', () => {
      grid.rebuild([[{ x: 0, z: 0 }, { x: 10, z: 0 }]]);
      // Near endpoint (0,0)
      expect(grid.checkCollision(0, 0.5, 2, -1, 0)).toBe(true);
      // Near endpoint (10,0)
      expect(grid.checkCollision(10, 0.5, 2, -1, 0)).toBe(true);
    });
  });

  describe('nearestDist', () => {
    it('returns Infinity on empty grid', () => {
      grid.rebuild([]);
      expect(grid.nearestDist(0, 0, 100, -1, 0)).toBe(Infinity);
    });

    it('returns Infinity for single-point trail (no segments)', () => {
      grid.rebuild([[{ x: 10, z: 0 }]]);
      expect(grid.nearestDist(0, 0, 100, -1, 0)).toBe(Infinity);
    });

    it('returns distance to closest segment', () => {
      // Segment from (10,0) to (20,0)
      grid.rebuild([[{ x: 10, z: 0 }, { x: 20, z: 0 }]]);
      // Point at (0,0) — closest point on segment is (10,0), distance = 10
      const dist = grid.nearestDist(0, 0, 100, -1, 0);
      expect(dist).toBeCloseTo(10, 0);
    });

    it('returns perpendicular distance to segment midpoint', () => {
      // Segment from (0,0) to (20,0)
      grid.rebuild([[{ x: 0, z: 0 }, { x: 20, z: 0 }]]);
      // Point at (10, 3) — perpendicular distance is 3
      const dist = grid.nearestDist(10, 3, 100, -1, 0);
      expect(dist).toBeCloseTo(3, 1);
    });

    it('returns distance to nearest of multiple trails', () => {
      grid.rebuild([
        [{ x: 100, z: 0 }, { x: 110, z: 0 }], // far
        [{ x: 5, z: 0 }, { x: 15, z: 0 }],     // close
      ]);
      // Point at (0,0) — nearest point on trail 1 segment is (5,0), distance = 5
      const dist = grid.nearestDist(0, 0, 200, -1, 0);
      expect(dist).toBeCloseTo(5, 0);
    });

    it('respects skipTrailIdx', () => {
      grid.rebuild([
        [{ x: 0, z: 0 }, { x: 10, z: 0 }], // closer (trail 0)
        [{ x: 50, z: 0 }, { x: 60, z: 0 }], // farther (trail 1)
      ]);
      // Skip trail 0 (skipN=1 to skip its only segment)
      // Nearest point on segment (50,0)→(60,0) from (5,0) is (50,0) → distance = 45
      const dist = grid.nearestDist(5, 0, 200, 0, 1);
      expect(dist).toBeCloseTo(45, 0);
    });

    it('respects search radius', () => {
      grid.rebuild([[{ x: 200, z: 0 }, { x: 210, z: 0 }]]);
      // Search radius too small to reach the segment
      const dist = grid.nearestDist(0, 0, 10, -1, 0);
      expect(dist).toBe(Infinity);
    });

    it('returns zero distance when point is on segment', () => {
      grid.rebuild([[{ x: 0, z: 0 }, { x: 20, z: 0 }]]);
      const dist = grid.nearestDist(10, 0, 100, -1, 0);
      expect(dist).toBeLessThan(0.1);
    });
  });
});
