/**
 * Tests for claimForfeit Cloud Function.
 *
 * Validates server-side disconnect forfeit logic: heartbeat staleness check,
 * participant verification, and double-claim prevention.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock state ───────────────────────────────────

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
  const mockFirestoreCollection = vi.fn().mockReturnValue({
    doc: vi.fn().mockReturnValue({
      get: vi.fn(async () => ({ exists: false, data: () => undefined })),
      set: vi.fn(),
      update: vi.fn(),
    }),
  });

  return {
    mockRtdbData, mockRefSet: mockRefSetInner, mockDatabase,
    mockFirestoreRunTransaction, mockFirestoreCollection,
    getNestedValue, setNestedValue,
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
        uid, providerData: [{ providerId: 'password' }],
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
  getFirestore: vi.fn(() => ({
    collection: mockFirestoreCollection,
    runTransaction: mockFirestoreRunTransaction,
  })),
  FieldValue: { serverTimestamp: vi.fn(), delete: vi.fn() },
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

// ── Import ───────────────────────────────────────────────

import { claimForfeit } from '../index';

const claimForfeitFn = claimForfeit as unknown as (request: unknown) => Promise<unknown>;

// ── Helpers ──────────────────────────────────────────────

function clearRtdb(): void {
  for (const key of Object.keys(mockRtdbData)) delete mockRtdbData[key];
  mockRefSet.mockClear();
}

// ── Tests ────────────────────────────────────────────────

describe('claimForfeit', () => {
  beforeEach(() => {
    clearRtdb();
    vi.clearAllMocks();
    mockFirestoreRunTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        get: vi.fn(async () => ({ exists: false, data: () => undefined })),
        set: vi.fn(),
        update: vi.fn(),
      };
      await fn(tx);
    });
  });

  it('should award win when opponent heartbeat is stale (>15s)', async () => {
    const now = Date.now();
    setNestedValue('matches/m1/meta', {
      players: ['claimant', 'opponent'],
      seriesLength: 3,
    });
    setNestedValue('matches/m1/heartbeat/opponent', now - 20_000);

    const result = await claimForfeitFn({
      auth: { uid: 'claimant' },
      data: { matchId: 'm1' },
    });

    expect(result).toEqual({ success: true, winner: 'claimant' });
    expect(mockRefSet).toHaveBeenCalledWith(
      expect.objectContaining({
        winner: 'claimant',
        losers: ['opponent'],
        reason: 'forfeit_disconnect',
      }),
    );
  });

  it('should reject when opponent heartbeat is fresh', async () => {
    const now = Date.now();
    setNestedValue('matches/m2/meta', {
      players: ['claimant', 'opponent'],
      seriesLength: 3,
    });
    setNestedValue('matches/m2/heartbeat/opponent', now - 5_000);

    await expect(
      claimForfeitFn({
        auth: { uid: 'claimant' },
        data: { matchId: 'm2' },
      }),
    ).rejects.toThrow('All opponents are still connected');
  });

  it('should reject when claimant is not a participant', async () => {
    setNestedValue('matches/m3/meta', {
      players: ['playerA', 'playerB'],
      seriesLength: 3,
    });

    await expect(
      claimForfeitFn({
        auth: { uid: 'intruder' },
        data: { matchId: 'm3' },
      }),
    ).rejects.toThrow('Not a participant');
  });

  it('should reject when match already has a finalResult (double-claim)', async () => {
    const now = Date.now();
    setNestedValue('matches/m4/meta', {
      players: ['claimant', 'opponent'],
      seriesLength: 3,
    });
    setNestedValue('matches/m4/heartbeat/opponent', now - 20_000);
    setNestedValue('matches/m4/finalResult', {
      winner: 'claimant',
    });

    await expect(
      claimForfeitFn({
        auth: { uid: 'claimant' },
        data: { matchId: 'm4' },
      }),
    ).rejects.toThrow('Match already has a result');
  });

  it('should reject unauthenticated requests', async () => {
    await expect(
      claimForfeitFn({
        auth: null,
        data: { matchId: 'm5' },
      }),
    ).rejects.toThrow('Must be signed in');
  });

  it('should reject when matchId is missing', async () => {
    await expect(
      claimForfeitFn({
        auth: { uid: 'claimant' },
        data: {},
      }),
    ).rejects.toThrow('Missing matchId');
  });

  it('should reject when match does not exist', async () => {
    await expect(
      claimForfeitFn({
        auth: { uid: 'claimant' },
        data: { matchId: 'nonexistent' },
      }),
    ).rejects.toThrow('Match not found');
  });

  it('should handle null heartbeat as stale', async () => {
    setNestedValue('matches/m6/meta', {
      players: ['claimant', 'opponent'],
      seriesLength: 3,
    });

    const result = await claimForfeitFn({
      auth: { uid: 'claimant' },
      data: { matchId: 'm6' },
    });

    expect(result).toEqual({ success: true, winner: 'claimant' });
  });
});
