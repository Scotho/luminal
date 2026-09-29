// ── Collision System ─────────────────────────────────────
// Extracted from Game — pure functions for trail collision,
// wall repulsion, proximity speed boost, and proximity VFX.

import { grid } from '../spatialGrid';
import { isOutOfBounds } from '../grid';
import { HIT_RADIUS, SKIP_OWN_SEGMENTS } from './simulation';
import type * as THREE from 'three';
import type { IPlayer, ITrail, NearestResult, TrailPoint } from '../types/index';

interface CollisionEntry {
  obj: IPlayer;
  isPlayer: boolean;
}

interface CollisionResult {
  playerDied: boolean;
  anyAiDied: boolean;
  deadThisFrame: Set<CollisionEntry>;
}

interface AIEntry {
  player: IPlayer;
}

interface OnlineMatch {
  myUid: string;
  opponentUid: string;
  reportLocalDeath(uid: string): void;
}

// ── Tunable collision constants (admin panel) ────────────
const _collisionTuning = {
  hitRadius: HIT_RADIUS,
  skipOwnSegments: SKIP_OWN_SEGMENTS,
  repulseRange: 6.5,
  repulseStrength: 1.8,
  headOnDistance: 2.0,
  proximityRange: 13,
};

export function getCollisionTuning(): typeof _collisionTuning { return _collisionTuning; }

/**
 * Update proximity-based speed boost for a player.
 * Queries the spatial grid for the nearest trail segment within range
 * and smoothly ramps the player's proximitySpeedBoost toward the target.
 *
 * @param {Player} player
 */
export function updateProximitySpeed(player: IPlayer): void {
  if (!player.alive) return;
  const { x, z } = player.getPosition();
  const range: number = _collisionTuning.proximityRange;
  // Skip own trail entirely — slipstream should only come from enemy trails
  const minDist: number = grid.nearestDist(x, z, range, player.trail, Infinity);

  const target: number = minDist < range ? (1 - minDist / range) : 0;
  // Smooth transition — ramp up fast, decay slow to avoid flicker
  const rampSpeed: number = target > player.proximitySpeedBoost ? 8 : 3;
  player.proximitySpeedBoost += (target - player.proximitySpeedBoost) * Math.min(1, rampSpeed * (1/60));
  if (player.proximitySpeedBoost < 0.01) player.proximitySpeedBoost = 0;
}

/**
 * Update trail proximity VFX — emissive glow, instance-color boost,
 * subtle vibration near the trail head, and line opacity pulse.
 *
 * @param {Player} player
 * @param {Trail}  trail
 * @param {number} prox  - proximity factor (0..1)
 * @param {number} dt
 */
/**
 * Compute and apply the proximity glow to the wall material —
 * emissive intensity and emissive color whitening.
 *
 * @param trail    - the trail whose wallMat will be mutated
 * @param prox     - proximity factor (0..1)
 * @param t        - current time in seconds (performance.now() * 0.001)
 * @param lumScale - pre-computed luminance scale for the trail color
 */
function _computeProximityGlow(trail: ITrail, prox: number, t: number, lumScale: number): void {
  // Store base emissive color for whitening
  if (!trail.wallMat._baseEmissiveColor) {
    trail.wallMat._baseEmissiveColor = trail.wallMat.emissive.clone();
  }

  // Set material emissive to boosted level — per-instance color modulates it
  // Include dark-color floor so blue/red don't lose glow during proximity
  const base: number = trail._baseEmissive || 0.5;
  const darkBoost: number = trail._darkBoost || 0;
  const darkFloor: number = darkBoost * 1.26;
  const pulse: number = Math.sin(t * 8) * prox * 0.075;
  trail.wallMat.emissiveIntensity = base + 0.22 + darkFloor + prox * 0.20 * lumScale + pulse;
  const bc: THREE.Color = trail.wallMat._baseEmissiveColor!;
  const whiten: number = prox * 0.20 * lumScale;
  trail.wallMat.emissive.setRGB(
    bc.r + (1 - bc.r) * whiten,
    bc.g + (1 - bc.g) * whiten,
    bc.b + (1 - bc.b) * whiten,
  );
}

/**
 * Drive the per-instance gradient pulse — walks backward from the trail head,
 * boosts instance colors, applies subtle head vibration.
 *
 * @param trail    - the trail whose instance buffer will be mutated
 * @param ic       - the instanced color attribute for the trail's wallMesh
 * @param prox     - proximity factor (0..1)
 * @param t        - current time in seconds (performance.now() * 0.001)
 * @param lumScale - pre-computed luminance scale for the trail color
 */
