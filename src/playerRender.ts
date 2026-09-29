// ── playerRender.ts ───────────────────────────────────────
// Pure-extraction helpers for per-frame Player render/VFX updates.
// These functions mutate the Player instance in place; no behavioural change
// from the original inline implementations in player.ts.

import * as THREE from 'three';
import type { Player } from './player';
import { adminOverrides } from './player';
import { bloomMul, getGfx, VISUAL_TUNING } from './graphics';
import {
  updateGroundFX, updateElectricArcs, updateSpeedLines, updateSnapSmoke,
} from './playerVFX';
import type { PlayerSim } from './core/simulation';
import {
  consumeGrindBustScore, finalizeGrindCashOut,
  GRIND_SWEET_SPOT, GRIND_SCORE_METER_DIVISOR, GRIND_COOLDOWN,
} from './core/simulation';
import {
  playGrindSweetLockIn, playGrindChainExtend, playGrindMilestone,
  playGrindCashOut, playGrindBust,
} from './sfx';
import { getDriftIntensity } from './effects/tireStreaks';

// SPEC-82: streak milestones that fire the ascending-triad cue
const GRIND_MILESTONES = [10, 25, 50, 100];

/** Fill the pre-allocated hoverboard animation input buffer with current state. */
export function fillHoverAnimInput(player: Player, dt: number, baseSpeed: number): void {
  const a = player._animInput;
  a.dt = dt;
  a.speed = player.speed;
  a.baseSpeed = baseSpeed;
  a.boosting = player.boosting || player.wBoosting;
  a.dashing = player.dashing;
  a.turnRamp = player._smoothTurnDir;
  a.brakeBlend = player._brakeBlend;
  a.grinding = player._grinding;
  a.grindBalance = player._grindBalance;
  a.airborne = player._airborne;
  a.airborneTimer = player._airborneTimer;
  a.airborneDuration = player._airborneDuration;
  a.airbornePeak = player._airbornePeak;
  a.recovery = player._recovery;
  a.landingPenalty = player._landingPenalty;
}

/**
 * Drive bike/car procedural animator from current physics state. Returns
 * true if a vehicle-specific animator handled the frame, false if caller
 * should apply fallback lean.
 */
export function updateWheeledAnimator(player: Player, dt: number, baseSpeed: number): boolean {
  if (player.vehicleType === 'bike' && player._bikeAnimator) {
    const a = player._bikeAnimInput;
    a.dt = dt;
    a.speed = player.speed;
    a.baseSpeed = baseSpeed;
    a.boosting = player.boosting || player.wBoosting;
    a.dashing = player.dashing;
    a.turnRamp = player._smoothTurnDir;
    a.brakeBlend = player._brakeBlend;
    player._bikeAnimator.update(a);
    return true;
  }
  if (player.vehicleType === 'car' && player._carAnimator) {
    const a = player._carAnimInput;
    a.dt = dt;
    a.speed = player.speed;
    a.baseSpeed = baseSpeed;
    a.boosting = player.boosting || player.wBoosting;
    a.dashing = player.dashing;
    a.turnRamp = player._smoothTurnDir;
    a.brakeBlend = player._brakeBlend;
    a.drifting = player._drifting;
    a.driftDirection = Math.sign(player._slipAngle);
    a.airborne = player._airborne;
    a.airborneTimer = player._airborneTimer;
    a.airborneDuration = player._airborneDuration;
    a.airbornePeak = player._airbornePeak;
    player._carAnimator.update(a);
    return true;
  }
  return false;
}

/**
 * Update grind HUD, combo HUD, bust overlay, spark VFX, and SFX edge cues.
 * Shared between the lockstep path (applySimState) and the single-player
 * path (update).
 *
 * SPEC-82: pass `sim` only from the single-player path (or lockstep with
 * `isLocal: true`) — it owns the sim mutations for bust consume and cash-out
 * finalize. Remote lockstep players pass null and render from cached state.
 */
