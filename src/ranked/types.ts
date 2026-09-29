// ── Ranked System Types ─────────────────────────────────

export const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'luminal'] as const;
export type Tier = typeof TIERS[number];

export type Division = 1 | 2 | 3 | 4;

export interface RankInfo {
  tier: Tier;
  division: Division;
  lp: number;
}

export interface RankedData {
  mmr: number;
  rank: RankInfo;
  placementGamesPlayed: number;
  placementComplete: boolean;
  rankedWins: number;
  rankedLosses: number;
  rankedGamesPlayed: number;
  lastRankedMatch: number;
  demotionShield: boolean;
  seasonId: number;
}

export const DEFAULT_MMR = 1000;
export const PLACEMENT_MATCHES = 5;
