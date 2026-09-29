// ── Luminal Cloud Functions ──────────────────────────────
// Server-side anticheat: match result arbitration, leaderboard protection,
// physics validation, and ranked infrastructure.

import * as admin from 'firebase-admin';
import { onValueWritten } from 'firebase-functions/v2/database';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onValueCreated } from 'firebase-functions/v2/database';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { sendDM, ALERT_COLOR } from './discord.js';
import { verifyRankedRound } from './verifyRankedRound.js';

const discordBotToken = defineSecret('DISCORD_BOT_TOKEN');

admin.initializeApp();

const rtdb = admin.database();
const firestore = admin.firestore();

// ── Phase 1A: Match Result Arbitration ────────────────────
// Triggered when any player writes their roundEnd entry.
// When ALL players have submitted, uses majority vote to determine winner
// and writes a canonical result to matches/{matchId}/result.

export const arbitrateRoundEnd = onValueWritten(
  { ref: 'matches/{matchId}/roundEnd/{uid}', region: 'us-central1' },
  async (event) => {
    const matchId = event.params.matchId;
    const roundEndRef = rtdb.ref(`matches/${matchId}/roundEnd`);
    const snap = await roundEndRef.get();
    const val = snap.val();
    if (!val) return;

    // Read meta to get the full player list (fallback for old player1/player2 format)
    const metaSnap = await rtdb.ref(`matches/${matchId}/meta`).get();
    const meta = metaSnap.val();
    if (!meta) return;
    const allPlayers: string[] = meta.players || [meta.player1, meta.player2].filter(Boolean);

    // Wait for ALL players to submit roundEnd entries
    if (!allPlayers.every(uid => val[uid])) return;

    // Verify all players reference the same round
    const rounds = new Set(allPlayers.map(uid => val[uid].round));
    if (rounds.size !== 1) {
      logger.warn(`Round mismatch in ${matchId}: ${[...rounds].join(' vs ')}`);
      return;
    }

    const round = val[allPlayers[0]].round;

    // Write canonical result (idempotent — uses round as key)
    const resultRef = rtdb.ref(`matches/${matchId}/result/${round}`);
    const existing = await resultRef.get();
    if (existing.exists()) return; // Already arbitrated this round

    // ── Ranked digest verification (TASK-109-3) ──
    const matchType: string = meta.matchType || 'casual';
    const verification = await verifyRankedRound(matchId, val, matchType);
    if (!verification.verified) {
      logger.warn(
        `[verifyRankedRound] Dispute in match ${matchId}:`,
        verification.dispute,
      );
    }

    // Majority vote: count each player's reported winner
    const votes: Record<string, number> = {};
    for (const uid of allPlayers) {
      const winner = val[uid]?.winner || 'draw';
      votes[winner] = (votes[winner] || 0) + 1;
    }
    let canonicalWinner = 'draw';
    let maxVotes = 0;
    for (const [w, count] of Object.entries(votes)) {
      if (count > maxVotes) { maxVotes = count; canonicalWinner = w; }
    }
    // Require strict majority; ties → draw
    if (maxVotes <= allPlayers.length / 2) canonicalWinner = 'draw';

    await resultRef.set({
      round,
      winner: canonicalWinner,
      players: allPlayers,
      ts: admin.database.ServerValue.TIMESTAMP,
    });

    logger.info(`Arbitrated ${matchId} round ${round}: winner=${canonicalWinner}`);
  },
);

// ── Phase 1A (cont): Match Series Result ──────────────────
// When a canonical round result is written, check if the series is over.
// If so, write the final match result and trigger leaderboard update.

export const checkSeriesEnd = onValueWritten(
  { ref: 'matches/{matchId}/result/{round}', region: 'us-central1' },
  async (event) => {
    const matchId = event.params.matchId;

    // Read match metadata to know series length and players
    const metaSnap = await rtdb.ref(`matches/${matchId}/meta`).get();
    const meta = metaSnap.val();
    if (!meta) return;

    const seriesLength = meta.seriesLength || 3;
    const winsNeeded = Math.ceil(seriesLength / 2);

    // Read all round results
    const resultsSnap = await rtdb.ref(`matches/${matchId}/result`).get();
    const results = resultsSnap.val();
    if (!results) return;

    // Count wins
    const scores: Record<string, number> = {};
    for (const roundKey of Object.keys(results)) {
      const r = results[roundKey];
      if (r.winner && r.winner !== 'draw') {
        scores[r.winner] = (scores[r.winner] || 0) + 1;
      }
    }

    // Check if series is over
    let seriesWinner: string | null = null;
    for (const [uid, wins] of Object.entries(scores)) {
      if (wins >= winsNeeded) {
        seriesWinner = uid;
        break;
      }
    }

    if (!seriesWinner) return; // Series not over yet

    // Check if we already wrote the final result
    const finalRef = rtdb.ref(`matches/${matchId}/finalResult`);
    const finalSnap = await finalRef.get();
    if (finalSnap.exists()) return;

    const allPlayers: string[] = meta.players || [meta.player1, meta.player2].filter(Boolean);
    const losers = allPlayers.filter(uid => uid !== seriesWinner);

    await finalRef.set({
      winner: seriesWinner,
      losers,
      scores,
      seriesLength,
      matchId,
      ts: admin.database.ServerValue.TIMESTAMP,
    });

    logger.info(`Series complete ${matchId}: winner=${seriesWinner}, scores=${JSON.stringify(scores)}`);

    // Trigger leaderboard update (Phase 1D)
    await updateLeaderboard(matchId, meta, seriesWinner, scores);

    // Trigger ranked MMR update if this was a ranked match
    const matchType: string = meta.matchType || 'casual';
    if (matchType === 'ranked') {
      await updateMMR(matchId, allPlayers, seriesWinner);
    }
  },
);

