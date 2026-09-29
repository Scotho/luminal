/**
 * Tests for cleanupStaleLobbies and cleanupStaleMatches Cloud Functions.
 *
 * Validates scheduled cleanup logic: lobby staleness criteria,
 * match TTL enforcement, and queue presence cleanup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock state ───────────────────────────────────

const {
  mockRtdbData, removedPaths, mockDatabase,
  mockFirestoreCollection, mockFirestoreBatchDelete, mockFirestoreBatchCommit,
  setNestedValue,
} = vi.hoisted(() => {
  const mockRtdbData: Record<string, unknown> = {};
  const removedPaths: string[] = [];

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
      remove: vi.fn(async () => { removedPaths.push(path); }),
      child: (childPath: string) => createMockRefForPath(`${path}/${childPath}`),
    };
  }

  const mockDatabase = {
    ref: vi.fn((path: string) => createMockRefForPath(path)),
  };

  const mockFirestoreBatchDelete = vi.fn();
  const mockFirestoreBatchCommit = vi.fn(async () => {});
  const mockFirestoreCollection = vi.fn().mockReturnValue({
    doc: vi.fn().mockReturnValue({
      get: vi.fn(async () => ({ exists: false, data: () => undefined })),
    }),
    where: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        get: vi.fn(async () => ({ empty: true, docs: [], size: 0 })),
      }),
    }),
  });

  return {
    mockRtdbData, removedPaths, mockDatabase,
    mockFirestoreCollection, mockFirestoreBatchDelete, mockFirestoreBatchCommit,
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
      batch: vi.fn(() => ({
        delete: mockFirestoreBatchDelete,
        commit: mockFirestoreBatchCommit,
      })),
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
      batch: vi.fn(() => ({
        delete: mockFirestoreBatchDelete,
        commit: mockFirestoreBatchCommit,
      })),
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
    batch: vi.fn(() => ({
      delete: mockFirestoreBatchDelete,
      commit: mockFirestoreBatchCommit,
    })),
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

import { cleanupStaleLobbies, cleanupStaleMatches } from '../index';

const cleanupLobbiesHandler = cleanupStaleLobbies as unknown as () => Promise<void>;
const cleanupMatchesHandler = cleanupStaleMatches as unknown as () => Promise<void>;

// ── Helpers ──────────────────────────────────────────────

function clearState(): void {
  for (const key of Object.keys(mockRtdbData)) delete mockRtdbData[key];
  removedPaths.length = 0;
}

const TWO_MINUTES = 2 * 60 * 1000;
const TWO_HOURS = 2 * 60 * 60 * 1000;

// ── Tests: cleanupStaleLobbies ───────────────────────────

describe('cleanupStaleLobbies', () => {
  beforeEach(() => {
    clearState();
    vi.clearAllMocks();
  });

  it('should remove lobby with offline host and old disconnectedAt', async () => {
    const now = Date.now();
    setNestedValue('lobbies', {
      lobby1: {
        status: 'waiting',
        createdAt: now - 60_000,
        host: { presence: false, disconnectedAt: now - TWO_MINUTES - 1000 },
      },
    });

    await cleanupLobbiesHandler();

    expect(removedPaths).toContain('lobbies/lobby1');
  });

  it('should remove active lobbies past absolute cutoff', async () => {
    const now = Date.now();
    setNestedValue('lobbies', {
      active1: {
        status: 'active',
        createdAt: now - TWO_HOURS - 1000,
        host: { presence: false, disconnectedAt: now - TWO_MINUTES - 1000 },
      },
    });

    await cleanupLobbiesHandler();

    expect(removedPaths).toContain('lobbies/active1');
  });

  it('should keep fresh active lobby under absolute cutoff', async () => {
    const now = Date.now();
    setNestedValue('lobbies', {
      active1: {
        status: 'active',
        createdAt: now - 30 * 60 * 1000, // 30 min, well under 2h
        host: { presence: true },
      },
    });

    await cleanupLobbiesHandler();

    expect(removedPaths).toHaveLength(0);
  });

  it('should remove lobby older than 2 hours absolute cutoff', async () => {
    const now = Date.now();
    setNestedValue('lobbies', {
      old1: {
        status: 'waiting',
        createdAt: now - TWO_HOURS - 1000,
        host: { presence: true },
      },
    });

    await cleanupLobbiesHandler();

    expect(removedPaths).toContain('lobbies/old1');
  });

  it('should remove corrupted lobby with no host field', async () => {
    setNestedValue('lobbies', {
      corrupted1: {
        status: 'waiting',
        createdAt: Date.now(),
      },
    });

    await cleanupLobbiesHandler();

    expect(removedPaths).toContain('lobbies/corrupted1');
  });

  it('should NOT remove lobby with offline host but alive guest', async () => {
    const now = Date.now();
    setNestedValue('lobbies', {
      lobby1: {
        status: 'waiting',
        createdAt: now - 60_000,
        host: { presence: false, disconnectedAt: now - TWO_MINUTES - 1000 },
        guests: { uid1: { presence: true } },
      },
    });

    await cleanupLobbiesHandler();

    expect(removedPaths).not.toContain('lobbies/lobby1');
  });

  it('should remove lobby in returning status past absolute cutoff', async () => {
    const now = Date.now();
    setNestedValue('lobbies', {
      returning1: {
        status: 'returning',
        createdAt: now - TWO_HOURS - 1000,
        host: { presence: true },
      },
    });

    await cleanupLobbiesHandler();

    expect(removedPaths).toContain('lobbies/returning1');
  });

  it('should do nothing when no lobbies exist', async () => {
    await cleanupLobbiesHandler();

    expect(removedPaths).toHaveLength(0);
  });

  it('should keep fresh lobby with online host', async () => {
    const now = Date.now();
    setNestedValue('lobbies', {
      fresh1: {
        status: 'waiting',
        createdAt: now - 30_000,
        host: { presence: true },
      },
    });

    await cleanupLobbiesHandler();

    expect(removedPaths).toHaveLength(0);
  });

  it('should remove lobby with unexpected status past absolute cutoff', async () => {
    const now = Date.now();
    setNestedValue('lobbies', {
      weird1: {
        status: 'ended',
        createdAt: now - TWO_HOURS - 1000,
        host: { presence: true },
      },
    });

    await cleanupLobbiesHandler();

    expect(removedPaths).toContain('lobbies/weird1');
  });

  it('should remove lobby with host presence undefined and old disconnectedAt', async () => {
    const now = Date.now();
    setNestedValue('lobbies', {
      ghost1: {
        status: 'waiting',
        createdAt: now - 60_000,
        host: { disconnectedAt: now - TWO_MINUTES - 1000 },
      },
    });

    await cleanupLobbiesHandler();

    expect(removedPaths).toContain('lobbies/ghost1');
  });
});

// ── Tests: cleanupStaleMatches ───────────────────────────

describe('cleanupStaleMatches', () => {
  beforeEach(() => {
    clearState();
    vi.clearAllMocks();
  });

  it('should remove RTDB matches older than 24 hours', async () => {
    const now = Date.now();
    const dayPlus = 25 * 60 * 60 * 1000;
    setNestedValue('matches', {
      old1: { meta: { ts: now - dayPlus } },
    });

    await cleanupMatchesHandler();

    expect(removedPaths).toContain('matches/old1');
  });

  it('should keep recent RTDB matches', async () => {
    const now = Date.now();
    setNestedValue('matches', {
      recent1: { meta: { ts: now - 3600_000 } },
    });

    await cleanupMatchesHandler();

    expect(removedPaths).not.toContain('matches/recent1');
  });

  it('should clean stale queue entries older than 5 minutes', async () => {
    const now = Date.now();
    setNestedValue('queuePresence', {
      user1: now - 400_000,
      user2: now - 60_000,
    });

    await cleanupMatchesHandler();

    expect(removedPaths).toContain('queuePresence/user1');
    expect(removedPaths).not.toContain('queuePresence/user2');
  });
});
