// ── Vehicle Physics Configuration ────────────────────────
// All per-vehicle constants live here for easy tuning.

import type { VehicleType } from './types/index';

export interface VehiclePhysics {
  baseSpeed: number;
  boostSpeed: number;
  dashSpeed: number;
  brakeSpeed: number;
  turnSpeed: number;           // radians/sec
  minLean: number;             // radians — lean at base speed
  maxLean: number;             // radians — lean at boost speed
  leanLerp: number;
  trailRear: number;           // trail spawn offset behind center
  // Drift (car-specific, inert for bike)
  canDrift: boolean;
  driftTurnMultiplier: number; // turn rate multiplier while drifting
  driftFriction: number;       // how fast velocity angle follows facing angle
  driftSlipDecay: number;      // how fast slip angle decays when NOT drifting
  driftMinSpeed: number;       // minimum speed to initiate drift
  driftSpeedRetention: number; // fraction of speed retained per second during drift
  driftMeterRegen: number;     // meter gained per second while drifting
  driftSpeed: number;          // target speed during drift (between boostSpeed and dashSpeed)
  driftBoostSpeed: number;     // target speed when boosting (W) during drift
  driftIntentStartSpeed: number; // speed where intent-first drift scaling begins
  driftIntentFullSpeed: number;  // speed where drift reaches full momentum behavior
  driftMaxSlipLow: number;     // max slip angle at low speed
  driftMaxSlipHigh: number;    // max slip angle at high speed
  driftGripLow: number;        // low-speed hookup / intent authority
  driftGripHigh: number;       // high-speed hookup / intent authority
  driftSlipResponseLow: number; // low-speed slip follow rate
  driftSlipResponseHigh: number; // high-speed slip follow rate
  driftThrottleHookLow: number; // throttle hookup assist at low speed
  driftThrottleHookHigh: number; // throttle hookup assist at high speed
  driftCountersteerAssistLow: number; // countersteer recovery at low speed
  driftCountersteerAssistHigh: number; // countersteer recovery at high speed
  driftReleaseAssistLow: number; // release recovery at low speed
  driftReleaseAssistHigh: number; // release recovery at high speed
  driftExitSlipThreshold: number; // slip threshold below which drift can end immediately
  driftExitSpeedThreshold: number; // speed01 cutoff for extra-crisp low-speed exits
  driftSpeedCarryLow: number;   // retained speed influence at low speed while drifting
  driftSpeedCarryHigh: number;  // retained speed influence at high speed while drifting
  driftSlipSpeedScrubLow: number; // low-speed slip scrub per second
  driftSlipSpeedScrubHigh: number; // high-speed slip scrub per second
  driftThrottleSpeedAuthorityLow: number; // low-speed throttle authority over drift target speed
  driftThrottleSpeedAuthorityHigh: number; // high-speed throttle authority over drift target speed
  driftCoastSpeedAuthorityLow: number; // low-speed coast authority over drift target speed
  driftCoastSpeedAuthorityHigh: number; // high-speed coast authority over drift target speed
  driftStraightenSpeedGain: number; // extra speed recovery when hooked up and pointed forward
  driftDashSlipPenaltyLow: number; // low-speed dash target penalty while highly sideways
  driftDashSlipPenaltyHigh: number; // high-speed dash target penalty while highly sideways
  driftEntryDuration: number;    // seconds to ramp from drift entry into full steady-state drift
  driftEntrySlipScale: number;   // entry-time cap on max slip
  driftEntryFollowScale: number; // entry-time scale on drift follow / correction
  driftEntryYawScale: number;    // entry-time scale on drift yaw authority
  driftHighSpeedWheelCorrectScale: number; // top-speed scale on wheel-direction correction
  driftHighSpeedBoostCorrectScale: number; // top-speed scale on boost hookup correction
  driftHighSpeedCountersteerScale: number; // top-speed scale on countersteer recovery
  driftHighSpeedReleaseScale: number; // top-speed scale on release recovery
  driftAlignThreshold: number; // slip angle (rad) below which drift begins exit countdown
  driftAlignGrace: number;     // seconds slip must stay aligned before drift ends (brake released)
  driftBoostStraighten: number;// multiplier for slip decay when boosting during drift
  driftSlipCeilingExponent: number;             // Controls ceiling curve steepness (3 = cubic)
  driftSlipCeilingThrottleTighten: number;      // 0-1, how much throttle tightens ceiling at low speed
  driftSlipCeilingCountersteerTighten: number;  // 0-1, how much countersteer tightens ceiling at low speed
  driftBoostDrain: number;     // meter drained per second when W-boosting during drift (must exceed driftMeterRegen)
  boostDrain: number;           // meter drained per second when W-boosting (0 = free boost)
  dashDrain: number;           // meter drained per second when dashing (Shift) — overrides shared METER_DRAIN
  boostLockThreshold: number;  // meter % (0-1) required to unlock boost after depletion
  passiveRegen: number;        // meter gained per second when idle (no dash/boost/drift)
  lowMeterThreshold: number;   // meter % (0-1) below which lowMeterRegen kicks in (0 = disabled)
  lowMeterRegen: number;       // meter gained per second when below lowMeterThreshold
  // Snap exit (releasing drift at large slip angle — instant redirect with speed penalty)
  snapExitSlipThreshold: number;    // min abs(slipAngle) to trigger snap exit instead of normal alignment exit
  snapRecoveryDuration: number;     // seconds of recovery phase (no boost)
  snapRecoveryBoostDuration: number;// seconds of recovery when W held (lurch — much faster)
  snapRecoverySpeedFloor: number;   // lowest speed target during decel phase (absolute)
  snapRecoveryBoostFloor: number;   // lowest speed target when lurching (higher = less penalty)
  snapRecoveryTargetSpeed: number;  // speed to rebuild toward during recovery
  snapRecoveryBoostTarget: number;  // speed target when lurching
  snapRecoveryAccelLerp: number;    // re-acceleration rate during recovery
  // Weight feel
  accelLerp: number;           // speed blend rate toward target (higher = snappier)
  decelLerp: number;           // braking blend rate
  // Fumes — grace buffer when meter depletes
  fumesDuration: number;       // seconds of grace boost after meter hits 0
  fumesSpeedScale: number;     // speed multiplier during fumes (0-1)
  // Slipstream
  proximitySpeedMultiplier: number; // max speed bonus from proximity (e.g. 0.15 = 15%)
  // Turn feel
  turnLerp: number;            // turnRamp blend rate (higher = snappier turn entry)
  turnDecay: number;           // turnRamp decay rate (higher = snappier turn exit)
  turnSpeedBleed: number;      // per-tick speed multiplier at max turn (1.0 = no bleed, 0.97 = 3% bleed)
  canGrind: boolean;           // hoverboard-only: can initiate trail grinds via special input
}

