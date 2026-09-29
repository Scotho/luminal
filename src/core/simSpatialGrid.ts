// ── Sim-Layer Spatial Hash Grid ──────────────────────────
// Lightweight spatial grid for deterministic AI raycasting inside the lockstep sim.
// Operates on TrailPoint[][] (pure data) instead of visual ITrail objects.

import { pointToSegmentDist } from '../utils';
import type { TrailPoint } from './simulation';

const CELL_SIZE: number = 8;
const INV_CELL: number = 1 / CELL_SIZE;

function cellKey(cx: number, cz: number): number {
  return (cx + 4096) * 8192 + (cz + 4096);
}

function cellCoord(v: number): number {
  return Math.floor(v * INV_CELL);
}

interface SimGridSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  trailIndex: number;
  segIndex: number;
}

export class SimSpatialGrid {
  private cells: Map<number, SimGridSegment[]> = new Map();
  private _trailLengths: number[] = [];

  /** Rebuild from all sim trails. Call once per tick before AI input computation. */
  rebuild(trails: TrailPoint[][]): void {
    this.cells.clear();
    this._trailLengths.length = trails.length;

    for (let ti = 0; ti < trails.length; ti++) {
      const pts = trails[ti];
      this._trailLengths[ti] = pts.length;
      for (let si = 0; si < pts.length - 1; si++) {
        const ax = pts[si].x, az = pts[si].z;
        const bx = pts[si + 1].x, bz = pts[si + 1].z;
        const entry: SimGridSegment = { ax, az, bx, bz, trailIndex: ti, segIndex: si };

        const minCx = cellCoord(Math.min(ax, bx));
        const maxCx = cellCoord(Math.max(ax, bx));
        const minCz = cellCoord(Math.min(az, bz));
        const maxCz = cellCoord(Math.max(az, bz));

        for (let cx = minCx; cx <= maxCx; cx++) {
          for (let cz = minCz; cz <= maxCz; cz++) {
            const key = cellKey(cx, cz);
            let bucket = this.cells.get(key);
            if (!bucket) {
              bucket = [];
              this.cells.set(key, bucket);
            }
            bucket.push(entry);
          }
        }
      }
    }
  }

  /** Check collision at point within hitRadius. Skips last skipN segments of skipTrailIdx. */
  checkCollision(px: number, pz: number, hitRadius: number, skipTrailIdx: number, skipN: number): boolean {
    const cx = cellCoord(px);
    const cz = cellCoord(pz);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = this.cells.get(cellKey(cx + dx, cz + dz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const seg = bucket[i];
          if (seg.trailIndex === skipTrailIdx) {
            const trailLen = this._trailLengths[seg.trailIndex];
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

  /** Find nearest segment distance within searchRadius. Skips last skipN segments of skipTrailIdx. */
  nearestDist(px: number, pz: number, searchRadius: number, skipTrailIdx: number, skipN: number): number {
    const cellRange = Math.ceil(searchRadius * INV_CELL);
    const cx = cellCoord(px);
    const cz = cellCoord(pz);
    let minDist = Infinity;

    for (let dx = -cellRange; dx <= cellRange; dx++) {
      for (let dz = -cellRange; dz <= cellRange; dz++) {
        const bucket = this.cells.get(cellKey(cx + dx, cz + dz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const seg = bucket[i];
          if (seg.trailIndex === skipTrailIdx) {
            const trailLen = this._trailLengths[seg.trailIndex];
            if (seg.segIndex >= trailLen - 1 - skipN) continue;
          }
          const d = pointToSegmentDist(px, pz, seg.ax, seg.az, seg.bx, seg.bz);
          if (d < minDist) {
            minDist = d;
            if (d < 0.1) return d;
          }
        }
      }
    }
    return minDist;
  }
}