// ── Phase 1D: Server-Side Leaderboard Update ──────────────
// Called by checkSeriesEnd when a match finishes.
// Replicates the logic from client-side leaderboard.ts but server-authoritative.

async function updateLeaderboard(
  matchId: string,
  meta: Record<string, unknown>,
  winner: string,
  scores: Record<string, number>,
): Promise<void> {
  const allPlayers: string[] = (meta.players as string[]) || [meta.player1, meta.player2].filter(Boolean) as string[];
  const seriesLength = (meta.seriesLength || 3) as number;
  const matchType = 'casual' as const; // Online matches are casual for now
  // Read the Firestore onlineMatch doc for player details
  const matchDoc = await firestore.collection('onlineMatches').doc(matchId).get();
  const matchData = matchDoc.data();

  for (const uid of allPlayers) {
    // Get player info from match doc or users collection
    let username = 'Unknown';
    let color = 0;
    let icon = '';

    if (matchData) {
      // Try players array first, fall back to player1/player2
      const players = matchData.players as Array<Record<string, unknown>> | undefined;
      let playerData: Record<string, unknown> | undefined;
      if (players) {
        playerData = players.find(p => p.uid === uid);
      } else {
        playerData = matchData.player1?.uid === uid ? matchData.player1 : matchData.player2;
      }
      if (playerData) {
        username = (playerData.username as string) || username;
        color = (playerData.color as number) ?? color;
      }
    }

    // Fallback: read from users collection
    if (username === 'Unknown') {
      const userDoc = await firestore.collection('users').doc(uid).get();
      const userData = userDoc.data();
      if (userData) {
        username = userData.username || username;
        color = userData.color ?? color;
        icon = userData.icon || '';
      }
    }

    // Check if user is anonymous — skip leaderboard for anonymous users
    try {
      const userRecord = await admin.auth().getUser(uid);
      const isAnonymous = userRecord.providerData.length === 0;
      if (isAnonymous) continue;
    } catch {
      continue; // User doesn't exist
    }

    const result = uid === winner ? 'player' : (winner ? 'ai' : 'draw');
    const docId = `${uid}_${seriesLength}_${matchType}`;
    const docRef = firestore.collection('leaderboard').doc(docId);

    await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);

      if (snap.exists) {
        const data = snap.data()!;
        // Dedup by matchId
        if (data.lastReplayId === matchId) return;

        const updates: Record<string, unknown> = {
          username,
          color,
          lastReplayId: matchId,
          lastUpdated: Date.now(),
          matchCount: (data.matchCount || 0) + 1,
          totalTime: (data.totalTime || 0), // matchTime not available server-side yet
        };

        if (icon) updates.icon = icon;

        if (result === 'player') {
          updates.wins = (data.wins || 0) + 1;
          updates.currentStreak = (data.currentStreak || 0) + 1;
          if ((updates.currentStreak as number) > (data.bestStreak || 0)) {
            updates.bestStreak = updates.currentStreak;
          }
          // Clear graveyard state on new win
          updates.currentStreakBrokenAt = admin.firestore.FieldValue.delete();
          updates.currentStreakPeak = admin.firestore.FieldValue.delete();
        } else if (result === 'ai') {
          updates.losses = (data.losses || 0) + 1;
          // Record graveyard data before resetting streak
          const prevStreak = data.currentStreak || 0;
          if (prevStreak > 0) {
            updates.currentStreakPeak = prevStreak;
            updates.currentStreakBrokenAt = Date.now();
          }
          updates.currentStreak = 0;
        } else {
          // Draw — increment draws, don't touch streaks
          updates.draws = (data.draws || 0) + 1;
        }

        const totalWins = (updates.wins ?? data.wins ?? 0) as number;
        const totalMatches = updates.matchCount as number;
        updates.winRate = totalMatches > 0 ? Math.round((totalWins / totalMatches) * 1000) / 10 : 0;

        tx.update(docRef, updates);
      } else {
        tx.set(docRef, {
          uid,
          username,
          color,
          icon: icon || '',
          series: seriesLength,
          matchType,
          wins: result === 'player' ? 1 : 0,
          losses: result === 'ai' ? 1 : 0,
          draws: result === 'draw' ? 1 : 0,
          totalTime: 0,
          matchCount: 1,
          bestStreak: result === 'player' ? 1 : 0,
          currentStreak: result === 'player' ? 1 : 0,
          fastestWin: 0,
          winRate: result === 'player' ? 100 : 0,
          lastUpdated: Date.now(),
          lastReplayId: matchId,
          bestStreakReplayId: '',
          fastestWinReplayId: '',
        });
      }
    });

    logger.info(`Updated leaderboard for ${uid} in match ${matchId}: ${result}`);
  }
}

