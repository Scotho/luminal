// ── playerState.ts ────────────────────────────────────────
// Pure-extraction helpers for applySimState (lockstep path) and courseCorrect.
// These functions mutate the Player instance in place; no behavioural change
// from the original inline implementations in player.ts.

import * as THREE from 'three';
import type { Player } from './player';
import { assistTuning } from './player';
import type { PlayerSim } from './core/simulation';
import type { TrailPoint } from './types/index';
import type { Trail } from './trail';
import { pointToSegmentDist } from './utils';
import { triggerSnapSmoke } from './playerVFX';
import {
  applyLeanAndAnimatorSim, fillHoverAnimInput, updateGrindRender,
  updateLightsAndFXSim, updateTrail,
} from './playerRender';

function hasFinitePlayerSimState(sim: PlayerSim): boolean {
  return Number.isFinite(sim.x) && Number.isFinite(sim.z) && Number.isFinite(sim.angle)
      && Number.isFinite(sim.speed) && Number.isFinite(sim.meter);
}

/**
 * Lockstep path: apply the deterministic sim state onto a Player and run
 * per-frame visuals. Pure extraction from Player.applySimState.
 *
 * SPEC-82: when `isLocal === true`, the sim is threaded through to
 * updateGrindRender so the local player hears grind cues and sees cash-out
 * animations. Remote players receive isLocal=false (default) and render
 * from cached state only.
 */
export function applySimState(
  player: Player,
  sim: PlayerSim,
  dt: number,
  turnDir: number,
  camera?: THREE.Camera,
  isLocal = false,
): void {
  const wasDashing = player.dashing;

  // Capture pre-update state for snap smoke trigger
  const prevSnapRecovery = player._snapRecovery;
  const prevVelocityAngle = player._velocityAngle;

  // Apply physics state from sim
  if (!hasFinitePlayerSimState(sim)) {
    if (import.meta.env.DEV) {
      console.error(`[BUG-18] applySimState REJECTED non-finite: x=${sim.x} z=${sim.z} angle=${sim.angle} speed=${sim.speed} meter=${sim.meter}`);
    }
    return;
  }

  player.mesh.position.x = sim.x;
  player.mesh.position.z = sim.z;
  player.angle = sim.angle;
  player.speed = sim.speed;
  player.meter = sim.meter;
  player.alive = sim.alive;
  player.boosting = sim.boosting;
  player.dashing = sim.dashing;
  player._brakeBlend = sim.brakeBlend;
  player.proximitySpeedBoost = sim.proximityBoost;
  player.wBoosting = sim.boosting && !sim.dashing;
  player.drifting = sim.drifting;
  player._drifting = sim.drifting;
  player._slipAngle = sim.slipAngle;
  player._velocityAngle = sim.velocityAngle;
  player.velocityAngle = player._velocityAngle;
  player.slipAngle = player._slipAngle;
  player._driftTimer = sim.driftTimer;
  player._driftEntryTimer = sim.driftEntryTimer;
  player.driftBoosting = sim.drifting && sim.boosting && !sim.dashing;
  player._snapRecovery = sim.snapRecovery;
  player._snapRecoveryTimer = sim.snapRecoveryTimer;
  player._snapRecoveryBoosted = sim.snapRecoveryBoosted;
  player._snapRecoveryFromAngle = sim.snapRecoveryFromAngle;
  player._turnRamp = sim.turnRamp;
  player.boostLocked = sim.boostLocked;
  player.fumes = sim.fumes;
  player._fumesTimer = sim.fumesTimer;
  player.sputterSFX = sim.sputterSFX;

  // Cache grind render state for VFX
  player._grinding = sim.grinding;
  player._grindBalance = sim.grindBalance;
  player._grindBailSide = sim.grindBailSide;
  player._airborne = sim.airborne;
  player._airborneTimer = sim.airborneTimer;
  player._airborneDuration = sim.airborneDuration > 0 ? sim.airborneDuration : 1;
  player._airbornePeak = sim.airbornePeak;
  player._recovery = sim.recovery;
  player._landingPenalty = sim.landingPenalty;
  player._grindStreakCount = sim.grindStreakCount;
  player._grindStreakBroken = sim.grindStreakBroken;
  player._grindTrailVehicleType = sim.grindTrailVehicleType;
  player._trickDetected = sim.trickDetected;
  player._trickMeterBonus = sim.trickMeterBonus;

  // Trigger snap smoke on transition
  if (!prevSnapRecovery && sim.snapRecovery && player.snapSmoke) {
    triggerSnapSmoke(player.snapSmoke, player.mesh.position, prevVelocityAngle);
  }

  if (!player.alive) return;

  const cfg = player._vCfg;
  const dashJustPressed = player.dashing && !wasDashing;
  player.mesh.rotation.y = player.angle;

  applyLeanAndAnimatorSim(player, dt, turnDir);

  // Hoverboard: procedural animation + grind VFX
  // SPEC-82: pass sim only for local player so cues fire without leaking
  // sim mutations for remote players (bust consume / cash-out finalize).
  if (player.vehicleType === 'hoverboard') {
    if (player._hoverAnimator) {
      fillHoverAnimInput(player, dt, cfg.baseSpeed);
      player._hoverAnimator.update(player._animInput);
    }
    updateGrindRender(player, dt, camera, isLocal ? sim : null);
  }

  updateTrail(player, dt);
  updateLightsAndFXSim(player, dt, dashJustPressed);
}

