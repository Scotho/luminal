// ── playerPhysics.ts ──────────────────────────────────────
// Pure-extraction helpers for Player physics integration.
// These functions mutate the Player instance in place; no behavioural change
// from the original inline implementations in player.ts.

import type { Player } from './player';
import { advancePlayer, type InputFrame, type SimState } from './core/simulation';
import { triggerSnapSmoke } from './playerVFX';

const METER_MAX_CAR = 100;

/**
 * Sim-driven path used by bike / car / hoverboard. Mirrors the persistent
 * _sim field from Player state, advances one tick via advancePlayer, then
 * writes the result back onto Player. Returns false if the result was
 * non-finite (caller should early-return, skipping render).
 */
export function stepSimPhysics(
  player: Player,
  dt: number,
  turnDir: number,
  accelerate: boolean,
  dash: boolean,
  brake: boolean,
  driftBrake: boolean,
  special: boolean,
  simContext: SimState | undefined,
  playerIndex: number | undefined,
): boolean {
  const cfg = player._vCfg;
  syncSimFromPlayer(player, turnDir);
  const sim = player._sim;

  const input: InputFrame = {
    tick: 0,
    turnDir: turnDir as -1 | 0 | 1,
    accelerate,
    dash,
    brake,
    driftBrake,
    special,
  };
  const result = advancePlayer(sim, input, cfg, dt, simContext, playerIndex);

  // advancePlayer returns a shallow-copied working object. Copy every
  // field back to player._sim so the next frame's call sees the updated
  // grind lifecycle (cooldowns, RNG state, streaks, etc.).
  Object.assign(player._sim, result);

  const prevSnapRecovery = player._snapRecovery;
  const prevVelocityAngle = player._velocityAngle;

  if (!Number.isFinite(result.x) || !Number.isFinite(result.z) || !Number.isFinite(result.angle)
      || !Number.isFinite(result.speed) || !Number.isFinite(result.meter)) {
    return false;
  }

  player.mesh.position.x = result.x;
  player.mesh.position.z = result.z;
  player.angle = result.angle;
  player.speed = result.speed;
  player.meter = result.meter;
  player.boosting = result.boosting;
  player.dashing = result.dashing;
  player._brakeBlend = result.brakeBlend;
  player._courseAssist = 0;
  player._drifting = result.drifting;
  player.drifting = result.drifting;
  player._slipAngle = result.slipAngle;
  player._velocityAngle = result.velocityAngle;
  player.velocityAngle = player._velocityAngle;
  player.slipAngle = player._slipAngle;
  player._driftTimer = result.driftTimer;
  player._driftEntryTimer = result.driftEntryTimer;
  player._driftBrakeHeld = result.driftBrakeHeld;
  player._driftBrakeReleased = result.driftBrakeReleased;
  player._driftAlignTimer = result.driftAlignTimer;
  player._snapRecovery = result.snapRecovery;
  player._snapRecoveryTimer = result.snapRecoveryTimer;
  player._snapRecoveryBoosted = result.snapRecoveryBoosted;
  player._snapRecoveryFromAngle = result.snapRecoveryFromAngle;
  player._turnRamp = result.turnRamp;
  player.boostLocked = result.boostLocked;
  player.fumes = result.fumes;
  player._fumesTimer = result.fumesTimer;
  player.sputterSFX = result.sputterSFX;
  player.wBoosting = result.boosting && !result.dashing;
  player.driftBoosting = result.drifting && accelerate && !player.dashing;

  // Capture grind destroy queue for local-mode fade-dissolve processing
  player.pendingGrindDestroys = result._grindDestroyQueue.length > 0
    ? [...result._grindDestroyQueue]
    : player.pendingGrindDestroys.length > 0 ? [] : player.pendingGrindDestroys;
  player.lastGrindTrailOwner = result.grindTrailOwner;

  // ── Grind render-cache write-back (TASK-223) ──────────
  // Mirror applySimState's grind field writes so single-player grind
  // drives HUDs, VFX, animations, and audio the same way lockstep does.
  player._grinding = result.grinding;
  player._grindBalance = result.grindBalance;
  player._grindBailSide = result.grindBailSide;
  player._airborne = result.airborne;
  player._airborneTimer = result.airborneTimer;
  player._airborneDuration = result.airborneDuration > 0 ? result.airborneDuration : 1;
  player._airbornePeak = result.airbornePeak;
  player._recovery = result.recovery;
  player._landingPenalty = result.landingPenalty;
  player._grindStreakCount = result.grindStreakCount;
  player._grindStreakBroken = result.grindStreakBroken;
  player._grindTrailVehicleType = result.grindTrailVehicleType;
  player._trickDetected = result.trickDetected;
  player._trickMeterBonus = result.trickMeterBonus;

  // Trigger snap smoke on transition
  if (!prevSnapRecovery && result.snapRecovery && player.snapSmoke) {
    triggerSnapSmoke(player.snapSmoke, player.mesh.position, prevVelocityAngle);
  }
  return true;
}