function _updatePulseAnimation(
  trail: ITrail,
  ic: THREE.InstancedBufferAttribute,
  prox: number,
  t: number,
  lumScale: number,
): void {
  // Walk backward from trail head, accumulate distance for gradient
  // 20 car lengths ~= 80 units
  const glowRange: number = 80;
  const points: TrailPoint[] = trail.points;
  const glowing: number[] = [];
  let accDist: number = 0;

  // Reset previous glowing instances that may fall outside new range
  if (trail._glowingIdxs) {
    for (const idx of trail._glowingIdxs) {
      trail.setInstanceY?.(idx, trail.getInstanceOrigY?.(idx) ?? 0);
      const off: number = idx * 3;
      ic.array[off] = 1; ic.array[off + 1] = 1; ic.array[off + 2] = 1;
    }
  }

  for (let i: number = points.length - 2; i >= 0 && accDist < glowRange; i--) {
    const a: TrailPoint = points[i], b: TrailPoint = points[i + 1];
    const segLen: number = Math.hypot(b.x - a.x, b.z - a.z);
    accDist += segLen;

    if (i >= trail._segCount) continue;

    // Gradient: full glow at head, fades to zero at glowRange
    const factor: number = Math.max(0, 1 - accDist / glowRange);
    const glow: number = factor * prox;

    // Instance color > 1 boosts the emissive contribution
    const boost: number = 1 + glow * 0.5 * lumScale;
    const off: number = i * 3;
    ic.array[off] = boost;
    ic.array[off + 1] = boost;
    ic.array[off + 2] = boost;

    // Subtle vibration near head
    if (factor > 0.5) {
      const origY: number = trail.getInstanceOrigY?.(i) ?? 0;
      trail.setInstanceY?.(i, origY + Math.sin(t * 25 + i) * factor * prox * 0.15);
    }

    glowing.push(i);
  }

  ic.needsUpdate = true;
  trail._glowingIdxs = glowing;
}

export function updateTrailProximityVFX(player: IPlayer, trail: ITrail, prox: number, _dt: number): void {
  const ic: THREE.InstancedBufferAttribute = trail.wallMesh.instanceColor!;
  const t: number = performance.now() * 0.001;

  if (!player.alive || prox < 0.05) {
    // Reset any previously glowing instances
    if (trail._glowingIdxs) {
      for (const idx of trail._glowingIdxs) {
        trail.setInstanceY?.(idx, trail.getInstanceOrigY?.(idx) ?? 0);
        // Reset instance color to white (neutral)
        const off: number = idx * 3;
        ic.array[off] = 1; ic.array[off + 1] = 1; ic.array[off + 2] = 1;
      }
      ic.needsUpdate = true;
      trail._glowingIdxs = null;
    }
    return;
  }

  // Scale glow by luminance — dark colors (blue) get stronger boost, light ones (green) less
  const lum: number = trail.color.r * 0.299 + trail.color.g * 0.587 + trail.color.b * 0.114;
  const lumScale: number = 0.6 + (1 - lum) * 0.8; // dark~=1.4, light~=0.6

  _computeProximityGlow(trail, prox, t, lumScale);
  _updatePulseAnimation(trail, ic, prox, t, lumScale);
}

// ── Enemy Trail Slipstream Glow ──────────────────────────
// Tracks which enemy trails are currently glowing for cleanup.
const _slipstreamState = new Map<ITrail, { idxs: number[]; uniform: number }>();

/**
 * Light up enemy trail segments near the player during slipstream.
 * Only call when player.proximitySpeedBoost > 0.1.
 */
