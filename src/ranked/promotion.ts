// ── Promotion / Demotion Logic ───────────────────────────
// State machine for LP changes, promotions, and demotions.

import type { Tier, Division, RankInfo } from './types';
import { TIERS } from './types';
import { TIER_MMR_RANGES, getTierIndex, hasDivisions } from './ranks';

export interface LpChangeResult {
  newRank: RankInfo;
  promoted: boolean;
  demoted: boolean;
  newDemotionShield: boolean;
  tierChange: boolean;
}

/**
 * Apply an LP change to a rank and handle promotion/demotion.
 *
 * @param currentRank - Current tier, division, LP
 * @param lpDelta - Positive for win, negative for loss
 * @param mmr - Hidden MMR (used for tier demotion check)
 * @param demotionShield - Whether player has a demotion shield
 */
// ts-prune-ignore-next
export function applyLpChange(
  currentRank: RankInfo,
  lpDelta: number,
  mmr: number,
  demotionShield: boolean,
): LpChangeResult {
  const { tier, division, lp } = currentRank;

  // Master/Luminal: unbounded LP, no divisions
  if (!hasDivisions(tier)) {
    const newLp = Math.max(0, lp + lpDelta);
    return {
      newRank: { tier, division: 1 as Division, lp: newLp },
      promoted: false,
      demoted: false,
      newDemotionShield: false,
      tierChange: false,
    };
  }

  const newLp = lp + lpDelta;

  // ── Promotion ─────────────────────────────────────────
  if (newLp >= 100) {
    const carryLp = newLp - 100;
    const promoted = promoteRank(tier, division);
    return {
      newRank: { ...promoted, lp: Math.min(carryLp, 99) },
      promoted: true,
      demoted: false,
      newDemotionShield: true, // grant shield in new division
      tierChange: promoted.tier !== tier,
    };
  }

  // ── Demotion ──────────────────────────────────────────
  if (newLp < 0) {
    // At floor (Bronze IV): clamp to 0
    if (tier === 'bronze' && division === 4) {
      return {
        newRank: { tier: 'bronze', division: 4, lp: 0 },
        promoted: false,
        demoted: false,
        newDemotionShield: demotionShield,
        tierChange: false,
      };
    }

    // Demotion shield absorbs the loss
    if (demotionShield) {
      return {
        newRank: { tier, division, lp: 0 },
        promoted: false,
        demoted: false,
        newDemotionShield: false, // shield consumed
        tierChange: false,
      };
    }

    // Tier demotion check: only demote tier if MMR is below tier floor
    if (division === 4) {
      const tierFloor = TIER_MMR_RANGES[tier].min;
      if (mmr >= tierFloor) {
        // MMR is still in-tier: stay at 0 LP, grant shield
        return {
          newRank: { tier, division: 4, lp: 0 },
          promoted: false,
          demoted: false,
          newDemotionShield: true,
          tierChange: false,
        };
      }
      // MMR below tier floor: demote to previous tier's division 1
      const demoted = demoteRank(tier, division);
      return {
        newRank: { ...demoted, lp: 75 },
        promoted: false,
        demoted: true,
        newDemotionShield: true, // grant shield in new division
        tierChange: demoted.tier !== tier,
      };
    }

    // Division demotion (within same tier)
    const demoted = demoteRank(tier, division);
    return {
      newRank: { ...demoted, lp: 75 },
      promoted: false,
      demoted: true,
      newDemotionShield: true, // grant shield
      tierChange: false,
    };
  }

  // ── Normal: LP stays within 0-99 ─────────────────────
  return {
    newRank: { tier, division, lp: newLp },
    promoted: false,
    demoted: false,
    newDemotionShield: demotionShield,
    tierChange: false,
  };
}

/** Promote to next division or tier. */
function promoteRank(tier: Tier, division: Division): Omit<RankInfo, 'lp'> {
  if (division > 1) {
    // Move up within tier (e.g., IV → III)
    return { tier, division: (division - 1) as Division };
  }
  // Division I → next tier's Division IV (or Master)
  const tierIdx = getTierIndex(tier);
  if (tierIdx >= TIERS.length - 2) {
    // Diamond I → Master
    return { tier: 'master', division: 1 as Division };
  }
  const nextTier = TIERS[tierIdx + 1];
  if (!hasDivisions(nextTier)) {
    return { tier: nextTier, division: 1 as Division };
  }
  return { tier: nextTier, division: 4 };
}

/** Demote to previous division or tier. */
function demoteRank(tier: Tier, division: Division): Omit<RankInfo, 'lp'> {
  if (division < 4) {
    // Move down within tier (e.g., III → IV)
    return { tier, division: (division + 1) as Division };
  }
  // Division IV → previous tier's Division I
  const tierIdx = getTierIndex(tier);
  if (tierIdx <= 0) {
    return { tier: 'bronze', division: 4 };
  }
  const prevTier = TIERS[tierIdx - 1];
  return { tier: prevTier, division: 1 };
}
