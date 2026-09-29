// ── Admin Panel: Physics + Gameplay Sections ─────────────
// Physics: Simulation, Bike, Car (with drift), Hoverboard.
// Gameplay: AI Personality, Collision, Player Assist.

import {
  addHeader,
  addSubHeader,
  addLabel,
  addSlider,
  trackSlider,
} from './helpers';
import type { GameLike } from '../adminPanel';
import { BIKE_PHYSICS, CAR_PHYSICS, HOVERBOARD_PHYSICS } from '../vehicleConfig';
import { getCollisionTuning } from '../core/collisionSystem';
import { aiTuning } from '../ai';
import { assistTuning } from '../player';

export function addPhysicsSection(gameRef: GameLike | null): void {
  // ── Simulation Speed ────────────────────────────────────
  addHeader('SIMULATION', 'sim');
  if (gameRef) {
    trackSlider('sim', 'timeScale', addSlider('time scale', gameRef.timeScale ?? 1, 0.1, 3, 0.1, (v) => {
      if (gameRef) gameRef.timeScale = v;
    }));
  }

  // ── Vehicle Physics — BIKE ─────────────────────────────
  addHeader('BIKE PHYSICS', 'bikePhys');
  {
    const bp = BIKE_PHYSICS;
    trackSlider('bikePhys', 'baseSpeed', addSlider('baseSpeed', bp.baseSpeed, 10, 80, 1, (v) => { bp.baseSpeed = v; }));
    trackSlider('bikePhys', 'boostSpeed', addSlider('boostSpeed', bp.boostSpeed, 20, 120, 1, (v) => { bp.boostSpeed = v; }));
    trackSlider('bikePhys', 'dashSpeed', addSlider('dashSpeed', bp.dashSpeed, 40, 160, 1, (v) => { bp.dashSpeed = v; }));
    trackSlider('bikePhys', 'turnSpeed', addSlider('turnSpeed', bp.turnSpeed, 0.5, 5, 0.05, (v) => { bp.turnSpeed = v; }));
    trackSlider('bikePhys', 'boostDrain', addSlider('boostDrain', bp.boostDrain, 0, 40, 1, (v) => { bp.boostDrain = v; }));
    trackSlider('bikePhys', 'dashDrain', addSlider('dashDrain', bp.dashDrain, 0, 120, 1, (v) => { bp.dashDrain = v; }));
    trackSlider('bikePhys', 'passiveRegen', addSlider('passiveRegen', bp.passiveRegen, 0, 20, 0.2, (v) => { bp.passiveRegen = v; }));
    trackSlider('bikePhys', 'minLean', addSlider('minLean', bp.minLean, 0, 1, 0.01, (v) => { bp.minLean = v; }));
    trackSlider('bikePhys', 'maxLean', addSlider('maxLean', bp.maxLean, 0, 1, 0.01, (v) => { bp.maxLean = v; }));
    trackSlider('bikePhys', 'accelLerp', addSlider('accelLerp', bp.accelLerp, 1, 999, 1, (v) => { bp.accelLerp = v; }));
  }

  // ── Vehicle Physics — CAR ──────────────────────────────
  addHeader('CAR PHYSICS', 'carPhys');
  {
    const cp = CAR_PHYSICS;
    trackSlider('carPhys', 'baseSpeed', addSlider('baseSpeed', cp.baseSpeed, 10, 80, 1, (v) => { cp.baseSpeed = v; }));
    trackSlider('carPhys', 'boostSpeed', addSlider('boostSpeed', cp.boostSpeed, 20, 120, 1, (v) => { cp.boostSpeed = v; }));
    trackSlider('carPhys', 'dashSpeed', addSlider('dashSpeed', cp.dashSpeed, 40, 160, 1, (v) => { cp.dashSpeed = v; }));
    trackSlider('carPhys', 'turnSpeed', addSlider('turnSpeed', cp.turnSpeed, 0.5, 5, 0.05, (v) => { cp.turnSpeed = v; }));
    trackSlider('carPhys', 'boostDrain', addSlider('boostDrain', cp.boostDrain, 0, 40, 1, (v) => { cp.boostDrain = v; }));
    trackSlider('carPhys', 'dashDrain', addSlider('dashDrain', cp.dashDrain, 0, 120, 1, (v) => { cp.dashDrain = v; }));
    trackSlider('carPhys', 'passiveRegen', addSlider('passiveRegen', cp.passiveRegen, 0, 20, 0.2, (v) => { cp.passiveRegen = v; }));
    trackSlider('carPhys', 'accelLerp', addSlider('accelLerp', cp.accelLerp, 1, 30, 0.5, (v) => { cp.accelLerp = v; }));
    trackSlider('carPhys', 'decelLerp', addSlider('decelLerp', cp.decelLerp, 1, 30, 0.5, (v) => { cp.decelLerp = v; }));
    addSubHeader('DRIFT');
    trackSlider('carPhys', 'driftTurnMul', addSlider('driftTurnMul', cp.driftTurnMultiplier, 0.5, 4, 0.1, (v) => { cp.driftTurnMultiplier = v; }));
    trackSlider('carPhys', 'driftFriction', addSlider('driftFriction', cp.driftFriction, 0.5, 5, 0.05, (v) => { cp.driftFriction = v; }));
    trackSlider('carPhys', 'driftSlipDecay', addSlider('slipDecay', cp.driftSlipDecay, 0.5, 8, 0.05, (v) => { cp.driftSlipDecay = v; }));
    trackSlider('carPhys', 'driftSpeed', addSlider('driftSpeed', cp.driftSpeed, 20, 120, 1, (v) => { cp.driftSpeed = v; }));
    trackSlider('carPhys', 'driftBoostSpeed', addSlider('driftBoostSpd', cp.driftBoostSpeed, 40, 140, 1, (v) => { cp.driftBoostSpeed = v; }));
    trackSlider('carPhys', 'driftMeterRegen', addSlider('driftRegen', cp.driftMeterRegen, 0, 60, 1, (v) => { cp.driftMeterRegen = v; }));
    trackSlider('carPhys', 'driftEntryDuration', addSlider('entryDur', cp.driftEntryDuration, 0, 1, 0.01, (v) => { cp.driftEntryDuration = v; }));
    trackSlider('carPhys', 'driftBoostStraighten', addSlider('boostStraight', cp.driftBoostStraighten, 0, 10, 0.1, (v) => { cp.driftBoostStraighten = v; }));
    trackSlider('carPhys', 'snapExitSlipThreshold', addSlider('snapSlipThresh', cp.snapExitSlipThreshold, 0, 1, 0.01, (v) => { cp.snapExitSlipThreshold = v; }));
    trackSlider('carPhys', 'snapRecoveryDuration', addSlider('snapRecovDur', cp.snapRecoveryDuration, 0, 1, 0.01, (v) => { cp.snapRecoveryDuration = v; }));
    trackSlider('carPhys', 'snapRecoveryBoostDuration', addSlider('snapBoostDur', cp.snapRecoveryBoostDuration, 0, 1, 0.01, (v) => { cp.snapRecoveryBoostDuration = v; }));
    trackSlider('carPhys', 'snapRecoverySpeedFloor', addSlider('snapSpdFloor', cp.snapRecoverySpeedFloor, 10, 60, 1, (v) => { cp.snapRecoverySpeedFloor = v; }));
    trackSlider('carPhys', 'snapRecoveryBoostFloor', addSlider('snapBoostFloor', cp.snapRecoveryBoostFloor, 20, 90, 1, (v) => { cp.snapRecoveryBoostFloor = v; }));
    trackSlider('carPhys', 'snapRecoveryTargetSpeed', addSlider('snapTargetSpd', cp.snapRecoveryTargetSpeed, 20, 100, 1, (v) => { cp.snapRecoveryTargetSpeed = v; }));
    trackSlider('carPhys', 'snapRecoveryBoostTarget', addSlider('snapBoostTgt', cp.snapRecoveryBoostTarget, 40, 120, 1, (v) => { cp.snapRecoveryBoostTarget = v; }));
    trackSlider('carPhys', 'snapRecoveryAccelLerp', addSlider('snapAccelLerp', cp.snapRecoveryAccelLerp, 1, 30, 0.5, (v) => { cp.snapRecoveryAccelLerp = v; }));
    addSubHeader('SPEED AUTHORITY');
    trackSlider('carPhys', 'driftMinSpeed', addSlider('driftMinSpd', cp.driftMinSpeed, 0, 50, 1, (v) => { cp.driftMinSpeed = v; }));
    trackSlider('carPhys', 'driftSpeedRetention', addSlider('spdRetention', cp.driftSpeedRetention, 0.5, 1, 0.01, (v) => { cp.driftSpeedRetention = v; }));
    trackSlider('carPhys', 'driftStraightenSpeedGain', addSlider('straightGain', cp.driftStraightenSpeedGain, 0, 15, 0.5, (v) => { cp.driftStraightenSpeedGain = v; }));
    addSubHeader('SLIP LIMITS');
    trackSlider('carPhys', 'driftMaxSlipLow', addSlider('maxSlipLow', cp.driftMaxSlipLow, 0, 0.5, 0.01, (v) => { cp.driftMaxSlipLow = v; }));
    trackSlider('carPhys', 'driftMaxSlipHigh', addSlider('maxSlipHigh', cp.driftMaxSlipHigh, 0.1, 1.5, 0.01, (v) => { cp.driftMaxSlipHigh = v; }));
    trackSlider('carPhys', 'driftGripLow', addSlider('gripLow', cp.driftGripLow, 1, 30, 0.5, (v) => { cp.driftGripLow = v; }));
    trackSlider('carPhys', 'driftGripHigh', addSlider('gripHigh', cp.driftGripHigh, 1, 15, 0.5, (v) => { cp.driftGripHigh = v; }));
    addSubHeader('EXIT / ALIGN');
    trackSlider('carPhys', 'driftAlignThreshold', addSlider('alignThresh', cp.driftAlignThreshold, 0, 0.5, 0.01, (v) => { cp.driftAlignThreshold = v; }));
    trackSlider('carPhys', 'driftAlignGrace', addSlider('alignGrace', cp.driftAlignGrace, 0, 2, 0.05, (v) => { cp.driftAlignGrace = v; }));
    trackSlider('carPhys', 'driftExitSlipThreshold', addSlider('exitSlipThr', cp.driftExitSlipThreshold, 0, 0.3, 0.01, (v) => { cp.driftExitSlipThreshold = v; }));
    trackSlider('carPhys', 'driftExitSpeedThreshold', addSlider('exitSpdThr', cp.driftExitSpeedThreshold, 0, 1, 0.01, (v) => { cp.driftExitSpeedThreshold = v; }));
  }

  // ── Vehicle Physics — HOVERBOARD ────────────────────────
  addHeader('HOVERBOARD PHYSICS', 'hoverPhys');
  {
    const hp = HOVERBOARD_PHYSICS;
    trackSlider('hoverPhys', 'baseSpeed', addSlider('baseSpeed', hp.baseSpeed, 10, 80, 1, (v) => { hp.baseSpeed = v; }));
    trackSlider('hoverPhys', 'boostSpeed', addSlider('boostSpeed', hp.boostSpeed, 20, 120, 1, (v) => { hp.boostSpeed = v; }));
    trackSlider('hoverPhys', 'dashSpeed', addSlider('dashSpeed', hp.dashSpeed, 40, 160, 1, (v) => { hp.dashSpeed = v; }));
    trackSlider('hoverPhys', 'turnSpeed', addSlider('turnSpeed', hp.turnSpeed, 0.5, 5, 0.05, (v) => { hp.turnSpeed = v; }));
    trackSlider('hoverPhys', 'boostDrain', addSlider('boostDrain', hp.boostDrain, 0, 40, 1, (v) => { hp.boostDrain = v; }));
    trackSlider('hoverPhys', 'dashDrain', addSlider('dashDrain', hp.dashDrain, 0, 120, 1, (v) => { hp.dashDrain = v; }));
    trackSlider('hoverPhys', 'passiveRegen', addSlider('passiveRegen', hp.passiveRegen, 0, 20, 0.2, (v) => { hp.passiveRegen = v; }));
    trackSlider('hoverPhys', 'minLean', addSlider('minLean', hp.minLean, 0, 1, 0.01, (v) => { hp.minLean = v; }));
    trackSlider('hoverPhys', 'maxLean', addSlider('maxLean', hp.maxLean, 0, 1, 0.01, (v) => { hp.maxLean = v; }));
    trackSlider('hoverPhys', 'accelLerp', addSlider('accelLerp', hp.accelLerp, 1, 999, 1, (v) => { hp.accelLerp = v; }));
    addSubHeader('TURN FEEL');
    trackSlider('hoverPhys', 'turnLerp', addSlider('turnLerp', hp.turnLerp, 1, 30, 0.5, (v) => { hp.turnLerp = v; }));
    trackSlider('hoverPhys', 'turnDecay', addSlider('turnDecay', hp.turnDecay, 1, 40, 0.5, (v) => { hp.turnDecay = v; }));
    trackSlider('hoverPhys', 'turnSpeedBleed', addSlider('turnSpdBleed', hp.turnSpeedBleed, 0.9, 1, 0.005, (v) => { hp.turnSpeedBleed = v; }));
  }
}

