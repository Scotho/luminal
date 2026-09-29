import type { AIState, AIPersonality, AIInput, IAIPlayer, ITrailLike, ITrail, VehicleType, AIDifficulty } from './types/index';
import { getArenaRadius, getArenaCircular, HIT_RADIUS, SKIP_OWN_SEGMENTS } from './core/simulation';
import { recreateRng } from './core/seededRandom';
import { grid } from './spatialGrid';
import type { SimSpatialGrid } from './core/simSpatialGrid';
import type { PlayerSim } from './core/simulation';
import type { TrailPoint } from './types/index';
import { getManeuverTurnOverride } from './aiManeuvers';
import {
  aiPerception,
  aiTrapAnalysis,
  aiScoringLoop,
  aiAccelDecision,
  aiDriftDecision,
  aiDashDecision,
  aiGrindDecision,
  aiFidget,
  normalizeAngle,
  wallDistFromPoint,
  type PlayerEstimate,
  type DifficultyPresetLite,
  type AIVehicleConstantsLite,
  type RaycastFn,
  type NearestTrailDistFn,
} from './aiPhases';

// ── Injectable grid for sim-layer AI ─────────────────────
// When _simGrid is set, raycast/nearestTrailDist use it instead of the visual global.
// Set by getAIInputSim, cleared immediately after the call.
let _simGrid: SimSpatialGrid | null = null;
let _simOwnTrailIdx: number = -1;

/** Segments to skip on own trail — must match collisionSystem.skipOwnSegments (10). */
export const AI_SKIP_OWN: number = SKIP_OWN_SEGMENTS;

export interface DifficultyPreset {
  // Personality ranges [min, range] — value = min + rng() * range
  aggression: [number, number];
  wallFear: [number, number];
  cutoffSkill: [number, number];
  escapeSkill: [number, number];
  turniness: [number, number];
  jitterAmount: [number, number];
  dashAggression: [number, number];
  // Perception
  lookaheadMult: number;
  emergencyMult: number;
  probeCount: number;
  probeStart: number;
  probeStep: number;
  c3Threshold: number;
  angleOffsets: number[];
  // Tactics
  offenseScale: number;
  huntingPull: number;
  dashMeterThreshold: number;
  counterAttackMult: number;
  attackEnabled: boolean;
  attackBand: number;
  attackDuration: [number, number];
  reactionDelay: [number, number];
  spaceDenialMult: number;
}

const MEDIUM_ANGLES: number[] = [-1.4, -1.0, -0.6, -0.4, -0.2, -0.1, 0, 0.1, 0.2, 0.4, 0.6, 1.0, 1.4];
const HARD_ANGLES: number[] = [-1.4, -1.0, -0.8, -0.6, -0.4, -0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 1.0, 1.4];

export const DIFFICULTY_PRESETS: Record<AIDifficulty, DifficultyPreset> = {
  easy: {
    aggression: [0.15, 0.25],
    wallFear: [0.85, 0.15],
    cutoffSkill: [0.1, 0.25],
    escapeSkill: [0.2, 0.25],
    turniness: [0.2, 0.2],
    jitterAmount: [0.06, 0.06],
    dashAggression: [0.3, 0.2],
    lookaheadMult: 2.0,
    emergencyMult: 0.35,
    probeCount: 3,
    probeStart: 5,
    probeStep: 8,
    c3Threshold: 35,
    angleOffsets: MEDIUM_ANGLES,
    offenseScale: 0.3,
    huntingPull: 0.3,
    dashMeterThreshold: 80,
    counterAttackMult: 0.2,
    attackEnabled: false,
    attackBand: 0,
    attackDuration: [0, 0],
    reactionDelay: [0.12, 0.08],
    spaceDenialMult: 0.3,
  },
  medium: {
    aggression: [0.5, 0.5],
    wallFear: [0.6, 0.4],
    cutoffSkill: [0.5, 0.5],
    escapeSkill: [0.5, 0.5],
    turniness: [0.4, 0.6],
    jitterAmount: [0.03, 0.05],
    dashAggression: [0.6, 0.4],
    lookaheadMult: 3.0,
    emergencyMult: 0.5,
    probeCount: 5,
    probeStart: 3,
    probeStep: 5,
    c3Threshold: 20,
    angleOffsets: MEDIUM_ANGLES,
    offenseScale: 1.0,
    huntingPull: 1.0,
    dashMeterThreshold: 15,
    counterAttackMult: 1.0,
    attackEnabled: true,
    attackBand: 0.10,
    attackDuration: [1.5, 1.5],
    reactionDelay: [0, 0],
    spaceDenialMult: 1.0,
  },
  hard: {
    aggression: [0.85, 0.15],
    wallFear: [0.5, 0.2],
    cutoffSkill: [0.9, 0.1],
    escapeSkill: [0.9, 0.1],
    turniness: [0.5, 0.25],
    jitterAmount: [0.01, 0.02],
    dashAggression: [0.9, 0.1],
    lookaheadMult: 4.0,
    emergencyMult: 0.7,
    probeCount: 7,
    probeStart: 2,
    probeStep: 4,
    c3Threshold: 12,
    angleOffsets: HARD_ANGLES,
    offenseScale: 1.5,
    huntingPull: 1.8,
    dashMeterThreshold: 10,
    counterAttackMult: 2.0,
    attackEnabled: true,
    attackBand: 0.18,
    attackDuration: [2.0, 2.0],
    reactionDelay: [0, 0],
    spaceDenialMult: 1.5,
  },
};

