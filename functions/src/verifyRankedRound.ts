// ── Ranked Round Digest Verification ────────────────────
// Cross-checks stateDigest from all clients before ranked match
// arbitration. Detects desync + result disagreement for audit.

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';

export interface DigestVerification {
  verified: boolean;
  dispute?: {
    reason: string;
    digests: Record<string, number>;
    winners: Record<string, string>;
    ts: number;
  };
}

export interface RoundEndEntry {
  round: number;
  winner: string;
  stateDigest?: number;
}

/**
 * Verifies state digests across all players for ranked matches.
 *
 * Rules:
 *  - Non-ranked matches skip verification entirely.
 *  - Missing digests are tolerated (backwards compat).
 *  - Matching digests always pass.
 *  - Mismatched digests with agreed winners pass (benign desync).
 *  - Mismatched digests with disagreed winners create a dispute record.
 */
export async function verifyRankedRound(
  matchId: string,
  roundEndEntries: Record<string, RoundEndEntry>,
  matchType: string,
): Promise<DigestVerification> {
  // 1. Non-ranked → skip
  if (matchType !== 'ranked') {
    return { verified: true };
  }

  const uids = Object.keys(roundEndEntries);

  // 2-3. Collect digests; tolerate missing ones
  const digests: Record<string, number> = {};
  for (const uid of uids) {
    const entry = roundEndEntries[uid];
    if (entry.stateDigest === undefined || entry.stateDigest === null) {
      return { verified: true }; // backwards compat
    }
    digests[uid] = entry.stateDigest;
  }

  // 4. All digests agree → pass
  const uniqueDigests = new Set(Object.values(digests));
  if (uniqueDigests.size === 1) {
    return { verified: true };
  }

  // Digests disagree — check if winners still agree
  const winners: Record<string, string> = {};
  for (const uid of uids) {
    winners[uid] = roundEndEntries[uid].winner;
  }

  const uniqueWinners = new Set(Object.values(winners));

  // 5. Digests differ but winners agree → benign desync
  if (uniqueWinners.size === 1) {
    return { verified: true };
  }

  // 6. Digests differ AND winners differ → dispute
  const round = roundEndEntries[uids[0]].round;
  const dispute = {
    reason: 'digest_and_winner_mismatch',
    digests,
    winners,
    ts: Date.now(),
  };

  const rtdb = admin.database();
  await rtdb.ref(`matches/${matchId}/disputes/${round}`).set(dispute);

  logger.warn(
    `[verifyRankedRound] Dispute in ${matchId} round ${round}: digests and winners disagree`,
  );

  return { verified: false, dispute };
}