// ── Ranked MMR Update ────────────────────────────────────
// Called by checkSeriesEnd when a ranked match finishes.
// Uses Elo with variable K-factor (K=64 during placement, K=32 after).

const DEFAULT_RANKED: Record<string, unknown> = {
  mmr: 1000,
  rank: { tier: 'bronze', division: 4, lp: 0 },
  placementGamesPlayed: 0,
  placementComplete: false,
  rankedWins: 0,
  rankedLosses: 0,
  rankedGamesPlayed: 0,
  lastRankedMatch: 0,
  demotionShield: false,
  seasonId: 1,
};

const RANK_TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
const PLACEMENT_GAMES = 5;

function eloExpected(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

function tierFromMmr(mmr: number): { tier: string; division: number; lp: number } {
  // Each tier spans 200 MMR, 4 divisions of 50 each
  // bronze: 0-999, silver: 1000-1199, gold: 1200-1399, platinum: 1400-1599, diamond: 1600+
  const tierIndex = Math.min(Math.max(Math.floor((mmr - 0) / 200), 0), RANK_TIERS.length - 1);
  const tierBase = tierIndex * 200;
  const inTier = mmr - tierBase;
  const division = Math.min(Math.max(4 - Math.floor(inTier / 50), 1), 4);
  const lp = inTier % 50;
  return { tier: RANK_TIERS[tierIndex], division, lp: Math.max(lp, 0) };
}

async function updateMMR(
  matchId: string,
  allPlayers: string[],
  winner: string,
): Promise<void> {
  // Read all players' ranked data
  const playerData: Map<string, Record<string, unknown>> = new Map();

  for (const uid of allPlayers) {
    const userDoc = await firestore.collection('users').doc(uid).get();
    const userData = userDoc.exists ? (userDoc.data() ?? {}) : {};
    const ranked = (userData.ranked ?? { ...DEFAULT_RANKED }) as Record<string, unknown>;
    // Ensure all default fields exist
    for (const [k, v] of Object.entries(DEFAULT_RANKED)) {
      if (ranked[k] === undefined) ranked[k] = v;
    }
    playerData.set(uid, ranked);
  }

  // Calculate Elo changes for each pair
  for (const uid of allPlayers) {
    const ranked = playerData.get(uid)!;
    const isWinner = uid === winner;
    const oldMmr = ranked.mmr as number;
    const gamesPlayed = (ranked.placementGamesPlayed as number) || 0;
    const isPlacement = gamesPlayed < PLACEMENT_GAMES;
    const K = isPlacement ? 64 : 32;

    // Average opponent MMR for multi-player (currently 1v1)
    const opponents = allPlayers.filter(u => u !== uid);
    const avgOppMmr = opponents.reduce((sum, opp) => sum + (playerData.get(opp)!.mmr as number), 0) / opponents.length;

    const expected = eloExpected(oldMmr, avgOppMmr);
    const actual = isWinner ? 1 : 0;
    const delta = Math.round(K * (actual - expected));
    const newMmr = Math.max(0, oldMmr + delta);

    // Log suspicious jumps
    if (Math.abs(delta) > 100) {
      logger.warn(`[ranked] Suspicious MMR delta ${delta} for ${uid} in match ${matchId} (${oldMmr} → ${newMmr})`);
    }

    // Update ranked fields
    const newGamesPlayed = gamesPlayed + 1;
    const wasPlacement = !ranked.placementComplete;
    const nowComplete = wasPlacement && newGamesPlayed >= PLACEMENT_GAMES;

    const newRank = tierFromMmr(newMmr);
    // For placement completion, start LP at 50 then add win LP
    if (nowComplete) {
      newRank.lp = Math.max(newRank.lp, 50);
    }

    const update: Record<string, unknown> = {
      ranked: {
        mmr: newMmr,
        rank: newRank,
        placementGamesPlayed: newGamesPlayed,
        placementComplete: ranked.placementComplete || nowComplete,
        rankedWins: (ranked.rankedWins as number) + (isWinner ? 1 : 0),
        rankedLosses: (ranked.rankedLosses as number) + (isWinner ? 0 : 1),
        rankedGamesPlayed: (ranked.rankedGamesPlayed as number) + 1,
        lastRankedMatch: Date.now(),
        demotionShield: ranked.demotionShield,
        seasonId: ranked.seasonId,
      },
    };

    await firestore.collection('users').doc(uid).update(update);
  }

  logger.info(`Ranked MMR updated for match ${matchId}: winner=${winner}`);
}

// ── Phase 1E: Match Creation Validation ───────────────────
// Validates that both players in a new match exist as real users.

export const validateMatchCreation = onDocumentCreated(
  { document: 'onlineMatches/{matchId}', region: 'us-central1' },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    // Support N-player array format with fallback to player1/player2
    const playersArray = data.players as Array<{ uid: string }> | undefined;
    let playerUids: string[];

    if (playersArray && playersArray.length >= 2) {
      playerUids = playersArray.map(p => p.uid).filter(Boolean);
    } else {
      const p1Uid = data.player1?.uid;
      const p2Uid = data.player2?.uid;
      playerUids = [p1Uid, p2Uid].filter(Boolean) as string[];
    }

    if (playerUids.length < 2) {
      logger.warn(`Match ${event.params.matchId} missing player UIDs`);
      return;
    }

    // Verify all users exist
    try {
      await Promise.all(playerUids.map(uid => admin.auth().getUser(uid)));
    } catch (err) {
      logger.error(`Match ${event.params.matchId} has invalid player UIDs: ${err}`);
      // Flag match as invalid
      await event.data?.ref.update({ status: 'invalid', invalidReason: 'unknown_player' });
      return;
    }

    // Store seriesLength and players in RTDB meta for the arbitration function to read
    const matchId = event.params.matchId;
    const seriesLength = data.seriesLength || 3;
    await rtdb.ref(`matches/${matchId}/meta`).update({
      players: playerUids,
      seriesLength,
    });
  },
);

