/**
 * Progression event constants and emission.
 * Uses CustomEvent on document, consistent with existing EVT_* pattern.
 */

import type { ProgressionEvent } from './progressionTypes';

export const EVT_LEVEL_UP = 'luminal:levelUp';
export const EVT_UNLOCK = 'luminal:unlock';
export const EVT_CHALLENGE_COMPLETE = 'luminal:challengeComplete';
export const EVT_PROGRESSION_READY = 'luminal:progressionReady';

export function emitProgressionEvent(event: ProgressionEvent): void {
  const evtName = {
    levelUp: EVT_LEVEL_UP,
    unlock: EVT_UNLOCK,
    challengeComplete: EVT_CHALLENGE_COMPLETE,
  }[event.type];

  document.dispatchEvent(new CustomEvent(evtName, { detail: event }));
}
