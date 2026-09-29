/**
 * SPEC-89: Streak-to-FLOW multiplier mapping.
 *
 * Existing streak tiers (3/5/10/20) map to FLOW multipliers.
 * The 20-streak tier is absorbed into the 10x bucket.
 */

export interface FlowMultiplierResult {
  tier: 0 | 1 | 2 | 3;
  multiplier: number;
}

const TIERS: readonly FlowMultiplierResult[] = [
  { tier: 0, multiplier: 1 },
  { tier: 1, multiplier: 3 },
  { tier: 2, multiplier: 5 },
  { tier: 3, multiplier: 10 },
];

export function getFlowMultiplier(matchStreak: number): FlowMultiplierResult {
  if (matchStreak >= 10) return TIERS[3];
  if (matchStreak >= 5) return TIERS[2];
  if (matchStreak >= 3) return TIERS[1];
  return TIERS[0];
}

/** Labels for the round-end reveal UI */
export const FLOW_MULTIPLIER_LABELS: Record<number, string> = {
  0: '1+ STREAK',
  1: '3+ STREAK',
  2: '5+ STREAK',
  3: '10+ STREAK',
};
