/**
 * Bridge between match-end and progression system.
 */

import type { XpState, XpAward } from './progressionTypes';
import { calculateMatchXp, type MatchXpInput } from './xpConfig';
import { addXp, addUnlock } from './xpState';
import { getUnlocksForLevel } from './unlockRegistry';
import { emitProgressionEvent } from './progressionEvents';

export interface MatchXpResult {
  award: XpAward;
  levelsGained: number;
  previousLevel: number;
  newLevel: number;
  newUnlocks: string[];
}

export function awardMatchXp(state: XpState | null, input: MatchXpInput): MatchXpResult | null {
  if (state === null) return null;
  const award = calculateMatchXp(input);
  const result = addXp(state, award.total);
  let newUnlocks: string[] = [];
  if (result.levelsGained > 0) {
    newUnlocks = processLevelUp(state, result.previousLevel, state.level);
  }
  return { award, levelsGained: result.levelsGained, previousLevel: result.previousLevel, newLevel: state.level, newUnlocks };
}

export function processLevelUp(state: XpState, previousLevel: number, newLevel: number): string[] {
  const newUnlocks: string[] = [];
  for (let lvl = previousLevel + 1; lvl <= newLevel; lvl++) {
    const levelUnlocks = getUnlocksForLevel(lvl);
    for (const unlock of levelUnlocks) {
      if (!state.unlockedItems.includes(unlock.id)) {
        addUnlock(state, unlock.id);
        newUnlocks.push(unlock.id);
        emitProgressionEvent({ type: 'unlock', unlockId: unlock.id, level: lvl });
      }
    }
    emitProgressionEvent({ type: 'levelUp', level: lvl });
  }
  return newUnlocks;
}

export function _resetBridgeForTesting(): void {}
