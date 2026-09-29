// ── Spatial Hash Grid for O(1) trail segment queries ────
// Replaces O(n) linear scans in collision, AI raycasting, proximity, etc.

import { pointToSegmentDist } from './utils';
import type { GridSegment, NearestResult, ITrail } from './types/index';

const CELL_SIZE: number = 8;
const INV_CELL: number = 1 / CELL_SIZE;

function cellKey(cx: number, cz: number): number {
  return (cx + 4096) * 8192 + (cz + 4096); // integer key, avoids string alloc
}

function cellCoord(v: number): number {
  return Math.floor(v * INV_CELL);
}

export class SpatialGrid {
  cells: Map<number, GridSegment[]>;

  constructor() {
    this.cells = new Map();
  }

  clear(): void {
    this.cells.clear();
  }

  // Insert a segment (a→b) into all cells it overlaps
  insertSegment(ax: number, az: number, bx: number, bz: number, trail: ITrail, segIndex: number): void {
    const entry: GridSegment = { ax, az, bx, bz, trail, segIndex };
    const minCx: number = cellCoord(Math.min(ax, bx));
    const maxCx: number = cellCoord(Math.max(ax, bx));
    const minCz: number = cellCoord(Math.min(az, bz));
    const maxCz: number = cellCoord(Math.max(az, bz));

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key: number = cellKey(cx, cz);
        let bucket: GridSegment[] | undefined = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(entry);
      }
    }
  }

  // Check collision at point (px, pz) within hitRadius.
  // skipTrail: if set, skip last skipN segments of that trail.
  checkCollision(px: number, pz: number, hitRadius: number, skipTrail: ITrail | null, skipN: number): boolean {
    const cx: number = cellCoord(px);
    const cz: number = cellCoord(pz);
    // Check a 3x3 neighborhood to cover hitRadius up to ~CELL_SIZE
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket: GridSegment[] | undefined = this.cells.get(cellKey(cx + dx, cz + dz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const seg: GridSegment = bucket[i];
          // Skip last N segments of own trail
          if (skipTrail && seg.trail === skipTrail) {
            const trailLen: number = seg.trail.points.length;
            if (seg.segIndex >= trailLen - 1 - skipN) continue;
          }
          if (pointToSegmentDist(px, pz, seg.ax, seg.az, seg.bx, seg.bz) < hitRadius) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // Find nearest segment distance within searchRadius
  nearestDist(px: number, pz: number, searchRadius: number, skipTrail: ITrail | null, skipN: number): number {
    const cellRange: number = Math.ceil(searchRadius * INV_CELL);
    const cx: number = cellCoord(px);
    const cz: number = cellCoord(pz);
    let minDist: number = Infinity;

    for (let dx = -cellRange; dx <= cellRange; dx++) {
      for (let dz = -cellRange; dz <= cellRange; dz++) {
        const bucket: GridSegment[] | undefined = this.cells.get(cellKey(cx + dx, cz + dz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const seg: GridSegment = bucket[i];
          if (skipTrail && seg.trail === skipTrail) {
            const trailLen: number = seg.trail.points.length;
            if (seg.segIndex >= trailLen - 1 - skipN) continue;
          }
          const d: number = pointToSegmentDist(px, pz, seg.ax, seg.az, seg.bx, seg.bz);
          if (d < minDist) {
            minDist = d;
            if (d < 0.1) return d; // early exit
          }
        }
      }
    }
    return minDist;
  }

  /** Return all segments within searchRadius, skipping skipTrail's last skipN segments. */
  segmentsInRange(
    px: number, pz: number, searchRadius: number,
    skipTrail: ITrail | null, skipN: number,
  ): { seg: GridSegment; dist: number }[] {
    const cellRange: number = Math.ceil(searchRadius * INV_CELL);
    const cx: number = cellCoord(px);
    const cz: number = cellCoord(pz);
    const results: { seg: GridSegment; dist: number }[] = [];
    const seen = new Set<GridSegment>();

    for (let dx = -cellRange; dx <= cellRange; dx++) {
      for (let dz = -cellRange; dz <= cellRange; dz++) {
        const bucket: GridSegment[] | undefined = this.cells.get(cellKey(cx + dx, cz + dz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const seg: GridSegment = bucket[i];
          if (seen.has(seg)) continue;
          seen.add(seg);
          if (skipTrail && seg.trail === skipTrail) {
            const trailLen: number = seg.trail.points.length;
            if (seg.segIndex >= trailLen - 1 - skipN) continue;
          }
          const d: number = pointToSegmentDist(px, pz, seg.ax, seg.az, seg.bx, seg.bz);
          if (d < searchRadius) {
            results.push({ seg, dist: d });
          }
        }
      }
    }
    return results;
  }

  // Find nearest segment info (distance + segment data) within searchRadius
  nearestSegment(px: number, pz: number, searchRadius: number, skipTrail: ITrail | null, skipN: number): NearestResult {
    const cellRange: number = Math.ceil(searchRadius * INV_CELL);
    const cx: number = cellCoord(px);
    const cz: number = cellCoord(pz);
    let minDist: number = Infinity;
    let nearest: GridSegment | null = null;

    for (let dx = -cellRange; dx <= cellRange; dx++) {
      for (let dz = -cellRange; dz <= cellRange; dz++) {
        const bucket: GridSegment[] | undefined = this.cells.get(cellKey(cx + dx, cz + dz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const seg: GridSegment = bucket[i];
          if (skipTrail && seg.trail === skipTrail) {
            const trailLen: number = seg.trail.points.length;
            if (seg.segIndex >= trailLen - 1 - skipN) continue;
          }
          const d: number = pointToSegmentDist(px, pz, seg.ax, seg.az, seg.bx, seg.bz);
          if (d < minDist) {
            minDist = d;
            nearest = seg;
          }
        }
      }
    }
    return { dist: minDist, seg: nearest };
  }

  removeSegment(trail: ITrail, segIndex: number): void {
    for (const [key, bucket] of this.cells) {
      for (let i = bucket.length - 1; i >= 0; i--) {
        if (bucket[i].trail === trail && bucket[i].segIndex === segIndex) {
          bucket.splice(i, 1);
        }
      }
      if (bucket.length === 0) this.cells.delete(key);
    }
  }
}

// Singleton grid shared by all game systems
export const grid: SpatialGrid = new SpatialGrid();
