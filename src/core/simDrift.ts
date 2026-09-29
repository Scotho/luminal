// ── Drift state machine (extracted from simulation.ts) ──
// Deterministic lockstep — bit-identical math must match simulation.ts semantics.
// Handles turning, slip dynamics, speed shaping, and exit conditions.
// Mutates player state in place and updates x/z position — no allocations.

import type { VehiclePhysics } from '../vehicleConfig';
import {
  approachAngleExp,
  clamp,
  easeOut2,
  lerp,
  normalizeAngle,
  saturate,
  smoothstep,
} from './simulation';
import type { InputFrame, PlayerSim } from './simulation';

// Meter constants (match player.ts)
const METER_MAX = 100;

function computeSlipCeiling(
  speed01: number,
  accelerate: boolean,
  countersteerAmt: number,
  dashing: boolean,
  cfg: VehiclePhysics,
): number {
  // Smoothstep curve: tight at low speed, fully open above 50% speed.
  // This keeps the ceiling out of mid/high-speed drifting entirely.
  const t = smoothstep(0, 0.5, speed01);
  let ceiling = cfg.driftMaxSlipLow + (cfg.driftMaxSlipHigh - cfg.driftMaxSlipLow) * t;

  // Throttle tightens ceiling at low speed (forward bite)
  if (accelerate && !dashing) {
    ceiling *= 1 - lerp(cfg.driftSlipCeilingThrottleTighten, 0.0, speed01);
  }

  // Countersteer tightens ceiling (recovery assist)
  if (countersteerAmt > 0) {
    ceiling *= 1 - countersteerAmt * lerp(cfg.driftSlipCeilingCountersteerTighten, 0.0, speed01);
  }

  return ceiling;
}

// ── Drift state machine ────────────────────────────────
// Handles turning, slip dynamics, speed shaping, and exit conditions.
// Mutates player state in place and updates x/z position — no allocations.

