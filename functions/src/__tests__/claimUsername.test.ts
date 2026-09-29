/**
 * Tests for claimUsername Cloud Function.
 *
 * Validates username claiming logic: format validation, uniqueness enforcement
 * via Firestore transaction, and atomic user document creation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock state ───────────────────────────────────

const {
  mockDatabase, mockRunTransaction, mockFirestoreCollection, mockFirestoreDoc,
  txGetResults, txSetCalls,
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

  function createMockRefForPath(path: string): Record<string, unknown> {
    return {
      get: vi.fn(async () => {
        const val = getNestedValue(path);
        return { val: () => val, exists: () => val !== null && val !== undefined };
      }),
      set: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      child: (childPath: string) => createMockRefForPath(`${path}/${childPath}`),
    };
  }

  const mockDatabase = {
    ref: vi.fn((path: string) => createMockRefForPath(path)),
  };

  // Firestore transaction mock state
  const txGetResults: Record<string, { exists: boolean; data: () => Record<string, unknown> | undefined }> = {};
  const txSetCalls: Array<{ path: string; data: unknown }> = [];

  const mockFirestoreDoc = vi.fn((path: string) => ({ path }));

  const mockFirestoreCollection = vi.fn((name: string) => ({
    doc: (id: string) => mockFirestoreDoc(`${name}/${id}`),
  }));

  const mockRunTransaction = vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
    const tx = {
      get: vi.fn(async (docRef: { path: string }) => {
        const result = txGetResults[docRef.path];
        return result || { exists: false, data: () => undefined };
      }),
      set: vi.fn((docRef: { path: string }, data: unknown) => {
        txSetCalls.push({ path: docRef.path, data });
      }),
      update: vi.fn(),
    };
    await fn(tx);
  });

  return {
    mockDatabase, mockRunTransaction, mockFirestoreCollection, mockFirestoreDoc,
    txGetResults, txSetCalls,
  };
});

// ── Mock all firebase modules ────────────────────────────

vi.mock('firebase-admin', () => ({
  default: {
    initializeApp: vi.fn(),
    database: vi.fn(() => mockDatabase),
    firestore: vi.fn(() => ({
      collection: mockFirestoreCollection,
      doc: mockFirestoreDoc,
      runTransaction: mockRunTransaction,
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
      doc: mockFirestoreDoc,
      runTransaction: mockRunTransaction,
    })),
    { FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TS'), delete: vi.fn() } },
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
    doc: mockFirestoreDoc,
    runTransaction: mockRunTransaction,
  })),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TS'), delete: vi.fn() },
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

import { claimUsername } from '../index';

const claimUsernameFn = claimUsername as unknown as (request: unknown) => Promise<unknown>;

// ── Tests ────────────────────────────────────────────────

describe('claimUsername', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txSetCalls.length = 0;
    for (const key of Object.keys(txGetResults)) delete txGetResults[key];
  });

  it('should accept a valid username and create user doc', async () => {
    const result = await claimUsernameFn({
      auth: { uid: 'user1' },
      data: { username: 'ValidUser', email: 'test@example.com' },
    });

    expect(result).toEqual({ success: true });
    expect(mockRunTransaction).toHaveBeenCalled();
  });

  it('should reject username shorter than 3 characters', async () => {
    await expect(
      claimUsernameFn({
        auth: { uid: 'user1' },
        data: { username: 'ab' },
      }),
    ).rejects.toThrow('Username must be 3-20 characters');
  });

  it('should reject username longer than 20 characters', async () => {
    await expect(
      claimUsernameFn({
        auth: { uid: 'user1' },
        data: { username: 'a'.repeat(21) },
      }),
    ).rejects.toThrow('Username must be 3-20 characters');
  });

  it('should reject username with special characters', async () => {
    await expect(
      claimUsernameFn({
        auth: { uid: 'user1' },
        data: { username: 'user@name!' },
      }),
    ).rejects.toThrow('Letters, numbers, _ and - only');
  });

  it('should reject username with spaces', async () => {
    await expect(
      claimUsernameFn({
        auth: { uid: 'user1' },
        data: { username: 'my name' },
      }),
    ).rejects.toThrow('Letters, numbers, _ and - only');
  });

  it('should reject when username is already taken by another user', async () => {
    txGetResults['usernames/takenuser'] = {
      exists: true,
      data: () => ({ uid: 'other_user' }),
    };

    await expect(
      claimUsernameFn({
        auth: { uid: 'user1' },
        data: { username: 'TakenUser' },
      }),
    ).rejects.toThrow('Username is already taken');
  });

  it('should allow reclaiming own username', async () => {
    txGetResults['usernames/myname'] = {
      exists: true,
      data: () => ({ uid: 'user1' }),
    };

    const result = await claimUsernameFn({
      auth: { uid: 'user1' },
      data: { username: 'MyName' },
    });

    expect(result).toEqual({ success: true });
  });

  it('should reject unauthenticated requests', async () => {
    await expect(
      claimUsernameFn({
        auth: undefined,
        data: { username: 'ValidUser' },
      }),
    ).rejects.toThrow('Must be signed in');
  });

  it('should reject non-string username', async () => {
    await expect(
      claimUsernameFn({
        auth: { uid: 'user1' },
        data: { username: 12345 },
      }),
    ).rejects.toThrow('username required');
  });

  it('should accept username with underscores and hyphens', async () => {
    const result = await claimUsernameFn({
      auth: { uid: 'user1' },
      data: { username: 'my_cool-name' },
    });

    expect(result).toEqual({ success: true });
  });

  it('should trim whitespace and check length on trimmed value', async () => {
    await expect(
      claimUsernameFn({
        auth: { uid: 'user1' },
        data: { username: '  ab  ' },
      }),
    ).rejects.toThrow('Username must be 3-20 characters');
  });

  it('should use lowercase for uniqueness check', async () => {
    await claimUsernameFn({
      auth: { uid: 'user1' },
      data: { username: 'MyName' },
    });

    expect(mockFirestoreDoc).toHaveBeenCalledWith('usernames/myname');
  });

  it('should preserve original casing in user doc', async () => {
    await claimUsernameFn({
      auth: { uid: 'user1' },
      data: { username: 'CamelCase' },
    });

    expect(txSetCalls.some(
      c => c.path === 'users/user1' &&
           (c.data as Record<string, unknown>).username === 'CamelCase',
    )).toBe(true);
  });
});
