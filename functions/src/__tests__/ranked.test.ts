/**
 * Tests for ranked MMR Cloud Function logic.
 * Validates Elo calculation, LP changes, placement, and promotion.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock state ───────────────────────────────────

const {
  mockRtdbData, mockFirestoreData, mockDatabase, mockFirestoreObj,
  setNestedValue, updatedDocs,
} = vi.hoisted(() => {
  const mockRtdbData: Record<string, unknown> = {};
  const mockFirestoreData: Record<string, Record<string, Record<string, unknown> | undefined>> = {};
  const updatedDocs: Array<{ path: string; data: unknown }> = [];

  function getNestedValue(path: string): unknown {
    const segments = path.split('/').filter(Boolean);
    let current: unknown = mockRtdbData;
    for (const seg of segments) {
      if (current == null || typeof current !== 'object') return null;
      current = (current as Record<string, unknown>)[seg];
    }
    return current ?? null;
  }

  function setNestedValue(path: string, value: unknown): void {
    const segments = path.split('/').filter(Boolean);
    let current = mockRtdbData as Record<string, unknown>;
    for (let i = 0; i < segments.length - 1; i++) {
      if (!current[segments[i]] || typeof current[segments[i]] !== 'object') {
        current[segments[i]] = {};
      }
      current = current[segments[i]] as Record<string, unknown>;
    }
    current[segments[segments.length - 1]] = value;
  }

  function createMockRefForPath(path: string): Record<string, unknown> {
    return {
      get: vi.fn(async () => {
        const val = getNestedValue(path);
        return { val: () => val, exists: () => val !== null && val !== undefined };
      }),
      set: vi.fn(async (val: unknown) => { setNestedValue(path, val); }),
      update: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      child: (childPath: string) => createMockRefForPath(`${path}/${childPath}`),
    };
  }

  const mockDatabase = {
    ref: vi.fn((path: string) => createMockRefForPath(path)),
  };

  const mockFirestoreObj = {
    collection: vi.fn((name: string) => ({
      doc: vi.fn((id: string) => ({
        get: vi.fn(async () => {
          const data = mockFirestoreData[name]?.[id];
          return {
            exists: data !== undefined,
            data: () => data,
            ref: {
              update: vi.fn(async (updateData: unknown) => {
                updatedDocs.push({ path: `${name}/${id}`, data: updateData });
                if (mockFirestoreData[name] && mockFirestoreData[name][id]) {
                  Object.assign(mockFirestoreData[name][id]!, updateData as Record<string, unknown>);
                }
              }),
            },
          };
        }),
        update: vi.fn(async (updateData: unknown) => {
          updatedDocs.push({ path: `${name}/${id}`, data: updateData });
          if (mockFirestoreData[name] && mockFirestoreData[name][id]) {
            Object.assign(mockFirestoreData[name][id]!, updateData as Record<string, unknown>);
          }
        }),
      })),
    })),
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        get: vi.fn(async (docRef: { get?: () => Promise<unknown> }) => {
          // Forward to the docRef's own get() which reads from mockFirestoreData
          if (docRef && docRef.get) return docRef.get();
          return { exists: false, data: () => undefined };
        }),
        set: vi.fn(),
        update: vi.fn(async (docRef: { update?: (data: unknown) => Promise<void> }, data: unknown) => {
          if (docRef && docRef.update) await docRef.update(data);
        }),
      };
      await fn(tx);
    }),
    batch: vi.fn(() => ({ delete: vi.fn(), commit: vi.fn(async () => {}) })),
  };

  return { mockRtdbData, mockFirestoreData, mockDatabase, mockFirestoreObj, setNestedValue, updatedDocs };
});

// ── Mock all firebase modules ────────────────────────────

vi.mock('firebase-admin', () => ({
  default: {
    initializeApp: vi.fn(),
    database: vi.fn(() => mockDatabase),
    firestore: vi.fn(() => mockFirestoreObj),
    auth: vi.fn(() => ({
      getUser: vi.fn(async (uid: string) => ({
        uid, providerData: [{ providerId: 'password' }],
      })),
    })),
  },
  initializeApp: vi.fn(),
  database: Object.assign(vi.fn(() => mockDatabase), {
    ServerValue: { TIMESTAMP: 'MOCK_TIMESTAMP' },
  }),
  firestore: Object.assign(vi.fn(() => mockFirestoreObj), {
    FieldValue: { serverTimestamp: vi.fn(), delete: vi.fn(() => '__DELETE__') },
  }),
  auth: vi.fn(() => ({
    getUser: vi.fn(async (uid: string) => ({
      uid, providerData: [{ providerId: 'password' }],
    })),
  })),
}));

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  getApps: vi.fn(() => []),
}));

vi.mock('firebase-admin/database', () => ({
  getDatabase: vi.fn(() => mockDatabase),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => mockFirestoreObj),
  FieldValue: { serverTimestamp: vi.fn(), delete: vi.fn(() => '__DELETE__') },
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({
    getUser: vi.fn(async (uid: string) => ({
      uid, providerData: [{ providerId: 'password' }],
    })),
  })),
}));

vi.mock('firebase-functions/v2/database', () => ({
  onValueWritten: vi.fn((_opts: unknown, handler: unknown) => handler),
  onValueCreated: vi.fn((_opts: unknown, handler: unknown) => handler),
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn((_opts: unknown, handler: unknown) => handler),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((_opts: unknown, handler: unknown) => handler),
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: vi.fn((_opts: unknown, handler: unknown) => handler),
}));

vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Import the handler ──────────────────────────────────

import { checkSeriesEnd } from '../index';

// checkSeriesEnd is the onValueWritten handler — invoke it directly
const checkSeriesHandler = checkSeriesEnd as unknown as (event: {
  params: { matchId: string; round: string };
}) => Promise<void>;

// ── Helpers ─────────────────────────────────────────────

function clearState(): void {
  for (const key of Object.keys(mockRtdbData)) delete mockRtdbData[key];
  for (const key of Object.keys(mockFirestoreData)) delete mockFirestoreData[key];
  updatedDocs.length = 0;
}

function setupMatch(matchId: string, players: string[], matchType: string = 'casual'): void {
  setNestedValue(`matches/${matchId}/meta`, {
    players,
    seriesLength: 3,
    status: 'playing',
    matchType,
  });
}

function setupRankedUser(uid: string, mmr: number, gamesPlayed: number = 10): void {
  if (!mockFirestoreData['users']) mockFirestoreData['users'] = {};
  mockFirestoreData['users'][uid] = {
    username: uid,
    color: 1,
    ranked: {
      mmr,
      rank: { tier: 'silver', division: 3, lp: 50 },
      placementGamesPlayed: gamesPlayed,
      placementComplete: gamesPlayed >= 5,
      rankedWins: Math.floor(gamesPlayed / 2),
      rankedLosses: Math.ceil(gamesPlayed / 2),
      rankedGamesPlayed: gamesPlayed,
      lastRankedMatch: Date.now() - 60000,
      demotionShield: false,
      seasonId: 1,
    },
  };
  // Also set in onlineMatches for leaderboard lookup
  if (!mockFirestoreData['onlineMatches']) mockFirestoreData['onlineMatches'] = {};
  mockFirestoreData['leaderboard'] = mockFirestoreData['leaderboard'] || {};
}

function setupMatchDoc(matchId: string, players: string[]): void {
  if (!mockFirestoreData['onlineMatches']) mockFirestoreData['onlineMatches'] = {};
  mockFirestoreData['onlineMatches'][matchId] = {
    id: matchId,
    players: players.map(uid => ({ uid, username: uid, color: 1 })),
    seed: 42,
    status: 'pending',
    createdAt: Date.now(),
  };
}

// ── Tests ───────────────────────────────────────────────

describe('Ranked MMR in checkSeriesEnd', () => {
  beforeEach(() => {
    clearState();
    vi.clearAllMocks();
  });

  it('does not trigger updateMMR for casual matches', async () => {
    setupMatch('match1', ['playerA', 'playerB'], 'casual');
    setupMatchDoc('match1', ['playerA', 'playerB']);
    setNestedValue('matches/match1/result', {
      1: { winner: 'playerA' },
      2: { winner: 'playerA' },
    });

    await checkSeriesHandler({ params: { matchId: 'match1', round: '2' } });

    // No ranked user data should be updated
    const rankedUpdates = updatedDocs.filter(d => {
      const data = d.data as Record<string, unknown>;
      return data && 'ranked' in data;
    });
    expect(rankedUpdates).toHaveLength(0);
  });

  it('triggers updateMMR for ranked matches and updates both players', async () => {
    setupMatch('ranked1', ['playerA', 'playerB'], 'ranked');
    setupMatchDoc('ranked1', ['playerA', 'playerB']);
    setupRankedUser('playerA', 1000);
    setupRankedUser('playerB', 1000);

    setNestedValue('matches/ranked1/result', {
      1: { winner: 'playerA' },
      2: { winner: 'playerA' },
    });

    await checkSeriesHandler({ params: { matchId: 'ranked1', round: '2' } });

    // Both users should have ranked field updates
    const rankedUpdates = updatedDocs.filter(d => {
      const data = d.data as Record<string, unknown>;
      return d.path.startsWith('users/') && data && 'ranked' in data;
    });
    expect(rankedUpdates.length).toBeGreaterThanOrEqual(2);

    // Winner should have higher MMR
    const winnerUpdate = rankedUpdates.find(d => d.path === 'users/playerA');
    const loserUpdate = rankedUpdates.find(d => d.path === 'users/playerB');
    expect(winnerUpdate).toBeDefined();
    expect(loserUpdate).toBeDefined();

    const winnerRanked = (winnerUpdate!.data as Record<string, unknown>).ranked as Record<string, unknown>;
    const loserRanked = (loserUpdate!.data as Record<string, unknown>).ranked as Record<string, unknown>;
    expect(winnerRanked.mmr as number).toBeGreaterThan(1000);
    expect(loserRanked.mmr as number).toBeLessThan(1000);
  });

  it('handles placement completion on 5th game', async () => {
    setupMatch('placement5', ['newPlayer', 'veteran'], 'ranked');
    setupMatchDoc('placement5', ['newPlayer', 'veteran']);

    // newPlayer has played 4 games (this will be 5th)
    if (!mockFirestoreData['users']) mockFirestoreData['users'] = {};
    mockFirestoreData['users']['newPlayer'] = {
      username: 'newPlayer', color: 1,
      ranked: {
        mmr: 1100,
        rank: { tier: 'bronze', division: 4, lp: 0 },
        placementGamesPlayed: 4,
        placementComplete: false,
        rankedWins: 3, rankedLosses: 1, rankedGamesPlayed: 4,
        lastRankedMatch: Date.now() - 60000,
        demotionShield: false, seasonId: 1,
      },
    };
    setupRankedUser('veteran', 1100, 50);

    setNestedValue('matches/placement5/result', {
      1: { winner: 'newPlayer' },
      2: { winner: 'newPlayer' },
    });

    await checkSeriesHandler({ params: { matchId: 'placement5', round: '2' } });

    const update = updatedDocs.find(d => d.path === 'users/newPlayer');
    expect(update).toBeDefined();
    const ranked = (update!.data as Record<string, unknown>).ranked as Record<string, unknown>;
    expect(ranked.placementComplete).toBe(true);
    expect(ranked.placementGamesPlayed).toBe(5);
    // Should have a real rank assigned
    const assignedRank = ranked.rank as Record<string, unknown>;
    expect(assignedRank.tier).toBeDefined();
    // LP starts at 50 from placement, then the win's LP gain is applied
    expect(assignedRank.lp as number).toBeGreaterThanOrEqual(50);
  });
});