// ── Admin: Purge Lobbies ─────────────────────────────────
// Callable function that uses admin SDK to bypass security rules.
// Accepts an optional filter: 'all', 'waiting', 'stale'.

const ADMIN_UIDS = ['INSERT_ADMIN_UID']; // TODO: replace with real admin UID

const CORS_ORIGINS = [/luminal\.live$/, /luminal-game\.web\.app$/, /luminal-test\.web\.app$/, /localhost/];

/** Verify caller is authenticated and has admin access (UID list or Scotho username). */
async function requireAdmin(request: CallableRequest): Promise<void> {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }
  let isAdmin = ADMIN_UIDS.includes(request.auth.uid);
  if (!isAdmin) {
    const userDoc = await firestore.collection('users').doc(request.auth.uid).get();
    const userData = userDoc.data();
    isAdmin = userData?.username === 'Scotho';
  }
  if (!isAdmin) {
    throw new HttpsError('permission-denied', 'Admin only');
  }
}

export const purgeLobbies = onCall(
  { region: 'us-central1', cors: CORS_ORIGINS },
  async (request) => {
    await requireAdmin(request);

    const filter = (request.data?.filter as string) || 'all';
    const snap = await rtdb.ref('lobbies').get();
    const val = snap.val() as Record<string, Record<string, unknown>> | null;
    if (!val) return { purged: 0, total: 0 };

    const ids = Object.keys(val);
    let toPurge: string[] = [];

    if (filter === 'all') {
      toPurge = ids;
    } else if (filter === 'unknown') {
      toPurge = ids.filter(id => !val[id].status);
    } else if (filter === 'waiting') {
      toPurge = ids.filter(id => {
        const lobby = val[id];
        return lobby.status === 'waiting' || !lobby.status;
      });
    } else if (filter === 'stale') {
      const cutoff = Date.now() - 8 * 60 * 60 * 1000;
      toPurge = ids.filter(id => {
        const lobby = val[id];
        return lobby.status !== 'playing' && ((lobby.createdAt as number) || 0) < cutoff;
      });
    }

    // Delete in parallel
    await Promise.all(toPurge.map(id => rtdb.ref(`lobbies/${id}`).remove()));

    logger.info(`Admin ${request.auth!.uid} purged ${toPurge.length}/${ids.length} lobbies (filter=${filter})`);
    return { purged: toPurge.length, total: ids.length };
  },
);

export const purgeMatches = onCall(
  { region: 'us-central1', cors: CORS_ORIGINS },
  async (request) => {
    await requireAdmin(request);

    await rtdb.ref('matches').remove();
    logger.info(`Admin ${request.auth!.uid} purged all matches`);
    return { success: true };
  },
);

