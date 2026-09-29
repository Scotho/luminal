// AI maneuver tables + helpers extracted from ai.ts (TASK-245).
// Pure extraction — no tuning changes.
import type { AIState, AIManeuver } from './types/index';

export type AIManeuverType = AIManeuver['type'];

/** Per-maneuver timing / dynamics — kept alongside the enum they describe. */
export interface AIManeuverTiming {
  // Ranges are [base, jitter] — final = base + rng() * jitter
  snakeDuration: [number, number];
  snakeFreq: [number, number];
  swerveDuration: [number, number];
  uturnDuration: number;
  // attack duration comes from difficulty preset (varies per tier)
}

export const AI_MANEUVER_TIMING: AIManeuverTiming = {
  snakeDuration: [1.0, 1.0],
  snakeFreq: [2.5, 2.0],
  swerveDuration: [0.4, 0.3],
  uturnDuration: 0.8,
};

/** Compute the turn override for the currently-active maneuver, advancing its timer.
 *  Returns null if no maneuver, maneuver just expired, or maneuver is 'attack' (scoring loop drives it). */
export function getManeuverTurnOverride(state: AIState, dt: number): number | null {
  if (!state.maneuver) return null;
  state.maneuver.timer += dt;
  if (state.maneuver.timer >= state.maneuver.duration) {
    state.maneuver = null;
    return null;
  }

  const t: number = state.maneuver.timer / state.maneuver.duration;

  switch (state.maneuver.type) {
    case 'snake':
      return Math.sin(state.maneuver.timer * state.maneuver.freq! * Math.PI * 2) * 0.6;
    case 'swerve':
      return t < 0.5 ? state.maneuver.dir! * 0.8 : -state.maneuver.dir! * 0.5;
    case 'uturn':
      return state.maneuver.dir!;
    case 'attack':
      return null; // use scoring loop
    default:
      return null;
  }
}