// Returns true if point is outside (or on) the arena boundary.
function isOutOfBounds(px: number, pz: number): boolean {
  const r = getArenaRadius();
  if (getArenaCircular()) return px * px + pz * pz >= r * r;
  return Math.abs(px) >= r - 0.8 || Math.abs(pz) >= r - 0.8;
}

interface AIVehicleConstants {
  turnSpeed: number;
  baseSpeed: number;
  boostSpeed: number;
  dashSpeed: number;
  driftSpeed: number;
  driftBoostSpeed: number;
}

const BIKE_AI: AIVehicleConstants = {
  turnSpeed: 2.94,
  baseSpeed: 40,
  boostSpeed: 55,
  dashSpeed: 98.5,
  driftSpeed: 0,
  driftBoostSpeed: 0,
};

const CAR_AI: AIVehicleConstants = {
  turnSpeed: 1.8,
  baseSpeed: 44.4,
  boostSpeed: 50,
  dashSpeed: 105,
  driftSpeed: 70,
  driftBoostSpeed: 90,
};

// ── Tunable AI constants (admin panel) ───────────────────
export const aiTuning = {
  maneuverMinCd: 3,
  maneuverMaxCd: 8,
};

// AIPlayer and TrailLike are now IAIPlayer and ITrailLike in types/index.ts
type AIPlayer = IAIPlayer;
type TrailLike = ITrailLike;

// ── Per-instance AI state ───────────────────────────────
export function createAIState(rng?: () => number, difficulty?: AIDifficulty): AIState {
  const r = rng || Math.random;
  const diff: AIDifficulty = difficulty || 'medium';
  const preset = DIFFICULTY_PRESETS[diff];
  return {
    personality: null,
    personalityTimer: 0,
    maneuver: null,
    maneuverCooldown: 0,
    trappedTimer: 0,
    trappedSuicideAt: 8 + r() * 7,
    fidgetTimer: 0,
    fidgetValue: 0,
    fidgetDuration: 0,
    lastPlayerAngle: null,
    lastPlayerPos: null,
    reactionDelay: preset.reactionDelay[0] + r() * preset.reactionDelay[1],
    accelCommit: 0,   // remaining time AI must keep accelerating
    accelCooldown: 0,  // remaining time before AI can accelerate again
    driftCommit: 0,    // remaining time AI must hold brake (drift)
    driftCooldown: 0,  // cooldown before next drift attempt
    driftExitTimer: 0, // time since drift exit (for dash combo)
    rng: r,
    difficulty: diff,
  };
}

/** Deep-clone an AIState for rollback snapshots. The RNG is cloned by recreating it at the same call count. */
export function cloneAIState(state: AIState): AIState {
  return {
    personality: state.personality ? { ...state.personality } : null,
    personalityTimer: state.personalityTimer,
    maneuver: state.maneuver ? { ...state.maneuver } : null,
    maneuverCooldown: state.maneuverCooldown,
    trappedTimer: state.trappedTimer,
    trappedSuicideAt: state.trappedSuicideAt,
    fidgetTimer: state.fidgetTimer,
    fidgetValue: state.fidgetValue,
    fidgetDuration: state.fidgetDuration,
    lastPlayerAngle: state.lastPlayerAngle,
    lastPlayerPos: state.lastPlayerPos ? { ...state.lastPlayerPos } : null,
    reactionDelay: state.reactionDelay,
    accelCommit: state.accelCommit,
    accelCooldown: state.accelCooldown,
    dashCommit: state.dashCommit,
    dashCooldown: state.dashCooldown,
    driftCommit: state.driftCommit,
    driftCooldown: state.driftCooldown,
    driftExitTimer: state.driftExitTimer,
    rng: recreateRng(
      (state.rng as { originalSeed?: number }).originalSeed ?? 0,
      (state.rng as { callCount?: number }).callCount ?? 0,
    ),
    difficulty: state.difficulty,
  };
}

