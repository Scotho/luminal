// ── Leaderboard System tests ─────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'test-uid' } },
}));

const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockDeleteDoc = vi.fn().mockResolvedValue(undefined);
const mockUpdateDoc = vi.fn().mockResolvedValue(undefined);
const mockRunTransaction = vi.fn();
const mockDoc = vi.fn().mockReturnValue({ id: 'mock-doc' });
const mockCollection = vi.fn().mockReturnValue({ id: 'mock-collection' });

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => mockDoc(...args),
  setDoc: vi.fn().mockResolvedValue(undefined),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  query: vi.fn().mockReturnValue({}),
  where: vi.fn().mockReturnValue({}),
  orderBy: vi.fn().mockReturnValue({}),
  limit: vi.fn().mockReturnValue({}),
  runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
}));

import {
  submitMatch, fetchLeaderboard, fetchUserStats, fetchAggregateStats,
  getPlayerRank, getUserRank, getRankForMetric, fetchGraveyard,
  wipeMyLeaderboard, backfillLeaderboardIcon,
} from '../leaderboard';
import type { LeaderboardEntry } from '../types/index';

const snap = (exists: boolean, data: Record<string, unknown> = {}) =>
  ({ exists: () => exists, data: () => data });

function makeEntry(o: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return { uid: 'u1', username: 'User1', color: 1, series: 3, matchType: 'ai',
    wins: 5, losses: 2, draws: 0, totalTime: 1000, matchCount: 7, bestStreak: 3,
    currentStreak: 1, fastestWin: 12, winRate: 71.4, lastUpdated: Date.now(),
    lastReplayId: '', bestStreakReplayId: '', fastestWinReplayId: '', ...o };
}

function qsnap(entries: LeaderboardEntry[]) {
  const docs = entries.map((e, i) => ({ id: `doc-${i}`, ref: { id: `doc-${i}` }, data: () => e }));
  return { docs, size: entries.length, forEach: (fn: (d: { data: () => LeaderboardEntry }) => void) => docs.forEach(fn) };
}

async function runTx(existing: LeaderboardEntry | null, call: () => Promise<void>) {
  let result: LeaderboardEntry | null = null;
  mockRunTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
    const tx = { get: vi.fn().mockResolvedValue(snap(!!existing, existing ?? {})), set: vi.fn() };
    await fn(tx);
    result = tx.set.mock.calls.length > 0 ? (tx.set.mock.calls[0][1] as LeaderboardEntry) : null;
  });
  await call();
  return result;
}

