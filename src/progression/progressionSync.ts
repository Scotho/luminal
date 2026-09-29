/**
 * Firebase persistence for progression state.
 */

import { db } from '../firebase';
import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import type { XpState, UnlockRecord } from './progressionTypes';
import { createXpState } from './xpState';

const DEBOUNCE_MS = 3000;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

export async function loadProgression(uid: string): Promise<XpState> {
  try {
    const userDoc = await getDoc(doc(db, 'users', uid));
    if (!userDoc.exists()) return createXpState();
    const data = userDoc.data();
    if (!data.progression) return createXpState();
    const p = data.progression;
    return {
      level: p.level ?? 1, xp: p.xp ?? 0, totalXp: p.totalXp ?? 0,
      unlockedItems: p.unlockedItems ?? [],
      challengeProgress: p.challengeProgress ?? {},
      tokensUsed: p.tokensUsed ?? {},
    };
  } catch { return createXpState(); }
}

export function saveProgression(uid: string, state: XpState): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { _saveProgressionNow(uid, state); }, DEBOUNCE_MS);
}

export async function _saveProgressionNow(uid: string, state: XpState): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', uid), {
      progression: {
        level: state.level, xp: state.xp, totalXp: state.totalXp,
        unlockedItems: state.unlockedItems,
        challengeProgress: state.challengeProgress,
        tokensUsed: state.tokensUsed,
      },
    });
  } catch { /* silently fail */ }
}

export async function appendUnlockLog(uid: string, record: UnlockRecord): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', uid), {
      unlockLog: arrayUnion(record),
    });
  } catch { /* silently fail — audit log is non-critical */ }
}

export function cancelPendingSave(): void {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
}

export async function flushSave(uid: string, state: XpState): Promise<void> {
  cancelPendingSave();
  await _saveProgressionNow(uid, state);
}

export function _resetSyncForTesting(): void { cancelPendingSave(); }