export function updateEnemySlipstreamVFX(
  player: IPlayer,
  _enemyTrails: ITrail[],
  _dt: number,
): void {
  const { x, z } = player.getPosition();
  const range: number = _collisionTuning.proximityRange;
  const prox: number = player.proximitySpeedBoost;

  // Query all enemy segments in range (skip own trail entirely)
  const nearby = grid.segmentsInRange(x, z, range, player.trail, Infinity);

  // Group by trail
  const trailHits = new Map<ITrail, { idx: number; intensity: number }[]>();
  for (const { seg, dist } of nearby) {
    // Skip player's own trail segments
    if (seg.trail === player.trail) continue;
    const intensity: number = (1 - dist / range) * prox;
    if (intensity < 0.02) continue;
    let arr = trailHits.get(seg.trail);
    if (!arr) { arr = []; trailHits.set(seg.trail, arr); }
    arr.push({ idx: seg.segIndex, intensity });
  }

  // Update each affected enemy trail
  const activeTrails = new Set<ITrail>();
  for (const [trail, hits] of trailHits) {
    activeTrails.add(trail);
    const ic: THREE.InstancedBufferAttribute = trail.wallMesh.instanceColor!;
    if (!ic) continue;

    // Reset previously glowing segments on this trail
    const prev = _slipstreamState.get(trail);
    if (prev) {
      for (const idx of prev.idxs) {
        const off: number = idx * 3;
        ic.array[off] = 1; ic.array[off + 1] = 1; ic.array[off + 2] = 1;
      }
    }

    // Apply new glow
    const glowIdxs: number[] = [];
    for (const { idx, intensity } of hits) {
      if (idx >= trail._segCount) continue;
      const off: number = idx * 3;
      const boost: number = 1 + intensity * 0.3;
      ic.array[off] = boost;
      ic.array[off + 1] = boost;
      ic.array[off + 2] = boost + intensity * 0.2; // slight cyan tint
      glowIdxs.push(idx);
    }
    ic.needsUpdate = true;

    // Drive uSlipstream uniform
    trail.setSlipstream?.(prox);
    _slipstreamState.set(trail, { idxs: glowIdxs, uniform: prox });
  }

  // Clear trails that are no longer in range
  for (const [trail, prev] of _slipstreamState) {
    if (activeTrails.has(trail)) continue;
    const ic: THREE.InstancedBufferAttribute = trail.wallMesh.instanceColor!;
    if (ic) {
      for (const idx of prev.idxs) {
        const off: number = idx * 3;
        ic.array[off] = 1; ic.array[off + 1] = 1; ic.array[off + 2] = 1;
      }
      ic.needsUpdate = true;
    }
    trail.setSlipstream?.(0);
    _slipstreamState.delete(trail);
  }
}

/**
 * Reset all enemy trail slipstream glow — call on death, round end, etc.
 */
export function clearEnemySlipstreamVFX(): void {
  for (const [trail, prev] of _slipstreamState) {
    const ic: THREE.InstancedBufferAttribute = trail.wallMesh.instanceColor!;
    if (ic) {
      for (const idx of prev.idxs) {
        const off: number = idx * 3;
        ic.array[off] = 1; ic.array[off + 1] = 1; ic.array[off + 2] = 1;
      }
      ic.needsUpdate = true;
    }
    trail.setSlipstream?.(0);
  }
  _slipstreamState.clear();
}

/**
 * Apply steering repulsion when a player approaches a trail wall.
 * Uses the spatial grid to find the nearest segment and nudges
 * the player's angle away from it.
 *
 * @param {Player}  player
 * @param {number}  dt
 * @param {string}  mode   - 'local' | 'online'
 */