/**
 * Legacy inline car physics path. Kept verbatim from the original player.ts
 * update() branch — drift state machine, brake blending, meter regen, etc.
 */
export function stepCarInlinePhysics(
  player: Player,
  dt: number,
  turnDir: number,
  accelerate: boolean,
  dash: boolean,
  brake: boolean,
  driftBrake: boolean,
): void {
  const cfg = player._vCfg;
  player.dashing = dash && player.meter > 0 && !player.boostLocked;

  let targetSpeed: number;
  if (player.dashing) {
    player.meter = Math.max(0, player.meter - cfg.dashDrain * dt);
    targetSpeed = cfg.dashSpeed;
    player.boosting = true;
    player.wBoosting = false;
  } else if (accelerate) {
    targetSpeed = cfg.boostSpeed;
    player.boosting = true;
    player.wBoosting = true;
  } else {
    targetSpeed = cfg.baseSpeed;
    player.boosting = false;
    player.wBoosting = false;
  }

  // Speed ramping (weighted for car)
  const lerpRate: number = targetSpeed > player.speed ? cfg.accelLerp : cfg.decelLerp;
  player.speed += (targetSpeed - player.speed) * Math.min(1, lerpRate * dt);

  // Proximity speed boost: up to 10% faster near any trail (non-drift vehicles — car earns speed through drift)
  if (!cfg.canDrift) {
    player.speed *= (1.0 + player.proximitySpeedBoost * cfg.proximitySpeedMultiplier);
  }

  // ── Drift state machine (car only) ──
  const wantDrift: boolean = cfg.canDrift && driftBrake && player.speed >= cfg.baseSpeed;
  if (wantDrift && !player._drifting) {
    player._drifting = true;
    player._driftBrakeHeld = true;
    player._driftAlignTimer = 0;
    player._velocityAngle = player.angle;
    player._driftTimer = 0;
  }

  // Brake — gentle decel (skip during drift — drift manages its own speed)
  if (brake && !player._drifting) {
    player._brakeBlend = Math.min(1, (player._brakeBlend || 0) + dt * 4);
    player.speed = player.speed * (1 - player._brakeBlend) + cfg.brakeSpeed * player._brakeBlend;
  } else if (!player._drifting) {
    player._brakeBlend = Math.max(0, (player._brakeBlend || 0) - dt * 6);
    if (player._brakeBlend > 0) {
      player.speed = player.speed * (1 - player._brakeBlend) + cfg.brakeSpeed * player._brakeBlend;
    }
  }

  let vx: number;
  let vz: number;

  player.driftBoosting = player._drifting && accelerate && !player.dashing;

  if (player._drifting) {
    player._driftTimer += dt;

    if (brake) {
      player._driftBrakeHeld = true;
      player._driftAlignTimer = 0;
    } else {
      player._driftBrakeHeld = false;
    }

    const assist: number = player._courseAssist || 0;
    player._courseAssist = 0;
    // Progressive drift turn: ramps from 60% to 100% over 0.4s for RL-style inertia
    const driftRamp: number = Math.min(1, player._driftTimer / 0.4);
    const effectiveMul: number = cfg.driftTurnMultiplier * (0.6 + 0.4 * driftRamp);
    player.angle += (turnDir + assist) * cfg.turnSpeed * effectiveMul * dt;

    const angleDiff: number = player.angle - player._velocityAngle;
    const norm: number = angleDiff - Math.round(angleDiff / (2 * Math.PI)) * 2 * Math.PI;
    const frictionMul: number = (accelerate && !player.dashing) ? cfg.driftBoostStraighten : 1;
    player._velocityAngle += norm * cfg.driftFriction * frictionMul * dt;
    player._slipAngle = player.angle - player._velocityAngle;

    if (player.dashing) {
      targetSpeed = cfg.dashSpeed;
    } else if (accelerate) {
      targetSpeed = cfg.driftBoostSpeed;
    } else {
      targetSpeed = cfg.driftSpeed;
    }
    const driftLerp: number = targetSpeed > player.speed ? cfg.accelLerp : cfg.decelLerp;
    player.speed += (targetSpeed - player.speed) * Math.min(1, driftLerp * dt);

    // Drift meter: regen while drifting — only dashing (shift) blocks regen
    if (!player.dashing) {
      player.meter = Math.min(METER_MAX_CAR, player.meter + cfg.driftMeterRegen * dt);
    }

    vx = -Math.sin(player._velocityAngle) * player.speed * dt;
    vz = -Math.cos(player._velocityAngle) * player.speed * dt;

    if (player.speed < cfg.driftMinSpeed * 0.4) {
      player._drifting = false;
    }
    if (!player._driftBrakeHeld && player._drifting) {
      if (Math.abs(player._slipAngle) < cfg.driftAlignThreshold) {
        if (player.driftBoosting) {
          // Boost-out: W + aligned = instant drift exit (snap velocity to facing)
          player._drifting = false;
          player._velocityAngle = player.angle;
        } else {
          player._driftAlignTimer += dt;
          if (player._driftAlignTimer >= cfg.driftAlignGrace) {
            player._drifting = false;
          }
        }
      } else {
        player._driftAlignTimer = 0;
      }
    }
  } else {
    player._slipAngle *= Math.exp(-cfg.driftSlipDecay * dt);
    player._velocityAngle = player.angle;

    const assist: number = player._courseAssist || 0;
    player._courseAssist = 0;
    player.angle += (turnDir + assist) * cfg.turnSpeed * dt;

    vx = -Math.sin(player.angle) * player.speed * dt;
    vz = -Math.cos(player.angle) * player.speed * dt;
  }

  player.mesh.position.x += vx;
  player.mesh.position.z += vz;
  player.drifting = player._drifting;
  player.velocityAngle = player._velocityAngle;
  player.slipAngle = player._slipAngle;
}