function resetPersonality(state: AIState): void {
  const r = state.rng;
  const p = DIFFICULTY_PRESETS[state.difficulty];
  state.personality = {
    aggression: p.aggression[0] + r() * p.aggression[1],
    wallFear: p.wallFear[0] + r() * p.wallFear[1],
    straightBias: 0.03 + r() * 0.12,
    jitterAmount: p.jitterAmount[0] + r() * p.jitterAmount[1],
    dashAggression: p.dashAggression[0] + r() * p.dashAggression[1],
    moodSwingRate: 4 + r() * 6,
    turniness: p.turniness[0] + r() * p.turniness[1],
    cutoffSkill: p.cutoffSkill[0] + r() * p.cutoffSkill[1],
    escapeSkill: p.escapeSkill[0] + r() * p.escapeSkill[1],
  };
  state.personalityTimer = 0;
}

// ── Raycast — uses spatial grid for O(1) collision per step ────────
// Generic version accepts a collision check function (works with both visual and sim grids)
function raycastGeneric(startX: number, startZ: number, dx: number, dz: number, maxRange: number, collisionCheck: (px: number, pz: number) => boolean): number {
  let d: number = 0.5;
  while (d <= maxRange) {
    const px: number = startX + dx * d;
    const pz: number = startZ + dz * d;
    if (isOutOfBounds(px, pz)) return d;
    if (collisionCheck(px, pz)) return d;
    if (d < 20) d += 0.5;
    else if (d < 50) d += 1.5;
    else d += 3;
  }
  return maxRange;
}

function raycast(startX: number, startZ: number, dx: number, dz: number, maxRange: number, _allTrails: TrailLike[], ownTrail: ITrail): number {
  if (_simGrid) {
    return raycastGeneric(startX, startZ, dx, dz, maxRange, (px, pz) => _simGrid!.checkCollision(px, pz, HIT_RADIUS, _simOwnTrailIdx, AI_SKIP_OWN));
  }
  return raycastGeneric(startX, startZ, dx, dz, maxRange, (px, pz) => grid.checkCollision(px, pz, HIT_RADIUS, ownTrail, AI_SKIP_OWN));
}

function nearestTrailDist(probeX: number, probeZ: number, radius: number, ownTrail: ITrail): number {
  return _simGrid
    ? _simGrid.nearestDist(probeX, probeZ, radius, _simOwnTrailIdx, AI_SKIP_OWN)
    : grid.nearestDist(probeX, probeZ, radius, ownTrail, AI_SKIP_OWN);
}

// ── Special Maneuvers — only when truly safe and far from player ──
export function tryStartManeuver(state: AIState, x: number, z: number, angle: number, clearDist: number, currentWallDist: number, playerDist: number, playerInfo: PlayerEstimate | null, _aggression: number): void {
  if (state.maneuver || state.maneuverCooldown > 0) return;
  // Much stricter safety: need lots of room to maneuver
  if (clearDist < 50 || currentWallDist < 50) return;

  const r = state.rng;
  const roll: number = r();

  const preset = DIFFICULTY_PRESETS[state.difficulty];

  // Only attack maneuvers when player is visible and in range
  if (roll < 0.06 && clearDist > 60 && currentWallDist > 60) {
    state.maneuver = { type: 'snake', timer: 0, duration: 1.0 + r() * 1.0, freq: 2.5 + r() * 2 };
  } else if (roll < 0.08 && clearDist > 60 && currentWallDist > 60) {
    state.maneuver = { type: 'swerve', timer: 0, duration: 0.4 + r() * 0.3, dir: r() < 0.5 ? 1 : -1 };
  } else if (roll < 0.12 && currentWallDist > 70 && clearDist > 80) {
    state.maneuver = { type: 'uturn', timer: 0, duration: 0.8, dir: r() < 0.5 ? 1 : -1 };
  } else if (preset.attackEnabled && roll < 0.12 + preset.attackBand && playerDist < 70 && playerDist > 20 && playerInfo) {
    state.maneuver = { type: 'attack', timer: 0, duration: preset.attackDuration[0] + r() * preset.attackDuration[1] };
  }

  if (state.maneuver) {
    state.maneuverCooldown = aiTuning.maneuverMinCd + r() * (aiTuning.maneuverMaxCd - aiTuning.maneuverMinCd);
  }
}