export function applyWallRepulsion(player: IPlayer, dt: number, _mode: string): void {
  if (!player.alive) return;
  const { x, z } = player.getPosition();
  const repulseRange: number = _collisionTuning.repulseRange;
  const repulseStrength: number = _collisionTuning.repulseStrength;

  // Use spatial grid to find nearest segment
  const result: NearestResult = grid.nearestSegment(x, z, repulseRange, player.trail, 12);
  if (!result.seg || result.dist >= repulseRange || result.dist < 0.01) return;

  const seg = result.seg;
  const nearestDist: number = result.dist;
  const sdx: number = seg.bx - seg.ax, sdz: number = seg.bz - seg.az;
  const lenSq: number = sdx * sdx + sdz * sdz;
  if (lenSq < 0.001) return;

  let t: number = ((x - seg.ax) * sdx + (z - seg.az) * sdz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX: number = seg.ax + t * sdx;
  const projZ: number = seg.az + t * sdz;
  const distX: number = x - projX;
  const distZ: number = z - projZ;

  const nearestNx: number = distX / nearestDist;
  const nearestNz: number = distZ / nearestDist;
  const wLen: number = Math.sqrt(lenSq);
  const wallDirX: number = sdx / wLen;
  const wallDirZ: number = sdz / wLen;

  const factor: number = (1 - nearestDist / repulseRange);
  const fwdX: number = -Math.sin(player.angle);
  const fwdZ: number = -Math.cos(player.angle);

  const approachDot: number = -(fwdX * nearestNx + fwdZ * nearestNz);

  if (approachDot > 0.05) {
    const dot1: number = fwdX * wallDirX + fwdZ * wallDirZ;
    const alignX: number = dot1 >= 0 ? wallDirX : -wallDirX;
    const alignZ: number = dot1 >= 0 ? wallDirZ : -wallDirZ;

    const blendAlign: number = Math.max(0, 1 - approachDot * 2);
    const targetX: number = nearestNx * (1 - blendAlign) + alignX * blendAlign;
    const targetZ: number = nearestNz * (1 - blendAlign) + alignZ * blendAlign;

    const cross: number = fwdX * targetZ - fwdZ * targetX;
    const push: number = factor * factor * repulseStrength * approachDot * dt;
    player.angle -= Math.sign(cross) * push;
  }
}

/**
 * Check all collisions (trail, out-of-bounds, head-on) and handle deaths.
 * Returns { playerDied, anyAiDied } so the caller can handle game state,
 * or null if no deaths occurred this frame.
 *
 * @param {Player}      player      - the local human player
 * @param {{ player: Player }[]} ais - AI entries
 * @param {string}      mode        - 'local' | 'online'
 * @param {OnlineMatch|null} onlineMatch
 * @returns {{ playerDied: boolean, anyAiDied: boolean } | null}
 */
// ts-prune-ignore-next
export function checkCollisions(
  player: IPlayer,
  ais: AIEntry[],
  mode: string,
  onlineMatch: OnlineMatch | null
): CollisionResult | null {
  // Check if game is already over (all AIs or player dead)
  const anyAiAlive: boolean = ais.some(ai => ai.player.alive);
  if (!player.alive || !anyAiAlive) return null;

  // Collect all alive players and trails
  const allPlayers: CollisionEntry[] = [{ obj: player, isPlayer: true }];
  for (const ai of ais) allPlayers.push({ obj: ai.player, isPlayer: false });

  // Determine who dies this frame
  const deadThisFrame = new Set<CollisionEntry>();

  for (const entry of allPlayers) {
    if (!entry.obj.alive) continue;
    const pos: { x: number; z: number } = entry.obj.getPosition();

    // Out of bounds
    if (isOutOfBounds(pos.x, pos.z)) {
      deadThisFrame.add(entry);
      continue;
    }

    // Check collision against all trails via spatial grid (single query)
    if (grid.checkCollision(pos.x, pos.z, _collisionTuning.hitRadius, entry.obj.trail, _collisionTuning.skipOwnSegments)) {
      deadThisFrame.add(entry);
    }
  }

  // Head-on collisions between all pairs of alive players
  for (let i: number = 0; i < allPlayers.length; i++) {
    if (!allPlayers[i].obj.alive) continue;
    const pi: { x: number; z: number } = allPlayers[i].obj.getPosition();
    for (let j: number = i + 1; j < allPlayers.length; j++) {
      if (!allPlayers[j].obj.alive) continue;
      const pj: { x: number; z: number } = allPlayers[j].obj.getPosition();
      if (Math.hypot(pi.x - pj.x, pi.z - pj.z) < _collisionTuning.headOnDistance) {
        deadThisFrame.add(allPlayers[i]);
        deadThisFrame.add(allPlayers[j]);
      }
    }
  }

  if (deadThisFrame.size === 0) return null;

  // Kill everyone who died
  let playerDied: boolean = false;
  let anyAiDied: boolean = false;
  for (const entry of deadThisFrame) {
    if (entry.obj.alive) {
      entry.obj.kill();
      if (entry.isPlayer) playerDied = true;
      else anyAiDied = true;

      // In online mode, report deaths through OnlineMatch for proper sync
      // Deferred to next microtask — network write doesn't need to block the death frame
      if (mode === 'online' && onlineMatch) {
        const diedUid: string = entry.isPlayer
          ? onlineMatch.myUid
          : onlineMatch.opponentUid;
        Promise.resolve().then(() => onlineMatch.reportLocalDeath(diedUid));
      }
    }
  }
  // SFX responsibility is on the caller (game.ts) — this module returns
  // collision results only, not side effects. See Principle 3 (tier clean).
  return { playerDied, anyAiDied, deadThisFrame };
}