export function updateGrindRender(
  player: Player,
  dt: number,
  camera?: THREE.Camera,
  sim: PlayerSim | null = null,
): void {
  // Spark VFX
  if (player._grinding && player._sparkEmitter) {
    const dirX = -Math.sin(player.angle);
    const dirZ = -Math.cos(player.angle);
    const sparkCount = Math.abs(player._grindBalance) < 0.15 ? 16 : 8;
    player._sparkEmitter.emit(
      player.mesh.position.x, 0.1, player.mesh.position.z,
      dirX, dirZ, sparkCount,
    );
  }
  if (player._sparkEmitter) player._sparkEmitter.update(dt);

  // Grind HUD (hoverboard only — guarded by _grindHUD != null for future vehicles)
  if (player._grindHUD) {
    if (player._grinding) {
      player._grindHUD.show();
      const vt = player._grindTrailVehicleType;
      const difficulty: 'easy' | 'normal' | 'hard' =
        vt === 'bike' ? 'easy' : vt === 'car' ? 'hard' : 'normal';
      player._grindHUD.setTrailDifficulty(difficulty);
    } else {
      player._grindHUD.hide();
    }
    if (camera) {
      player._grindHUD.update(
        dt,
        player.mesh.position.x,
        player._innerGroup.position.y,
        player.mesh.position.z,
        player._grindBalance,
        camera,
      );
    }
  }

  // TASK-265: pre-grind availability hint — fades in when sim reports a
  // grindable trail is in range and the player is free to press Space.
  // (Remote lockstep players pass sim=null, so their hints stay hidden.)
  if (player._grindAvailabilityHint) {
    const available = !!sim
      && sim.grindSnapAvailable
      && !sim.grinding
      && !sim.airborne
      && !sim.recovery
      && sim.grindCooldown <= 0;
    player._grindAvailabilityHint.setAvailable(available);
  }

  // SPEC-94: Tire streak decals during drift (car only)
  if (player._tireStreaks) {
    if (player.drifting) {
      const intensity = getDriftIntensity(player.slipAngle, player.speed, 110);
      player._tireStreaks.spawnStreak(
        player.mesh.position.x,
        player.mesh.position.z,
        player.angle,
        intensity,
        performance.now(),
      );
    }
    player._tireStreaks.tickFade(dt * 1000);
  }

  // Combo HUD + SFX edge cues (SPEC-82)
  if (player._grindComboHUD && sim) {
    // 1) Consume any pending bust score — fire overlay + sfx
    const bust = consumeGrindBustScore(sim);
    if (bust > 0) {
      player._grindBustOverlay?.flash(bust, player.colorHex);
      playGrindBust();
    }

    // 2) Sweet-spot lock-in cue on edge transition
    const inSweet = sim.grinding && Math.abs(sim.grindBalance) < GRIND_SWEET_SPOT;
    if (inSweet && !player._lastSweetLockIn) {
      playGrindSweetLockIn();
    }
    player._lastSweetLockIn = inSweet;

    // 3) Milestone cue on streak tier crossings
    for (let i = 0; i < GRIND_MILESTONES.length; i++) {
      const m = GRIND_MILESTONES[i];
      if (sim.grindStreakCount >= m && player._lastStreakCount < m) {
        playGrindMilestone(i);
      }
    }

    // 4) Chain extend cue when a trick was appended this frame
    const chainLen = sim.grindChain.length;
    if (chainLen > player._lastChainLength) {
      playGrindChainExtend();
    }

    // 5) Clean cash-out transition: runActive true → false without a bust.
    //    sim.grindScore stays intact for one frame so we can read it here.
    if (player._prevRunActive && !sim.grindRunActive && bust === 0) {
      const cashOutScore = sim.grindScore;
      const meterGain = Math.floor(cashOutScore / GRIND_SCORE_METER_DIVISOR);
      if (cashOutScore > 0) {
        playGrindCashOut(cashOutScore);
        player._grindComboHUD.triggerCashOut(meterGain);
      }
      finalizeGrindCashOut(sim);
    }

    // 6) Drive combo HUD state with live sim data
    player._grindComboHUD.update({
      streakCount: sim.grindStreakCount,
      broken: sim.grindStreakBroken,
      isGrinding: sim.grinding,
      score: sim.grindScore,
      multiplier: sim.grindMultiplier,
      chain: sim.grindChain,
      dirty: sim.grindChainDirty,
      cooldownRemaining: sim.grindCooldown,
      cooldownTotal: GRIND_COOLDOWN,
    });

    player._lastChainLength = chainLen;
    player._lastStreakCount = sim.grindStreakCount;
    player._prevRunActive = sim.grindRunActive;
  } else if (player._grindComboHUD) {
    // Remote lockstep path (sim === null): drive HUD from cached render state;
    // no cue firing, no sim mutation. Score/mult/chain are not synced for
    // remote players — they see a simplified display.
    player._grindComboHUD.update({
      streakCount: player._grindStreakCount,
      broken: player._grindStreakBroken,
      isGrinding: player._grinding,
      score: 0,
      multiplier: 1.0,
      chain: [],
      dirty: 0,
      cooldownRemaining: 0,
      cooldownTotal: 0,
    });
  }

  // Drive bust overlay animation (ticks regardless of sim availability)
  player._grindBustOverlay?.update(dt);
}

