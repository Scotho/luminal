// ── Proximity & Meter Pure Functions ──────────────────────
// Extracted from lockstepManager.ts for file size compliance.
// Pure functions with zero coupling to the LockstepManager class.

import { getArenaCircular, getArenaRadius, type TrailPoint } from './simulation';

// ── Constants ─────────────────────────────────────────────
export const PROXIMITY_RANGE = 8;        // range for proximity speed boost (match game.ts)
export const PROXIMITY_RAMP_UP = 8;      // smoothing rate up
export const PROXIMITY_RAMP_DOWN = 3;    // smoothing rate down
export const RECHARGE_RANGE = 8;         // range for meter recharge from trails/walls
export const METER_RECHARGE_MAX = 104;   // max recharge rate per second (match player.ts)
export const METER_MAX = 100;
export const ARENA_HALF_RECHARGE = 192;  // ARENA_SIZE / 2 for wall distance

// ── Combined trail distance scan (single pass over both trails) ────
// NOTE: This function computes min-distance which is order-independent.
// Different segment iteration order (e.g., after rollback) produces identical results.
export function computeTrailDistances(
  px: number, pz: number,
  ownTrail: TrailPoint[], enemyTrail: TrailPoint[],
): { minDist: number; minEnemyDist: number } {
  let minEnemyDist = Infinity;

  // Scan enemy trail segments (tracked separately for recharge)
  for (let i = 0; i < enemyTrail.length - 1; i++) {
    const d = ptSegDistFast(px, pz, enemyTrail[i].x, enemyTrail[i].z, enemyTrail[i + 1].x, enemyTrail[i + 1].z);
    if (d < minEnemyDist) minEnemyDist = d;
  }
  let minDist = minEnemyDist;

  // Scan own trail segments (minDist includes both for collision; proximity boost uses enemy only)
  for (let i = 0; i < ownTrail.length - 1; i++) {
    const d = ptSegDistFast(px, pz, ownTrail[i].x, ownTrail[i].z, ownTrail[i + 1].x, ownTrail[i + 1].z);
    if (d < minDist) minDist = d;
  }

  return { minDist, minEnemyDist };
}

// ── Proximity boost from pre-computed trail distance ────
export function computeProximityBoost(
  minDist: number, currentBoost: number, dt: number,
): number {
  const target = minDist < PROXIMITY_RANGE ? 1 - minDist / PROXIMITY_RANGE : 0;
  const rate = target > currentBoost ? PROXIMITY_RAMP_UP : PROXIMITY_RAMP_DOWN;
  return currentBoost + (target - currentBoost) * Math.min(1, rate * dt);
}

// Inlined point-to-segment distance (avoids import from utils)
export function ptSegDistFast(
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

// ── Meter recharge from pre-computed enemy distance + walls (deterministic) ───
export function computeMeterRecharge(
  px: number, pz: number,
  minEnemyDist: number,
  meter: number, dashing: boolean, dt: number,
): number {
  if (dashing) return meter;

  // Proximity recharge from enemy trail (distance already computed)
  if (minEnemyDist < RECHARGE_RANGE) {
    const factor = 1 - minEnemyDist / RECHARGE_RANGE;
    meter = Math.min(METER_MAX, meter + METER_RECHARGE_MAX * factor * dt);
  }

  // Wall recharge (distance to nearest arena wall)
  let wallDist: number;
  if (getArenaCircular()) {
    wallDist = getArenaRadius() - Math.sqrt(px * px + pz * pz);
  } else {
    wallDist = Math.min(ARENA_HALF_RECHARGE - Math.abs(px), ARENA_HALF_RECHARGE - Math.abs(pz));
  }
  if (wallDist < RECHARGE_RANGE) {
    const factor = 1 - wallDist / RECHARGE_RANGE;
    meter = Math.min(METER_MAX, meter + METER_RECHARGE_MAX * factor * dt);
  }

  return meter;
}
