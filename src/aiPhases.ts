// ai.ts phase helpers — extracted from getAIInput to keep ai.ts under 700 LOC.
// TASK-245 pure extraction: code is moved as-is, same operation order, no tuning changes.
//
// Phases:
//   1. aiPerception       — geometry + target/threat scanning
//   2. aiTrapAnalysis     — 8-dir escape search for trapped detection
//   3. aiScoringLoop      — angle-offset evaluation
//   4. aiAccelDecision    — commit-based accelerate decision
//   5. aiDriftDecision    — car slingshot drift FSM
//   6. aiDashDecision     — dash trigger evaluation
//   7. aiGrindDecision    — hoverboard grind FSM + balance correction
import type {
  AIState,
  AIPersonality,
  IAIPlayer,
  ITrailLike,
  ITrail,
  TrailPoint,
} from './types/index';
import { getArenaRadius, getArenaCircular } from './core/simulation';

// ── Shared types (kept local to phases) ──────────────────

/** Difficulty preset shape — mirrors DIFFICULTY_PRESETS entries in ai.ts. */
export interface DifficultyPresetLite {
  lookaheadMult: number;
  emergencyMult: number;
  probeCount: number;
  probeStart: number;
  probeStep: number;
  c3Threshold: number;
  angleOffsets: number[];
  offenseScale: number;
  huntingPull: number;
  dashMeterThreshold: number;
  counterAttackMult: number;
  spaceDenialMult: number;
}

/** Minimal vehicle constants needed by phases (see AIVehicleConstants in ai.ts). */
export interface AIVehicleConstantsLite {
  turnSpeed: number;
  baseSpeed: number;
}

export interface PlayerEstimate {
  px: number;
  pz: number;
  hdx: number;
  hdz: number;
  turnRate: number;
  speed: number;
}

export interface MoodFactor {
  aggrMod: number;
  fearMod: number;
}

export interface EncircleInfo {
  encircled: boolean;
  gapAngle: number;
}

/** Everything the scoring loop + downstream decisions need. Built once per tick. */
export interface PerceptionState {
  x: number;
  z: number;
  angle: number;
  isCar: boolean;
  currentSpeed: number;
  maxRange: number;
  emergencyDist: number;
  mood: MoodFactor;
  aggression: number;
  wallFear: number;
  currentWallDist: number;
  fwdDx: number;
  fwdDz: number;
  straightAheadClear: number;
  playerInfo: PlayerEstimate | null;
  playerDist: number;
  playerApproaching: boolean;
  playerFacingUs: number;
  counterAttack: boolean;
  isAttackManeuver: boolean;
  encircle: EncircleInfo;
}

export interface TrapAnalysis {
  maxClearAny: number;
  bestEscapeAngle: number;
  secondBestClear: number;
  secondBestAngle: number;
  isTrapped: boolean;
  isUncomfortable: boolean;
}

export interface ScoringResult {
  bestOffset: number;
  bestScore: number;
  bestClearDist: number;
}

/** Signature of the raycast function — abstracted so phases don't reach into ai.ts internals. */
export type RaycastFn = (
  startX: number,
  startZ: number,
  dx: number,
  dz: number,
  maxRange: number,
  allTrails: ITrailLike[],
  ownTrail: ITrail,
) => number;

/** Signature of the nearest-trail-distance probe (grid vs simGrid indirection). */
export type NearestTrailDistFn = (
  probeX: number,
  probeZ: number,
  radius: number,
  ownTrail: ITrail,
) => number;

// ── Geometry helpers (copies from ai.ts — pure, no state) ──

export function wallDistFromPoint(x: number, z: number): number {
  if (getArenaCircular()) return getArenaRadius() - Math.sqrt(x * x + z * z);
  return Math.min(getArenaRadius() - 0.8 - Math.abs(x), getArenaRadius() - 0.8 - Math.abs(z));
}

export function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// ── Player estimation ────────────────────────────────────
export function estimatePlayer(playerTrail: ITrailLike): PlayerEstimate | null {
  const pts: TrailPoint[] = playerTrail.points;
  if (pts.length < 2) return null;
  const last: TrailPoint = pts[pts.length - 1];
  const prev: TrailPoint = pts[Math.max(0, pts.length - 4)];
  const hdx: number = last.x - prev.x;
  const hdz: number = last.z - prev.z;
  const len: number = Math.hypot(hdx, hdz);
  if (len < 0.01) return null;
  let turnRate: number = 0;
  if (pts.length >= 8) {
    const p1: TrailPoint = pts[Math.max(0, pts.length - 8)];
    const p2: TrailPoint = pts[Math.max(0, pts.length - 4)];
    const d1x: number = p2.x - p1.x, d1z: number = p2.z - p1.z;
    const d2x: number = last.x - p2.x, d2z: number = last.z - p2.z;
    const l1: number = Math.hypot(d1x, d1z), l2: number = Math.hypot(d2x, d2z);
    if (l1 > 0.01 && l2 > 0.01) {
      const cross: number = (d1x / l1) * (d2z / l2) - (d1z / l1) * (d2x / l2);
      turnRate = cross;
    }
  }
  return { px: last.x, pz: last.z, hdx: hdx / len, hdz: hdz / len, turnRate, speed: len };
}