/**
 * Apply lean/body-roll (accounting for drift) and drive the active animator.
 * Used by the single-player update() path.
 */
export function applyLeanAndAnimatorUpdate(player: Player, dt: number, turnDir: number): void {
  const cfg = player._vCfg;
  player._smoothTurnDir += (turnDir - player._smoothTurnDir) * 4.0 * dt;
  const driftLeanBoost: number = player._drifting ? Math.min(1, Math.abs(player._slipAngle) * 2) : 0;
  const totalLeanInput: number = player._smoothTurnDir + driftLeanBoost * Math.sign(player._slipAngle) * 0.5;
  const speedT: number = Math.min(1, Math.max(0, (player.speed - cfg.baseSpeed) / (cfg.boostSpeed - cfg.baseSpeed)));
  const leanRange: number = cfg.minLean + speedT * (cfg.maxLean - cfg.minLean);
  const targetLean: number = -totalLeanInput * leanRange;
  player.currentLean += (targetLean - player.currentLean) * cfg.leanLerp * dt;
  if (!updateWheeledAnimator(player, dt, cfg.baseSpeed) &&
      player._innerGroup && player.vehicleType !== 'hoverboard') {
    player._innerGroup.rotation.z = player.currentLean;
  }
}

/**
 * Apply lean/body-roll and drive the active animator for the lockstep
 * applySimState path (no drift lean boost — drift is already in sim).
 */
export function applyLeanAndAnimatorSim(player: Player, dt: number, turnDir: number): void {
  const cfg = player._vCfg;
  player._smoothTurnDir += (turnDir - player._smoothTurnDir) * 4.0 * dt;
  const speedT: number = Math.min(1, Math.max(0, (player.speed - cfg.baseSpeed) / (cfg.boostSpeed - cfg.baseSpeed)));
  const leanRange: number = cfg.minLean + speedT * (cfg.maxLean - cfg.minLean);
  const targetLean = -player._smoothTurnDir * leanRange;
  player.currentLean += (targetLean - player.currentLean) * cfg.leanLerp * dt;
  if (!updateWheeledAnimator(player, dt, cfg.baseSpeed) &&
      player._innerGroup && player.vehicleType !== 'hoverboard') {
    player._innerGroup.rotation.z = player.currentLean;
  }
}

/**
 * Emit trail points (skips during grind / airborne) and drive trail head /
 * speed parameters.
 */
export function updateTrail(player: Player, dt: number): void {
  const cfg = player._vCfg;
  const trailX: number = player.mesh.position.x + Math.sin(player.angle) * cfg.trailRear;
  const trailZ: number = player.mesh.position.z + Math.cos(player.angle) * cfg.trailRear;
  player.trailTimer += dt;
  // Grinders and airborne players do not lay new trail points — they're on an existing rail.
  if (player.trailTimer > 0.03 && !player._grinding && !player._airborne) {
    player.trailTimer = 0;
    player.trail.addPoint(trailX, trailZ);
  }
  player.trail.updateHead(trailX, trailZ);
  player.trail.updateSpeed(player.speed / 40);
}

/**
 * Update engine glow, bike light, proximity aura, underglow, ground FX,
 * electric arcs, speed lines and snap smoke for the single-player update()
 * path (uses the dash-intensity 2.21 constant and `accelerate` gate).
 */