export const BIKE_PHYSICS: VehiclePhysics = {
  baseSpeed: 45,               // was 40 — faster coast for bigger map
  boostSpeed: 65,              // was 55 — W-boost feels like real acceleration
  dashSpeed: 100,              // was 98.5 — tiny bump
  brakeSpeed: 28,
  turnSpeed: 2.94,
  minLean: 0.21,
  maxLean: 0.64,
  leanLerp: 3.5,
  trailRear: 2.5,
  canDrift: false,
  driftTurnMultiplier: 1,
  driftFriction: 999,
  driftSlipDecay: 999,
  driftMinSpeed: 0,
  driftSpeedRetention: 1,
  driftMeterRegen: 0,
  driftSpeed: 0,
  driftBoostSpeed: 0,
  driftIntentStartSpeed: 0,
  driftIntentFullSpeed: 1,
  driftMaxSlipLow: 0,
  driftMaxSlipHigh: 0,
  driftGripLow: 0,
  driftGripHigh: 0,
  driftSlipResponseLow: 0,
  driftSlipResponseHigh: 0,
  driftThrottleHookLow: 0,
  driftThrottleHookHigh: 0,
  driftCountersteerAssistLow: 0,
  driftCountersteerAssistHigh: 0,
  driftReleaseAssistLow: 0,
  driftReleaseAssistHigh: 0,
  driftExitSlipThreshold: 0,
  driftExitSpeedThreshold: 0,
  driftSpeedCarryLow: 0,
  driftSpeedCarryHigh: 0,
  driftSlipSpeedScrubLow: 0,
  driftSlipSpeedScrubHigh: 0,
  driftThrottleSpeedAuthorityLow: 0,
  driftThrottleSpeedAuthorityHigh: 0,
  driftCoastSpeedAuthorityLow: 0,
  driftCoastSpeedAuthorityHigh: 0,
  driftStraightenSpeedGain: 0,
  driftDashSlipPenaltyLow: 0,
  driftDashSlipPenaltyHigh: 0,
  driftEntryDuration: 0,
  driftEntrySlipScale: 1,
  driftEntryFollowScale: 1,
  driftEntryYawScale: 1,
  driftHighSpeedWheelCorrectScale: 1,
  driftHighSpeedBoostCorrectScale: 1,
  driftHighSpeedCountersteerScale: 1,
  driftHighSpeedReleaseScale: 1,
  driftAlignThreshold: 0,
  driftAlignGrace: 0,
  driftBoostStraighten: 1,
  driftSlipCeilingExponent: 0,
  driftSlipCeilingThrottleTighten: 0,
  driftSlipCeilingCountersteerTighten: 0,
  driftBoostDrain: 0,
  boostDrain: 0,             // W-boost is free (meter economy is proximity-based)
  dashDrain: 35,               // was 60 — ~2.9s full dash (was 1.7s)
  boostLockThreshold: 0.10,    // was 0.2 — faster re-engage (fumes handles the warning)
  passiveRegen: 20,            // was 17.6 — ~5s full regen
  lowMeterThreshold: 0.2,    // below 20% meter triggers emergency regen
  lowMeterRegen: 5,          // 5 meter/sec (~5% of max) when critically low
  snapExitSlipThreshold: 0,
  snapRecoveryDuration: 0,
  snapRecoveryBoostDuration: 0,
  snapRecoverySpeedFloor: 1,
  snapRecoveryBoostFloor: 1,
  snapRecoveryTargetSpeed: 0,
  snapRecoveryBoostTarget: 0,
  snapRecoveryAccelLerp: 0,
  accelLerp: 999,   // instant (matches current behavior)
  decelLerp: 999,
  fumesDuration: 0.75,
  fumesSpeedScale: 0.70,
  proximitySpeedMultiplier: 0.15,  // was hardcoded 0.10
  turnLerp: 14,
  turnDecay: 28.8,
  turnSpeedBleed: 1.0,         // no speed bleed — bike is precise
  canGrind: false,
};

