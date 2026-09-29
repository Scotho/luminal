/**
 * Global progression state manager.
 */

import type { XpState } from './progressionTypes';
import { addUnlock } from './xpState';
import { loadProgression, saveProgression, flushSave, appendUnlockLog } from './progressionSync';
import { awardMatchXp, type MatchXpResult } from './progressionBridge';
import { incrementChallenge } from './challengeState';
import { getChallengeById } from './unlockRegistry';
import { emitProgressionEvent, EVT_PROGRESSION_READY } from './progressionEvents';
import type { MatchXpInput } from './xpConfig';

let _state: XpState | null = null;
let _uid: string | null = null;

export function getProgressionState(): XpState | null { return _state; }

export async function initProgression(uid: string): Promise<void> {
  _uid = uid;
  _state = await loadProgression(uid);
  document.dispatchEvent(new CustomEvent(EVT_PROGRESSION_READY));
}

export function clearProgression(): void { _state = null; _uid = null; }

export function onMatchComplete(input: MatchXpInput): MatchXpResult | null {
  if (!_state || !_uid) return null;
  const result = awardMatchXp(_state, input);
  if (result) {
    saveProgression(_uid, _state);
    for (const unlockId of result.newUnlocks) {
      appendUnlockLog(_uid, { id: unlockId, source: 'level', at: Date.now() });
    }
  }
  return result;
}

export function trackChallengeEvent(event: string, amount = 1): string[] {
  if (!_state || !_uid) return [];
  const newUnlocks: string[] = [];
  incrementChallenge(_state, event, amount);
  for (const [challengeId, progress] of Object.entries(_state.challengeProgress)) {
    const challenge = getChallengeById(challengeId);
    if (!challenge) continue;
    if (progress >= challenge.target && !_state.unlockedItems.includes(challenge.unlockId)) {
      addUnlock(_state, challenge.unlockId);
      newUnlocks.push(challenge.unlockId);
      emitProgressionEvent({ type: 'challengeComplete', challengeId, unlockId: challenge.unlockId });
      appendUnlockLog(_uid, { id: challenge.unlockId, source: 'challenge', at: Date.now() });
    }
  }
  if (newUnlocks.length > 0) saveProgression(_uid, _state);
  return newUnlocks;
}

/** After a confirmed shop purchase, update local state. */
export function addUnlockFromPurchase(unlockId: string): void {
  if (!_state) return;
  addUnlock(_state, unlockId);
}

export async function flushProgressionState(): Promise<void> {
  if (_state && _uid) await flushSave(_uid, _state);
}

export function _resetManagerForTesting(): void { _state = null; _uid = null; }
export function _setStateForTesting(state: XpState | null, uid?: string): void {
  _state = state; _uid = uid || 'test-uid';
}