/**
 * Copy non-grind render fields from the Player into player._sim so the next
 * advancePlayer call sees current position/angle/speed/meter/drift state.
 *
 * Grind-owned fields (grinding, grindBalance, grindCooldown, airborne, etc.)
 * are NOT touched — they live in player._sim and are the source of truth
 * across frames for the single-player grind path.
 */
export function syncSimFromPlayer(player: Player, turnDir: number): void {
  const sim = player._sim;
  sim.x = player.mesh.position.x;
  sim.z = player.mesh.position.z;
  sim.angle = player.angle;
  sim.speed = player.speed;
  sim.meter = player.meter;
  sim.alive = player.alive;
  sim.vehicleType = player.vehicleType;
  sim.boosting = player.boosting;
  sim.dashing = player.dashing;
  sim.brakeBlend = player._brakeBlend;
  sim.proximityBoost = player.proximitySpeedBoost;
  sim.courseAssist = player._courseAssist;
  sim.drifting = player._drifting;
  sim.slipAngle = player._slipAngle;
  sim.velocityAngle = player._velocityAngle;
  sim.driftTimer = player._driftTimer;
  sim.driftEntryTimer = player._driftEntryTimer;
  sim.driftBrakeHeld = player._driftBrakeHeld;
  sim.driftBrakeReleased = player._driftBrakeReleased;
  sim.driftAlignTimer = player._driftAlignTimer;
  sim.snapRecovery = player._snapRecovery;
  sim.snapRecoveryTimer = player._snapRecoveryTimer;
  sim.snapRecoveryBoosted = player._snapRecoveryBoosted;
  sim.snapRecoveryFromAngle = player._snapRecoveryFromAngle;
  sim.turnRamp = player._turnRamp;
  sim.boostLocked = player.boostLocked;
  sim.fumes = player.fumes;
  sim.fumesTimer = player._fumesTimer;
  sim.sputterSFX = false; // one-frame flag, reset before each step
  sim.trailTimer = 0;
  void turnDir;
}