// ── Offense scoring — capped to never overpower survival ──
export function computeOffense(
  aiX: number,
  aiZ: number,
  aiDx: number,
  aiDz: number,
  playerInfo: PlayerEstimate,
  aggression: number,
  cutoffSkill: number,
): number {
  const { px, pz, hdx, hdz, turnRate } = playerInfo;
  const projDist: number = 25 + aggression * 25;
  const turnAdj: number = turnRate * projDist * 0.3;
  const futX: number = px + hdx * projDist + (-hdz) * turnAdj;
  const futZ: number = pz + hdz * projDist + hdx * turnAdj;
  const toFutX: number = futX - aiX;
  const toFutZ: number = futZ - aiZ;
  const dist: number = Math.hypot(toFutX, toFutZ);
  let score: number = 0;

  // Head-on collision avoidance
  if (dist < 15 && dist > 0.01) {
    const dot: number = (aiDx * (px - aiX) + aiDz * (pz - aiZ)) / dist;
    if (dot > 0.5) score -= 25;
  }

  // Intercept bonus — head toward predicted position
  if (dist > 8 && dist < 80) {
    const normX: number = toFutX / dist;
    const normZ: number = toFutZ / dist;
    score += (aiDx * normX + aiDz * normZ) * 12 * aggression * cutoffSkill * (1 - dist / 80);
  }

  // Cut-off bonus — cross perpendicular to player's heading
  if (dist > 6 && dist < 50) {
    const perpX: number = -hdz, perpZ: number = hdx;
    const cutDot: number = Math.abs(aiDx * perpX + aiDz * perpZ);
    score += cutDot * 8 * aggression * cutoffSkill * (1 - dist / 50);
  }

  // Trail-laying strategy
  const toPx: number = px - aiX, toPz: number = pz - aiZ;
  const toPDist: number = Math.hypot(toPx, toPz);
  if (toPDist > 5 && toPDist < 60) {
    const toPlayerNx: number = toPx / toPDist, toPlayerNz: number = toPz / toPDist;
    const playerHeadingToward: number = hdx * (-toPlayerNx) + hdz * (-toPlayerNz);
    if (playerHeadingToward > 0.2) {
      const crossDot: number = Math.abs(aiDx * (-toPlayerNz) + aiDz * toPlayerNx);
      score += crossDot * 8 * aggression * cutoffSkill * playerHeadingToward * (1 - toPDist / 60);
    }
  }

  // Wall-pressure
  const playerWallDist: number = wallDistFromPoint(px, pz);
  if (playerWallDist < 40) {
    score += 5 * aggression * (1 - playerWallDist / 40);
    if (playerWallDist < 20) {
      score += 4 * aggression * cutoffSkill;
    }
  }

  // Hard cap: offense can never exceed this — survival always wins
  return Math.max(-50, Math.min(50, score));
}

// ── Encirclement detection ───────────────────────────────
export function detectEncirclement(aiX: number, aiZ: number, playerTrail: ITrailLike): EncircleInfo {
  const pts: TrailPoint[] = playerTrail.points;
  if (pts.length < 20) return { encircled: false, gapAngle: 0 };

  const sampleCount = 8;
  const step = Math.max(1, Math.floor(Math.min(pts.length, 80) / sampleCount));
  const startIdx = Math.max(0, pts.length - sampleCount * step);
  const angles: number[] = [];
  for (let i = startIdx; i < pts.length; i += step) {
    const dx = pts[i].x - aiX;
    const dz = pts[i].z - aiZ;
    if (Math.hypot(dx, dz) < 60) {
      angles.push(Math.atan2(dx, dz));
    }
  }
  if (angles.length < 4) return { encircled: false, gapAngle: 0 };

  angles.sort((a, b) => a - b);
  let maxGap = 0;
  let gapMid = 0;
  for (let i = 0; i < angles.length - 1; i++) {
    const gap = angles[i + 1] - angles[i];
    if (gap > maxGap) { maxGap = gap; gapMid = angles[i] + gap / 2; }
  }
  const wrapGap = (Math.PI * 2) - (angles[angles.length - 1] - angles[0]);
  if (wrapGap > maxGap) { maxGap = wrapGap; gapMid = angles[angles.length - 1] + wrapGap / 2; }

  const encircled = maxGap < Math.PI * 2 / 3;
  return { encircled, gapAngle: gapMid };
}

// ── Phase 1: perception ───────────────────────────────────
export interface PerceptionInputs {
  aiPlayer: IAIPlayer;
  allTrails: ITrailLike[];
  ownTrail: ITrail;
  targetTrail: ITrailLike | null;
  state: AIState;
  preset: DifficultyPresetLite;
  vCfg: AIVehicleConstantsLite;
  personality: AIPersonality;
  raycast: RaycastFn;
}

