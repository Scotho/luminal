/**
 * SPEC-92: Server-side FLOW award computation.
 *
 * Called from updateLeaderboard() Cloud Function.
 * Bounds-checks reported FLOW, updates banked/lifetime on user doc.
 */

import * as admin from 'firebase-admin';

/** Mirrors FLOW_HARD_CAP from flowTuning.ts — duplicated to avoid cross-package dep */
const HARD_CAP_PER_ROUND = 2500;

/** Minimum seconds between awards (rate limiting) */
const MIN_AWARD_INTERVAL_SEC = 30;

/** Max FLOW per local reconciliation claim */
export const LOCAL_CLAIM_CAP = 10_000;

export interface FlowReport {
  round: number;
  awarded: number;
  died: boolean;
}

/**
 * Compute and award FLOW for a match inside an existing transaction.
 * Returns the total FLOW awarded.
 */
export async function computeAndAwardFlow(
  tx: FirebaseFirestore.Transaction,
  uid: string,
  matchId: string,
  reportedResults: FlowReport[],
): Promise<number> {
  const userRef = admin.firestore().collection('users').doc(uid);
  const userDoc = await tx.get(userRef);
  if (!userDoc.exists) return 0;

  const data = userDoc.data()!;
  const currentBanked = (data.bankedFlow ?? 0) as number;
  const currentLifetime = (data.lifetimeFlow ?? 0) as number;
  const lastAwardAt = (data.lastFlowAwardAt ?? 0) as number;

  // Rate limiting
  const now = Date.now();
  if (now - lastAwardAt < MIN_AWARD_INTERVAL_SEC * 1000) {
    return 0;
  }

  // Bound each round's reported amount
  let matchTotal = 0;
  for (const r of reportedResults) {
    if (r.died) continue;
    const bounded = Math.min(Math.max(0, r.awarded), HARD_CAP_PER_ROUND);
    matchTotal += bounded;
  }

  if (matchTotal <= 0) return 0;

  tx.update(userRef, {
    bankedFlow: currentBanked + matchTotal,
    lifetimeFlow: currentLifetime + matchTotal,
    lastFlowAwardAt: now,
  });

  return matchTotal;
}
