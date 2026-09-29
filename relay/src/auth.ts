// ── Firebase Auth Verification ───────────────────────────
// Verifies Firebase ID token and checks match membership via RTDB.

import admin from 'firebase-admin';

export interface AuthResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verify ID token, check uid matches claimed uid, and confirm
 * the player is a participant in the match.
 */
export async function verifyAndAuthorize(
  token: string,
  matchId: string,
  claimedUid: string,
): Promise<AuthResult> {
  // Test mode: token value IS the UID. No Firebase, no RTDB check.
  if (process.env.AUTH_MODE === 'test') {
    if (token !== claimedUid) {
      return { ok: false, reason: 'uid mismatch' };
    }
    return { ok: true };
  }

  // 1. Verify Firebase ID token
  let decoded: admin.auth.DecodedIdToken;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch {
    return { ok: false, reason: 'invalid token' };
  }

  // 2. UID must match
  if (decoded.uid !== claimedUid) {
    return { ok: false, reason: 'uid mismatch' };
  }

  // 3. Check match membership
  try {
    const metaSnap = await admin.database().ref(`matches/${matchId}/meta`).get();
    const meta = metaSnap.val();
    if (!meta || !Array.isArray(meta.players) || !meta.players.includes(claimedUid)) {
      return { ok: false, reason: 'not a participant in this match' };
    }
  } catch {
    return { ok: false, reason: 'failed to verify match membership' };
  }

  return { ok: true };
}