// Slingshot (DeLorean) — RL-style drift car
// Doc stats: Top Speed 8, Accel 7, Boost Speed 10, Boost Regen 5, Handling 2, Braking 4
// Worst raw handling but drift compensates. Highest boost speed in the game.
// Speed maintained through drifts. Drifting builds meter.
export const CAR_PHYSICS: VehiclePhysics = {
  baseSpeed: 48,               // was 44.4 — faster coast
  boostSpeed: 62,              // was 50 — W-boost actually means something
  dashSpeed: 107,              // was 105 — keeps fastest-in-game crown
  brakeSpeed: 20,          // Braking 4/10 (bike=28 at 2/10 inverted — higher = slower brake)
  turnSpeed: 1.8,          // Handling 2/10 — wide raw turns, slightly more responsive (bike=2.94 at 8/10)
  minLean: 0,
  maxLean: 0,              // no body roll on car
  leanLerp: 5.0,
  trailRear: 6.0,           // cyberpunk delorean rear offset
  canDrift: true,
  driftTurnMultiplier: 1.4, // was 2.1 — reduced to prevent orbit (216°/s → 139°/s steady-state yaw)
  driftFriction: 1.444,     // 10% looser velocity tracking — more slide
  driftSlipDecay: 2.527,    // 10% slower snap-back — holds the slide longer
  driftMinSpeed: 20,        // can drift at lower speeds
  driftSpeedRetention: 0.92, // speed bleeds ~8%/sec during unboosted drift — punishes coasting
  driftMeterRegen: 38,         // was 34 — faster regen while drifting
  driftSpeed: 75,              // was 70 — base drift cruises faster
  driftBoostSpeed: 92,         // was 90 — maintains gap above new boostSpeed
  driftIntentStartSpeed: 18,
  driftIntentFullSpeed: 75,
  driftMaxSlipLow: 0.10,
  driftMaxSlipHigh: 0.70,
  driftGripLow: 20.0,
  driftGripHigh: 4.5,
  driftSlipResponseLow: 24.0,
  driftSlipResponseHigh: 7.0,
  driftThrottleHookLow: 16.0,
  driftThrottleHookHigh: 3.0,
  driftCountersteerAssistLow: 18.0,
  driftCountersteerAssistHigh: 4.0,
  driftReleaseAssistLow: 16.0,
  driftReleaseAssistHigh: 3.0,
  driftExitSlipThreshold: 0.08,
  driftExitSpeedThreshold: 0.35,
  driftSpeedCarryLow: 0.82,
  driftSpeedCarryHigh: 0.96,
  driftSlipSpeedScrubLow: 8.0,
  driftSlipSpeedScrubHigh: 2.0,
  driftThrottleSpeedAuthorityLow: 0.18,
  driftThrottleSpeedAuthorityHigh: 0.72,
  driftCoastSpeedAuthorityLow: 0.08,
  driftCoastSpeedAuthorityHigh: 0.42,
  driftStraightenSpeedGain: 6.0,
  driftDashSlipPenaltyLow: 0.30,
  driftDashSlipPenaltyHigh: 0.08,
  driftEntryDuration: 0.20,
  driftEntrySlipScale: 0.45,
  driftEntryFollowScale: 0.55,
  driftEntryYawScale: 0.72,
  driftHighSpeedWheelCorrectScale: 0.42,
  driftHighSpeedBoostCorrectScale: 0.30,
  driftHighSpeedCountersteerScale: 0.55,
  driftHighSpeedReleaseScale: 0.65,
  driftAlignThreshold: 0.15,  // ~8.5° — slip angle below which alignment timer starts (wider tolerance with higher friction)
  driftAlignGrace: 0.7,      // seconds of alignment before drift auto-exits (brake released)
  driftBoostStraighten: 4.5, // W during drift decays slip angle faster → "boost out" (compensates higher base friction)
  driftSlipCeilingExponent: 3.0,
  driftSlipCeilingThrottleTighten: 0.40,
  driftSlipCeilingCountersteerTighten: 0.35,
  driftBoostDrain: 25,       // legacy — no longer drains meter (W+drift regens now)
  boostDrain: 0,             // car W-boost is free (meter economy is drift-based)
  dashDrain: 30,               // was 54 — ~3.3s full dash
  boostLockThreshold: 0.10,    // was 0.2 — faster re-engage
  passiveRegen: 18,            // was 15.6 — ~5.6s full regen
  lowMeterThreshold: 0,      // disabled for car (drift-based economy)
  lowMeterRegen: 0,
  snapExitSlipThreshold: 0.35,    // ~20° — snap exit instead of waiting for alignment
  snapRecoveryDuration: 0.30,     // 300ms recovery without boost
  snapRecoveryBoostDuration: 0.12,// 120ms with W held — the lurch
  snapRecoverySpeedFloor: 30,     // decel nadir — drops toward 30 then rebuilds
  snapRecoveryBoostFloor: 58,     // lurch nadir — shallower dip when W held
  snapRecoveryTargetSpeed: 50,    // rebuild toward boostSpeed
  snapRecoveryBoostTarget: 90,    // rebuild toward driftBoostSpeed when lurching
  snapRecoveryAccelLerp: 10,      // fast re-acceleration during recovery
  accelLerp: 6,             // Accel 7/10 — weighted, takes time to reach speed
  decelLerp: 5,
  fumesDuration: 0.75,
  fumesSpeedScale: 0.70,
  proximitySpeedMultiplier: 0.15,
  turnLerp: 14,
  turnDecay: 28.8,
  turnSpeedBleed: 1.0,         // no speed bleed — car uses drift system
  canGrind: false,
};

