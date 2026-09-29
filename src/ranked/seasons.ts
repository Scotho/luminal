// ── Season System ───────────────────────────────────────
// Season reset logic and constants.

import { DEFAULT_MMR } from './types';

/**
 * Soft MMR reset: pulls MMR 50% toward the default (1000).
 * Keeps high/low players closer to center for the new season.
 */
// ts-prune-ignore-next
export function softResetMmr(currentMmr: number): number {
  return Math.round((currentMmr + DEFAULT_MMR) / 2);
}

/**
 * Compute decay LP loss for Diamond+ inactivity.
 * @param daysSinceLastMatch - Days since last ranked match
 * @param gracePeriodDays - Days before decay starts (default 14)
 * @returns LP to subtract (0 if within grace period)
 */
// ts-prune-ignore-next
export function computeDecayLp(daysSinceLastMatch: number, gracePeriodDays: number = 14): number {
  if (daysSinceLastMatch <= gracePeriodDays) return 0;
  const decayDays = daysSinceLastMatch - gracePeriodDays;
  return decayDays * 25; // 25 LP per day
}

/** Check if a tier is subject to rank decay. */
// ts-prune-ignore-next
export function isDecayEligible(tier: string): boolean {
  return tier === 'diamond' || tier === 'master' || tier === 'luminal';
}

/** Days until decay starts for a player. */
// ts-prune-ignore-next
export function daysUntilDecay(lastMatchTimestamp: number, gracePeriodDays: number = 14): number {
  const daysSince = (Date.now() - lastMatchTimestamp) / (1000 * 60 * 60 * 24);
  return Math.max(0, gracePeriodDays - daysSince);
}