// ── Main AI Function ─────────────────────────────────────
// Orchestrator — delegates heavy lifting to phase helpers in aiPhases.ts.
// Must preserve exact tick-by-tick operation order (including PRNG calls) for determinism.
export function getAIInput(aiPlayer: AIPlayer, allTrails: TrailLike[], dt: number, state: AIState, targetTrail: TrailLike | null, ownTrail: ITrail): AIInput {
  if (!state.personality) resetPersonality(state);
  const preset: DifficultyPreset = DIFFICULTY_PRESETS[state.difficulty];
  state.personalityTimer += dt;
  if (state.personalityTimer > state.personality!.moodSwingRate * 10) resetPersonality(state);

  if (state.maneuverCooldown > 0) state.maneuverCooldown -= dt;

  const isCar: boolean = aiPlayer.vehicleType === 'car';
  const vCfg: AIVehicleConstants = isCar ? CAR_AI : BIKE_AI;
  const personality: AIPersonality = state.personality!;

  // Phase 1: perception — geometry, target scan, threat detection
  const presetLite: DifficultyPresetLite = preset; // structural subset — safe widening
  const vCfgLite: AIVehicleConstantsLite = vCfg;
  const rcFn: RaycastFn = raycast;
  const nearestFn: NearestTrailDistFn = nearestTrailDist;

  const perception = aiPerception({
    aiPlayer, allTrails, ownTrail, targetTrail, state,
    preset: presetLite, vCfg: vCfgLite, personality, raycast: rcFn,
  });
  const { x, z, angle, currentWallDist, straightAheadClear, playerInfo, playerDist } = perception;

  // Only attempt maneuvers when safe
  tryStartManeuver(state, x, z, angle, straightAheadClear, currentWallDist, playerDist, playerInfo, perception.aggression);

  // Maneuver override path — short-circuits scoring when a forced-turn maneuver is active
  const maneuverTurn: number | null = getManeuverTurnOverride(state, dt);
  if (maneuverTurn !== null) {
    const testAngle: number = angle + maneuverTurn * vCfg.turnSpeed * dt * 3;
    const testDx: number = -Math.sin(testAngle);
    const testDz: number = -Math.cos(testAngle);
    const testClear: number = raycast(x, z, testDx, testDz, perception.emergencyDist * 3, allTrails, ownTrail);
    const testWallDist: number = wallDistFromPoint(x + testDx * 10, z + testDz * 10);

    if (testClear > perception.emergencyDist * 1.5 && testWallDist > 15) {
      const accelerate: boolean = straightAheadClear > 50 && currentWallDist > 25;
      return { turn: maneuverTurn, accelerate, dash: false, brake: false };
    } else {
      // Maneuver would be dangerous — abort immediately
      state.maneuver = null;
    }
  }

  // Phase 2: trapped detection — 8-dir escape search
  const trap = aiTrapAnalysis(perception, allTrails, ownTrail, rcFn);
  const { isTrapped, maxClearAny, bestEscapeAngle, secondBestClear, secondBestAngle } = trap;

  if (isTrapped) {
    state.trappedTimer += dt;
  } else {
    state.trappedTimer = Math.max(0, state.trappedTimer - dt * 2); // decay instead of instant reset
  }

  // When trapped, use the scoring loop's best escape angle via proper angle diff
  if (isTrapped && state.trappedTimer < state.trappedSuicideAt) {
    // Pick escape target: prefer the angle we can actually turn to reach
    const diff1: number = normalizeAngle(bestEscapeAngle - angle);
    const diff2: number = normalizeAngle(secondBestAngle - angle);
    // If best angle requires turning almost 180°, try second best if it's closer
    const useAngle: number = (Math.abs(diff1) > Math.PI * 0.7 && secondBestClear > 12 && Math.abs(diff2) < Math.abs(diff1))
      ? secondBestAngle : bestEscapeAngle;
    const angleDiff: number = normalizeAngle(useAngle - angle);
    const turn: number = Math.max(-1, Math.min(1, angleDiff * 3));
    // More aggressive escape — dash if any meter available
    const wantDash: boolean = aiPlayer.meter > 10 && maxClearAny > 8 && personality.escapeSkill > 0.3;
    return { turn, accelerate: maxClearAny > 8, dash: wantDash, brake: false };
  }
  if (state.trappedTimer >= state.trappedSuicideAt) {
    return { turn: 0, accelerate: false, dash: false, brake: false };
  }

  // Phase 3: scoring loop — evaluate angle offsets and pick best
  const scoring = aiScoringLoop({
    perception, trap, state, personality, preset: presetLite,
    allTrails, ownTrail, aiPlayer, raycast: rcFn, nearestTrailDist: nearestFn,
  });
  const { bestOffset } = scoring;

  const turnPerFrame: number = vCfg.turnSpeed * dt;
  let turn: number = Math.max(-1, Math.min(1, bestOffset / Math.max(turnPerFrame, 0.01)));

  // Phase 8: fidget (subtle human-like jitter on turn) — only when safe
  turn = aiFidget(state, perception, scoring, turn, dt);

  // Phase 4: accelerate decision — committed bursts, no rapid tapping
  let accelerate: boolean = aiAccelDecision({ state, perception, scoring, turn, dt, aiPlayer });

  // Phase 5: slingshot drift FSM — only for car vehicles
  const driftResult = aiDriftDecision({ state, perception, scoring, trap, aiPlayer, dt, vCfg: vCfgLite, accelerate });
  const wantBrake: boolean = driftResult.wantBrake;
  accelerate = driftResult.accelerate;

  // Phase 6: dash decision — smarter triggers
  const wantDash: boolean = aiDashDecision({ state, perception, scoring, personality, preset: presetLite, turn, aiPlayer });

  // Phase 7: hoverboard grind AI — may override turn
  const grindResult = aiGrindDecision(aiPlayer, state, turn);
  const wantSpecial: boolean = grindResult.wantSpecial;
  turn = grindResult.turn;

  return { turn, accelerate, dash: wantDash, brake: wantBrake, special: wantSpecial || undefined };
}