export function addGameplaySection(gameRef: GameLike | null): void {
  // ── AI Personality ─────────────────────────────────────
  addHeader('AI PERSONALITY', 'ai');
  {
    const aiEntries = gameRef?.ais?.filter(a => a.aiState?.personality) ?? [];
    if (!aiEntries.length) {
      addLabel('(no AI with personality — start a game)');
    } else {
      addLabel(`${aiEntries.length} AI active — sliders apply to all`);
      const first = aiEntries[0].aiState!.personality!;
      const setAll = (key: string, v: number): void => {
        for (const ai of aiEntries) {
          if (ai.aiState?.personality) ai.aiState.personality[key] = v;
        }
      };
      trackSlider('ai', 'aggression', addSlider('aggression', first.aggression, 0, 1, 0.05, (v) => setAll('aggression', v)));
      trackSlider('ai', 'wallFear', addSlider('wallFear', first.wallFear, 0, 1, 0.05, (v) => setAll('wallFear', v)));
      trackSlider('ai', 'dashAggression', addSlider('dashAggr', first.dashAggression, 0, 1, 0.05, (v) => setAll('dashAggression', v)));
      trackSlider('ai', 'turniness', addSlider('turniness', first.turniness, 0, 1, 0.05, (v) => setAll('turniness', v)));
      trackSlider('ai', 'cutoffSkill', addSlider('cutoffSkill', first.cutoffSkill, 0, 1, 0.05, (v) => setAll('cutoffSkill', v)));
      trackSlider('ai', 'escapeSkill', addSlider('escapeSkill', first.escapeSkill, 0, 1, 0.05, (v) => setAll('escapeSkill', v)));
      trackSlider('ai', 'straightBias', addSlider('straightBias', first.straightBias, 0, 0.3, 0.01, (v) => setAll('straightBias', v)));
      trackSlider('ai', 'jitter', addSlider('jitter', first.jitterAmount, 0, 0.2, 0.01, (v) => setAll('jitterAmount', v)));
    }
    addSubHeader('MANEUVER TIMING');
    trackSlider('ai', 'maneuverMinCd', addSlider('minCooldown', aiTuning.maneuverMinCd, 0.5, 10, 0.5, (v) => { aiTuning.maneuverMinCd = v; }));
    trackSlider('ai', 'maneuverMaxCd', addSlider('maxCooldown', aiTuning.maneuverMaxCd, 1, 20, 0.5, (v) => { aiTuning.maneuverMaxCd = v; }));
  }

  // ── Collision ──────────────────────────────────────────
  addHeader('COLLISION', 'collision');
  {
    const ct = getCollisionTuning();
    trackSlider('collision', 'hitRadius', addSlider('hitRadius', ct.hitRadius, 0.2, 3, 0.05, (v) => { ct.hitRadius = v; }));
    trackSlider('collision', 'skipOwnSegs', addSlider('skipOwnSegs', ct.skipOwnSegments, 0, 30, 1, (v) => { ct.skipOwnSegments = v; }));
    trackSlider('collision', 'repulseRange', addSlider('repulseRange', ct.repulseRange, 1, 15, 0.5, (v) => { ct.repulseRange = v; }));
    trackSlider('collision', 'repulseStr', addSlider('repulseStr', ct.repulseStrength, 0, 5, 0.1, (v) => { ct.repulseStrength = v; }));
    trackSlider('collision', 'headOnDist', addSlider('headOnDist', ct.headOnDistance, 0.5, 5, 0.1, (v) => { ct.headOnDistance = v; }));
    trackSlider('collision', 'proximityRange', addSlider('proxRange', ct.proximityRange, 2, 25, 0.5, (v) => { ct.proximityRange = v; }));
  }

  // ── Player Assist ─────────────────────────────────────
  addHeader('PLAYER ASSIST', 'assist');
  trackSlider('assist', 'range', addSlider('range', assistTuning.range, 0, 20, 0.5, (v) => { assistTuning.range = v; }));
  trackSlider('assist', 'strength', addSlider('strength', assistTuning.strength, 0, 1, 0.05, (v) => { assistTuning.strength = v; }));
  trackSlider('assist', 'angleMax', addSlider('angleMax', assistTuning.angleMax, 0, 1.5, 0.05, (v) => { assistTuning.angleMax = v; }));
}
