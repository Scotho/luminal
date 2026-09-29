// ── Leaderboard System ────────────────────────────────────
// Stores per-user stats in Firestore, queryable by settings combo.
// Each doc = one user's stats for a specific (series, matchType) tuple.
// Stores replay IDs for best achievements so entries can link to replays.

import { db } from './firebase';
import {
  doc, getDoc, getDocs, collection,
  query, where, orderBy, limit, runTransaction, deleteDoc, updateDoc,
} from 'firebase/firestore';
import { auth } from './firebase';
import { logLocal } from './localDiagnostics';
import type { LeaderboardEntry } from './types/index';

// Doc ID: uid_series_matchType (e.g. "abc123_3_ai" = BO3, offline)
function docId(uid: string, series: number, matchType: string): string {
  return `${uid}_${series}_${matchType}`;
}

// Submit a match result to the leaderboard
// replayId: the IndexedDB replay ID for this match (optional)
export async function submitMatch(
  uid: string,
  username: string,
  color: number,
  result: string,
  matchTime: number,
  series: number,
  matchType: 'ai' | 'casual',
  replayId?: string,
  icon?: string,
): Promise<void> {
  const id = docId(uid, series, matchType);
  const docRef = doc(db, 'leaderboard', id);

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(docRef);
    let data: LeaderboardEntry;

    if (snap.exists()) {
      data = snap.data() as LeaderboardEntry;
      // Dedup: skip if this exact match was already submitted
      if (replayId && data.lastReplayId === replayId) return;
      data.username = username;
      data.color = color;
      if (icon) data.icon = icon;
      data.lastReplayId = replayId || data.lastReplayId || '';

      if (result === 'player') {
        data.wins++;
        data.currentStreak++;
        if (data.currentStreak > data.bestStreak) {
          data.bestStreak = data.currentStreak;
          if (replayId) data.bestStreakReplayId = replayId;
        }
        if (matchTime < data.fastestWin || data.fastestWin === 0) {
          data.fastestWin = matchTime;
          if (replayId) data.fastestWinReplayId = replayId;
        }
        // Clear graveyard state when streak resumes
        delete data.currentStreakBrokenAt;
        delete data.currentStreakPeak;
      } else if (result === 'ai') {
        data.losses++;
        // Record graveyard data before resetting streak
        if (data.currentStreak > 0) {
          data.currentStreakPeak = data.currentStreak;
          data.currentStreakBrokenAt = Date.now();
        }
        data.currentStreak = 0;
      } else {
        data.draws++;
      }

      data.totalTime += matchTime;
      data.matchCount++;
      data.winRate = data.matchCount > 0 ? Math.round((data.wins / data.matchCount) * 1000) / 10 : 0;
      data.lastUpdated = Date.now();
    } else {
      data = {
        uid,
        username,
        color,
        icon: icon || '',
        series,
        matchType,
        wins: result === 'player' ? 1 : 0,
        losses: result === 'ai' ? 1 : 0,
        draws: result === 'draw' ? 1 : 0,
        totalTime: matchTime,
        matchCount: 1,
        bestStreak: result === 'player' ? 1 : 0,
        currentStreak: result === 'player' ? 1 : 0,
        fastestWin: result === 'player' ? matchTime : 0,
        winRate: result === 'player' ? 100 : 0,
        lastUpdated: Date.now(),
        lastReplayId: replayId || '',
        bestStreakReplayId: (result === 'player' && replayId) ? replayId : '',
        fastestWinReplayId: (result === 'player' && replayId) ? replayId : '',
      };
    }

    transaction.set(docRef, data);
  });
}

// Fetch leaderboard for a given metric + settings filter
// metric: 'wins', 'winRate', 'bestStreak', 'fastestWin'
export async function fetchLeaderboard(
  metric: string,
  series: number,
  matchType: 'ai' | 'casual',
  maxResults: number = 20,
): Promise<LeaderboardEntry[]> {
  try {
    // Try indexed query first (equality + orderBy)
    const q = query(
      collection(db, 'leaderboard'),
      where('series', '==', series),
      where('matchType', '==', matchType),
      orderBy(metric, metric === 'fastestWin' ? 'asc' : 'desc'),
      limit(maxResults),
    );
    const snap = await getDocs(q);
    const results: LeaderboardEntry[] = [];
    snap.forEach(d => {
      const data = d.data() as LeaderboardEntry;
      if (metric === 'fastestWin' && data.fastestWin === 0) return;
      results.push(data);
    });
    return results;
  } catch (e: unknown) {
    // Fallback: fetch without orderBy and sort client-side (index may not be ready)
    console.warn('Leaderboard indexed query failed, using fallback:', e instanceof Error ? e.message : e);
    const q = query(
      collection(db, 'leaderboard'),
      where('series', '==', series),
      where('matchType', '==', matchType),
      limit(100),
    );
    const snap = await getDocs(q);
    const results: LeaderboardEntry[] = [];
    snap.forEach(d => {
      const data = d.data() as LeaderboardEntry;
      if (metric === 'fastestWin' && data.fastestWin === 0) return;
      results.push(data);
    });
    results.sort((a, b) => {
      if (metric === 'fastestWin') return (a[metric as keyof LeaderboardEntry] as number || 0) - (b[metric as keyof LeaderboardEntry] as number || 0);
      return (b[metric as keyof LeaderboardEntry] as number || 0) - (a[metric as keyof LeaderboardEntry] as number || 0);
    });
    return results.slice(0, maxResults);
  }
}