describe('leaderboard', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('submitMatch', () => {
    it('creates a new entry on first win', async () => {
      const data = await runTx(null, () => submitMatch('u1', 'User1', 1, 'player', 5000, 3, 'ai'));
      expect(data).not.toBeNull();
      expect(data!.wins).toBe(1);
      expect(data!.losses).toBe(0);
      expect(data!.currentStreak).toBe(1);
      expect(data!.matchCount).toBe(1);
    });

    it('creates a new entry on first loss', async () => {
      const data = await runTx(null, () => submitMatch('u1', 'User1', 1, 'ai', 5000, 3, 'ai'));
      expect(data!.wins).toBe(0);
      expect(data!.losses).toBe(1);
      expect(data!.currentStreak).toBe(0);
    });

    it('updates existing entry with a win — increments streak', async () => {
      const existing = makeEntry({ wins: 3, currentStreak: 2, bestStreak: 2, matchCount: 5, totalTime: 500 });
      const data = await runTx(existing, () => submitMatch('u1', 'User1', 1, 'player', 100, 3, 'ai'));
      expect(data!.wins).toBe(4);
      expect(data!.currentStreak).toBe(3);
      expect(data!.bestStreak).toBe(3);
      expect(data!.matchCount).toBe(6);
    });

    it('updates existing entry with a loss — resets streak', async () => {
      const existing = makeEntry({ losses: 1, currentStreak: 4, matchCount: 6 });
      const data = await runTx(existing, () => submitMatch('u1', 'User1', 1, 'ai', 100, 3, 'ai'));
      expect(data!.losses).toBe(2);
      expect(data!.currentStreak).toBe(0);
      expect(data!.currentStreakPeak).toBe(4);
    });

    it('skips duplicate replay submission', async () => {
      const existing = makeEntry({ lastReplayId: 'replay-1' });
      const data = await runTx(existing, () => submitMatch('u1', 'User1', 1, 'player', 100, 3, 'ai', 'replay-1'));
      expect(data).toBeNull(); // tx.set was not called
    });
  });

  describe('fetchLeaderboard', () => {
    it('returns entries from indexed query', async () => {
      mockGetDocs.mockResolvedValueOnce(qsnap([makeEntry({ wins: 10 }), makeEntry({ uid: 'u2', wins: 5 })]));
      const result = await fetchLeaderboard('wins', 3, 'ai');
      expect(result).toHaveLength(2);
      expect(result[0].wins).toBe(10);
    });

    it('filters out fastestWin=0 entries', async () => {
      mockGetDocs.mockResolvedValueOnce(qsnap([makeEntry({ fastestWin: 12 }), makeEntry({ uid: 'u2', fastestWin: 0 })]));
      const result = await fetchLeaderboard('fastestWin', 3, 'ai');
      expect(result).toHaveLength(1);
    });

    it('falls back to client-side sort on error', async () => {
      mockGetDocs
        .mockRejectedValueOnce(new Error('index not ready'))
        .mockResolvedValueOnce(qsnap([makeEntry({ wins: 3 }), makeEntry({ uid: 'u2', wins: 8 })]));
      const result = await fetchLeaderboard('wins', 3, 'ai');
      expect(result).toHaveLength(2);
      expect(result[0].wins).toBe(8);
    });
  });

  describe('fetchUserStats', () => {
    it('returns entry when doc exists', async () => {
      const entry = makeEntry();
      mockGetDoc.mockResolvedValueOnce(snap(true, entry));
      expect(await fetchUserStats('u1', 3, 'ai')).toEqual(entry);
    });

    it('returns null when doc does not exist', async () => {
      mockGetDoc.mockResolvedValueOnce(snap(false));
      expect(await fetchUserStats('u1', 3, 'ai')).toBeNull();
    });
  });

  describe('fetchAggregateStats', () => {
    it('aggregates stats across multiple combos', async () => {
      const e1 = makeEntry({ wins: 3, losses: 1, draws: 0, matchCount: 4, totalTime: 100, bestStreak: 3, currentStreak: 2 });
      const e2 = makeEntry({ wins: 5, losses: 2, draws: 1, matchCount: 8, totalTime: 200, bestStreak: 5, currentStreak: 0 });
      mockGetDocs.mockResolvedValueOnce(qsnap([e1, e2]));
      expect(await fetchAggregateStats('u1')).toEqual(
        { wins: 8, losses: 3, draws: 1, matchCount: 12, totalTime: 300, bestStreak: 5, currentStreak: 2 },
      );
    });

    it('returns null when no entries exist', async () => {
      mockGetDocs.mockResolvedValueOnce(qsnap([]));
      expect(await fetchAggregateStats('u1')).toBeNull();
    });
  });

  describe('getPlayerRank', () => {
    it('returns 1-based rank when user is found', async () => {
      mockGetDocs.mockResolvedValueOnce(qsnap([makeEntry({ uid: 'top', wins: 10 }), makeEntry({ uid: 'u1', wins: 5 })]));
      expect(await getPlayerRank('u1', 3)).toBe(2);
    });

    it('returns 0 when user is not in leaderboard', async () => {
      mockGetDocs.mockResolvedValueOnce(qsnap([makeEntry({ uid: 'other' })]));
      expect(await getPlayerRank('u1', 3)).toBe(0);
    });
  });

  describe('getUserRank', () => {
    it('returns rank based on win count', async () => {
      mockGetDoc.mockResolvedValueOnce(snap(true, makeEntry({ wins: 5 })));
      mockGetDocs.mockResolvedValueOnce({ size: 3 });
      expect(await getUserRank('u1', 3, 'ai')).toBe(4);
    });

    it('returns null when user has no stats', async () => {
      mockGetDoc.mockResolvedValueOnce(snap(false));
      expect(await getUserRank('u1', 3, 'ai')).toBeNull();
    });
  });

  describe('getRankForMetric', () => {
    it('returns rank for a specific metric', async () => {
      mockGetDocs.mockResolvedValueOnce(qsnap([
        makeEntry({ uid: 'a', bestStreak: 10 }), makeEntry({ uid: 'u1', bestStreak: 7 }), makeEntry({ uid: 'b', bestStreak: 3 }),
      ]));
      expect(await getRankForMetric('u1', 3, 'ai', 'bestStreak')).toBe(2);
    });

    it('returns null when user not found', async () => {
      mockGetDocs.mockResolvedValueOnce(qsnap([makeEntry({ uid: 'other' })]));
      expect(await getRankForMetric('u1', 3, 'ai', 'wins')).toBeNull();
    });
  });

  describe('fetchGraveyard', () => {
    it('returns entries with broken streaks', async () => {
      mockGetDocs.mockResolvedValueOnce(qsnap([makeEntry({ currentStreak: 0, currentStreakPeak: 5 })]));
      expect(await fetchGraveyard(3, 'ai')).toHaveLength(1);
    });

    it('returns empty array on query failure', async () => {
      mockGetDocs.mockRejectedValueOnce(new Error('index missing'));
      expect(await fetchGraveyard(3, 'ai')).toEqual([]);
    });
  });

  describe('wipeMyLeaderboard', () => {
    it('deletes all docs for the current user', async () => {
      const [ref1, ref2] = [{ id: 'ref1' }, { id: 'ref2' }];
      const mk = () => makeEntry();
      mockGetDocs
        .mockResolvedValueOnce({ docs: [{ id: 'test-uid_3_ai', ref: ref1, data: mk }], size: 1, forEach: vi.fn() })
        .mockResolvedValueOnce({ docs: [
          { id: 'test-uid_3_ai', ref: ref1, data: mk },
          { id: 'test-uid_5_casual', ref: ref2, data: mk },
          { id: 'other_3_ai', ref: { id: 'ref3' }, data: mk },
        ] });
      await wipeMyLeaderboard();
      expect(mockDeleteDoc).toHaveBeenCalledTimes(2);
    });

    it('does nothing when no entries exist', async () => {
      mockGetDocs.mockResolvedValueOnce({ docs: [], size: 0 }).mockResolvedValueOnce({ docs: [] });
      await wipeMyLeaderboard();
      expect(mockDeleteDoc).not.toHaveBeenCalled();
    });
  });

  describe('backfillLeaderboardIcon', () => {
    it('updates only docs with a different icon', async () => {
      const [ref1, ref2] = [{ id: 'ref1' }, { id: 'ref2' }];
      mockGetDocs.mockResolvedValueOnce({ docs: [
        { ref: ref1, data: () => ({ icon: 'old' }) }, { ref: ref2, data: () => ({ icon: 'new' }) },
      ] });
      await backfillLeaderboardIcon('u1', 'new');
      expect(mockUpdateDoc).toHaveBeenCalledOnce();
      expect(mockUpdateDoc).toHaveBeenCalledWith(ref1, { icon: 'new' });
    });

    it('skips when icon is empty', async () => {
      await backfillLeaderboardIcon('u1', '');
      expect(mockGetDocs).not.toHaveBeenCalled();
    });
  });
});