/**
 * Gentle steering assist: nudge toward parallel when near a trail or wall.
 * Pure extraction from Player.courseCorrect.
 */
export function courseCorrect(player: Player, trails: Trail[], skipOwn: Trail): void {
  if (!player.alive || player.isAI) return;
  const { x, z } = player.getPosition();
  const dx: number = -Math.sin(player.angle);
  const dz: number = -Math.cos(player.angle);
  let bestNudge: number = 0;
  let bestDist: number = assistTuning.range;

  // Check trails
  for (const trail of trails) {
    const pts: TrailPoint[] = trail.points;
    const skip: number = trail === skipOwn ? 12 : 0;
    const end: number = pts.length - skip;
    for (let i = Math.max(0, end - 150); i < end - 1; i++) {
      const a: TrailPoint = pts[i], b: TrailPoint = pts[i + 1];
      const sx: number = b.x - a.x, sz: number = b.z - a.z;
      const segLen: number = Math.hypot(sx, sz);
      if (segLen < 0.01) continue;
      const dist: number = pointToSegmentDist(x, z, a.x, a.z, b.x, b.z);
      if (dist < bestDist && dist > 0.5) {
        // Direction of this segment
        const sdx: number = sx / segLen, sdz: number = sz / segLen;
        // Cross product: how much we're angling toward the segment
        const cross: number = dx * sdz - dz * sdx;
        // Dot product: are we going along or against the segment?
        const dot: number = dx * sdx + dz * sdz;
        const absAngle: number = Math.abs(cross);
        // Only assist at shallow approach angles
        if (absAngle < assistTuning.angleMax && absAngle > 0.02) {
          // Find closest point on segment to get lateral direction
          let t: number = ((x - a.x) * sx + (z - a.z) * sz) / (segLen * segLen);
          t = Math.max(0, Math.min(1, t));
          const cx: number = a.x + t * sx, cz: number = a.z + t * sz;
          // Is heading converging toward or diverging from the trail?
          const toTrailX: number = cx - x, toTrailZ: number = cz - z;
          const convergence: number = dx * toTrailX + dz * toTrailZ;

          const p: number = 1 - dist / assistTuning.range;
          const proximity: number = p * p; // quadratic falloff — gentle at distance
          // Only straighten toward parallel when converging (prevents pushing away)
          if (convergence > 0) {
            const sign: number = dot >= 0 ? -Math.sign(cross) : Math.sign(cross);
            const nudge: number = sign * absAngle * proximity * assistTuning.strength;
            if (Math.abs(nudge) > Math.abs(bestNudge)) {
              bestNudge = nudge;
              bestDist = dist;
            }
          }
        }
      }
    }
  }

  // Check arena walls
  const HALF: number = 192; // ARENA_SIZE / 2
  const wallDists: Array<{ dist: number; nx: number; nz: number }> = [
    { dist: HALF - x, nx: -1, nz: 0 },   // right wall
    { dist: HALF + x, nx: 1, nz: 0 },    // left wall
    { dist: HALF - z, nx: 0, nz: -1 },   // far wall
    { dist: HALF + z, nx: 0, nz: 1 },    // near wall
  ];
  for (const w of wallDists) {
    if (w.dist < assistTuning.range && w.dist > 0.5 && w.dist < bestDist) {
      // Cross: how much heading deviates from wall-parallel
      // Wall normal is (nx, nz), wall direction is (-nz, nx)
      const cross: number = dx * w.nx + dz * w.nz; // dot with normal = approach angle
      const absAngle: number = Math.abs(cross);
      if (absAngle < assistTuning.angleMax && absAngle > 0.02) {
        // Only assist when heading toward the wall (cross < 0 = toward wall)
        if (cross > 0) continue; // heading away — no assist needed
        const p: number = 1 - w.dist / assistTuning.range;
        const proximity: number = p * p; // quadratic falloff — gentle at distance
        const nudge: number = -Math.sign(cross) * absAngle * proximity * assistTuning.strength;
        if (Math.abs(nudge) > Math.abs(bestNudge)) {
          bestNudge = nudge;
        }
      }
    }
  }

  player._courseAssist = bestNudge;
}
