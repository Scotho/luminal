// ── Hoverboard pose writers ───────────────────────────────
// Extracted from hoverboardAnimator.ts to keep the class file focused.
// Each pose mutates the target buffer in place — no allocation per frame.

import { getVehiclePhysics } from './vehicleConfig';

export interface AnimPose {
  innerY: number;
  innerRollZ: number;
  boardPitchX: number;
  boardRollZ: number;
  riderPitchX: number;
  riderRollZ: number;
  riderScaleY: number;
  riderOffsetY: number;
  /** Additional world-Y lift applied to the innerGroup — used to put the board on top of a trail wall during grinding. */
  grindLift: number;
}

/** Static key list — avoids per-frame Object.keys() allocation. */
export const POSE_KEYS: (keyof AnimPose)[] = [
  'innerY', 'innerRollZ', 'boardPitchX', 'boardRollZ',
  'riderPitchX', 'riderRollZ', 'riderScaleY', 'riderOffsetY',
  'grindLift',
];

export function defaultPose(): AnimPose {
  return {
    innerY: 0, innerRollZ: 0,
    boardPitchX: 0, boardRollZ: 0,
    riderPitchX: 0, riderRollZ: 0,
    riderScaleY: 1, riderOffsetY: 0,
    grindLift: 0,
  };
}

/** Lerp rates per property (higher = snappier). */
export const LERP_RATES: Record<keyof AnimPose, number> = {
  innerY: 8, innerRollZ: 6,
  boardPitchX: 6, boardRollZ: 8,
  riderPitchX: 5, riderRollZ: 7,
  riderScaleY: 4, riderOffsetY: 6,
  grindLift: 22, // snappy — pops the rider onto/off the wall in ~100ms
};

/** Height of a trail wall top (matches wallHeight in trail.ts). */
export const GRIND_WALL_TOP_Y = 2.68;

/** Transition durations (seconds). */
export const GRIND_ENTRY_DURATION = 0.2;
export const GRIND_EXIT_DURATION = 0.15;

/** Maximum lean angle, imported from vehicle config. */
const MAX_LEAN = getVehiclePhysics('hoverboard').maxLean;

// ── Pose writers (mutate target in-place to avoid per-frame allocation) ──

export function poseIdle(out: AnimPose, time: number): void {
  // Primary hover bob — two layered sines for organic float
  out.innerY = Math.sin(time * 0.004) * 0.07 + Math.sin(time * 0.0067) * 0.03;
  // Weight shifts side-to-side (surfer stance)
  out.innerRollZ = Math.sin(time * 0.002) * 0.04;
  // Board tilts subtly — never perfectly level (hover instability)
  out.boardPitchX = Math.sin(time * 0.003) * 0.025 + Math.sin(time * 0.0051) * 0.01;
  out.boardRollZ = Math.sin(time * 0.0025) * 0.03;
  // Rider compensates slightly opposite to board — natural balance reaction
  out.riderPitchX = Math.sin(time * 0.0018) * 0.02;
  out.riderRollZ = -Math.sin(time * 0.002) * 0.02;
  out.riderScaleY = 1;
  // Rider bobs with the board but slightly delayed (body mass lag)
  out.riderOffsetY = Math.sin(time * 0.004 + 0.3) * 0.012;
  out.grindLift = 0;
}

export function poseAccel(out: AnimPose, time: number): void {
  out.innerY = Math.sin(time * 0.005) * 0.025;
  out.innerRollZ = 0;
  // Aggressive forward lean — rider commits weight forward
  out.boardPitchX = -0.10;
  out.boardRollZ = 0;
  out.riderPitchX = -0.15;
  out.riderRollZ = 0;
  out.riderScaleY = 0.93;
  out.riderOffsetY = -0.03;
  out.grindLift = 0;
}

export function poseBoost(out: AnimPose, time: number): void {
  // Tighter vibration at high speed
  out.innerY = Math.sin(time * 0.008) * 0.015;
  out.innerRollZ = 0;
  // Deep tuck — rider crouches into wind
  out.boardPitchX = -0.18;
  out.boardRollZ = 0;
  out.riderPitchX = -0.30;
  out.riderRollZ = 0;
  out.riderScaleY = 0.82;
  out.riderOffsetY = -0.12;
  out.grindLift = 0;
}

export function poseTurn(out: AnimPose, turnRamp: number): void {
  out.innerY = 0;
  out.innerRollZ = -turnRamp * MAX_LEAN;
  out.boardPitchX = -Math.abs(turnRamp) * 0.03;
  out.boardRollZ = -turnRamp * 0.18;
  // Rider counter-leans slightly — like a real boarder shifting weight
  out.riderPitchX = 0;
  out.riderRollZ = -turnRamp * MAX_LEAN * 0.65;
  out.riderScaleY = 1;
  out.riderOffsetY = 0;
  out.grindLift = 0;
}

export function poseBoardGrab(out: AnimPose, turnRamp: number): void {
  out.innerY = -0.03;
  out.innerRollZ = -turnRamp * MAX_LEAN;
  out.boardPitchX = -0.07;
  out.boardRollZ = -turnRamp * 0.22;
  // Deep grab crouch — rider reaches down
  out.riderPitchX = -0.18;
  out.riderRollZ = -turnRamp * MAX_LEAN * 0.75;
  out.riderScaleY = 0.85;
  out.riderOffsetY = -0.10;
  out.grindLift = 0;
}

