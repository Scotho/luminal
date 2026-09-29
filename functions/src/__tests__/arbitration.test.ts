/**
 * Tests for arbitrateRoundEnd and checkSeriesEnd Cloud Functions.
 *
 * These functions handle match result arbitration via majority vote
 * and series completion detection — critical trust boundary logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock state (available inside vi.mock factories) ──

const {
  mockRtdbData, mockRefSet, mockDatabase,
  mockFirestoreRunTransaction, mockFirestoreCollection,
  setNestedValue,
} = vi.hoisted(() => {
  const mockRtdbData: Record<string, unknown> = {};

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

  const mockRefSetInner = vi.fn(async (_val: unknown) => {});

  function createMockRefForPath(path: string): Record<string, unknown> {
    return {
      get: vi.fn(async () => {
        const val = getNestedValue(path);
        return { val: () => val, exists: () => val !== null && val !== undefined };
      }),
      set: vi.fn(async (val: unknown) => {
        setNestedValue(path, val);
        mockRefSetInner(val);
      }),
      update: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      child: (childPath: string) => createMockRefForPath(`${path}/${childPath}`),
    };
  }

  const mockDatabase = {
    ref: vi.fn((path: string) => createMockRefForPath(path)),
  };

  const mockFirestoreRunTransaction = vi.fn();
  const mockFirestoreCollection = vi.fn();

  return {
    mockRtdbData,
    mockRefSet: mockRefSetInner,
    mockDatabase,
    mockFirestoreRunTransaction,
    mockFirestoreCollection,
    getNestedValue,
    setNestedValue,
    createMockRefForPath,
  };
});

// ── Mock all firebase modules ────────────────────────────

vi.mock('firebase-admin', () => ({
  default: {
    initializeApp: vi.fn(),
    database: vi.fn(() => mockDatabase),
    firestore: vi.fn(() => ({
      collection: mockFirestoreCollection,
      runTransaction: mockFirestoreRunTransaction,
    })),
    auth: vi.fn(() => ({
      getUser: vi.fn(async (uid: string) => ({
        uid,
        providerData: [{ providerId: 'password' }],
      })),
    })),
  },
  initializeApp: vi.fn(),
  database: Object.assign(vi.fn(() => mockDatabase), {
    ServerValue: { TIMESTAMP: 'MOCK_TIMESTAMP' },
  }),
  firestore: Object.assign(
    vi.fn(() => ({
      collection: mockFirestoreCollection,
      runTransaction: mockFirestoreRunTransaction,
    })),
    { FieldValue: { serverTimestamp: vi.fn(), delete: vi.fn() } },
  ),
  auth: vi.fn(() => ({
    getUser: vi.fn(async (uid: string) => ({
      uid,
      providerData: [{ providerId: 'password' }],
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
  getFirestore: vi.fn(() => ({
    collection: mockFirestoreCollection,
    runTransaction: mockFirestoreRunTransaction,
  })),
  FieldValue: { serverTimestamp: vi.fn(), delete: vi.fn() },
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({
    getUser: vi.fn(async (uid: string) => ({
      uid,
      providerData: [{ providerId: 'password' }],
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
    constructor(public code: string, message: string) {
      super(message);
    }
  },
}));

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: vi.fn((_opts: unknown, handler: unknown) => handler),
}));

vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Import (mocks hoisted above) ────────────────────────

import { arbitrateRoundEnd, checkSeriesEnd } from '../index';

const arbitrateHandler = arbitrateRoundEnd as unknown as (event: unknown) => Promise<void>;
const checkSeriesHandler = checkSeriesEnd as unknown as (event: unknown) => Promise<void>;

// ── Helpers ──────────────────────────────────────────────

function clearRtdb(): void {
  for (const key of Object.keys(mockRtdbData)) delete mockRtdbData[key];
  mockRefSet.mockClear();
}

// ── Tests ────────────────────────────────────────────────

describe('arbitrateRoundEnd', () => {
  beforeEach(() => {
    clearRtdb();
    vi.clearAllMocks();
  });

  it('should write canonical result when all players agree on winner', async () => {
    setNestedValue('matches/m1/meta', {
      players: ['playerA', 'playerB'],
      seriesLength: 3,
    });
    setNestedValue('matches/m1/roundEnd', {
      playerA: { round: 1, winner: 'playerA' },
      playerB: { round: 1, winner: 'playerA' },
    });

    await arbitrateHandler({ params: { matchId: 'm1', uid: 'playerA' } });

    expect(mockRefSet).toHaveBeenCalledWith(
      expect.objectContaining({
        round: 1,
        winner: 'playerA',
        players: ['playerA', 'playerB'],
      }),
    );
  });

  it('should resolve disagreement via majority vote', async () => {
    setNestedValue('matches/m2/meta', {
      players: ['playerA', 'playerB', 'playerC'],
      seriesLength: 3,
    });
    setNestedValue('matches/m2/roundEnd', {
      playerA: { round: 1, winner: 'playerA' },
      playerB: { round: 1, winner: 'playerB' },
      playerC: { round: 1, winner: 'playerA' },
    });

    await arbitrateHandler({ params: { matchId: 'm2', uid: 'playerA' } });

    expect(mockRefSet).toHaveBeenCalledWith(
      expect.objectContaining({ winner: 'playerA' }),
    );
  });

  it('should resolve tie votes as draw', async () => {
    setNestedValue('matches/m3/meta', {
      players: ['playerA', 'playerB'],
      seriesLength: 3,
    });
    setNestedValue('matches/m3/roundEnd', {
      playerA: { round: 1, winner: 'playerA' },
      playerB: { round: 1, winner: 'playerB' },
    });

    await arbitrateHandler({ params: { matchId: 'm3', uid: 'playerA' } });

    expect(mockRefSet).toHaveBeenCalledWith(
      expect.objectContaining({ winner: 'draw' }),
    );
  });

  it('should not overwrite existing result (idempotency)', async () => {
    setNestedValue('matches/m4/meta', {
      players: ['playerA', 'playerB'],
      seriesLength: 3,
    });
    setNestedValue('matches/m4/roundEnd', {
      playerA: { round: 1, winner: 'playerA' },
      playerB: { round: 1, winner: 'playerA' },
    });
    setNestedValue('matches/m4/result/1', {
      round: 1,
      winner: 'playerA',
    });

    await arbitrateHandler({ params: { matchId: 'm4', uid: 'playerA' } });

    expect(mockRefSet).not.toHaveBeenCalled();
  });

  it('should wait until all players have submitted', async () => {
    setNestedValue('matches/m5/meta', {
      players: ['playerA', 'playerB'],
      seriesLength: 3,
    });
    setNestedValue('matches/m5/roundEnd', {
      playerA: { round: 1, winner: 'playerA' },
    });

    await arbitrateHandler({ params: { matchId: 'm5', uid: 'playerA' } });

    expect(mockRefSet).not.toHaveBeenCalled();
  });

  it('should return early if roundEnd is empty', async () => {
    setNestedValue('matches/m6/meta', {
      players: ['playerA', 'playerB'],
      seriesLength: 3,
    });

    await arbitrateHandler({ params: { matchId: 'm6', uid: 'playerA' } });
    expect(mockRefSet).not.toHaveBeenCalled();
  });

  it('should warn on round mismatch and not write result', async () => {
    const { logger } = await import('firebase-functions');

    setNestedValue('matches/m7/meta', {
      players: ['playerA', 'playerB'],
      seriesLength: 3,
    });
    setNestedValue('matches/m7/roundEnd', {
      playerA: { round: 1, winner: 'playerA' },
      playerB: { round: 2, winner: 'playerB' },
    });

    await arbitrateHandler({ params: { matchId: 'm7', uid: 'playerA' } });

    expect(mockRefSet).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('should fall back to player1/player2 meta format', async () => {
    setNestedValue('matches/m8/meta', {
      player1: 'playerA',
      player2: 'playerB',
      seriesLength: 3,
    });
    setNestedValue('matches/m8/roundEnd', {
      playerA: { round: 1, winner: 'playerA' },
      playerB: { round: 1, winner: 'playerA' },
    });

    await arbitrateHandler({ params: { matchId: 'm8', uid: 'playerA' } });

    expect(mockRefSet).toHaveBeenCalledWith(
      expect.objectContaining({ winner: 'playerA' }),
    );
  });
});

describe('checkSeriesEnd', () => {
  beforeEach(() => {
    clearRtdb();
    vi.clearAllMocks();
    mockFirestoreCollection.mockReturnValue({
      doc: vi.fn().mockReturnValue({
        get: vi.fn(async () => ({ exists: false, data: () => undefined })),
        set: vi.fn(),
        update: vi.fn(),
      }),
    });
    mockFirestoreRunTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        get: vi.fn(async () => ({ exists: false, data: () => undefined })),
        set: vi.fn(),
        update: vi.fn(),
      };
      await fn(tx);
    });
  });

  it('should write finalResult when player reaches winsNeeded (bo3)', async () => {
    setNestedValue('matches/m1/meta', {
      players: ['playerA', 'playerB'],
      seriesLength: 3,
    });
    setNestedValue('matches/m1/result', {
      1: { winner: 'playerA' },
      2: { winner: 'playerA' },
    });

    await checkSeriesHandler({ params: { matchId: 'm1', round: '2' } });

    expect(mockRefSet).toHaveBeenCalledWith(
      expect.objectContaining({
        winner: 'playerA',
        losers: ['playerB'],
        seriesLength: 3,
      }),
    );
  });

  it('should not end series if no player has enough wins', async () => {
    setNestedValue('matches/m2/meta', {
      players: ['playerA', 'playerB'],
      seriesLength: 3,
    });
    setNestedValue('matches/m2/result', {
      1: { winner: 'playerA' },
      2: { winner: 'playerB' },
    });

    await checkSeriesHandler({ params: { matchId: 'm2', round: '2' } });

    expect(mockRefSet).not.toHaveBeenCalled();
  });

  it('should not overwrite existing finalResult (idempotency)', async () => {
    setNestedValue('matches/m3/meta', {
      players: ['playerA', 'playerB'],
      seriesLength: 3,
    });
    setNestedValue('matches/m3/result', {
      1: { winner: 'playerA' },
      2: { winner: 'playerA' },
    });
    setNestedValue('matches/m3/finalResult', {
      winner: 'playerA',
    });

    await checkSeriesHandler({ params: { matchId: 'm3', round: '2' } });

    expect(mockRefSet).not.toHaveBeenCalled();
  });

  it('should handle bo5 series correctly (need 3 wins)', async () => {
    setNestedValue('matches/m4/meta', {
      players: ['playerA', 'playerB'],
      seriesLength: 5,
    });
    setNestedValue('matches/m4/result', {
      1: { winner: 'playerA' },
      2: { winner: 'playerB' },
      3: { winner: 'playerA' },
      4: { winner: 'playerA' },
    });

    await checkSeriesHandler({ params: { matchId: 'm4', round: '4' } });

    expect(mockRefSet).toHaveBeenCalledWith(
      expect.objectContaining({
        winner: 'playerA',
        seriesLength: 5,
      }),
    );
  });

  it('should count draws as non-wins', async () => {
    setNestedValue('matches/m5/meta', {
      players: ['playerA', 'playerB'],
      seriesLength: 3,
    });
    setNestedValue('matches/m5/result', {
      1: { winner: 'playerA' },
      2: { winner: 'draw' },
      3: { winner: 'playerB' },
    });

    await checkSeriesHandler({ params: { matchId: 'm5', round: '3' } });

    expect(mockRefSet).not.toHaveBeenCalled();
  });

  it('should default seriesLength to 3 if not set', async () => {
    setNestedValue('matches/m6/meta', {
      players: ['playerA', 'playerB'],
    });
    setNestedValue('matches/m6/result', {
      1: { winner: 'playerB' },
      2: { winner: 'playerB' },
    });

    await checkSeriesHandler({ params: { matchId: 'm6', round: '2' } });

    expect(mockRefSet).toHaveBeenCalledWith(
      expect.objectContaining({
        winner: 'playerB',
        seriesLength: 3,
      }),
    );
  });
});
