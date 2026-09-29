/**
 * TASK-306: Token choice system (pure logic).
 * Tokens are awarded at specific levels, allowing the player to pick one unlock.
 */

import type { XpState } from './progressionTypes';
import { getTokenGroup } from './unlockRegistry';
import { addUnlock } from './xpState';

export type TokenStatus = 'locked' | 'available' | 'used';

const TOKEN_LEVELS = [6, 9] as const;

/** Check if a token group can be used (level reached, not already used). */
export function canUseToken(state: XpState, group: number): boolean {
  const tokenGroup = getTokenGroup(group);
  if (!tokenGroup) return false;
  if (state.level < group) return false;
  if (state.tokensUsed[group]) return false;
  return true;
}

/** Use a token to select one option from the group. Returns true if successful. */
export function useToken(state: XpState, group: number, chosenId: string): boolean {
  if (!canUseToken(state, group)) return false;

  const tokenGroup = getTokenGroup(group);
  if (!tokenGroup) return false;

  const validOption = tokenGroup.options.find(o => o.id === chosenId);
  if (!validOption) return false;

  state.tokensUsed[group] = chosenId;

  // Handle bundles (e.g., "color:white+teal" → unlock "color:white" and "color:teal")
  const colonIdx = chosenId.indexOf(':');
  if (colonIdx >= 0) {
    const prefix = chosenId.substring(0, colonIdx);
    const keys = chosenId.substring(colonIdx + 1);
    if (keys.includes('+')) {
      for (const key of keys.split('+')) {
        addUnlock(state, `${prefix}:${key}`);
      }
    } else {
      addUnlock(state, chosenId);
    }
  } else {
    addUnlock(state, chosenId);
  }

  return true;
}

/** Get the status of a token group. */
export function getTokenStatus(state: XpState, group: number): TokenStatus {
  if (state.tokensUsed[group]) return 'used';
  if (state.level >= group) return 'available';
  return 'locked';
}

/** Get all token groups that are available but not yet used. */
export function getPendingTokens(state: XpState): number[] {
  return TOKEN_LEVELS.filter(g => state.level >= g && !state.tokensUsed[g]);
}