// ── Sim-layer AI input ──────────────────────────────────
// Deterministic AI input for lockstep sim. Uses SimSpatialGrid instead of the
// visual global grid singleton. Wraps PlayerSim into IAIPlayer-compatible shape.

export function getAIInputSim(
  p: PlayerSim,
  vehicleType: VehicleType,
  simGrid: SimSpatialGrid,
  ownTrailIndex: number,
  allTrails: TrailPoint[][],
  dt: number,
  aiState: AIState,
  targetTrailIndex: number | null,
): AIInput {
  // Inject sim grid for the duration of this call
  _simGrid = simGrid;
  _simOwnTrailIdx = ownTrailIndex;

  // Wrap PlayerSim as IAIPlayer
  const fakePlayer: IAIPlayer = {
    getPosition: () => ({ x: p.x, z: p.z }),
    angle: p.angle,
    speed: p.speed,
    dashing: p.dashing,
    boosting: p.boosting,
    drifting: p.drifting,
    meter: p.meter,
    vehicleType,
    // Hoverboard grind state — exposed for grind AI decision logic
    grinding: p.grinding,
    grindBalance: p.grindBalance,
    grindCooldown: p.grindCooldown,
    grindDuration: p.grindDuration,
    airborne: p.airborne,
    recovery: p.recovery,
    grindSnapAvailable: p.grindSnapAvailable,
  };

  // Wrap TrailPoint[][] as ITrailLike[] and ITrail (only .points is read)
  const fakeTrails: ITrailLike[] = allTrails.map(pts => ({ points: pts }));
  const fakeOwnTrail = { points: allTrails[ownTrailIndex] || [] } as ITrail;
  const fakeTargetTrail: ITrailLike | null = targetTrailIndex !== null ? fakeTrails[targetTrailIndex] : null;

  try {
    return getAIInput(fakePlayer, fakeTrails, dt, aiState, fakeTargetTrail, fakeOwnTrail);
  } finally {
    // Always clear injection — prevent leaking into visual-layer calls
    _simGrid = null;
    _simOwnTrailIdx = -1;
  }
}