export const purgeDebugReports = onCall(
  { region: 'us-central1', cors: CORS_ORIGINS },
  async (request) => {
    await requireAdmin(request);

    await rtdb.ref('debugReports').remove();
    logger.info(`Admin ${request.auth!.uid} purged all debug reports`);
    return { success: true };
  },
);

// ── Scheduled: Auto-cleanup stale lobbies ────────────────
// Runs every 10 minutes. Cleans up lobbies where:
// - Host is offline (presence falsy) with no alive guest and disconnectedAt > 2 min, OR
// - Non-playing lobby older than 2 hours (absolute cutoff), OR
// - Corrupted lobby with no host field
export const cleanupStaleLobbies = onSchedule(
  { schedule: 'every 10 minutes', region: 'us-central1', timeoutSeconds: 120 },
  async () => {
    const snap = await rtdb.ref('lobbies').get();
    const val = snap.val() as Record<string, Record<string, unknown>> | null;
    if (!val) return;

    const now = Date.now();
    const ORPHAN_CUTOFF = 2 * 60 * 1000;        // 2 minutes — host offline
    const ABSOLUTE_CUTOFF = 2 * 60 * 60 * 1000;  // 2 hours — hard limit
    const toPurge: string[] = [];

    for (const [id, lobby] of Object.entries(val)) {
      const host = lobby.host as Record<string, unknown> | undefined;
      const guests = lobby.guests as Record<string, Record<string, unknown>> | undefined;
      const createdAt = (lobby.createdAt as number) || 0;

      // Case 1: No host field at all (corrupted lobby)
      if (!host) {
        toPurge.push(id);
        continue;
      }

      // Case 2: Host offline, no alive guest, disconnectedAt old enough
      if (!host.presence) {
        const dcAt = host.disconnectedAt as number | undefined;
        const guestAlive = guests && Object.values(guests).some(g => g.presence !== false);
        if (dcAt && now - dcAt > ORPHAN_CUTOFF && !guestAlive) {
          toPurge.push(id);
          continue;
        }
      }

      // Case 3: Any lobby older than absolute cutoff (including active/stuck matches)
      if (createdAt > 0 && now - createdAt > ABSOLUTE_CUTOFF) {
        toPurge.push(id);
      }
    }

    // Delete in parallel (matches manual purge approach)
    if (toPurge.length > 0) {
      await Promise.allSettled(toPurge.map(id => rtdb.ref(`lobbies/${id}`).remove()));
      logger.info(`Cleaned up ${toPurge.length} stale lobbies out of ${Object.keys(val).length}`);
    }
  },
);

// ── F6: Anti-Forfeit — Server-validated disconnect forfeit ──
// Callable by the remaining player when opponent disconnects.
// Validates heartbeat staleness before awarding the win.

export const claimForfeit = onCall(
  { region: 'us-central1', cors: CORS_ORIGINS },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const { matchId } = request.data as { matchId?: string };
    const claimantUid = request.auth.uid;

    if (!matchId) {
      throw new HttpsError('invalid-argument', 'Missing matchId');
    }

    // Verify the caller is a participant
    const metaSnap = await rtdb.ref(`matches/${matchId}/meta`).get();
    const meta = metaSnap.val();
    if (!meta) throw new HttpsError('not-found', 'Match not found');

    const allPlayers: string[] = meta.players || [meta.player1, meta.player2].filter(Boolean);
    if (!allPlayers.includes(claimantUid)) {
      throw new HttpsError('permission-denied', 'Not a participant');
    }

    const otherUids = allPlayers.filter(uid => uid !== claimantUid);

    // Check if ANY other player's heartbeat is stale (must be >15s stale)
    const now = Date.now();
    const staleUids: string[] = [];
    for (const opponentUid of otherUids) {
      const hbSnap = await rtdb.ref(`matches/${matchId}/heartbeat/${opponentUid}`).get();
      const hbVal = hbSnap.val() as number | null;
      if (!hbVal || (now - hbVal) >= 15_000) {
        staleUids.push(opponentUid);
      }
    }

    if (staleUids.length === 0) {
      throw new HttpsError('failed-precondition', 'All opponents are still connected');
    }

    // Prevent double-write
    const finalSnap = await rtdb.ref(`matches/${matchId}/finalResult`).get();
    if (finalSnap.exists()) {
      throw new HttpsError('already-exists', 'Match already has a result');
    }

    const seriesLength = (meta.seriesLength || 3) as number;
    const winsNeeded = Math.ceil(seriesLength / 2);

    // Build scores: claimant gets winsNeeded, all others get 0
    const forfeitScores: Record<string, number> = { [claimantUid]: winsNeeded };
    for (const uid of otherUids) forfeitScores[uid] = 0;

    // Write forfeit result
    await rtdb.ref(`matches/${matchId}/finalResult`).set({
      winner: claimantUid,
      losers: otherUids,
      reason: 'forfeit_disconnect',
      scores: forfeitScores,
      seriesLength,
      matchId,
      ts: admin.database.ServerValue.TIMESTAMP,
    });

    logger.info(`Forfeit in ${matchId}: ${staleUids.join(',')} disconnected, ${claimantUid} wins`);

    // Update leaderboard
    await updateLeaderboard(matchId, meta, claimantUid, { [claimantUid]: winsNeeded });

    return { success: true, winner: claimantUid };
  },
);