export function aiPerception(inp: PerceptionInputs): PerceptionState {
  const { aiPlayer, allTrails, ownTrail, targetTrail, state, preset, personality, raycast } = inp;

  const { x, z } = aiPlayer.getPosition();
  const angle: number = aiPlayer.angle;
  const isCar: boolean = aiPlayer.vehicleType === 'car';
  const currentSpeed: number = aiPlayer.speed;
  // Lookahead scales with speed — faster = need to see further ahead
  const maxRange: number = currentSpeed * preset.lookaheadMult;
  const emergencyDist: number = currentSpeed * preset.emergencyMult;

  const mood: MoodFactor = {
    aggrMod: Math.sin(state.personalityTimer * 0.4) * 0.15,
    fearMod: Math.sin(state.personalityTimer * 0.3 + 1.5) * 0.08,
  };
  const aggression: number = Math.max(0.1, Math.min(1.0, personality.aggression + mood.aggrMod));
  const wallFear: number = Math.max(0.5, personality.wallFear + mood.fearMod);

  const playerInfo: PlayerEstimate | null = targetTrail ? estimatePlayer(targetTrail) : null;
  const currentWallDist: number = wallDistFromPoint(x, z);

  let playerDist: number = Infinity;
  if (playerInfo) playerDist = Math.hypot(playerInfo.px - x, playerInfo.pz - z);

  // Detect player approaching
  let playerApproaching: boolean = false;
  let playerFacingUs: number = 0;
  if (playerInfo && playerDist < 60) {
    const toAiX: number = (x - playerInfo.px) / playerDist;
    const toAiZ: number = (z - playerInfo.pz) / playerDist;
    playerFacingUs = playerInfo.hdx * toAiX + playerInfo.hdz * toAiZ;
    playerApproaching = playerFacingUs > 0.3 && playerDist < 45;
  }

  // Counter-attack decision — consume RNG unconditionally to keep PRNG in sync across clients
  const counterRoll = state.rng();
  let counterAttack: boolean = false;
  if (playerApproaching) {
    const counterChance: number = (0.08 + aggression * 0.12 + (playerDist < 20 ? 0.15 : 0)) * preset.counterAttackMult;
    counterAttack = counterRoll < counterChance;
  }
  const isAttackManeuver: boolean = !!(state.maneuver && state.maneuver.type === 'attack');

  // Encirclement detection — does the player's trail wrap around us?
  const encircle: EncircleInfo = targetTrail
    ? detectEncirclement(x, z, targetTrail)
    : { encircled: false, gapAngle: 0 };

  const fwdDx: number = -Math.sin(angle), fwdDz: number = -Math.cos(angle);
  const straightAheadClear: number = raycast(x, z, fwdDx, fwdDz, maxRange, allTrails, ownTrail);

  return {
    x, z, angle, isCar, currentSpeed, maxRange, emergencyDist,
    mood, aggression, wallFear, currentWallDist,
    fwdDx, fwdDz, straightAheadClear,
    playerInfo, playerDist, playerApproaching, playerFacingUs,
    counterAttack, isAttackManeuver, encircle,
  };
}

// ── Phase 2: trapped detection (8-direction escape scan) ──
export function aiTrapAnalysis(
  perception: PerceptionState,
  allTrails: ITrailLike[],
  ownTrail: ITrail,
  raycast: RaycastFn,
): TrapAnalysis {
  const { x, z, angle } = perception;
  const trapCheckDirs: number = 8;
  let maxClearAny: number = 0;
  let bestEscapeAngle: number = angle;
  let secondBestClear: number = 0;
  let secondBestAngle: number = angle;
  for (let i = 0; i < trapCheckDirs; i++) {
    const a: number = (i / trapCheckDirs) * Math.PI * 2;
    const cdx: number = -Math.sin(a), cdz: number = -Math.cos(a);
    const cd: number = raycast(x, z, cdx, cdz, 50, allTrails, ownTrail);
    if (cd > maxClearAny) {
      secondBestClear = maxClearAny;
      secondBestAngle = bestEscapeAngle;
      maxClearAny = cd;
      bestEscapeAngle = a;
    } else if (cd > secondBestClear) {
      secondBestClear = cd;
      secondBestAngle = a;
    }
  }
  const isTrapped: boolean = maxClearAny < 30;
  const isUncomfortable: boolean = !isTrapped && maxClearAny < 50;
  return { maxClearAny, bestEscapeAngle, secondBestClear, secondBestAngle, isTrapped, isUncomfortable };
}

// ── Phase 3: angle-offset scoring loop ────────────────────
export interface ScoringInputs {
  perception: PerceptionState;
  trap: TrapAnalysis;
  state: AIState;
  personality: AIPersonality;
  preset: DifficultyPresetLite;
  allTrails: ITrailLike[];
  ownTrail: ITrail;
  aiPlayer: IAIPlayer;
  raycast: RaycastFn;
  nearestTrailDist: NearestTrailDistFn;
}

