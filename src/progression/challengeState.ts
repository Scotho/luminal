/**
 * Challenge progress tracking (pure logic).
 * Challenges are standalone — no level gating.
 */

import type { XpState, ChallengeDefinition } from './progressionTypes';
import { CHALLENGES, getChallengeById } from './unlockRegistry';

export interface ChallengeView extends ChallengeDefinition {
  progress: number;
  complete: boolean;
}

export function incrementChallenge(state: XpState, trackingEvent: string, amount = 1): void {
  for (const challenge of CHALLENGES) {
    if (challenge.trackingEvent !== trackingEvent) continue;
    const current = state.challengeProgress[challenge.id] || 0;
    if (current >= challenge.target) continue;
    state.challengeProgress[challenge.id] = Math.min(current + amount, challenge.target);
  }
}

export function isChallengeComplete(state: XpState, challengeId: string): boolean {
  const challenge = getChallengeById(challengeId);
  if (!challenge) return false;
  return (state.challengeProgress[challengeId] || 0) >= challenge.target;
}

export function getAllChallengeViews(state: XpState): ChallengeView[] {
  return CHALLENGES.map(c => ({
    ...c,
    progress: state.challengeProgress[c.id] || 0,
    complete: (state.challengeProgress[c.id] || 0) >= c.target,
  }));
}

export function getChallengeProgress(state: XpState, challengeId: string): number {
  return state.challengeProgress[challengeId] || 0;
}