// ── F3: Match Cleanup / TTL ────────────────────────────────
// Runs every 6 hours. Removes stale RTDB matches (>24h) and
// Firestore onlineMatch docs (>7 days).

export const cleanupStaleMatches = onSchedule(
  { schedule: 'every 6 hours', region: 'us-central1', timeoutSeconds: 300 },
  async () => {
    const now = Date.now();
    const RTDB_TTL_MS = 24 * 60 * 60 * 1000;        // 24 hours
    const FIRESTORE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
    let rtdbCleaned = 0;
    let firestoreCleaned = 0;

    // 1. Clean RTDB matches older than 24h
    const matchesSnap = await rtdb.ref('matches').get();
    const matches = matchesSnap.val() as Record<string, Record<string, unknown>> | null;
    if (matches) {
      const deletes: Promise<void>[] = [];
      for (const [matchId, matchData] of Object.entries(matches)) {
        const ts = findLatestTimestamp(matchData);
        if (ts > 0 && (now - ts) > RTDB_TTL_MS) {
          deletes.push(rtdb.ref(`matches/${matchId}`).remove());
          rtdbCleaned++;
        }
      }
      await Promise.allSettled(deletes);
    }

    // 2. Clean stale queue entries (>5 min)
    const queueSnap = await rtdb.ref('queuePresence').get();
    const queue = queueSnap.val() as Record<string, number> | null;
    if (queue) {
      for (const [uid, ts] of Object.entries(queue)) {
        if (typeof ts === 'number' && (now - ts) > 300_000) {
          await rtdb.ref(`queuePresence/${uid}`).remove();
        }
      }
    }

    // 3. Clean Firestore onlineMatches older than 7 days
    const cutoff = new Date(now - FIRESTORE_TTL_MS);
    const staleQuery = firestore.collection('onlineMatches')
      .where('createdAt', '<', cutoff)
      .limit(500);
    const staleDocs = await staleQuery.get();
    if (!staleDocs.empty) {
      const batch = firestore.batch();
      staleDocs.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      firestoreCleaned = staleDocs.size;
    }

    if (rtdbCleaned > 0 || firestoreCleaned > 0) {
      logger.info(`Cleanup: ${rtdbCleaned} RTDB matches, ${firestoreCleaned} Firestore docs removed`);
    }
  },
);