export function updateLightsAndFXUpdate(
  player: Player,
  dt: number,
  accelerate: boolean,
  dashJustPressed: boolean,
): void {
  const t: number = performance.now() * 0.001;
  let intensity: number;
  if (player.dashing) {
    const zap: number = Math.sin(t * 40) * 0.35 + Math.sin(t * 67) * 0.25 + Math.sin(t * 97) * 0.18;
    intensity = 2.21 + zap;
  } else if (accelerate) {
    const zap: number = Math.sin(t * 30) * 0.25 + Math.sin(t * 53) * 0.18;
    intensity = 1.6 + zap;
  } else {
    intensity = 1.6;
  }
  applyCommonLights(player, intensity, t, dashJustPressed, dt);
}

/**
 * Engine glow / lights / FX for the lockstep applySimState path. Uses the
 * dash-intensity 2.6 constant and `player.boosting` gate (subtly different
 * from the update() path — preserved verbatim).
 */
export function updateLightsAndFXSim(
  player: Player,
  dt: number,
  dashJustPressed: boolean,
): void {
  const t: number = performance.now() * 0.001;
  let intensity: number;
  if (player.dashing) {
    const zap: number = Math.sin(t * 40) * 0.35 + Math.sin(t * 67) * 0.25 + Math.sin(t * 97) * 0.18;
    intensity = 2.6 + zap;
  } else if (player.boosting) {
    const zap: number = Math.sin(t * 30) * 0.25 + Math.sin(t * 53) * 0.18;
    intensity = 1.6 + zap;
  } else {
    intensity = 1.6;
  }
  applyCommonLights(player, intensity, t, dashJustPressed, dt);
}

function applyCommonLights(
  player: Player,
  intensity: number,
  t: number,
  dashJustPressed: boolean,
  dt: number,
): void {
  if (adminOverrides.engineGlow !== null) intensity = adminOverrides.engineGlow;
  (player.engineGlow.material as THREE.MeshStandardMaterial).emissiveIntensity = intensity * bloomMul.vehicles;
  const vt = VISUAL_TUNING[getGfx().preset] ?? VISUAL_TUNING.high;
  if (player.bikeLight) {
    player.bikeLight.intensity = (adminOverrides.bikeLight !== null ? adminOverrides.bikeLight : vt.bikeLightInt)
      * player._vehicleLightBoost * bloomMul.vehicles;
  }

  // Proximity visual effects — small localized aura (~1.5 bike lengths)
  const prox: number = player.proximitySpeedBoost;
  if (player.proximityAura) {
    const flicker: number = prox > 0.1 ? (Math.sin(t * 12) * 0.3 + Math.sin(t * 19) * 0.2 + Math.sin(t * 31) * 0.15) : 0;
    player.proximityAura.intensity = (prox * 2.1 + flicker * prox) * bloomMul.vehicles;
    player.proximityAura.distance = 7; // ~1.5 bike lengths, fixed
    const c: THREE.Color = player.proximityAura.color;
    c.setRGB(0.6 + prox * 0.4, 0.8 + prox * 0.2, 1.0);
  }
  // Underglow: subtle pulse when near trails
  if (player.underGlow) {
    player.underGlow.intensity = (adminOverrides.underGlow !== null ? adminOverrides.underGlow : vt.underGlowInt)
      * player._vehicleUnderglowBoost * bloomMul.vehicles;
  }

  // Ground effects — sparks on dash only, lightning arcs on any boost
  if (player.groundFX) {
    updateGroundFX(player.groundFX, player.mesh.position, player.angle, player.speed, player.wBoosting, player.dashing, dashJustPressed, dt);
  }

  // Electric arcs — only during dash (shift), not W-boost
  if (player.electricArcs) {
    updateElectricArcs(player.electricArcs, player.mesh.position, player.angle, player.dashing, dashJustPressed, dt);
  }

  // Speed lines
  if (player.speedLines) {
    updateSpeedLines(player.speedLines, player.mesh.position, player.angle, player.dashing, dashJustPressed, dt, player._grinding, player._grindBalance);
  }

  // Snap exit smoke
  if (player.snapSmoke) updateSnapSmoke(player.snapSmoke, dt);
}