export function advanceDrift(
  p: PlayerSim, input: InputFrame, cfg: VehiclePhysics, dt: number,
  driftInput: boolean,
): void {
  p.driftTimer += dt;
  p.driftEntryTimer += dt;

  if (driftInput) {
    p.driftBrakeHeld = true;
    p.driftAlignTimer = 0;
  } else {
    p.driftBrakeHeld = false;
    p.driftBrakeReleased = true; // brake was released at least once during this drift
  }

  // Drift turn rate (amplified, progressive ramp for RL-style inertia)
  const assist = p.courseAssist;
  const driftRamp: number = Math.min(1, p.driftTimer / 0.4);
  const entry01 = saturate(p.driftEntryTimer / Math.max(0.0001, cfg.driftEntryDuration));
  const entryEase = entry01 * entry01 * (3 - 2 * entry01);
  const speed01 = saturate((p.speed - cfg.driftIntentStartSpeed) / Math.max(0.001, cfg.driftIntentFullSpeed - cfg.driftIntentStartSpeed));
  const highSpeedRelax01 = smoothstep(0.65, 1.0, speed01);
  const entryYawScale = lerp(cfg.driftEntryYawScale, 1.0, entryEase);
  const yawAuthority = lerp(1.2, 1.0, speed01);

  const steer = clamp(input.turnDir + assist, -1, 1);
  const steerCurve = Math.sign(steer) * Math.pow(Math.abs(steer), 0.85);
  const entrySlipCap = lerp(cfg.driftEntrySlipScale, 1.0, entryEase);
  const maxSlip = lerp(cfg.driftMaxSlipLow, cfg.driftMaxSlipHigh, easeOut2(speed01)) * entrySlipCap;
  const baseGrip = lerp(cfg.driftGripLow, cfg.driftGripHigh, speed01);
  const slipResponse = lerp(cfg.driftSlipResponseLow, cfg.driftSlipResponseHigh, speed01);
  const currentSlip = normalizeAngle(p.angle - p.velocityAngle);
  const countersteerAmt = steer === 0 ? 0 : saturate(-Math.sign(currentSlip || 1) * steer);
  const throttleAssist = input.accelerate && !p.dashing
    ? lerp(cfg.driftThrottleHookLow, cfg.driftThrottleHookHigh, speed01)
    : 0;
  const wheelCorrectScale = lerp(1.0, cfg.driftHighSpeedWheelCorrectScale, highSpeedRelax01);
  const boostCorrectScale = lerp(1.0, cfg.driftHighSpeedBoostCorrectScale, highSpeedRelax01);
  const countersteerScale = lerp(1.0, cfg.driftHighSpeedCountersteerScale, highSpeedRelax01);
  const releaseScale = lerp(1.0, cfg.driftHighSpeedReleaseScale, highSpeedRelax01);
  const entryFollowScale = lerp(cfg.driftEntryFollowScale, 1.0, entryEase);
  const countersteerAssist = countersteerAmt * lerp(cfg.driftCountersteerAssistLow, cfg.driftCountersteerAssistHigh, speed01) * countersteerScale;
  const releaseAssist = driftInput ? 0 : lerp(cfg.driftReleaseAssistLow, cfg.driftReleaseAssistHigh, speed01) * releaseScale;

  const ceilingSlip = computeSlipCeiling(speed01, input.accelerate, countersteerAmt, p.dashing, cfg);

  // ── Coupled yaw/follow scaling ──
  // When the ceiling constrains slip, both yaw rotation and velocity follow
  // must scale down together — tight slip + fast yaw = orbit, not arc.
  // Band 0.3–0.8 covers the actual drift speed range (spd01 0.45–0.55).
  const driftConstraint = smoothstep(0.3, 0.8, speed01);
  let yawScale = lerp(0.5, 1.0, driftConstraint);
  let followScale = lerp(0.7, 1.0, driftConstraint);

  // ── Reversal damping ──
  // When slip and steer point opposite directions (player reversing drift),
  // damp yaw and follow proportional to how much slip remains on the old side.
  // This creates momentum resistance to direction changes without affecting
  // steady-state drift or initial entry.
  const reversing = Math.abs(currentSlip) > 0.05
    && Math.sign(currentSlip) !== 0
    && Math.sign(currentSlip) !== Math.sign(steerCurve);
  const reversalAmount = reversing
    ? saturate(Math.abs(currentSlip) / Math.max(maxSlip, 0.001))
    : 0;
  yawScale *= lerp(1.0, 0.55, reversalAmount);
  followScale *= lerp(1.0, 0.7, reversalAmount);

  const effectiveMul: number = cfg.driftTurnMultiplier * (0.65 + 0.35 * driftRamp) * yawAuthority * entryYawScale * yawScale;
  p.angle += (input.turnDir + assist) * cfg.turnSpeed * effectiveMul * dt;

  let targetSlip = steerCurve * maxSlip;
  if (input.accelerate && !p.dashing) {
    targetSlip *= 1 - lerp(0.75, 0.20, speed01);
  }
  if (countersteerAmt > 0) {
    targetSlip *= 1 - countersteerAmt * lerp(0.90, 0.30, speed01);
  }
  if (!driftInput) {
    targetSlip *= lerp(0.05, 0.55, speed01);
  }
  const desiredVelocityAngle = p.angle - targetSlip;
  // Slip-shaped follow: reduce at BOTH extremes, strongest in mid-range.
  // Low slip: soften snap-to-facing (glide instead of magnetic lock-in)
  // High slip: looser feel at max angle (float instead of carve)
  const slip01 = saturate(Math.abs(currentSlip) / Math.max(ceilingSlip, 0.001));
  const lowSlipScale = lerp(0.7, 1.0, smoothstep(0.1, 0.4, slip01));
  const highSlipScale = lerp(1.0, 0.65, smoothstep(0.5, 1.0, slip01));
  const followSlipScale = lowSlipScale * highSlipScale;
  const baseFollowRate = (slipResponse + baseGrip * 0.35) * entryFollowScale * followScale * followSlipScale;
  const wheelCorrectRate = (throttleAssist * wheelCorrectScale * entryFollowScale + countersteerAssist + releaseAssist) * followScale * followSlipScale;
  const preDynamicsDiff = normalizeAngle(p.angle - p.velocityAngle);
  p.velocityAngle = approachAngleExp(p.velocityAngle, desiredVelocityAngle, baseFollowRate + wheelCorrectRate, dt);
  if (input.accelerate && !p.dashing) {
    p.velocityAngle = approachAngleExp(
      p.velocityAngle,
      p.angle,
      throttleAssist * boostCorrectScale * entryFollowScale * followScale,
      dt,
    );
  }
  // ── Slip ceiling enforcement ──
  // Cap slip to ceiling, but only when slip is on the same side as before the
  // dynamics ran. If countersteer pushed slip through zero to the other side,
  // let it go — capping a zero-crossing would trap slip at the ceiling forever.
  const postDiff = normalizeAngle(p.angle - p.velocityAngle);
  const postSlip = Math.abs(postDiff);
  const sameSlipSide = Math.sign(postDiff) === Math.sign(preDynamicsDiff) || Math.abs(preDynamicsDiff) < 0.001;
  if (postSlip > ceilingSlip && sameSlipSide) {
    p.velocityAngle = normalizeAngle(p.angle - Math.sign(postDiff) * ceilingSlip);
  }
  p.slipAngle = normalizeAngle(p.angle - p.velocityAngle);
  const absSlip = Math.abs(p.slipAngle);

  const absSlip01 = saturate(absSlip / Math.max(maxSlip, 0.001));
  const lowSpeed01 = 1 - speed01;
  const forwardIntent01 = 1 - absSlip01;
  const speedCarry = lerp(cfg.driftSpeedCarryLow, cfg.driftSpeedCarryHigh, speed01);
  const coastAuthority = lerp(cfg.driftCoastSpeedAuthorityLow, cfg.driftCoastSpeedAuthorityHigh, speed01);
  const throttleAuthority = lerp(cfg.driftThrottleSpeedAuthorityLow, cfg.driftThrottleSpeedAuthorityHigh, speed01);
  const effectiveAuthority = (input.accelerate ? throttleAuthority : coastAuthority) * forwardIntent01;
  const slipScrub =
    lerp(cfg.driftSlipSpeedScrubLow, cfg.driftSlipSpeedScrubHigh, speed01) *
    absSlip01 *
    (0.35 + 0.65 * lowSpeed01);
  const carryTarget = Math.min(p.speed * speedCarry, cfg.driftSpeed);
  const requestedTarget = input.accelerate ? cfg.driftBoostSpeed : cfg.driftSpeed;
  let shapedTargetSpeed = lerp(carryTarget, requestedTarget, effectiveAuthority);
  if (input.accelerate) {
    shapedTargetSpeed += cfg.driftStraightenSpeedGain * forwardIntent01 * (0.35 + 0.65 * lowSpeed01);
  }
  p.speed = Math.max(cfg.brakeSpeed, p.speed - slipScrub * dt);

  // Drift speed targets
  let targetSpeed: number;
  if (p.dashing) {
    p.brakeBlend = 0;
    const dashPenalty = lerp(cfg.driftDashSlipPenaltyLow, cfg.driftDashSlipPenaltyHigh, speed01) * absSlip01 * lowSpeed01;
    targetSpeed = cfg.dashSpeed * (1 - dashPenalty);
    p.speed += (targetSpeed - p.speed) * Math.min(1, cfg.accelLerp * dt);
  } else {
    // Decay brake blend when not braking
    p.brakeBlend = Math.max(0, p.brakeBlend - dt * 6);
    if (p.brakeBlend > 0) {
      p.speed = p.speed * (1 - p.brakeBlend) + cfg.brakeSpeed * p.brakeBlend;
    }
    targetSpeed = shapedTargetSpeed;
    const driftLerp = targetSpeed > p.speed ? cfg.accelLerp : cfg.decelLerp;
    p.speed += (targetSpeed - p.speed) * Math.min(1, driftLerp * dt);
  }

  // Drift meter regen (only dashing blocks regen)
  if (!p.dashing) {
    p.meter = Math.min(METER_MAX, p.meter + cfg.driftMeterRegen * dt);
  }

  // Movement uses velocity angle (the slide)
  p.x += -Math.sin(p.velocityAngle) * p.speed * dt;
  p.z += -Math.cos(p.velocityAngle) * p.speed * dt;

  // Drift exit conditions
  if (p.speed < cfg.driftMinSpeed * 0.4) {
    p.drifting = false;
    p.driftEntryTimer = 0;
    p.velocityAngle = p.angle;
  }
  if (!p.driftBrakeHeld && p.drifting) {
    const lowSpeedSnap = speed01 <= cfg.driftExitSpeedThreshold;
    if (cfg.snapExitSlipThreshold > 0 && absSlip >= cfg.snapExitSlipThreshold) {
      // SNAP EXIT — large slip angle: end drift immediately, snap recovery curves velocity back
      p.drifting = false;
      p.driftEntryTimer = 0;
      p.driftAlignTimer = 0;
      p.snapRecovery = true;
      p.snapRecoveryTimer = 0;
      p.snapRecoveryBoosted = input.accelerate && !p.dashing;
      p.snapRecoveryFromAngle = p.velocityAngle; // remember old slide direction for curved path
    } else if (absSlip <= cfg.driftExitSlipThreshold || (lowSpeedSnap && absSlip <= cfg.driftExitSlipThreshold * 3.5)) {
      p.drifting = false;
      p.driftEntryTimer = 0;
      p.driftAlignTimer = 0;
      p.snapRecovery = false;
      p.snapRecoveryTimer = 0;
      p.snapRecoveryBoosted = false;
      p.snapRecoveryFromAngle = p.angle;
      p.velocityAngle = lowSpeedSnap
        ? p.angle
        : approachAngleExp(p.velocityAngle, p.angle, baseGrip + releaseAssist, dt);
      p.slipAngle = normalizeAngle(p.angle - p.velocityAngle);
    }
  }
}