// ── Username Claim (atomic) ──────────────────────────────
// Prevents race condition where two concurrent signups claim the same name.
export const claimUsername = onCall(
  { region: 'us-central1', cors: CORS_ORIGINS },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be signed in');

    const { username, email } = request.data as { username?: string; email?: string };
    if (typeof username !== 'string') throw new HttpsError('invalid-argument', 'username required');

    const trimmed = username.trim();
    if (trimmed.length < 3 || trimmed.length > 20) {
      throw new HttpsError('invalid-argument', 'Username must be 3-20 characters');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      throw new HttpsError('invalid-argument', 'Letters, numbers, _ and - only');
    }

    const lower = trimmed.toLowerCase();
    const usernameRef = firestore.doc(`usernames/${lower}`);
    const userRef = firestore.doc(`users/${uid}`);

    await firestore.runTransaction(async (tx) => {
      const existing = await tx.get(usernameRef);
      if (existing.exists && existing.data()?.uid !== uid) {
        throw new HttpsError('already-exists', 'Username is already taken');
      }
      tx.set(usernameRef, { uid });
      tx.set(userRef, {
        username: trimmed,
        email: email || '',
        icon: 'star',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeen: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return { success: true };
  },
);

/** Walk an object tree to find the most recent timestamp value. */
function findLatestTimestamp(obj: unknown): number {
  let latest = 0;
  const walk = (val: unknown): void => {
    if (!val || typeof val !== 'object') return;
    const o = val as Record<string, unknown>;
    if (typeof o.ts === 'number' && o.ts > latest) latest = o.ts;
    for (const v of Object.values(o)) walk(v);
  };
  walk(obj);
  return latest;
}

// ── Health Check ─────────────────────────────────────────
// Lightweight callable for admin dashboard banner to verify functions are reachable.

export const healthCheck = onCall({ region: 'us-central1', cors: CORS_ORIGINS }, async () => {
  return { ok: true, ts: Date.now() };
});

// ═══════════════════════════════════════════════════════════════
// ── Emergency DM Alerts ──────────────────────────────────────
// Discord bot DMs to admin for outages, bug spikes, player spikes.
// Bot token stored in Firebase secrets (DISCORD_BOT_TOKEN).
// ═══════════════════════════════════════════════════════════════

const ALERT_COOLDOWN_COLLECTION = 'alertCooldowns';

/** Check if enough time has passed since the last alert of this type. */
async function checkCooldown(alertType: string, cooldownMs: number): Promise<boolean> {
  const doc = await firestore.collection(ALERT_COOLDOWN_COLLECTION).doc(alertType).get();
  if (doc.exists) {
    const lastSent = doc.data()?.lastSent as number || 0;
    if (Date.now() - lastSent < cooldownMs) return false;
  }
  await firestore.collection(ALERT_COOLDOWN_COLLECTION).doc(alertType).set({
    lastSent: Date.now(),
  });
  return true;
}

/** Check if OVERSEER is actively monitoring this domain. */
async function isOverseerActive(domain: string): Promise<boolean> {
  try {
    const snap = await rtdb.ref('config/overseerHeartbeat').get();
    const data = snap.val() as { ts?: number; domains?: string[] } | null;
    if (!data?.ts) return false;
    const fresh = (Date.now() - data.ts) < 10 * 60 * 1000; // 10 min
    const covers = Array.isArray(data.domains) && data.domains.includes(domain);
    return fresh && covers;
  } catch {
    return false;
  }
}

// ── Monitor 1: Health Check (every 5 min) ────────────────────
// Detects stuck matches, RTDB connectivity issues, and function health.

export const monitorHealth = onSchedule(
  { schedule: 'every 5 minutes', region: 'us-central1', secrets: [discordBotToken] },
  async () => {
    const token = discordBotToken.value();
    if (await isOverseerActive('server-health')) return;
    const now = Date.now();
    const alerts: string[] = [];

    // Check for stuck matches (>10 min with no finalResult)
    const matchesSnap = await rtdb.ref('matches').get();
    const matches = matchesSnap.val() as Record<string, Record<string, unknown>> | null;
    let stuckCount = 0;

    if (matches) {
      for (const matchData of Object.values(matches)) {
        const meta = matchData.meta as Record<string, unknown> | undefined;
        if (!meta) continue;

        const hasFinal = !!matchData.finalResult;
        if (hasFinal) continue;

        // Find the earliest timestamp in the match
        const ts = findLatestTimestamp(meta);
        if (ts > 0 && (now - ts) > 10 * 60 * 1000) {
          stuckCount++;
        }
      }
    }

    if (stuckCount > 0) {
      alerts.push(`**${stuckCount}** match${stuckCount > 1 ? 'es' : ''} stuck >10 min without result`);
    }

    // Check for stale lobbies (>30 min, indicates cleanup failure)
    const lobbiesSnap = await rtdb.ref('lobbies').get();
    const lobbies = lobbiesSnap.val() as Record<string, Record<string, unknown>> | null;
    let staleLobbyCount = 0;

    if (lobbies) {
      for (const lobby of Object.values(lobbies)) {
        const createdAt = (lobby.createdAt as number) || 0;
        if (createdAt > 0 && (now - createdAt) > 30 * 60 * 1000) {
          staleLobbyCount++;
        }
      }
    }

    if (staleLobbyCount > 3) {
      alerts.push(`**${staleLobbyCount}** stale lobbies (>30 min) — cleanup may be failing`);
    }

    // Send DM if any issues found (30 min cooldown)
    if (alerts.length > 0) {
      const canSend = await checkCooldown('health_monitor', 30 * 60 * 1000);
      if (canSend) {
        await sendDM(token, {
          title: 'Luminal Health Alert',
          description: alerts.join('\n'),
          color: ALERT_COLOR.CRITICAL,
          fields: [
            { name: 'Active Matches', value: `${matches ? Object.keys(matches).length : 0}`, inline: true },
            { name: 'Active Lobbies', value: `${lobbies ? Object.keys(lobbies).length : 0}`, inline: true },
            { name: 'Checked At', value: `<t:${Math.floor(now / 1000)}:R>`, inline: true },
          ],
          footer: { text: 'Luminal Emergency Monitor' },
        });
      }
    }
  },
);

// ── Monitor 2: Bug Report Spike ──────────────────────────────
// Fires on every new bug report. If >3 in 10 min, DMs admin.

export const onBugReport = onValueCreated(
  { ref: 'debugReports/{reportId}', region: 'us-central1', secrets: [discordBotToken] },
  async (event) => {
    const token = discordBotToken.value();
    if (await isOverseerActive('bugs')) return;
    const report = event.data.val() as Record<string, unknown>;
    const now = Date.now();

    // Count recent bug reports (last 10 min)
    const reportsSnap = await rtdb.ref('debugReports').get();
    const allReports = reportsSnap.val() as Record<string, Record<string, unknown>> | null;
    let recentCount = 0;

    if (allReports) {
      for (const r of Object.values(allReports)) {
        const ts = (r.ts as number) || (r.timestamp as number) || 0;
        if (ts > 0 && (now - ts) < 10 * 60 * 1000) {
          recentCount++;
        }
      }
    }

    // Spike threshold: 3+ reports in 10 min
    if (recentCount >= 3) {
      // Cluster errors by message similarity (first 80 chars)
      const clusters = new Map<string, number>();
      if (allReports) {
        for (const r of Object.values(allReports)) {
          const ts = (r.ts as number) || (r.timestamp as number) || 0;
          if (ts > 0 && (now - ts) < 10 * 60 * 1000) {
            const key = ((r.error as string) || (r.message as string) || 'unknown').replace(/\s+/g, ' ').slice(0, 80);
            clusters.set(key, (clusters.get(key) || 0) + 1);
          }
        }
      }
      const topErrors = Array.from(clusters.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([msg, count]) => `\`${msg}\` ×${count}`)
        .join('\n');

      const canSend = await checkCooldown('bug_spike', 15 * 60 * 1000);
      if (canSend) {
        await sendDM(token, {
          title: 'Bug Report Spike',
          description: `**${recentCount} bug reports** in the last 10 minutes — possible broken build.`,
          color: ALERT_COLOR.CRITICAL,
          fields: [
            { name: 'Top Errors', value: topErrors || '(unknown)', inline: false },
            { name: 'Source', value: `${report.source || 'game-client'}`, inline: true },
            { name: 'Total Recent', value: `${recentCount}`, inline: true },
          ],
          footer: { text: 'Luminal Emergency Monitor' },
        });
      }
    }
  },
);

// ── Monitor 3: Player Count Spike ────────────────────────────
// Runs every 5 min alongside health check. Tracks concurrent players
// and alerts on new peak records or unusual spikes.

export const monitorPlayerCount = onSchedule(
  { schedule: 'every 5 minutes', region: 'us-central1', secrets: [discordBotToken] },
  async () => {
    const token = discordBotToken.value();
    if (await isOverseerActive('player-activity')) return;
    const now = Date.now();

    // Count currently online players (status entries with online: true or recent ts)
    const statusSnap = await rtdb.ref('status').get();
    const status = statusSnap.val() as Record<string, Record<string, unknown>> | null;
    let onlineCount = 0;

    if (status) {
      for (const entry of Object.values(status)) {
        const isOnline = entry.online === true;
        const ts = (entry.ts as number) || 0;
        // Consider online if flagged or heartbeat within last 2 min
        if (isOnline || (ts > 0 && (now - ts) < 2 * 60 * 1000)) {
          onlineCount++;
        }
      }
    }

    // Read/update peak tracking doc
    const peakRef = firestore.collection('config').doc('playerPeaks');
    const peakDoc = await peakRef.get();
    const peakData = peakDoc.exists ? peakDoc.data()! : {};
    const allTimePeak = (peakData.allTimePeak as number) || 0;
    const lastNotifiedPeak = (peakData.lastNotifiedPeak as number) || 0;

    // Milestone thresholds
    const MILESTONES = [5, 10, 15, 25, 50, 75, 100, 150, 200, 500, 1000];

    // Check if we crossed a new milestone
    const crossedMilestone = MILESTONES.find(m => onlineCount >= m && lastNotifiedPeak < m);

    // Check if new all-time peak (with at least 20% increase to avoid noise)
    const isNewPeak = onlineCount > allTimePeak && onlineCount >= 3;

    if (crossedMilestone || isNewPeak) {
      const canSend = await checkCooldown('player_spike', 30 * 60 * 1000);
      if (canSend) {
        const title = isNewPeak
          ? `New Peak: ${onlineCount} Players Online!`
          : `Player Milestone: ${onlineCount} Online!`;

        await sendDM(token, {
          title,
          description: isNewPeak
            ? `New all-time concurrent record! Previous peak was **${allTimePeak}**.`
            : `Luminal just hit **${crossedMilestone}** concurrent players.`,
          color: ALERT_COLOR.WARNING,
          fields: [
            { name: 'Online Now', value: `${onlineCount}`, inline: true },
            { name: 'Previous Peak', value: `${allTimePeak}`, inline: true },
            { name: 'Time', value: `<t:${Math.floor(now / 1000)}:R>`, inline: true },
          ],
          footer: { text: 'Luminal Player Monitor' },
        });
      }

      // Update peak tracking
      const updates: Record<string, unknown> = { lastNotifiedPeak: onlineCount };
      if (onlineCount > allTimePeak) updates.allTimePeak = onlineCount;
      updates.lastChecked = now;
      await peakRef.set(updates, { merge: true });
    }
  },
);