// Fetch a specific user's stats for given settings
export async function fetchUserStats(
  uid: string,
  series: number,
  matchType: 'ai' | 'casual',
): Promise<LeaderboardEntry | null> {
  const id = docId(uid, series, matchType);
  const snap = await getDoc(doc(db, 'leaderboard', id));
  return snap.exists() ? (snap.data() as LeaderboardEntry) : null;
}

// Fetch aggregate stats across all settings combos for a user
export async function fetchAggregateStats(uid: string): Promise<{
  wins: number;
  losses: number;
  draws: number;
  bestStreak: number;
  currentStreak: number;
  totalTime: number;
  matchCount: number;
} | null> {
  const q = query(
    collection(db, 'leaderboard'),
    where('uid', '==', uid),
  );
  const snap = await getDocs(q);
  const agg = { wins: 0, losses: 0, draws: 0, bestStreak: 0, currentStreak: 0, totalTime: 0, matchCount: 0 };
  snap.forEach(d => {
    const s = d.data() as LeaderboardEntry;
    agg.wins += s.wins || 0;
    agg.losses += s.losses || 0;
    agg.draws += s.draws || 0;
    agg.totalTime += s.totalTime || 0;
    agg.matchCount += s.matchCount || 0;
    if ((s.bestStreak || 0) > agg.bestStreak) agg.bestStreak = s.bestStreak;
    if ((s.currentStreak || 0) > agg.currentStreak) agg.currentStreak = s.currentStreak;
  });
  return agg.matchCount > 0 ? agg : null;
}

// Get user's rank by bestStreak (or other metric) for given settings
export async function getPlayerRank(
  uid: string,
  series: number,
  metric: string = 'bestStreak',
): Promise<number> {
  const entries = await fetchLeaderboard(metric, series, 'ai');
  const idx = entries.findIndex(e => e.uid === uid);
  return idx >= 0 ? idx + 1 : 0;
}

// Get user's rank by wins for given settings
export async function getUserRank(
  uid: string,
  series: number,
  matchType: 'ai' | 'casual',
): Promise<number | null> {
  const userStats = await fetchUserStats(uid, series, matchType);
  if (!userStats) return null;
  const q = query(
    collection(db, 'leaderboard'),
    where('series', '==', series),
    where('matchType', '==', matchType),
    where('wins', '>', userStats.wins),
  );
  const snap = await getDocs(q);
  return snap.size + 1;
}

// Get user's rank for any metric within a specific series + matchType
export async function getRankForMetric(
  uid: string,
  series: number,
  matchType: 'ai' | 'casual',
  metric: string,
): Promise<number | null> {
  const entries = await fetchLeaderboard(metric, series, matchType, 100);
  const idx = entries.findIndex(e => e.uid === uid);
  return idx >= 0 ? idx + 1 : null;
}

// Fetch recently-fallen players for the Current Streak graveyard
export async function fetchGraveyard(
  series: number,
  matchType: 'ai' | 'casual',
  maxResults: number = 20,
): Promise<LeaderboardEntry[]> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago
  try {
    const q = query(
      collection(db, 'leaderboard'),
      where('series', '==', series),
      where('matchType', '==', matchType),
      where('currentStreak', '==', 0),
      where('currentStreakBrokenAt', '>', cutoff),
      orderBy('currentStreakBrokenAt', 'desc'),
      limit(maxResults),
    );
    const snap = await getDocs(q);
    const results: LeaderboardEntry[] = [];
    snap.forEach(d => results.push(d.data() as LeaderboardEntry));
    return results;
  } catch (e: unknown) {
    console.warn('Graveyard query failed:', e instanceof Error ? e.message : e);
    return [];
  }
}

// ── Quick wipe: delete all leaderboard entries for the logged-in user ──
export async function wipeMyLeaderboard(): Promise<void> {
  const user = auth.currentUser;
  if (!user) { console.error('Not logged in — auth.currentUser is null'); return; }
  logLocal(`Wiping leaderboard for uid: ${user.uid}`);

  // Query by uid field
  const snap = await getDocs(
    query(collection(db, 'leaderboard'), where('uid', '==', user.uid)),
  );

  // Fallback: also check docs whose ID starts with this uid (doc ID = uid_series_matchType)
  const allSnap = await getDocs(collection(db, 'leaderboard'));
  const extraDocs = allSnap.docs.filter(d => d.id.startsWith(user.uid) && !snap.docs.some(s => s.id === d.id));

  const toDelete = [...snap.docs, ...extraDocs];
  if (toDelete.length === 0) { logLocal('No entries found.'); return; }
  logLocal(`Deleting ${toDelete.length} entries (${snap.size} by uid field, ${extraDocs.length} by doc ID)...`);
  for (const d of toDelete) {
    await deleteDoc(d.ref);
    logLocal(`  Deleted ${d.id}`);
  }
  logLocal('Done. Reload page.');
}

// Backfill icon on all leaderboard entries for a user (called at login)
export async function backfillLeaderboardIcon(uid: string, icon: string): Promise<void> {
  if (!icon) return;
  try {
    const q = query(collection(db, 'leaderboard'), where('uid', '==', uid));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      if (d.data().icon !== icon) {
        await updateDoc(d.ref, { icon });
      }
    }
  } catch (e) {
    console.warn('Failed to backfill leaderboard icon:', e);
  }
}
