/**
 * Firebase mock factories for Cloud Functions unit tests.
 *
 * These mocks replace firebase-admin and firebase-functions modules
 * so we can test handler logic without a live Firebase connection.
 */
import { vi } from 'vitest';

// ── RTDB Mock ──────────────────────────────────────────────

export interface MockSnapshot {
  val: () => unknown;
  exists: () => boolean;
}

export interface MockRef {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  child: ReturnType<typeof vi.fn>;
}

/** In-memory store keyed by path. Tests populate this to control what the RTDB "returns". */
export const rtdbStore: Record<string, unknown> = {};

function resolveNestedPath(root: unknown, segments: string[]): unknown {
  let current = root;
  for (const seg of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

export function makeSnapshot(val: unknown): MockSnapshot {
  return {
    val: () => val,
    exists: () => val !== null && val !== undefined,
  };
}

export function createMockRef(basePath = ''): MockRef {
  const ref: MockRef = {
    get: vi.fn(async () => {
      const val = resolveNestedPath(rtdbStore, basePath.split('/').filter(Boolean));
      return makeSnapshot(val ?? null);
    }),
    set: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    child: vi.fn((childPath: string) => createMockRef(`${basePath}/${childPath}`)),
  };
  return ref;
}

const refCache: Record<string, MockRef> = {};

export function mockRtdbRef(path: string): MockRef {
  if (!refCache[path]) {
    refCache[path] = createMockRef(path);
  }
  return refCache[path];
}

export function resetRtdbMocks(): void {
  for (const key of Object.keys(rtdbStore)) delete rtdbStore[key];
  for (const key of Object.keys(refCache)) delete refCache[key];
}

// ── Firestore Mock ─────────────────────────────────────────

export interface MockDocSnap {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
  ref: { update: ReturnType<typeof vi.fn> };
}

export interface MockDocRef {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

export interface MockCollection {
  doc: (id: string) => MockDocRef;
  where: ReturnType<typeof vi.fn>;
}

export const firestoreStore: Record<string, Record<string, Record<string, unknown> | undefined>> = {};

export function createMockDocRef(collection: string, docId: string): MockDocRef {
  return {
    get: vi.fn(async () => {
      const data = firestoreStore[collection]?.[docId];
      return {
        exists: data !== undefined,
        data: () => data,
        ref: { update: vi.fn() },
      } as MockDocSnap;
    }),
    set: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
  };
}

export function createMockCollection(name: string): MockCollection {
  return {
    doc: (id: string) => createMockDocRef(name, id),
    where: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        get: vi.fn(async () => ({ empty: true, docs: [], size: 0 })),
      }),
    }),
  };
}

export function resetFirestoreMocks(): void {
  for (const key of Object.keys(firestoreStore)) delete firestoreStore[key];
}

// ── Auth Mock ──────────────────────────────────────────────

export const authUsers: Record<string, { uid: string; providerData: Array<{ providerId: string }> }> = {};

export function createMockAuth() {
  return {
    getUser: vi.fn(async (uid: string) => {
      const user = authUsers[uid];
      if (!user) throw new Error(`User ${uid} not found`);
      return user;
    }),
  };
}

export function resetAuthMocks(): void {
  for (const key of Object.keys(authUsers)) delete authUsers[key];
}

// ── All-in-one reset ───────────────────────────────────────

export function resetAllMocks(): void {
  resetRtdbMocks();
  resetFirestoreMocks();
  resetAuthMocks();
}