// Hoverboard — surfy carving feel, no drift, speed bleed on hard turns
export const HOVERBOARD_PHYSICS: VehiclePhysics = {
  baseSpeed: 45,
  boostSpeed: 65,
  dashSpeed: 100,
  brakeSpeed: 28,
  turnSpeed: 2.94,
  minLean: 0.21,
  maxLean: 0.64,
  leanLerp: 3.5,
  trailRear: 2.2,
  canDrift: false,
  driftTurnMultiplier: 1,
  driftFriction: 999,
  driftSlipDecay: 999,
  driftMinSpeed: 0,
  driftSpeedRetention: 1,
  driftMeterRegen: 0,
  driftSpeed: 0,
  driftBoostSpeed: 0,
  driftIntentStartSpeed: 0,
  driftIntentFullSpeed: 1,
  driftMaxSlipLow: 0,
  driftMaxSlipHigh: 0,
  driftGripLow: 0,
  driftGripHigh: 0,
  driftSlipResponseLow: 0,
  driftSlipResponseHigh: 0,
  driftThrottleHookLow: 0,
  driftThrottleHookHigh: 0,
  driftCountersteerAssistLow: 0,
  driftCountersteerAssistHigh: 0,
  driftReleaseAssistLow: 0,
  driftReleaseAssistHigh: 0,
  driftExitSlipThreshold: 0,
  driftExitSpeedThreshold: 0,
  driftSpeedCarryLow: 0,
  driftSpeedCarryHigh: 0,
  driftSlipSpeedScrubLow: 0,
  driftSlipSpeedScrubHigh: 0,
  driftThrottleSpeedAuthorityLow: 0,
  driftThrottleSpeedAuthorityHigh: 0,
  driftCoastSpeedAuthorityLow: 0,
  driftCoastSpeedAuthorityHigh: 0,
  driftStraightenSpeedGain: 0,
  driftDashSlipPenaltyLow: 0,
  driftDashSlipPenaltyHigh: 0,
  driftEntryDuration: 0,
  driftEntrySlipScale: 1,
  driftEntryFollowScale: 1,
  driftEntryYawScale: 1,
  driftHighSpeedWheelCorrectScale: 1,
  driftHighSpeedBoostCorrectScale: 1,
  driftHighSpeedCountersteerScale: 1,
  driftHighSpeedReleaseScale: 1,
  driftAlignThreshold: 0,
  driftAlignGrace: 0,
  driftBoostStraighten: 1,
  driftSlipCeilingExponent: 0,
  driftSlipCeilingThrottleTighten: 0,
  driftSlipCeilingCountersteerTighten: 0,
  driftBoostDrain: 0,
  boostDrain: 0,
  dashDrain: 35,
  boostLockThreshold: 0.10,
  passiveRegen: 20,
  lowMeterThreshold: 0.2,
  lowMeterRegen: 5,
  snapExitSlipThreshold: 0,
  snapRecoveryDuration: 0,
  snapRecoveryBoostDuration: 0,
  snapRecoverySpeedFloor: 1,
  snapRecoveryBoostFloor: 1,
  snapRecoveryTargetSpeed: 0,
  snapRecoveryBoostTarget: 0,
  snapRecoveryAccelLerp: 0,
  accelLerp: 999,
  decelLerp: 999,
  fumesDuration: 0.75,
  fumesSpeedScale: 0.70,
  proximitySpeedMultiplier: 0.15,
  turnLerp: 8,                 // slower ramp-up — surfy arcing into turns
  turnDecay: 12,               // slower decay — momentum carries through turn exit
  turnSpeedBleed: 0.97,        // 3% speed bleed per tick at max turn — rewards smooth carves
  canGrind: true,
};

export const LOADOUT_DISPLAY_NAMES: Record<VehicleType, string> = {
  bike: 'SPECTRE',
  car: 'SLINGSHOT',
  hoverboard: 'VECTOR',
};

export function getVehiclePhysics(type: VehicleType): VehiclePhysics {
  if (type === 'car') return CAR_PHYSICS;
  if (type === 'hoverboard') return HOVERBOARD_PHYSICS;
  return BIKE_PHYSICS;
}
