// ── Deterministic Simulation Layer ───────────────────────
// Fixed-timestep simulation for lockstep netcode.
// Both clients run this with identical inputs to produce identical state.
// No Three.js dependencies — pure math only.

import type { VehicleType } from '../types/index';
import type { VehiclePhysics } from '../vehicleConfig';
import { advanceDrift } from './simDrift';
import { advanceGrind } from './simGrind';

// ── Constants ───────────────────────────────────────────
export const SIM_TICK_RATE = 60;
export const SIM_DT = 1 / SIM_TICK_RATE; // ~16.67ms
export const TRAIL_TICK_INTERVAL = 2;     // add trail point every 2 ticks (30Hz)
export const ARENA_HALF = 192;            // ARENA_SIZE / 2 = 384 / 2
export const MAX_TRAIL_POINTS = 2500;     // ~83s of trail at 30Hz — prevents O(n) blowup

// Meter constants (match player.ts)
const METER_MAX = 100;

// ── Grind constants ─────────────────────────────────────
// TASK-265: range bumped 1.5× to widen the engagement window — players were
// missing grinds by grazing trails a hair outside the old 6-unit snap.
export const GRIND_SNAP_RANGE = 9.0;
export const GRIND_HOP_RANGE = 6.0;
export const GRIND_ENTRY_COST = 50;
export const GRIND_SPEED_BONUS = 12;
export const GRIND_DASH_SPEED_BONUS = 25;
export const GRIND_SWEET_SPOT = 0.30;
export const GRIND_DANGER_ZONE = 0.75;
/** Grace window (seconds) after grind starts — destabilization physics held off so the player can read the HUD before correcting. */
// TASK-265: longer grace so the entry feels less snappy and players can settle in
export const GRIND_GRACE_DURATION = 0.55;
export const GRIND_METER_REGEN_PERFECT = 25;
export const GRIND_METER_REGEN_BASE = 12;
// ── THPS2-style balance physics ─────────────────────────
export const GRIND_LEAN_GRAVITY = 1.8;         // self-reinforcing: lean * gravity * instability * dt
export const GRIND_INSTABILITY_BASE = 0.6;     // starting instability multiplier
export const GRIND_INSTABILITY_RATE = 0.12;    // instability increase per second
export const GRIND_INSTABILITY_CAP = 2.0;      // prevents instant death on long grinds
export const GRIND_LEAN_RND_RANGE = 0.5;       // random perturbation magnitude on lean velocity
export const GRIND_LEAN_RND_KICK = 0.35;       // velocity assigned when lean velocity too small
export const GRIND_LEAN_ACC = 3.5;             // player correction per unit input per second
export const GRIND_DASH_INSTABILITY_MULT = 1.4; // dashing makes balance harder
export const GRIND_DISRUPT_RANGE = 8.0;
// TASK-267: when a player is grinding an enemy trail, the trail owner is
// slowed — a feedback mechanic that makes laying trail risky under pressure.
// Speed multiplier applied to the target while the timer is active.
export const GRIND_SLOW_MULT = 0.78;
// Timer renewed every tick the grinder is active; decays after grind ends so
// the slow fades out instead of cutting abruptly.
export const GRIND_SLOW_DURATION = 0.18;
export const GRIND_BAIL_SPEED_MULT = 0.5;
export const GRIND_BAIL_METER_PENALTY = 15;
export const GRIND_BAIL_LATERAL_SPEED = 8.0;   // sideways push on bail
export const GRIND_COOLDOWN = 3.0;
// TASK-265: longer airborne + recovery so the exit/bail reads more clearly
export const GRIND_AIRBORNE_CLEAN = 0.5;
export const GRIND_AIRBORNE_BAIL = 0.65;
export const GRIND_JUMP_HEIGHT_CLEAN = 0.8;
export const GRIND_JUMP_HEIGHT_BAIL = 1.2;
export const GRIND_RECOVERY_CLEAN = 1.0;
export const GRIND_RECOVERY_BAIL = 1.5;
export const GRIND_DANGER_CORRECT_PENALTY = 0.8;
export const GRIND_HOP_BALANCE_PERTURB = 0.2;
export const GRIND_ALIGN_BLEND = 0.15;
export const GRIND_SWEET_SPEED_BONUS = 5;

// ── Score × multiplier (SPEC-82) ─────────────────────────────────────────────
// TASK-265: base reduced 30% — score was accruing faster than meter conversion
// kept satisfying; slowing the raw gain lets milestones and multiplier growth
// carry more of the reward weight.
export const GRIND_SCORE_BASE_PER_SEGMENT = 70;
export const GRIND_SCORE_SWEET_MULT = 2.0;
export const GRIND_SCORE_DASH_MULT = 1.5;
export const GRIND_SCORE_TRICK_MULT_ADD = 0.5;
export const GRIND_SCORE_MILESTONE_MULT_ADD = 0.5;
export const GRIND_SCORE_MULT_CAP = 10.0;
export const GRIND_SCORE_METER_DIVISOR = 20;
export const GRIND_CHAIN_MAX_LENGTH = 16;

// ── Vehicle-specific grind trail modifiers ─────────────
export interface GrindTrailMod {
  speedMult: number;
  instabilityMult: number;
  regenMult: number;
}

export const GRIND_TRAIL_MODS: Record<VehicleType, GrindTrailMod> = {
  car:        { speedMult: 1.25, instabilityMult: 1.4, regenMult: 0.9 },  // fast + hard
  bike:       { speedMult: 0.85, instabilityMult: 0.7, regenMult: 1.15 }, // slow + easy
  hoverboard: { speedMult: 1.0,  instabilityMult: 1.0, regenMult: 1.0 }, // neutral
};

// ── Grind streak milestone bonuses ─────────────────────
/** [streakCount, meterBonus] pairs — checked on each segment advance. */
export const STREAK_MILESTONES: readonly [number, number][] = [
  [10, 5],   // 10 segments = +5 meter
  [25, 10],  // 25 segments = +10 meter
  [50, 15],  // 50 segments = +15 meter
  [100, 25], // 100 segments = +25 meter
];