// Intermediate shape: results from the survival/space section of the per-offset scoring.
// Partial score + geometry reused by the tactics section.
interface SurvivalScore {
  score: number;
  clearDist: number;
  ax: number;
  az: number;
  perpDx: number;
  perpDz: number;
}

/** Sections A–C3 (survival + wall + open-space + multi-step) for one angle offset. */
function scoreSurvival(
  dx: number, dz: number, testAngle: number, inp: ScoringInputs,
): SurvivalScore {
  const { perception, trap, preset, allTrails, ownTrail, raycast, nearestTrailDist } = inp;
  const { x, z, currentSpeed, maxRange, emergencyDist, wallFear } = perception;
  const { isUncomfortable } = trap;

  // A: Survival — core raycast distance (most important signal)
  const clearDist: number = raycast(x, z, dx, dz, maxRange, allTrails, ownTrail);
  let score: number = clearDist * 1.5;
  if (clearDist < emergencyDist) score -= 800;
  if (clearDist < emergencyDist * 2.5) score -= 150 * (1 - clearDist / (emergencyDist * 2.5));

  // A2: Trail proximity — probe count from difficulty preset
  for (let probeI = 0; probeI < preset.probeCount; probeI++) {
    const probeD: number = Math.min(preset.probeStart + probeI * preset.probeStep, clearDist * 0.8);
    const probeX: number = x + dx * probeD, probeZ: number = z + dz * probeD;
    const tDist: number = nearestTrailDist(probeX, probeZ, 8, ownTrail);
    if (tDist < 4) score -= 60 * (1 - tDist / 4);
    else if (tDist < 8) score -= 20 * (1 - tDist / 8);
  }

  // B: Wall avoidance — much stronger, speed-scaled lookahead
  const nearProbe: number = Math.min(currentSpeed * 0.3, 15);
  const nearWall: number = wallDistFromPoint(x + dx * nearProbe, z + dz * nearProbe);
  if (nearWall < 40) {
    const ratio: number = 1 - nearWall / 40;
    score -= 80 * wallFear * ratio * ratio;
  }
  const midProbe: number = currentSpeed * 0.6;
  const midWall: number = wallDistFromPoint(x + dx * midProbe, z + dz * midProbe);
  if (midWall < 50) {
    score -= 60 * wallFear * (1 - midWall / 50);
  }
  const farProbe: number = currentSpeed * 1.0;
  const farWall: number = wallDistFromPoint(x + dx * farProbe, z + dz * farProbe);
  if (farWall < 60) {
    score -= 30 * wallFear * (1 - farWall / 60);
  }
  const immediateWall: number = wallDistFromPoint(x + dx * emergencyDist, z + dz * emergencyDist);
  if (immediateWall < 3) score -= 500;

  // C: Open space feelers — prefer routes with room to maneuver
  const ahead: number = Math.min(15, Math.max(2, clearDist * 0.3));
  const ax: number = x + dx * ahead;
  const az: number = z + dz * ahead;
  const perpDx: number = -Math.sin(testAngle + Math.PI / 2);
  const perpDz: number = -Math.cos(testAngle + Math.PI / 2);
  const leftClear: number = raycast(ax, az, perpDx, perpDz, 25, allTrails, ownTrail);
  const rightClear: number = raycast(ax, az, -perpDx, -perpDz, 25, allTrails, ownTrail);
  const openWeight: number = isUncomfortable ? 1.2 : 0.5;
  score += (leftClear + rightClear) * openWeight;
  if (leftClear < 5 && rightClear < 5) score -= 60;
  if (leftClear < 3 || rightClear < 3) score -= 25;

  // C2: Self-trap prevention — penalize directions that reduce our own reachable space
  if (clearDist > 10) {
    const futureOpenL: number = raycast(ax, az, perpDx, perpDz, 15, allTrails, ownTrail);
    const futureOpenR: number = raycast(ax, az, -perpDx, -perpDz, 15, allTrails, ownTrail);
    const futureOpen: number = futureOpenL + futureOpenR;
    if (futureOpen < 8) score -= 80;
    else if (futureOpen < 14) score -= 35;
  }

  // C3: Multi-step lookahead
  if (clearDist > preset.c3Threshold) {
    const lookDist: number = Math.min(clearDist * 0.6, currentSpeed * 1.5);
    const futX: number = x + dx * lookDist;
    const futZ: number = z + dz * lookDist;
    const futWall: number = wallDistFromPoint(futX, futZ);
    if (futWall > 2) {
      let futureSpace: number = 0;
      for (let fi = 0; fi < 4; fi++) {
        const fa: number = (fi / 4) * Math.PI * 2;
        futureSpace += raycast(futX, futZ, -Math.sin(fa), -Math.cos(fa), 30, allTrails, ownTrail);
      }
      if (futureSpace < 20) score -= 120;
      else if (futureSpace < 40) score -= 60;
      else score += futureSpace * 0.15;
    }
  }

  return { score, clearDist, ax, az, perpDx, perpDz };
}

