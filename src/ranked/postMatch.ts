// ── Post-Match Ranked Result ─────────────────────────────
// Reads updated rank data after a match and computes visible diff for UI.

import type { RankedData, RankInfo, Tier } from './types';

export interface RankedDiff {
  lpChange: number;
  mmrChange: number;
  promoted: boolean;
  demoted: boolean;
  tierChange: boolean;
  newTier?: Tier;
  placementComplete?: boolean;
  placementRank?: RankInfo;
  gamesPlayed: number;
}

/** Compare before/after ranked data to compute visible diff for animations. */
// ts-prune-ignore-next
export function compareRankedData(before: RankedData | null, after: RankedData | null): RankedDiff {
  if (!after) {
    return { lpChange: 0, mmrChange: 0, promoted: false, demoted: false, tierChange: false, gamesPlayed: 0 };
  }

  if (!before) {
    // First ranked game — show placement progress
    return {
      lpChange: 0,
      mmrChange: after.mmr - 1000,
      promoted: false,
      demoted: false,
      tierChange: false,
      placementComplete: after.placementComplete,
      placementRank: after.placementComplete ? after.rank : undefined,
      gamesPlayed: after.rankedGamesPlayed,
    };
  }

  const lpChange = after.rank.lp - before.rank.lp;
  const mmrChange = after.mmr - before.mmr;
  const tierChanged = before.rank.tier !== after.rank.tier;
  const divChanged = before.rank.division !== after.rank.division;
  const promoted = tierChanged
    ? tierIndex(after.rank.tier) > tierIndex(before.rank.tier)
    : divChanged && after.rank.division < before.rank.division;
  const demoted = tierChanged
    ? tierIndex(after.rank.tier) < tierIndex(before.rank.tier)
    : divChanged && after.rank.division > before.rank.division;

  return {
    lpChange: promoted ? (100 - before.rank.lp) + after.rank.lp : demoted ? -(before.rank.lp + (75 - after.rank.lp)) : lpChange,
    mmrChange,
    promoted,
    demoted,
    tierChange: tierChanged,
    newTier: tierChanged ? after.rank.tier : undefined,
    placementComplete: !before.placementComplete && after.placementComplete,
    placementRank: !before.placementComplete && after.placementComplete ? after.rank : undefined,
    gamesPlayed: after.rankedGamesPlayed,
  };
}

const TIERS_ORDER: Tier[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'luminal'];
function tierIndex(tier: Tier): number { return TIERS_ORDER.indexOf(tier); }
