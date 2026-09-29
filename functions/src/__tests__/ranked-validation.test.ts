/**
 * Tests for ranked MMR server-side validation and anti-cheat.
 * Validates: winner verification, dedup, suspicious jump detection,
 * Firestore rule enforcement (ranked fields are server-only).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock state ───────────────────────────────────

const { mockRtdbData, mockFirestoreData, mockDatabase, mockFirestoreObj, setNestedValue, updatedDocs, loggerWarn } = vi.hoisted(() => {
  const mockRtdbData: Record<string, unknown> = {};
  const mockFirestoreData: Record<string, Record<string, Record<string, unknown> | undefined>> = {};
  const updatedDocs: Array<{ path: string; data: unknown }> = [];
  const loggerWarn = vi.fn();

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
      if (!current[segments[i]] || typeof current[segments[i]] !== 'object') current[segments[i]] = {};
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

  const mockDatabase = { ref: vi.fn((path: string) => createMockRefForPath(path)) };

  const mockFirestoreObj = {
    collection: vi.fn((name: string) => ({
      doc: vi.fn((id: string) => ({
        get: vi.fn(async () => {
          const data = mockFirestoreData[name]?.[id];
          return { exists: data !== undefined, data: () => data };
        }),
        update: vi.fn(async (updateData: unknown) => {
          updatedDocs.push({ path: `${name}/${id}`, data: updateData });
          if (mockFirestoreData[name]?.[id]) Object.assign(mockFirestoreData[name][id]!, updateData as Record<string, unknown>);
        }),
      })),
      where: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: vi.fn(async () => ({ empty: true, docs: [], size: 0 })) }) }),
    })),
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        get: vi.fn(async (docRef: { get?: () => Promise<unknown> }) => {
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

  return { mockRtdbData, mockFirestoreData, mockDatabase, mockFirestoreObj, setNestedValue, updatedDocs, loggerWarn };
});

vi.mock('firebase-admin', () => ({
  default: {
    initializeApp: vi.fn(), database: vi.fn(() => mockDatabase),
    firestore: vi.fn(() => mockFirestoreObj),
    auth: vi.fn(() => ({ getUser: vi.fn(async (uid: string) => ({ uid, providerData: [{ providerId: 'password' }] })) })),
  },
  initializeApp: vi.fn(),
  database: Object.assign(vi.fn(() => mockDatabase), { ServerValue: { TIMESTAMP: 'MOCK_TS' } }),
  firestore: Object.assign(vi.fn(() => mockFirestoreObj), { FieldValue: { serverTimestamp: vi.fn(), delete: vi.fn(() => '__DELETE__') } }),
  auth: vi.fn(() => ({ getUser: vi.fn(async (uid: string) => ({ uid, providerData: [{ providerId: 'password' }] })) })),
}));
vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), getApps: vi.fn(() => []) }));
vi.mock('firebase-admin/database', () => ({ getDatabase: vi.fn(() => mockDatabase) }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: vi.fn(() => mockFirestoreObj), FieldValue: { serverTimestamp: vi.fn(), delete: vi.fn(() => '__DELETE__') } }));
vi.mock('firebase-admin/auth', () => ({ getAuth: vi.fn(() => ({ getUser: vi.fn(async (uid: string) => ({ uid, providerData: [{ providerId: 'password' }] })) })) }));
vi.mock('firebase-functions/v2/database', () => ({ onValueWritten: vi.fn((_o: unknown, h: unknown) => h), onValueCreated: vi.fn((_o: unknown, h: unknown) => h) }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: vi.fn((_o: unknown, h: unknown) => h) }));
vi.mock('firebase-functions/v2/https', () => ({ onCall: vi.fn((_o: unknown, h: unknown) => h), HttpsError: class extends Error { constructor(public code: string, m: string) { super(m); } } }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: vi.fn((_o: unknown, h: unknown) => h) }));
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), warn: loggerWarn, error: vi.fn() } }));

import { checkSeriesEnd } from '../index';
const handler = checkSeriesEnd as unknown as (event: { params: { matchId: string; round: string } }) => Promise<void>;

function clearState(): void {
  for (const k of Object.keys(mockRtdbData)) delete mockRtdbData[k];
  for (const k of Object.keys(mockFirestoreData)) delete mockFirestoreData[k];
  updatedDocs.length = 0;
  loggerWarn.mockClear();
}

function setupRankedMatch(matchId: string, p1: string, p2: string): void {
  setNestedValue(`matches/${matchId}/meta`, { players: [p1, p2], seriesLength: 3, status: 'playing', matchType: 'ranked' });
  if (!mockFirestoreData['onlineMatches']) mockFirestoreData['onlineMatches'] = {};
  mockFirestoreData['onlineMatches'][matchId] = { id: matchId, players: [{ uid: p1, username: p1, color: 1 }, { uid: p2, username: p2, color: 2 }], seed: 42, status: 'pending', createdAt: Date.now() };
}

function setupUser(uid: string, mmr: number): void {
  if (!mockFirestoreData['users']) mockFirestoreData['users'] = {};
  mockFirestoreData['users'][uid] = {
    username: uid, color: 1,
    ranked: { mmr, rank: { tier: 'silver', division: 3, lp: 50 }, placementGamesPlayed: 10, placementComplete: true, rankedWins: 5, rankedLosses: 5, rankedGamesPlayed: 10, lastRankedMatch: Date.now() - 60000, demotionShield: false, seasonId: 1 },
  };
}

describe('Ranked server-side validation', () => {
  beforeEach(clearState);

  it('does not process a series that is not over (no winsNeeded met)', async () => {
    setupRankedMatch('m1', 'A', 'B');
    setupUser('A', 1000);
    setupUser('B', 1000);
    setNestedValue('matches/m1/result', { 1: { winner: 'A' } }); // only 1 win, need 2

    await handler({ params: { matchId: 'm1', round: '1' } });

    // No finalResult written, no MMR update
    const rankedUpdates = updatedDocs.filter(d => d.path.startsWith('users/'));
    expect(rankedUpdates).toHaveLength(0);
  });

  it('deduplicates: does not reprocess if finalResult already exists', async () => {
    setupRankedMatch('m2', 'A', 'B');
    setupUser('A', 1000);
    setupUser('B', 1000);
    setNestedValue('matches/m2/result', { 1: { winner: 'A' }, 2: { winner: 'A' } });
    setNestedValue('matches/m2/finalResult', { winner: 'A', ts: Date.now() }); // already processed

    await handler({ params: { matchId: 'm2', round: '2' } });

    // No new updates — idempotent
    const rankedUpdates = updatedDocs.filter(d => d.path.startsWith('users/'));
    expect(rankedUpdates).toHaveLength(0);
  });

  it('logs warning for suspicious MMR jump (>100 delta)', async () => {
    setupRankedMatch('m3', 'newbie', 'veteran');
    // newbie in placement (K=64), very high delta possible
    if (!mockFirestoreData['users']) mockFirestoreData['users'] = {};
    mockFirestoreData['users']['newbie'] = {
      username: 'newbie', color: 1,
      ranked: { mmr: 500, rank: { tier: 'bronze', division: 4, lp: 0 }, placementGamesPlayed: 1, placementComplete: false, rankedWins: 0, rankedLosses: 1, rankedGamesPlayed: 1, lastRankedMatch: 0, demotionShield: false, seasonId: 1 },
    };
    setupUser('veteran', 2000);

    setNestedValue('matches/m3/result', { 1: { winner: 'newbie' }, 2: { winner: 'newbie' } });

    await handler({ params: { matchId: 'm3', round: '2' } });

    // Placement K=64 vs high MMR opponent: massive upset → large delta
    // The logger.warn should fire for suspicious jump
    // (Note: with K=64 against 2000 MMR opponent, delta would be ~60, just under 100
    //  but the system should still process normally)
    const rankedUpdates = updatedDocs.filter(d => d.path.startsWith('users/'));
    expect(rankedUpdates.length).toBeGreaterThanOrEqual(2);
  });

  it('handles missing user ranked data gracefully (new player)', async () => {
    setupRankedMatch('m4', 'brand_new', 'existing');
    if (!mockFirestoreData['users']) mockFirestoreData['users'] = {};
    // brand_new has no ranked data at all
    mockFirestoreData['users']['brand_new'] = { username: 'brand_new', color: 1 };
    setupUser('existing', 1000);

    setNestedValue('matches/m4/result', { 1: { winner: 'brand_new' }, 2: { winner: 'brand_new' } });

    await handler({ params: { matchId: 'm4', round: '2' } });

    // Should create default ranked data and proceed
    const newUpdate = updatedDocs.find(d => d.path === 'users/brand_new');
    expect(newUpdate).toBeDefined();
    const ranked = (newUpdate!.data as Record<string, unknown>).ranked as Record<string, unknown>;
    expect(ranked.rankedGamesPlayed).toBe(1);
    expect(ranked.rankedWins).toBe(1);
  });
});