/** Sections D–L (offense, hunting, defense, counter, center pull, space denial, encirclement). */
function scoreTactics(
  dx: number, dz: number, offset: number, weaveBias: number,
  survival: SurvivalScore, inp: ScoringInputs,
): number {
  const { perception, state, personality, preset, aiPlayer } = inp;
  const {
    x, z, isCar, emergencyDist, aggression, currentWallDist,
    playerInfo, playerDist, playerApproaching, playerFacingUs,
    counterAttack, isAttackManeuver, encircle,
  } = perception;
  const { clearDist } = survival;
  let score: number = survival.score;

  // D: Offense — gated behind strong safety factor
  const safetyFactor: number = Math.max(0, Math.min(1, (clearDist - emergencyDist * 1.5) / (emergencyDist * 2.5)));
  const wallSafety: number = Math.max(0, Math.min(1, (currentWallDist - 15) / 40));
  const combinedSafety: number = safetyFactor * wallSafety;
  if (combinedSafety > 0.1 && playerInfo) {
    const offenseMult: number = isAttackManeuver ? 1.3 : 1.0;
    score += combinedSafety * computeOffense(x, z, dx, dz, playerInfo, aggression, personality.cutoffSkill) * offenseMult * preset.offenseScale;
  }

  // E: Straight preference + subtle organic weave
  const straightMult: number = (isCar && aiPlayer.drifting) ? 0.1 : 0.5;
  score += personality.straightBias * (1 - Math.abs(offset) / 1.4) * straightMult;
  score += (1 - Math.abs(offset - weaveBias) / 1.6) * personality.turniness * 1.0;

  // F: Random jitter
  if (clearDist > emergencyDist * 2 && currentWallDist > 20) {
    score += (state.rng() - 0.5) * personality.jitterAmount * 8;
  }

  // G: Proximity hunting
  if (playerInfo && playerDist < 70 && combinedSafety > 0.3) {
    const toPlayerX: number = (playerInfo.px - x) / playerDist;
    const toPlayerZ: number = (playerInfo.pz - z) / playerDist;
    const dot: number = dx * toPlayerX + dz * toPlayerZ;
    const huntRange: number = 70;
    const huntMult: number = encircle.encircled ? 2.0 : 1.0;
    score += dot * 14 * aggression * (1 - playerDist / huntRange) * combinedSafety * huntMult * preset.huntingPull;

    if (playerDist < 40) {
      const cutDot: number = Math.abs(dx * (-playerInfo.hdz) + dz * playerInfo.hdx);
      score += cutDot * 12 * aggression * personality.cutoffSkill * (1 - playerDist / 40) * combinedSafety * preset.huntingPull;
    }

    if (playerDist < 50 && personality.cutoffSkill > 0.5) {
      const predDist: number = Math.min(playerDist * 0.7, 25);
      const predX: number = playerInfo.px + playerInfo.hdx * predDist;
      const predZ: number = playerInfo.pz + playerInfo.hdz * predDist;
      const toPredX: number = predX - x, toPredZ: number = predZ - z;
      const toPredDist: number = Math.hypot(toPredX, toPredZ);
      if (toPredDist > 1) {
        score += (dx * toPredX / toPredDist + dz * toPredZ / toPredDist) * 7 * aggression * personality.cutoffSkill * combinedSafety * preset.huntingPull;
      }
    }
  }

  // H: Defensive evasion
  if (playerApproaching && playerInfo && !counterAttack && !isAttackManeuver) {
    const toPlayerX: number = (playerInfo.px - x) / playerDist;
    const toPlayerZ: number = (playerInfo.pz - z) / playerDist;
    const facingPlayer: number = dx * toPlayerX + dz * toPlayerZ;
    const urgency: number = playerFacingUs * (1 - playerDist / 45);
    score -= facingPlayer * 20 * urgency;
    const perpDotDef: number = Math.abs(dx * (-toPlayerZ) + dz * toPlayerX);
    score += perpDotDef * 12 * urgency;
    if (perpDotDef > 0.5) {
      const dodgeWall: number = wallDistFromPoint(x + dx * 15, z + dz * 15);
      if (dodgeWall > 20) score += 5 * urgency;
    }
  }

  // I: Counter-attack
  if (counterAttack && playerInfo && combinedSafety > 0.3) {
    const cutX: number = -playerInfo.hdz;
    const cutZ: number = playerInfo.hdx;
    const cutDot: number = dx * cutX + dz * cutZ;
    score += Math.abs(cutDot) * 20 * personality.cutoffSkill * combinedSafety;
  }

  // J: Prefer turning toward center
  if (currentWallDist < 80) {
    const toCenterX: number = -x / getArenaRadius();
    const toCenterZ: number = -z / getArenaRadius();
    const centerDot: number = dx * toCenterX + dz * toCenterZ;
    const wallPressure: number = 1 - currentWallDist / 80;
    score += centerDot * 20 * wallPressure * wallPressure;
  }

  // K: Space denial
  if (playerInfo && combinedSafety > 0.4 && aggression > 0.6) {
    const pWallDistX: number = getArenaRadius() - 0.8 - Math.abs(playerInfo.px);
    const pWallDistZ: number = getArenaRadius() - 0.8 - Math.abs(playerInfo.pz);
    if (pWallDistX < 30 || pWallDistZ < 30) {
      const playerToWallX: number = playerInfo.px > 0 ? 1 : -1;
      const playerToWallZ: number = playerInfo.pz > 0 ? 1 : -1;
      const betweenX: number = (playerInfo.px + playerToWallX * Math.min(pWallDistX, pWallDistZ) * 0.5) - x;
      const betweenZ: number = (playerInfo.pz + playerToWallZ * Math.min(pWallDistX, pWallDistZ) * 0.5) - z;
      const bDist: number = Math.hypot(betweenX, betweenZ);
      if (bDist > 1) {
        score += (dx * betweenX / bDist + dz * betweenZ / bDist) * 5 * aggression * combinedSafety * preset.spaceDenialMult;
      }
    }
  }

  // L: Encirclement escape
  if (encircle.encircled) {
    const gapDx: number = -Math.sin(encircle.gapAngle);
    const gapDz: number = -Math.cos(encircle.gapAngle);
    const gapDot: number = dx * gapDx + dz * gapDz;
    score += gapDot * 80;
  }

  return score;
}