export function poseGrindEntry(out: AnimPose, progress: number, grindBalance: number): void {
  const popPhase = Math.min(1, progress * 2.5);   // Snappier pop-up
  const settlePhase = Math.max(0, (progress - 0.4) * (1 / 0.6));

  // Pop up, then settle into a committed low stance on the rail.
  out.innerY = popPhase * 0.22 - settlePhase * 0.26;
  out.innerRollZ = -grindBalance * MAX_LEAN * 1.35;
  // Board noses up on the pop, then levels out on the rail.
  out.boardPitchX = popPhase * 0.06 - settlePhase * 0.06;
  out.boardRollZ = -grindBalance * 0.14;
  // Rider shoulders forward as they dig in.
  out.riderPitchX = -settlePhase * 0.12;
  out.riderRollZ = -grindBalance * MAX_LEAN * 1.05;
  // Rider extends on pop, then compresses into deep grind crouch.
  out.riderScaleY = 1 + popPhase * 0.08 - settlePhase * 0.18;
  out.riderOffsetY = -settlePhase * 0.06;
  // Lift onto the top of the trail wall — rises with the pop so the board
  // clears the wall before committing to the rail height.
  out.grindLift = GRIND_WALL_TOP_Y * popPhase;
}

export function poseGrindRide(out: AnimPose, grindBalance: number): void {
  // Subtle alive idle — board never sits perfectly still on the rail.
  const micro = Math.sin(performance.now() * 0.009) * 0.008;
  out.innerY = -0.08 + micro;
  out.innerRollZ = -grindBalance * MAX_LEAN * 1.35;
  out.boardPitchX = -0.035;
  out.boardRollZ = -grindBalance * 0.14;
  // Committed low crouch, shoulders forward for balance.
  out.riderPitchX = -0.12;
  out.riderRollZ = -grindBalance * MAX_LEAN * 1.1;
  out.riderScaleY = 0.88;
  out.riderOffsetY = -0.06;
  out.grindLift = GRIND_WALL_TOP_Y;
}

export function poseGrindExit(out: AnimPose, progress: number, turnRamp: number): void {
  const pop = 1 - progress;
  out.innerY = pop * 0.14;
  out.innerRollZ = -turnRamp * MAX_LEAN * 1.4;
  out.boardPitchX = pop * -0.08;
  out.boardRollZ = pop * 0.06;
  // Rider springs up from crouch on release.
  out.riderPitchX = pop * 0.07;
  out.riderRollZ = -turnRamp * MAX_LEAN * 1.1;
  out.riderScaleY = 1 + pop * 0.08;
  out.riderOffsetY = pop * 0.05;
  // Fall off the wall smoothly over the exit transition.
  out.grindLift = GRIND_WALL_TOP_Y * pop;
}

export function poseAirborne(
  out: AnimPose,
  airborneTimer: number, airborneDuration: number, airbornePeak: number,
  turnRamp: number, time: number,
): void {
  const t = airborneDuration > 0 ? 1 - (airborneTimer / airborneDuration) : 0;
  const tClamped = Math.max(0, Math.min(1, t));

  out.innerY = airbornePeak * Math.sin(Math.PI * tClamped);
  out.innerRollZ = -turnRamp * MAX_LEAN * 1.5;
  out.boardPitchX = Math.sin(time * 0.008) * 0.03;
  out.boardRollZ = 0;
  out.riderPitchX = 0;
  out.riderRollZ = -turnRamp * MAX_LEAN * 1.3;
  out.riderScaleY = 1.05;
  out.riderOffsetY = 0.02;
  out.grindLift = 0;
}

export function poseRecovery(out: AnimPose, progress: number): void {
  const compression = 1 - progress;
  out.innerY = 0;
  out.innerRollZ = 0;
  out.boardPitchX = compression * 0.05;
  out.boardRollZ = 0;
  out.riderPitchX = compression * -0.1;
  out.riderRollZ = 0;
  out.riderScaleY = 0.80 + progress * 0.20;
  out.riderOffsetY = compression * -0.05;
  out.grindLift = 0;
}

export function poseBail(
  out: AnimPose,
  airborneTimer: number, airborneDuration: number, airbornePeak: number,
  time: number,
): void {
  const t = airborneDuration > 0 ? 1 - (airborneTimer / airborneDuration) : 0;
  const tClamped = Math.max(0, Math.min(1, t));

  out.innerY = airbornePeak * Math.sin(Math.PI * tClamped);
  // Full chaotic spin — board and rider tumble independently
  out.innerRollZ = Math.sin(time * 0.014) * Math.PI * 0.5;
  out.boardPitchX = Math.sin(time * 0.012) * 0.3;
  out.boardRollZ = Math.sin(time * 0.009) * 0.25;
  out.riderPitchX = Math.sin(time * 0.016) * 0.4;
  out.riderRollZ = Math.sin(time * 0.013) * 0.35;
  // Rider separates from board slightly during tumble
  out.riderScaleY = 1;
  out.riderOffsetY = Math.sin(time * 0.01) * 0.08;
  out.grindLift = 0;
}