// ── Deterministic PRNG for grind balance drift ──────────
/** mulberry32 — fast 32-bit PRNG. Returns next state and a float in [0, 1). */
export function mulberry32(state: number): { next: number; value: number } {
  let t = (state + 0x6D2B79F5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const raw = ((t ^ (t >>> 14)) >>> 0);
  return { next: raw, value: raw / 4294967296 };
}

/** Seed a grind RNG from tick and player index — deterministic across clients. */
function seedGrindRng(tick: number, playerIndex: number): number {
  return ((tick * 2654435761) ^ (playerIndex * 340573321)) >>> 0;
}

// ── Types ───────────────────────────────────────────────

export interface InputFrame {
  tick: number;
  /** Turn direction. Humans use -1/0/1; AI uses float in [-1, 1] for smooth steering. */
  turnDir: number;
  accelerate: boolean;
  dash: boolean;
  brake: boolean;
  /** Space / primary brake — initiates and sustains drift. S / secondary brake does not. */
  driftBrake?: boolean;
  /** Space held — context-sensitive per vehicle (grind for hoverboard, brake for others). */
  special?: boolean;
}

export interface PlayerSim {
  x: number;
  z: number;
  angle: number;
  speed: number;
  meter: number;
  alive: boolean;
  boosting: boolean;
  dashing: boolean;
  vehicleType: VehicleType;
  brakeBlend: number;
  trailTimer: number;       // ticks since last trail point
  proximityBoost: number;   // 0-1, set externally before step
  courseAssist: number;      // set externally before step
  // Drift state (car-specific, inert for bike)
  drifting: boolean;
  slipAngle: number;        // angle between facing and velocity direction
  velocityAngle: number;    // direction the car is actually moving
  driftTimer: number;
  driftEntryTimer: number;
  driftBrakeHeld: boolean;
  driftBrakeReleased: boolean; // true once brake released during drift (enables drift-brake on re-press)
  driftAlignTimer: number;  // time slip has been below align threshold
  // Snap exit recovery (releasing drift at large slip angle)
  snapRecovery: boolean;
  snapRecoveryTimer: number;
  snapRecoveryBoosted: boolean; // true if W was held when snap exit triggered (lurch mode)
  snapRecoveryFromAngle: number; // velocity angle at moment of snap exit (for curved path)
  turnRamp: number;  // smoothed turn intensity for bikes (0 = neutral, -1/+1 = full turn)
  boostLocked: boolean; // true when meter depleted during boost — unlocks at threshold
  fumes: boolean;           // in fumes grace phase (meter depleted, still boosting at reduced speed)
  fumesTimer: number;       // countdown — when 0, fumes end and boost locks
  sputterSFX: boolean;      // one-frame flag — true when fumes just ended (triggers sputter sound)
  // ── Grind state (hoverboard special) ──────────────────
  grinding: boolean;
  grindTrailOwner: number;     // player index whose trail we're grinding (-1 = none)
  grindSegIdx: number;         // current segment index on that trail
  grindSegT: number;           // 0..1 interpolation along current segment
  grindBalance: number;        // -1.0 to +1.0 (edges = bail)
  grindLeanDir: number;        // lean velocity (THPS2-style continuous drift)
  grindRngState: number;       // seeded PRNG state (for rollback)
  grindSpeed: number;          // locked entry speed + bonus
  grindDuration: number;       // seconds spent grinding (difficulty ramp)
  grindGraceTimer: number;     // seconds of grace remaining — destabilization physics skipped while > 0
  grindDirection: number;      // +1 or -1 (traversal direction through points array)
  grindOwnTrail: boolean;      // true = own trail (no regen, no destruction)
  grindTrailVehicleType: VehicleType | null; // vehicle type of trail owner (for modifiers)
  _grindDestroyQueue: number[];  // segment indices queued for destruction this tick
  grindBailSide: number;       // sign of balance at bail (-1 or +1), 0 = clean exit
  // ── Grind streak tracking ─────────────────────────────
  grindStreakCount: number;     // consecutive segments ground in sweet/normal zone
  grindStreakBest: number;      // best streak this round
  grindStreakBroken: boolean;   // set true when streak breaks (danger zone)
  // ── Score × multiplier (SPEC-82) ──────────────────────
  grindScore: number;          // accumulated base score this run
  grindMultiplier: number;     // starts 1.0, caps at GRIND_SCORE_MULT_CAP
  grindChain: string[];        // trick names landed this run (max GRIND_CHAIN_MAX_LENGTH)
  grindChainDirty: number;     // monotonic tick on chain/mult change, for UI diff
  grindBustScore: number;      // score snapshot at bail, consumed by overlay
  grindRunActive: boolean;     // true between first entry and final cash-out or bail
  // ── TASK-265: pre-grind availability hint ────────────
  /** True when a grind could be initiated this frame — set by the entry gate in advancePlayer. */
  grindSnapAvailable: boolean;
  // ── TASK-267: slow-on-grind feedback ────────────────
  /** Seconds remaining on the slow-on-grind penalty — > 0 means another player is grinding our trail. */
  grindedOnTimer: number;
  // ── Post-grind state ──────────────────────────────────
  airborne: boolean;
  airborneTimer: number;       // seconds remaining in air
  airborneDuration: number;    // total air time (for arc calculation)
  airbornePeak: number;        // max Y height of jump arc
  landingPenalty: boolean;     // true = bail (harsher recovery)
  recovery: boolean;           // on ground, sluggish
  recoveryTimer: number;       // seconds remaining in recovery
  grindCooldown: number;       // seconds before can grind again
  // ── Trick state (airborne input detection) ────────────
  trickInputBuffer: number[];   // sampled directional inputs during airborne (max 6)
  trickDetected: string;        // trick name ('' = none)
  trickMeterBonus: number;      // meter to award on landing
  trickSampleTimer: number;     // ticks since last sample
}

export interface TrailPoint {
  x: number;
  z: number;
}

export interface SimState {
  tick: number;
  players: PlayerSim[];
  trails: TrailPoint[][];
}

export interface PlayerSpawn {
  x: number;
  z: number;
  angle: number;
  baseSpeed: number;
  vehicleType?: VehicleType;
}

// ── Create initial player state ─────────────────────────

export function createPlayerSim(x: number, z: number, angle: number, speed: number, vehicleType: VehicleType = 'bike'): PlayerSim {
  return {
    x, z, angle, speed,
    vehicleType,
    meter: METER_MAX,
    alive: true,
    boosting: false,
    dashing: false,
    brakeBlend: 0,
    trailTimer: 0,
    proximityBoost: 0,
    courseAssist: 0,
    drifting: false,
    slipAngle: 0,
    velocityAngle: angle,
    driftTimer: 0,
    driftEntryTimer: 0,
    driftBrakeHeld: false,
    driftBrakeReleased: false,
    driftAlignTimer: 0,
    snapRecovery: false,
    snapRecoveryTimer: 0,
    snapRecoveryBoosted: false,
    snapRecoveryFromAngle: angle,
    turnRamp: 0,
    boostLocked: false,
    fumes: false,
    fumesTimer: 0,
    sputterSFX: false,
    // Grind state
    grinding: false,
    grindTrailOwner: -1,
    grindSegIdx: 0,
    grindSegT: 0,
    grindBalance: 0,
    grindLeanDir: 0,
    grindRngState: 0,
    grindSpeed: 0,
    grindDuration: 0,
    grindGraceTimer: 0,
    grindDirection: 1,
    grindOwnTrail: false,
    grindTrailVehicleType: null,
    _grindDestroyQueue: [],
    grindBailSide: 0,
    // Streak tracking
    grindStreakCount: 0,
    grindStreakBest: 0,
    grindStreakBroken: false,
    // Post-grind state
    airborne: false,
    airborneTimer: 0,
    airborneDuration: 0,
    airbornePeak: 0,
    landingPenalty: false,
    recovery: false,
    recoveryTimer: 0,
    grindCooldown: 0,
    // Trick state
    trickInputBuffer: [],
    trickDetected: '',
    trickMeterBonus: 0,
    trickSampleTimer: 0,
    grindScore: 0,
    grindMultiplier: 1.0,
    grindChain: [],
    grindChainDirty: 0,
    grindBustScore: 0,
    grindRunActive: false,
    grindSnapAvailable: false,
    grindedOnTimer: 0,
  };
}

export function createSimState(tick: number, spawns: PlayerSpawn[]): SimState {
  return {
    tick,
    players: spawns.map(s => createPlayerSim(s.x, s.z, s.angle, s.baseSpeed, s.vehicleType)),
    trails: spawns.map(() => []),
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function saturate(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function easeOut2(t: number): number {
  const clamped = saturate(t);
  return 1 - (1 - clamped) * (1 - clamped);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = saturate((x - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function normalizeAngle(a: number): number {
  return a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
}

export function approachAngleExp(current: number, target: number, rate: number, dt: number): number {
  const diff = normalizeAngle(target - current);
  return normalizeAngle(current + diff * (1 - Math.exp(-Math.max(0, rate) * dt)));
}

// ── Boost/meter/fumes phase ────────────────────────────
// Handles boost lock, dash state, fumes grace period, and speed target.
// Mutates player state in place — no allocations.

function _advanceBoost(p: PlayerSim, input: InputFrame, cfg: VehiclePhysics, dt: number): void {
  // Unlock boost when meter reaches threshold
  if (p.boostLocked && p.meter >= METER_MAX * cfg.boostLockThreshold) {
    p.boostLocked = false;
  }

  p.sputterSFX = false;

  // Dash state — can dash with meter OR during fumes
  p.dashing = input.dash && (p.meter > 0 || p.fumes) && !p.boostLocked;

  // Fumes tick — count down grace period
  if (p.fumes) {
    p.fumesTimer -= dt;
    if (p.fumesTimer <= 0) {
      // Fumes expired — hard cutoff
      p.fumes = false;
      p.fumesTimer = 0;
      p.boostLocked = true;
      p.sputterSFX = true;
      p.dashing = false;
      p.boosting = false;
    }
  }

  // Speed target
  let targetSpeed: number;
  if (p.boostLocked) {
    // Locked out — coast
    targetSpeed = cfg.baseSpeed;
    p.boosting = false;
    p.dashing = false;
  } else if (p.dashing) {
    if (!p.fumes) {
      p.meter = Math.max(0, p.meter - cfg.dashDrain * dt);
    }
    if (p.meter <= 0 && !p.fumes) {
      p.fumes = true;
      p.fumesTimer = cfg.fumesDuration;
    }
    targetSpeed = p.fumes ? cfg.dashSpeed * cfg.fumesSpeedScale : cfg.dashSpeed;
    p.boosting = true;
  } else if (input.accelerate && !p.boostLocked) {
    if (cfg.boostDrain > 0 && !p.fumes) {
      p.meter = Math.max(0, p.meter - cfg.boostDrain * dt);
    }
    if (p.meter <= 0 && !p.fumes && cfg.boostDrain > 0) {
      p.fumes = true;
      p.fumesTimer = cfg.fumesDuration;
    }
    targetSpeed = p.fumes ? cfg.boostSpeed * cfg.fumesSpeedScale : cfg.boostSpeed;
    p.boosting = true;
  } else {
    targetSpeed = cfg.baseSpeed;
    p.boosting = false;
    // If player releases boost/dash during fumes, end fumes early
    if (p.fumes) {
      p.fumes = false;
      p.fumesTimer = 0;
      p.boostLocked = true;
      p.sputterSFX = true;
    }
  }

  // Speed ramping
  const lerpRate = targetSpeed > p.speed ? cfg.accelLerp : cfg.decelLerp;
  p.speed += (targetSpeed - p.speed) * Math.min(1, lerpRate * dt);
}

// ── Snap recovery phase ────────────────────────────────
// Smooth decel-then-rebuild after releasing drift at large slip angle.
// Mutates player state in place and updates x/z position — no allocations.

function _advanceSnapRecovery(
  p: PlayerSim, input: InputFrame, cfg: VehiclePhysics, dt: number,
): void {
  p.driftEntryTimer = 0;
  // Snap recovery — smooth decel-then-rebuild after releasing drift at large slip angle
  p.snapRecoveryTimer += dt;
  const dur = p.snapRecoveryBoosted ? cfg.snapRecoveryBoostDuration : cfg.snapRecoveryDuration;
  const progress = Math.min(1, p.snapRecoveryTimer / dur);

  // Turn normally during recovery
  const assist = p.courseAssist;
  p.angle += (input.turnDir + assist) * cfg.turnSpeed * dt;

  // Smooth speed envelope: target ramps from floor → final via ease-in curve
  const floorSpeed = p.snapRecoveryBoosted ? cfg.snapRecoveryBoostFloor : cfg.snapRecoverySpeedFloor;
  const finalTarget = p.snapRecoveryBoosted ? cfg.snapRecoveryBoostTarget : cfg.snapRecoveryTargetSpeed;
  const effectiveTarget = floorSpeed + (finalTarget - floorSpeed) * (progress * progress);
  // Stronger decel when above target, normal accel when below
  const rate = p.speed > effectiveTarget ? cfg.snapRecoveryAccelLerp * 1.5 : cfg.snapRecoveryAccelLerp;
  p.speed += (effectiveTarget - p.speed) * Math.min(1, rate * dt);

  // Curved path: blend velocity from old slide direction → facing via ease-out
  // (fast initial whip toward facing, smooth settle at end)
  const dirBlend = 1 - (1 - progress) * (1 - progress); // quadratic ease-out
  const angleDiff = p.angle - p.snapRecoveryFromAngle;
  const normDiff = angleDiff - Math.round(angleDiff / (2 * Math.PI)) * 2 * Math.PI;
  p.velocityAngle = p.snapRecoveryFromAngle + normDiff * dirBlend;
  if (cfg.canDrift) {
    p.slipAngle = p.angle - p.velocityAngle;
  }

  p.x += -Math.sin(p.velocityAngle) * p.speed * dt;
  p.z += -Math.cos(p.velocityAngle) * p.speed * dt;

  if (p.snapRecoveryTimer >= dur) {
    p.snapRecovery = false;
    p.snapRecoveryTimer = 0;
  }
}

// ── Trail proximity search (for grind entry / hop) ─────

export function _findNearestTrailSeg(
  px: number, pz: number,
  playerIndex: number, state: SimState, range: number,
): { trailOwner: number; segIdx: number; dist: number; isOwn: boolean } | null {
  let best: { trailOwner: number; segIdx: number; dist: number; isOwn: boolean } | null = null;
  let bestDist = range;

  for (let t = 0; t < state.trails.length; t++) {
    const trail = state.trails[t];
    if (!trail || trail.length < 2) continue;
    const isOwn = t === playerIndex;
    const skipN = isOwn ? 10 : 0;
    for (let s = 0; s < trail.length - 1 - skipN; s++) {
      const d = ptSegDist(px, pz, trail[s].x, trail[s].z, trail[s + 1].x, trail[s + 1].z);
      if (d < bestDist) {
        bestDist = d;
        best = { trailOwner: t, segIdx: s, dist: d, isOwn };
      }
    }
  }
  return best;
}

// ── Pure movement step (extracted from Player.update) ───
// Returns new state without mutating input.
// Handles both bike (no drift) and car (full drift state machine).
// Sub-functions (_advanceBoost, advanceDrift, _advanceSnapRecovery) mutate
// a working copy in place — no intermediate object allocations.

export function advancePlayer(
  p: PlayerSim,
  input: InputFrame,
  cfg: VehiclePhysics,
  dt: number,
  state?: SimState,
  playerIndex?: number,
): PlayerSim {
  if (!p.alive) return p;

  // Shallow copy — sub-functions mutate this working copy in place.
  // Original player object is never modified.
  const w: PlayerSim = { ...p };

  // ── Grind system (hoverboard only) ─────────────────────
  // Clear grind destroy queue each tick
  w._grindDestroyQueue = [];

  // Grind cooldown tick (always, even when not grinding)
  if (w.grindCooldown > 0) {
    w.grindCooldown = Math.max(0, w.grindCooldown - dt);
  }

  // If in grind/airborne/recovery — delegate to grind system
  if ((w.grinding || w.airborne || w.recovery) && state != null && playerIndex != null) {
    // First frame after snapshot-load or edge case: player was already grinding
    // but runActive was stale. Fresh ground-entry case handled below after early return.
    // ── Entry reset for players already grinding but without an active run (SPEC-82) ──
    if (w.grinding && !w.grindRunActive) {
      w.grindScore = 0;
      w.grindMultiplier = 1.0;
      w.grindChain.length = 0;
      w.grindChainDirty++;
      w.grindRunActive = true;
      w.grindBustScore = 0;
    }
    advanceGrind(w, input, cfg, dt, state, playerIndex);
    return w;
  }

  // TASK-265: pre-grind availability hint + grind initiation share one scan.
  // Compute nearest trail once per frame for the availability flag, then reuse
  // the result for the entry path if Space is held this frame.
  w.grindSnapAvailable = false;
  let nearest: ReturnType<typeof _findNearestTrailSeg> = null;
  if (cfg.canGrind && w.grindCooldown <= 0 && state != null && playerIndex != null) {
    nearest = _findNearestTrailSeg(w.x, w.z, playerIndex, state, GRIND_SNAP_RANGE);
    if (nearest && (nearest.isOwn || w.meter >= GRIND_ENTRY_COST)) {
      w.grindSnapAvailable = true;
    }
  }

  // Grind initiation (hoverboard only, requires sim state)
  if (input.special && cfg.canGrind && w.grindCooldown <= 0 && state != null && playerIndex != null) {
    if (nearest) {
      const canAfford = nearest.isOwn || w.meter >= GRIND_ENTRY_COST;
      if (canAfford) {
        if (!nearest.isOwn) w.meter -= GRIND_ENTRY_COST;
        // ── Score run reset on fresh entry (SPEC-82) ──────────
        if (!w.grindRunActive) {
          w.grindScore = 0;
          w.grindMultiplier = 1.0;
          w.grindChain.length = 0;
          w.grindChainDirty++;
          w.grindRunActive = true;
        }
        w.grindBustScore = 0;
        w.grinding = true;
        w.grindTrailOwner = nearest.trailOwner;
        w.grindSegIdx = nearest.segIdx;
        w.grindSegT = 0;
        w.grindBalance = 0;
        w.grindStreakCount = 0;
        w.grindStreakBroken = false;
        w.grindRngState = seedGrindRng(state.tick, playerIndex);
        // THPS2: grinds start with a random 50/50 lean direction
        const initR = mulberry32(w.grindRngState);
        w.grindRngState = initR.next;
        w.grindLeanDir = GRIND_LEAN_RND_KICK * (initR.value < 0.5 ? -1 : 1);
        // Apply trail type speed modifier (own-trail grinding = neutral)
        const entryMods = nearest.isOwn
          ? GRIND_TRAIL_MODS.hoverboard
          : GRIND_TRAIL_MODS[state.players[nearest.trailOwner].vehicleType];
        w.grindSpeed = w.speed + GRIND_SPEED_BONUS * entryMods.speedMult;
        w.grindDuration = 0;
        w.grindGraceTimer = GRIND_GRACE_DURATION;
        w.grindOwnTrail = nearest.isOwn;
        w.grindTrailVehicleType = state.players[nearest.trailOwner].vehicleType;
        // Pick traversal direction
        const trail = state.trails[nearest.trailOwner];
        const seg = trail[nearest.segIdx];
        const segNext = trail[nearest.segIdx + 1];
        if (seg && segNext) {
          const segDx = segNext.x - seg.x;
          const segDz = segNext.z - seg.z;
          const velX = -Math.sin(w.angle);
          const velZ = -Math.cos(w.angle);
          const dot = velX * segDx + velZ * segDz;
          w.grindDirection = dot >= 0 ? 1 : -1;
        } else {
          w.grindDirection = 1;
        }
        // Immediately route to grind system
        advanceGrind(w, input, cfg, dt, state, playerIndex);
        return w;
      }
    }
  }

  // Phase 1: Boost, meter, fumes, and speed
  _advanceBoost(w, input, cfg, dt);

  // ── TASK-267: slow-on-grind — drag the trail owner while an enemy rides their rail ──
  // Read the pre-step state.players so the decision is independent of the iteration
  // order within simStep — rollback-safe because we're querying a stable snapshot.
  // Renew timer every tick the grinder is active; decay on its own once they leave.
  if (state != null && playerIndex != null) {
    let beingGrinded = false;
    const others: PlayerSim[] = state.players;
    for (let i = 0; i < others.length; i++) {
      if (i === playerIndex) continue;
      const other: PlayerSim = others[i];
      if (!other.alive) continue;
      if (other.grinding && !other.grindOwnTrail && other.grindTrailOwner === playerIndex) {
        beingGrinded = true;
        break;
      }
    }
    if (beingGrinded) {
      w.grindedOnTimer = GRIND_SLOW_DURATION;
    } else if (w.grindedOnTimer > 0) {
      w.grindedOnTimer = Math.max(0, w.grindedOnTimer - dt);
    }
    // Apply drag toward a slow-speed cap so the full movement block (normal and
    // snap recovery) uses the reduced speed. Drifters are skipped — their own
    // speed state machine would stomp the edit and the committed feel matters.
    if (w.grindedOnTimer > 0 && !w.drifting) {
      const slowCap = cfg.baseSpeed * GRIND_SLOW_MULT;
      if (w.speed > slowCap) {
        // Rate 18/sec ≈ 30% per tick — onset over ~6 ticks feels immediate without snapping.
        w.speed += (slowCap - w.speed) * Math.min(1, 18 * dt);
      }
    }
  }

  // ── Drift state machine (car only, guarded by cfg.canDrift) ──
  // Check drift entry BEFORE brake decel so brake doesn't drop speed below threshold on the same frame
  const driftInput = input.driftBrake ?? input.brake;

  // Proximity speed boost (bike only — car earns speed through drift)
  if (!cfg.canDrift) {
    w.speed *= (1.0 + p.proximityBoost * cfg.proximitySpeedMultiplier);
  }
  const wantDrift = cfg.canDrift && driftInput && w.speed >= cfg.baseSpeed;
  if (wantDrift && !w.drifting) {
    w.drifting = true;
    w.driftBrakeHeld = true;
    w.driftBrakeReleased = false;
    w.driftAlignTimer = 0;
    w.driftTimer = 0;
    w.driftEntryTimer = 0;
    w.snapRecovery = false; // cancel any active snap recovery
    w.snapRecoveryTimer = 0;
    w.snapRecoveryBoosted = false;
    w.snapRecoveryFromAngle = w.angle;
  }

  // Brake blend (skip during drift — drift manages its own speed)
  if (input.brake && !w.drifting) {
    w.brakeBlend = Math.min(1, w.brakeBlend + dt * 4);
    w.speed = w.speed * (1 - w.brakeBlend) + cfg.brakeSpeed * w.brakeBlend;
  } else if (!w.drifting) {
    w.brakeBlend = Math.max(0, w.brakeBlend - dt * 6);
    if (w.brakeBlend > 0) {
      w.speed = w.speed * (1 - w.brakeBlend) + cfg.brakeSpeed * w.brakeBlend;
    }
  }

  if (w.drifting) {
    // Phase 2: Drift mechanics — mutates w in place, updates w.x/w.z
    advanceDrift(w, input, cfg, dt, driftInput);
  } else if (w.snapRecovery) {
    // Phase 3: Snap recovery — mutates w in place, updates w.x/w.z
    _advanceSnapRecovery(w, input, cfg, dt);
  } else {
    w.driftEntryTimer = 0;
    // Not drifting — normal movement
    if (cfg.canDrift) {
      const postSpeed01 = saturate((w.speed - cfg.driftIntentStartSpeed) / Math.max(0.001, cfg.driftIntentFullSpeed - cfg.driftIntentStartSpeed));
      const postDriftRate = Math.max(cfg.driftGripLow, cfg.driftSlipDecay) * lerp(2.0, 1.0, postSpeed01);
      w.velocityAngle = approachAngleExp(w.velocityAngle, w.angle, postDriftRate, dt);
      w.slipAngle = normalizeAngle(w.angle - w.velocityAngle);
    }

    const assist = p.courseAssist;

    if (!cfg.canDrift) {
      // Non-drift vehicles: smooth turn ramp (tuned per vehicle via turnLerp/turnDecay)
      const target = input.turnDir;
      if (target !== 0) {
        w.turnRamp += (target - w.turnRamp) * Math.min(1, cfg.turnLerp * dt);
      } else {
        w.turnRamp *= Math.exp(-cfg.turnDecay * dt);
        if (Math.abs(w.turnRamp) < 0.01) w.turnRamp = 0;
      }
      w.angle += (w.turnRamp + assist) * cfg.turnSpeed * dt;

      // Speed bleed on hard turns (hoverboard carving feel)
      if (cfg.turnSpeedBleed < 1.0 && Math.abs(w.turnRamp) > 0.1) {
        const bleedAmount = 1.0 - (1.0 - cfg.turnSpeedBleed) * Math.abs(w.turnRamp);
        w.speed *= bleedAmount;
      }
    } else {
      // Car: direct turn with slow-speed boost
      const speedRatio: number = Math.min(w.speed / cfg.baseSpeed, 1);
      const slowTurnBoost: number = 1 + (1 - speedRatio) * 0.6;
      w.angle += (input.turnDir + assist) * cfg.turnSpeed * slowTurnBoost * dt;
    }

    w.x += -Math.sin(w.angle) * w.speed * dt;
    w.z += -Math.cos(w.angle) * w.speed * dt;
  }

  // Meter passive regen (full rate always, none while dashing/drifting/in fumes)
  if (!w.dashing && !w.drifting && !w.snapRecovery && !w.fumes) {
    w.meter = Math.min(METER_MAX, w.meter + cfg.passiveRegen * dt);
  }

  // Low meter emergency regen (bike only — trickle charge when critically low)
  if (cfg.lowMeterThreshold > 0 && w.meter < METER_MAX * cfg.lowMeterThreshold) {
    w.meter = Math.min(METER_MAX, w.meter + cfg.lowMeterRegen * dt);
  }

  // ── Cash out on clean run end (SPEC-82) ───────────────
  if (
    w.grindRunActive &&
    !w.grinding &&
    !w.airborne &&
    !w.recovery &&
    w.grindCooldown <= 0
  ) {
    const meterGain = Math.floor(w.grindScore / GRIND_SCORE_METER_DIVISOR);
    w.meter = Math.min(METER_MAX, w.meter + meterGain);
    // grindScore stays as-is for one frame so player.ts can snapshot it
    // before the flag flips; finalizeGrindCashOut clears next frame.
    w.grindRunActive = false;
  }

  // Trail timer
  w.trailTimer++;

  // Reset courseAssist (set externally each tick)
  w.courseAssist = 0;

  return w;
}

// ── Grind lifecycle helpers (SPEC-82) ───────────────────

/** Called by the render layer after consuming cash-out score snapshot (SPEC-82). */
export function finalizeGrindCashOut(p: PlayerSim): void {
  // Note: grindRunActive is already false at this point — the cash-out block in
  // advancePlayer flipped it during the one-frame UI read window. We only clear
  // the stale score/mult/chain fields that player.ts is done reading.
  p.grindScore = 0;
  p.grindMultiplier = 1.0;
  p.grindChain.length = 0;
  p.grindChainDirty++;
}

/** Read + clear the bust score in one call (keeps sim mutation localized). */
export function consumeGrindBustScore(p: PlayerSim): number {
  const v = p.grindBustScore;
  p.grindBustScore = 0;
  return v;
}

// ── Collision checks ────────────────────────────────────

export const HIT_RADIUS = 0.8;
export const SKIP_OWN_SEGMENTS = 10;

let _arenaCircular = false;
let _arenaRadius = ARENA_HALF;

export function setArenaShape(circular: boolean, radius: number): void {
  _arenaCircular = circular;
  _arenaRadius = radius;
}

export function getArenaCircular(): boolean { return _arenaCircular; }
export function getArenaRadius(): number { return _arenaRadius; }

export function isOutOfBounds(x: number, z: number): boolean {
  if (_arenaCircular) return x * x + z * z >= _arenaRadius * _arenaRadius;
  return Math.abs(x) >= _arenaRadius || Math.abs(z) >= _arenaRadius;
}

export function checkHeadOn(a: PlayerSim, b: PlayerSim, threshold = 2.0): boolean {
  return Math.hypot(a.x - b.x, a.z - b.z) < threshold;
}

// Point-to-segment distance (inlined for zero dependencies)
function ptSegDist(
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

// Single-trail collision check. If isOwnTrail, skips last SKIP_OWN_SEGMENTS segments.
export function checkTrailCollisionSingle(
  px: number,
  pz: number,
  trail: TrailPoint[],
  isOwnTrail: boolean,
): boolean {
  const end = isOwnTrail ? trail.length - 1 - SKIP_OWN_SEGMENTS : trail.length - 1;
  for (let i = 0; i < end; i++) {
    if (ptSegDist(px, pz, trail[i].x, trail[i].z, trail[i + 1].x, trail[i + 1].z) < HIT_RADIUS) {
      return true;
    }
  }
  return false;
}

// Legacy 2-trail collision check — used by game.ts for AI collision checks.
// ts-prune-ignore-next
export function checkTrailCollision(
  px: number,
  pz: number,
  ownTrail: TrailPoint[],
  enemyTrail: TrailPoint[],
): boolean {
  return checkTrailCollisionSingle(px, pz, enemyTrail, false) ||
         checkTrailCollisionSingle(px, pz, ownTrail, true);
}

// ── Simulation step ─────────────────────────────────────
// Advances the simulation by one fixed tick with full deterministic collision.

export function simStep(
  state: SimState,
  inputs: InputFrame[],
  cfgs: VehiclePhysics[],
): SimState {
  const tick = state.tick + 1;
  const n = state.players.length;

  // Advance all players
  let players = state.players.map((p, i) => advancePlayer(p, inputs[i], cfgs[i], SIM_DT, state, i));

  // Trail points (every TRAIL_TICK_INTERVAL ticks) — only copy when mutating
  const trails = state.trails.map(t => t); // shallow copy of outer array

  for (let i = 0; i < n; i++) {
    const p = players[i];
    // Grinding/airborne players do not lay trail points — they ride on an existing rail.
    if (p.alive && !p.grinding && !p.airborne && p.trailTimer >= TRAIL_TICK_INTERVAL) {
      const rx = p.x + Math.sin(p.angle) * cfgs[i].trailRear;
      const rz = p.z + Math.cos(p.angle) * cfgs[i].trailRear;
      const shifted = trails[i].length >= MAX_TRAIL_POINTS;
      trails[i] = shifted
        ? [...trails[i].slice(1), { x: rx, z: rz }]
        : [...trails[i], { x: rx, z: rz }];
      players = players.map((pl, j) => j === i ? { ...pl, trailTimer: 0 } : pl);

      // Adjust grindSegIdx for any player grinding on this trail
      if (shifted) {
        players = players.map(pl => {
          if (!pl.grinding || pl.grindTrailOwner !== i) return pl;
          const newIdx = pl.grindSegIdx - 1;
          if (newIdx <= 0) {
            // Segment consumed — force clean exit
            return {
              ...pl,
              grinding: false,
              airborne: true,
              landingPenalty: false,
              airborneTimer: GRIND_AIRBORNE_CLEAN,
              airborneDuration: GRIND_AIRBORNE_CLEAN,
              airbornePeak: GRIND_JUMP_HEIGHT_CLEAN,
              grindTrailOwner: -1,
              grindSegIdx: 0,
              grindSegT: 0,
              grindBalance: 0,
              grindLeanDir: 0,
              grindRngState: 0,
              grindSpeed: 0,
              grindDirection: 1,
              grindDuration: 0,
              grindGraceTimer: 0,
              grindOwnTrail: false,
              grindTrailVehicleType: null,
              grindBailSide: 0,
              // Reset trick state for new airborne phase
              trickInputBuffer: [],
              trickDetected: '',
              trickMeterBonus: 0,
              trickSampleTimer: 0,
            };
          }
          return { ...pl, grindSegIdx: newIdx };
        });
      }
    }
  }

  // Out of bounds check
  for (let i = 0; i < n; i++) {
    if (players[i].alive && isOutOfBounds(players[i].x, players[i].z)) {
      players = players.map((p, j) => j === i ? { ...p, alive: false } : p);
    }
  }

  // Trail collision — each player checks against ALL trails
  for (let i = 0; i < n; i++) {
    if (!players[i].alive) continue;
    if (players[i].grinding || players[i].airborne) continue;
    let hit = false;
    for (let j = 0; j < n; j++) {
      const isOwn = i === j;
      if (checkTrailCollisionSingle(players[i].x, players[i].z, trails[j], isOwn)) {
        hit = true;
        break;
      }
    }
    if (hit) {
      players = players.map((p, j) => j === i ? { ...p, alive: false } : p);
    }
  }

  // Head-on collision — all pairs
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (players[i].alive && players[j].alive && checkHeadOn(players[i], players[j])) {
        players = players.map((p, k) => (k === i || k === j) ? { ...p, alive: false } : p);
      }
    }
  }

  return { tick, players, trails };
}

// ── Snapshot for rollback ───────────────────────────────

export function cloneSimState(s: SimState): SimState {
  return {
    tick: s.tick,
    players: s.players.map(p => ({ ...p, _grindDestroyQueue: [...p._grindDestroyQueue], grindChain: [...p.grindChain], trickInputBuffer: [...p.trickInputBuffer] })),
    trails: s.trails.map(t => t.slice()),
  };
}

// ── State serialization for desync recovery ──────────────

/** JSON-safe representation for network transfer (desync recovery). */
export interface SerializedSimState {
  tick: number;
  players: PlayerSim[];
  trails: TrailPoint[][];
}

/** Round floats to avoid JSON precision drift. */
function roundPlayer(p: PlayerSim): PlayerSim {
  return {
    vehicleType: p.vehicleType,
    x: Math.round(p.x * 10000) / 10000,
    z: Math.round(p.z * 10000) / 10000,
    angle: Math.round(p.angle * 10000) / 10000,
    speed: Math.round(p.speed * 10000) / 10000,
    meter: Math.round(p.meter * 100) / 100,
    alive: p.alive,
    boosting: p.boosting,
    dashing: p.dashing,
    brakeBlend: Math.round(p.brakeBlend * 10000) / 10000,
    trailTimer: p.trailTimer,
    proximityBoost: Math.round(p.proximityBoost * 10000) / 10000,
    courseAssist: 0,
    drifting: p.drifting,
    slipAngle: Math.round(p.slipAngle * 10000) / 10000,
    velocityAngle: Math.round(p.velocityAngle * 10000) / 10000,
    driftTimer: Math.round(p.driftTimer * 10000) / 10000,
    driftEntryTimer: Math.round(p.driftEntryTimer * 10000) / 10000,
    driftBrakeHeld: p.driftBrakeHeld,
    driftBrakeReleased: p.driftBrakeReleased,
    driftAlignTimer: Math.round(p.driftAlignTimer * 10000) / 10000,
    snapRecovery: p.snapRecovery,
    snapRecoveryTimer: Math.round(p.snapRecoveryTimer * 10000) / 10000,
    snapRecoveryBoosted: p.snapRecoveryBoosted,
    snapRecoveryFromAngle: Math.round(p.snapRecoveryFromAngle * 10000) / 10000,
    turnRamp: Math.round(p.turnRamp * 10000) / 10000,
    boostLocked: p.boostLocked,
    fumes: p.fumes,
    fumesTimer: Math.round(p.fumesTimer * 10000) / 10000,
    sputterSFX: false, // transient flag, not synced
    // Grind state
    grinding: p.grinding,
    grindTrailOwner: p.grindTrailOwner,
    grindSegIdx: p.grindSegIdx,
    grindSegT: Math.round(p.grindSegT * 10000) / 10000,
    grindBalance: Math.round(p.grindBalance * 10000) / 10000,
    grindLeanDir: Math.round(p.grindLeanDir * 10000) / 10000,
    grindRngState: p.grindRngState,
    grindSpeed: Math.round(p.grindSpeed * 10000) / 10000,
    grindDuration: Math.round(p.grindDuration * 10000) / 10000,
    grindGraceTimer: Math.round(p.grindGraceTimer * 10000) / 10000,
    grindDirection: p.grindDirection,
    grindOwnTrail: p.grindOwnTrail,
    grindTrailVehicleType: p.grindTrailVehicleType,
    _grindDestroyQueue: [...p._grindDestroyQueue],
    grindBailSide: p.grindBailSide,
    // Streak tracking
    grindStreakCount: p.grindStreakCount,
    grindStreakBest: p.grindStreakBest,
    grindStreakBroken: p.grindStreakBroken,
    // Score × multiplier (SPEC-82)
    grindScore: Math.round(p.grindScore),
    grindMultiplier: Math.round(p.grindMultiplier * 100) / 100,
    grindChain: [...p.grindChain],
    grindChainDirty: p.grindChainDirty,
    grindBustScore: Math.round(p.grindBustScore),
    grindRunActive: p.grindRunActive,
    grindSnapAvailable: p.grindSnapAvailable,
    grindedOnTimer: Math.round(p.grindedOnTimer * 10000) / 10000,
    // Post-grind state
    airborne: p.airborne,
    airborneTimer: Math.round(p.airborneTimer * 10000) / 10000,
    airborneDuration: Math.round(p.airborneDuration * 10000) / 10000,
    airbornePeak: Math.round(p.airbornePeak * 10000) / 10000,
    landingPenalty: p.landingPenalty,
    recovery: p.recovery,
    recoveryTimer: Math.round(p.recoveryTimer * 10000) / 10000,
    grindCooldown: Math.round(p.grindCooldown * 10000) / 10000,
    // Trick state
    trickInputBuffer: [...p.trickInputBuffer],
    trickDetected: p.trickDetected,
    trickMeterBonus: p.trickMeterBonus,
    trickSampleTimer: p.trickSampleTimer,
  };
}

/** Round player state only — cheap enough to call every tick (~40 Math.round for 2 players).
 *  Prevents floating-point divergence from accumulating between lockstep clients. */
export function quantizePlayers(s: SimState): SimState {
  return {
    tick: s.tick,
    players: s.players.map(p => roundPlayer(p)),
    trails: s.trails, // trails are derived from quantized positions — no per-tick rounding needed
  };
}

/** Full quantization including trails — more expensive (O(trail length) per player).
 *  Call periodically (e.g. every 30 ticks) to sync trail precision. */
export function quantizeSimState(s: SimState): SimState {
  return {
    tick: s.tick,
    players: s.players.map(p => roundPlayer(p)),
    trails: s.trails.map(trail => trail.map(pt => ({
      x: Math.round(pt.x * 100) / 100,
      z: Math.round(pt.z * 100) / 100,
    }))),
  };
}

export function serializeSimState(s: SimState): SerializedSimState {
  return {
    tick: s.tick,
    players: s.players.map(p => roundPlayer(p)),
    trails: s.trails.map(trail => trail.map(p => ({ x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 }))),
  };
}

export function deserializeSimState(data: SerializedSimState): SimState {
  return {
    tick: data.tick,
    players: data.players.map(p => ({ ...p, _grindDestroyQueue: [...(p._grindDestroyQueue || [])], trickInputBuffer: [...(p.trickInputBuffer || [])] })),
    trails: data.trails.map(trail => trail.map(p => ({ x: p.x, z: p.z }))),
  };
}

// ── State hash for consistency verification ─────────────

export function hashSimState(s: SimState): number {
  // FNV-1a hash — must include all fields that affect gameplay outcome
  let h = 2166136261;
  const feed = (v: number): void => { h = Math.imul(h ^ (v & 0xff), 16777619); h = Math.imul(h ^ ((v >> 8) & 0xff), 16777619); };

  for (let i = 0; i < s.players.length; i++) {
    const p = s.players[i];
    feed(Math.round(p.x * 10));
    feed(Math.round(p.z * 10));
    feed(Math.round(p.angle * 1000));
    feed(Math.round(p.speed * 10));
    feed(Math.round(p.meter));
    // TODO: courseAssist is not hashed. It is set externally before simStep and reset to 0
    // by quantizePlayers after simStep, so it cannot diverge between ticks. If courseAssist
    // is ever made persistent (survives quantize), add it to the hash.
    feed(p.alive ? 1 : 0);
    // Drift state (affects movement direction and speed)
    feed(p.drifting ? 1 : 0);
    feed(Math.round(p.slipAngle * 1000));
    feed(Math.round(p.velocityAngle * 1000));
    // Timer / sub-state fields that affect simulation outcome
    feed(p.trailTimer);
    feed(Math.round(p.driftTimer * 1000));
    feed(Math.round(p.driftEntryTimer * 1000));
    feed(p.driftBrakeHeld ? 1 : 0);
    feed(p.driftBrakeReleased ? 1 : 0);
    feed(Math.round(p.driftAlignTimer * 1000));
    // Speed modifiers
    feed(Math.round(p.brakeBlend * 1000));
    feed(Math.round(p.proximityBoost * 1000));
    feed(p.boosting ? 1 : 0);
    feed(p.dashing ? 1 : 0);
    // Snap recovery state — affects velocity angle and speed during recovery phase.
    // Omitting these caused silent divergence that only surfaced in hashed fields 60+ ticks later.
    feed(p.snapRecovery ? 1 : 0);
    feed(Math.round(p.snapRecoveryTimer * 1000));
    feed(p.snapRecoveryBoosted ? 1 : 0);
    feed(Math.round(p.snapRecoveryFromAngle * 1000));
    // Bike turn ramp — affects angle computation each tick
    feed(Math.round(p.turnRamp * 1000));
    feed(p.boostLocked ? 1 : 0);
    feed(p.fumes ? 1 : 0);
    feed(Math.round(p.fumesTimer * 1000));
    // Grind state — all fields that affect grinding simulation outcome
    feed(p.grinding ? 1 : 0);
    feed(p.grindTrailOwner);
    feed(p.grindSegIdx);
    feed(Math.round(p.grindSegT * 1000));
    feed(Math.round(p.grindBalance * 10000));
    feed(Math.round(p.grindLeanDir * 10000));
    feed(p.grindRngState);
    feed(Math.round(p.grindSpeed * 100));
    feed(Math.round(p.grindDuration * 100));
    feed(Math.round(p.grindGraceTimer * 100));
    feed(p.grindDirection);
    feed(p.grindOwnTrail ? 1 : 0);
    feed(p.grindBailSide);
    // Score / multiplier / run state (SPEC-82) — grindChain excluded (string array)
    feed(Math.round(p.grindScore));
    feed(Math.round(p.grindMultiplier * 100));
    feed(p.grindRunActive ? 1 : 0);
    // TASK-267: slow-on-grind timer affects movement speed — must be hashed.
    feed(Math.round(p.grindedOnTimer * 1000));
    feed(p.grindStreakCount);
    feed(p.grindStreakBest);
    feed(p.grindStreakBroken ? 1 : 0);
    feed(p.airborne ? 1 : 0);
    feed(Math.round(p.airborneTimer * 1000));
    feed(p.landingPenalty ? 1 : 0);
    feed(p.recovery ? 1 : 0);
    feed(Math.round(p.recoveryTimer * 1000));
    feed(Math.round(p.grindCooldown * 1000));
    // Trick state — affects meter outcome on landing
    for (let b = 0; b < p.trickInputBuffer.length; b++) feed(p.trickInputBuffer[b]);
    feed(p.trickMeterBonus);
    feed(p.trickSampleTimer);
  }

  // Trail lengths
  for (let i = 0; i < s.trails.length; i++) {
    feed(s.trails[i].length);
  }

  // Sample trail points at regular intervals for mid-trail divergence detection
  const HASH_STRIDE = 50;
  for (let i = 0; i < s.trails.length; i++) {
    const trail = s.trails[i];
    for (let j = 0; j < trail.length; j += HASH_STRIDE) {
      feed(Math.round(trail[j].x * 10));
      feed(Math.round(trail[j].z * 10));
    }
    // Sample last few trail points for tail verification
    for (let j = Math.max(0, trail.length - 3); j < trail.length; j++) {
      feed(Math.round(trail[j].x * 10));
      feed(Math.round(trail[j].z * 10));
    }
  }

  return h >>> 0;
}

// ── Snapshot ring buffer ────────────────────────────────

export class SnapshotBuffer {
  private _buffer: (SimState | null)[];
  private _size: number;

  constructor(size = 10) {
    this._size = size;
    this._buffer = new Array(size).fill(null);
  }

  save(state: SimState): void {
    this._buffer[state.tick % this._size] = cloneSimState(state);
  }

  get(tick: number): SimState | null {
    const entry = this._buffer[tick % this._size];
    if (entry && entry.tick === tick) return cloneSimState(entry);
    return null;
  }

  clear(): void {
    this._buffer.fill(null);
  }
}