export function aiScoringLoop(inp: ScoringInputs): ScoringResult {
  const { perception, state, personality, preset } = inp;
  const { angle } = perception;

  let bestOffset: number = 0;
  let bestScore: number = -Infinity;
  let bestClearDist: number = 0;

  const weaveBias: number = Math.sin(state.personalityTimer * 0.7) * personality.turniness * 0.15;

  for (const offset of preset.angleOffsets) {
    const testAngle: number = angle + offset;
    const dx: number = -Math.sin(testAngle);
    const dz: number = -Math.cos(testAngle);

    const survival = scoreSurvival(dx, dz, testAngle, inp);
    const score = scoreTactics(dx, dz, offset, weaveBias, survival, inp);

    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
      bestClearDist = survival.clearDist;
    }
  }

  return { bestOffset, bestScore, bestClearDist };
}

// ── Phase 4: accelerate decision (commit/cooldown bursts) ──
export interface AccelDecisionInputs {
  state: AIState;
  perception: PerceptionState;
  scoring: ScoringResult;
  turn: number;
  dt: number;
  aiPlayer: IAIPlayer;
}

export function aiAccelDecision(inp: AccelDecisionInputs): boolean {
  const { state, perception, scoring, turn, dt, aiPlayer } = inp;
  const { playerInfo, playerDist, currentWallDist, aggression, isCar } = perception;
  const { bestClearDist } = scoring;

  // Tick down timers
  if (state.accelCommit > 0) state.accelCommit -= dt;
  if (state.accelCooldown > 0) state.accelCooldown -= dt;

  const wantAccel: boolean = (bestClearDist > 50 && currentWallDist > 30 && Math.abs(turn) <= 0.6)
    || (playerInfo && playerDist < 50 && playerDist > 20 && bestClearDist > 40 && currentWallDist > 25 && aggression > 0.5 && Math.abs(turn) <= 0.5) as boolean;

  let accelerate: boolean;
  if (state.accelCommit > 0) {
    accelerate = bestClearDist > 20 && currentWallDist > 12;
    if (!accelerate) { state.accelCommit = 0; state.accelCooldown = 0.4 + state.rng() * 0.4; }
  } else if (wantAccel && state.accelCooldown <= 0) {
    accelerate = true;
    state.accelCommit = 0.8 + state.rng() * 1.2;
  } else {
    accelerate = false;
  }

  // Cars: always accelerate unless emergency (cars decelerate hard when coasting)
  if (isCar) {
    if (aiPlayer.drifting) {
      accelerate = true;
    } else if (bestClearDist > 15 && currentWallDist > 8) {
      accelerate = true;
    }
  }

  return accelerate;
}

// ── Phase 5: slingshot drift FSM (car only) ───────────────
export interface DriftDecisionInputs {
  state: AIState;
  perception: PerceptionState;
  scoring: ScoringResult;
  trap: TrapAnalysis;
  aiPlayer: IAIPlayer;
  dt: number;
  vCfg: AIVehicleConstantsLite;
  accelerate: boolean;
}

export interface DriftDecisionResult {
  wantBrake: boolean;
  accelerate: boolean;
}

