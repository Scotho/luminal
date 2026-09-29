// ── Rank Tiers & LP Calculation ──────────────────────────
// Pure module — no Firebase dependencies.

import type { Tier, Division, RankInfo } from './types';
import { TIERS } from './types';

// ── Tier Configuration ──────────────────────────────────

export const TIER_MMR_RANGES: Record<Tier, { min: number; max: number }> = {
  bronze:   { min: 0,    max: 799  },
  silver:   { min: 800,  max: 1199 },
  gold:     { min: 1200, max: 1599 },
  platinum: { min: 1600, max: 1999 },
  diamond:  { min: 2000, max: 2399 },
  master:   { min: 2400, max: Infinity },
  luminal:  { min: 2400, max: Infinity }, // same as master — distinguished by LP rank
};

// ts-prune-ignore-next
export const TIER_COLORS: Record<Tier, string> = {
  bronze:   '#CD7F32',
  silver:   '#C0C0C0',
  gold:     '#FFD700',
  platinum: '#00CED1',
  diamond:  '#B9F2FF',
  master:   '#9B59B6',
  luminal:  '#FF00FF',
};

// ts-prune-ignore-next
export const DIVISIONS: readonly Division[] = [4, 3, 2, 1] as const;

// ── Rank Queries ────────────────────────────────────────

/** Map MMR to initial rank after placement. Max placement = Platinum IV. */
// ts-prune-ignore-next
export function getRankFromMmr(mmr: number): RankInfo {
  if (mmr >= 1600) return { tier: 'platinum', division: 4, lp: 50 };
  if (mmr >= 1400) return { tier: 'gold', division: 2, lp: 50 };
  if (mmr >= 1200) return { tier: 'gold', division: 4, lp: 50 };
  if (mmr >= 1000) return { tier: 'silver', division: 3, lp: 50 };
  if (mmr >= 800)  return { tier: 'silver', division: 4, lp: 50 };
  if (mmr >= 600)  return { tier: 'bronze', division: 1, lp: 50 };
  if (mmr >= 400)  return { tier: 'bronze', division: 2, lp: 50 };
  if (mmr >= 200)  return { tier: 'bronze', division: 3, lp: 50 };
  return { tier: 'bronze', division: 4, lp: 50 };
}

/** Get the midpoint MMR value for a given tier+division. */
export function getRankMidpointMmr(tier: Tier, division: Division): number {
  const range = TIER_MMR_RANGES[tier];
  if (tier === 'master' || tier === 'luminal') return 2600;

  const tierSpan = range.max - range.min + 1; // e.g., 800 for bronze
  const divisionSpan = tierSpan / 4;
  // Division 4 is lowest, 1 is highest
  const divIndex = 4 - division; // 0 for div4, 3 for div1
  return Math.round(range.min + divisionSpan * divIndex + divisionSpan / 2);
}

/**
 * Calculate LP change for a win or loss.
 * Base = 25, adjusted by how hidden MMR compares to rank midpoint.
 * Range: 15-35 LP.
 */
// ts-prune-ignore-next
export function calculateLpChange(
  hiddenMmr: number,
  tier: Tier,
  division: Division,
  isWin: boolean,
): number {
  const midpoint = getRankMidpointMmr(tier, division);
  const mmrDelta = hiddenMmr - midpoint;
  const adjustment = Math.max(-10, Math.min(10, Math.round(mmrDelta / 20)));

  if (isWin) {
    return 25 + adjustment; // 15-35
  }
  return 25 - adjustment; // inverted: higher MMR = lose less
}

/** Human-readable rank name. */
// ts-prune-ignore-next
export function getTierDisplayName(tier: Tier, division: Division): string {
  const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
  if (tier === 'master' || tier === 'luminal') return tierName;
  const divNames: Record<Division, string> = { 4: 'IV', 3: 'III', 2: 'II', 1: 'I' };
  return `${tierName} ${divNames[division]}`;
}

/** Compact rank string for HUD. */
// ts-prune-ignore-next
export function getRankCompact(tier: Tier, division: Division, lp: number): string {
  const t = tier.charAt(0).toUpperCase();
  if (tier === 'master' || tier === 'luminal') return `${t} ${lp}LP`;
  return `${t}${division} ${lp}LP`;
}

/** Get tier index (0 = bronze, 6 = luminal). */
export function getTierIndex(tier: Tier): number {
  return TIERS.indexOf(tier);
}

/** Check if tier has divisions (master and luminal do not). */
export function hasDivisions(tier: Tier): boolean {
  return tier !== 'master' && tier !== 'luminal';
}
