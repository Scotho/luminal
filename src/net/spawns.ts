// ── Spawn Position Calculation ───────────────────────────
// Pure functions — deterministic spawn placement using seeded PRNG.
// All clients independently compute identical positions.

import { seededRandom } from '../core/seededRandom';
import { getArenaCircular, getArenaRadius, ARENA_HALF } from '../core/simulation';
import type { SpawnPosition } from '../types/index';

const MIN_DIST_FACTOR = 0.42;
const MAX_DIST_FACTOR = 0.75;

/** N-player spawn positions — evenly distributed around the arena. */
export function getSpawnPositions(seed: number, count: number): SpawnPosition[] {
  const rng = seededRandom(seed);
  const baseAngle = rng() * Math.PI * 2;
  const halfArena = getArenaCircular() ? getArenaRadius() : ARENA_HALF;
  const minDist = halfArena * MIN_DIST_FACTOR;
  const maxDist = halfArena * MAX_DIST_FACTOR;
  const spawns: SpawnPosition[] = [];
  for (let i = 0; i < count; i++) {
    const angle = baseAngle + (i / count) * Math.PI * 2;
    const dist = minDist + rng() * (maxDist - minDist);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    spawns.push({ x, z, angle: Math.atan2(x, z) });
  }
  return spawns;
}