export function aiDriftDecision(inp: DriftDecisionInputs): DriftDecisionResult {
  const { state, perception, scoring, trap, aiPlayer, dt, vCfg } = inp;
  let accelerate = inp.accelerate;
  let wantBrake: boolean = false;

  if (!perception.isCar) return { wantBrake, accelerate };

  const { emergencyDist, currentSpeed, currentWallDist } = perception;
  const { bestOffset, bestClearDist } = scoring;
  const { isTrapped } = trap;

  if (state.driftCommit > 0) state.driftCommit -= dt;
  if (state.driftCooldown > 0) state.driftCooldown -= dt;

  const isTurning: boolean = Math.abs(bestOffset) > 0.15;
  const meterLow: boolean = aiPlayer.meter < 60;
  const hasRoom: boolean = bestClearDist > 20 && currentWallDist > 12;

  if (aiPlayer.drifting) {
    const shouldKeepDrifting: boolean =
      (Math.abs(bestOffset) > 0.1 && bestClearDist > 10) ||
      (aiPlayer.meter < 80 && bestClearDist > 15) ||
      (state.driftCommit > 0 && bestClearDist > 10);

    if (shouldKeepDrifting) {
      wantBrake = true;
      state.driftExitTimer = 0;
    } else {
      wantBrake = false;
      accelerate = true;
      state.driftExitTimer += dt;
    }
  } else if (state.driftCooldown <= 0 && hasRoom && !isTrapped) {
    const shouldStartDrift: boolean =
      (isTurning && bestClearDist > 20) ||
      (meterLow && bestClearDist > 25 && currentWallDist > 15) ||
      (currentSpeed > vCfg.baseSpeed && Math.abs(bestOffset) > 0.1 && bestClearDist > 20) ||
      (bestClearDist > 30 && currentWallDist < 40);

    if (shouldStartDrift) {
      wantBrake = true;
      accelerate = true;
      state.driftCommit = 0.4 + state.rng() * 0.8;
      state.driftExitTimer = 0;
    }
  }

  if (state.driftCommit > 0 && aiPlayer.drifting) {
    wantBrake = true;
  }

  if (bestClearDist < emergencyDist * 1.2 || currentWallDist < 6) {
    wantBrake = false;
    state.driftCommit = 0;
  }

  if (!aiPlayer.drifting && state.driftExitTimer > 0 && state.driftExitTimer < 0.15) {
    state.driftCooldown = 0.3 + state.rng() * 0.5;
  }

  return { wantBrake, accelerate };
}

// ── Phase 6: dash decision ───────────────────────────────
export interface DashDecisionInputs {
  state: AIState;
  perception: PerceptionState;
  scoring: ScoringResult;
  personality: AIPersonality;
  preset: DifficultyPresetLite;
  turn: number;
  aiPlayer: IAIPlayer;
}

export function aiDashDecision(inp: DashDecisionInputs): boolean {
  const { state, perception, scoring, personality, preset, turn, aiPlayer } = inp;
  const { x, z, playerInfo, playerDist, currentWallDist, aggression, isAttackManeuver, isCar, fwdDx, fwdDz, encircle } = perception;
  const { bestClearDist } = scoring;

  const hasMeter: boolean = aiPlayer.meter > preset.dashMeterThreshold;
  const clearRoad: boolean = bestClearDist > 50 && Math.abs(turn) <= 0.4 && currentWallDist > 30;
  let wantDash: boolean = false;

  if (hasMeter && clearRoad) {
    // Dash toward player when facing them and path is clear
    if (playerInfo && playerDist < 55 && playerDist > 12 && aggression > 0.4) {
      const toPlayerX: number = (playerInfo.px - x) / playerDist;
      const toPlayerZ: number = (playerInfo.pz - z) / playerDist;
      const facingPlayer: number = (fwdDx * toPlayerX + fwdDz * toPlayerZ);
      if (facingPlayer > 0.5) wantDash = true;
    }
    // Attack maneuver dash — only if still safe
    if (isAttackManeuver && playerDist < 45 && bestClearDist > 60) wantDash = true;
    // Dash to cut off player at close range
    if (playerInfo && playerDist < 25 && aggression > 0.7 && personality.cutoffSkill > 0.7 && bestClearDist > 50) {
      const cutDot: number = Math.abs(fwdDx * (-playerInfo.hdz) + fwdDz * playerInfo.hdx);
      if (cutDot > 0.5) wantDash = true;
    }
    // Slingshot dash combo: dash right after exiting drift for max speed
    if (isCar && !aiPlayer.drifting && state.driftExitTimer > 0 && state.driftExitTimer < 0.8 && aiPlayer.meter > 15) {
      wantDash = true;
    }
  }

  // Emergency encirclement dash — break through the gap even if road isn't perfectly clear
  if (encircle.encircled && hasMeter && bestClearDist > 20) {
    wantDash = true;
  }

  return wantDash;
}

// ── Phase 7: hoverboard grind FSM ─────────────────────────
// TASK-267: difficulty tuning drives how aggressively the AI engages grinds.
// `opportunisticMeter` — meter threshold BELOW which the AI will engage a
// grind any time one is available (reactive, refill play).
// `seekMeter` — meter threshold BELOW which the AI engages even if it has
// to commit bigger (proactive, offensive grind hunting). Hard sits just
// under full meter, so hard AI grinds almost every opportunity.
interface AIGrindTuning {
  opportunisticMeter: number;
  seekMeter: number;
  correctionStrength: number;
  correctionDelay: number;
  exitMeterTarget: number;
  dangerExitTime: number;
}

const GRIND_AI_EASY: AIGrindTuning = {
  opportunisticMeter: 35,
  seekMeter: 45,
  correctionStrength: 0.6,
  correctionDelay: 0.3,
  exitMeterTarget: 70,
  dangerExitTime: 0.3,
};

const GRIND_AI_MEDIUM: AIGrindTuning = {
  opportunisticMeter: 60,
  seekMeter: 78,
  correctionStrength: 0.82,
  correctionDelay: 0.15,
  exitMeterTarget: 90,
  dangerExitTime: 0.55,
};

const GRIND_AI_HARD: AIGrindTuning = {
  opportunisticMeter: 85,
  seekMeter: 97,
  correctionStrength: 0.97,
  correctionDelay: 0.05,
  exitMeterTarget: 98,
  dangerExitTime: 0.9,
};

export interface GrindDecisionResult {
  wantSpecial: boolean;
  turn: number;
}

export function aiGrindDecision(
  aiPlayer: IAIPlayer,
  state: AIState,
  initialTurn: number,
): GrindDecisionResult {
  let turn = initialTurn;
  let wantSpecial: boolean = false;

  if (aiPlayer.vehicleType !== 'hoverboard') return { wantSpecial, turn };

  const grindTuning: AIGrindTuning =
    state.difficulty === 'hard' ? GRIND_AI_HARD
    : state.difficulty === 'medium' ? GRIND_AI_MEDIUM
    : GRIND_AI_EASY;

  const isGrinding: boolean = aiPlayer.grinding === true;
  const isAirborne: boolean = aiPlayer.airborne === true;
  const isRecovery: boolean = aiPlayer.recovery === true;
  const grindCooldown: number = aiPlayer.grindCooldown ?? 0;
  const grindBalance: number = aiPlayer.grindBalance ?? 0;
  const grindDuration: number = aiPlayer.grindDuration ?? 0;
  // Pre-grind availability set by the sim each tick — true when a grindable
  // rail is within snap range AND the AI has the meter to afford entry.
  // Undefined for callers that don't plumb it (legacy path) — falls back to
  // the meter-only gate in that case.
  const snap: boolean | undefined = aiPlayer.grindSnapAvailable;

  if (!isGrinding && !isAirborne && !isRecovery && grindCooldown <= 0) {
    const meter = aiPlayer.meter;
    if (snap === true) {
      // Snap-aware path: engage whenever an actual rail is in reach and the
      // AI's meter is under its seek threshold. Hard AI seeks constantly.
      if (meter < grindTuning.seekMeter) {
        wantSpecial = true;
      }
    } else if (snap === undefined) {
      // Legacy gate — used by paths where grindSnapAvailable isn't plumbed
      // through yet. Preserves pre-TASK-267 behaviour.
      if (meter < grindTuning.opportunisticMeter) {
        wantSpecial = true;
      }
    }
  }

  if (isGrinding) {
    wantSpecial = true;

    if (Math.abs(grindBalance) > 0.1) {
      const correctionDir: number = grindBalance > 0 ? -1 : 1;
      turn = correctionDir * grindTuning.correctionStrength;
    }

    const balanceDanger: boolean =
      Math.abs(grindBalance) > 0.7 && grindDuration > grindTuning.dangerExitTime;
    const meterSatisfied: boolean = aiPlayer.meter > grindTuning.exitMeterTarget;
    if (meterSatisfied || balanceDanger) {
      wantSpecial = false;
    }
  }

  return { wantSpecial, turn };
}

// ── Phase 8: fidget (subtle human-like jitter on turn) ────
export function aiFidget(state: AIState, perception: PerceptionState, scoring: ScoringResult, turn: number, dt: number): number {
  const { emergencyDist, currentWallDist } = perception;
  const { bestClearDist } = scoring;

  state.fidgetTimer -= dt;
  if (state.fidgetTimer <= 0) {
    // Pre-roll all values unconditionally to keep PRNG in sync across clients
    const fidgetRoll = state.rng();
    const fidgetValue = (state.rng() - 0.5) * 0.15;
    const fidgetDuration = 0.05 + state.rng() * 0.08;
    if (fidgetRoll < 0.2 && bestClearDist > emergencyDist * 3 && currentWallDist > 30) {
      state.fidgetValue = fidgetValue;
      state.fidgetDuration = fidgetDuration;
    } else {
      state.fidgetValue = 0;
      state.fidgetDuration = 0;
    }
    state.fidgetTimer = 0.5 + state.rng() * 1.0;
  }
  if (state.fidgetDuration > 0) {
    turn = Math.max(-1, Math.min(1, turn + state.fidgetValue));
    state.fidgetDuration -= dt;
  }
  return turn;
}
