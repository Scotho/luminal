// ── Matchmaking Tests ───────────────────────────────────
// Verifies the race-condition fix: when tryFindMatch's createMatch fails
// (opponent matched us first), the passive listenForMatch listener must
// still fire so both players see the "match found" popup.

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// ── Mock Firebase modules BEFORE importing matchmaking ──
const mockOnSnapshot = vi.fn(() => vi.fn()); // returns unsub
const mockRunTransaction = vi.fn();
const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockDoc = vi.fn((_db: unknown, _col: string, id: string) => ({ __id: id }));
const mockCollection = vi.fn();
const mockSetDoc = vi.fn();
const mockDeleteDoc = vi.fn();
const mockQuery = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => mockDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  limit: (...args: unknown[]) => mockLimit(...args),
}));

const mockRef = vi.fn((_db: unknown, path: string) => ({ __path: path }));
const mockSet = vi.fn(() => Promise.resolve());
const mockGet = vi.fn(() => Promise.resolve({ exists: () => false, val: () => null }));
const mockOnValue = vi.fn();
const mockRemove = vi.fn(() => Promise.resolve());
const mockOnDisconnect = vi.fn(() => ({ remove: vi.fn(() => Promise.resolve()) }));

const mockRtdbQuery = vi.fn((...args: unknown[]) => args[0]);
const mockLimitToFirst = vi.fn(() => ({}));
const mockRtdbRunTransaction = vi.fn((_ref: unknown, updater: (val: unknown) => unknown) => {
  const result = updater(null);
  return Promise.resolve({ committed: result !== undefined, snapshot: null });
});

vi.mock('firebase/database', () => ({
  ref: (...args: unknown[]) => mockRef(...args),
  set: (...args: unknown[]) => mockSet(...args),
  get: (...args: unknown[]) => mockGet(...args),
  onValue: (...args: unknown[]) => mockOnValue(...args),
  remove: (...args: unknown[]) => mockRemove(...args),
  onDisconnect: (...args: unknown[]) => mockOnDisconnect(...args),
  query: (...args: unknown[]) => mockRtdbQuery(...args),
  limitToFirst: (...args: unknown[]) => mockLimitToFirst(...args),
  runTransaction: (...args: unknown[]) => mockRtdbRunTransaction(...args),
}));

vi.mock('./firebase', () => ({
  db: { __db: true },
  rtdb: { __rtdb: true },
  auth: { currentUser: null },
}));

import { enterQueue, leaveQueue, onMatchFound, listenForMatch } from './matchmaking';
import type { MatchFoundData } from './types/index';

// ── Helpers ─────────────────────────────────────────────

/** Build a mock Firestore query snapshot from an array of {id, data} entries */
function makeQueueSnap(entries: Array<{ id: string; data: Record<string, unknown> }>) {
  const docs = entries.map(e => ({
    id: e.id,
    data: () => e.data,
    exists: () => true,
  }));
  return {
    docs,
    empty: docs.length === 0,
    forEach: (cb: (d: { id: string; data: () => Record<string, unknown> }) => void) => docs.forEach(cb),
  };
}

/** Build a mock RTDB presence snapshot */
function makePresenceSnap(uids: string[]) {
  const val: Record<string, number> = {};
  uids.forEach(u => { val[u] = Date.now(); });
  return {
    exists: () => uids.length > 0,
    val: () => (uids.length > 0 ? val : null),
  };
}

describe('Matchmaking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Default: RTDB presence returns empty, Firestore queue returns empty
    mockGet.mockResolvedValue(makePresenceSnap([]));
    mockGetDocs.mockResolvedValue(makeQueueSnap([]));
    mockSetDoc.mockResolvedValue(undefined);
    mockDeleteDoc.mockResolvedValue(undefined);
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => null });
    mockRunTransaction.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initiator gets match callback when createMatch succeeds', async () => {
    const callback = vi.fn();
    onMatchFound(callback);

    // Presence shows both players online
    mockGet.mockResolvedValue(makePresenceSnap(['playerA', 'playerB']));

    // Queue has playerB waiting
    mockGetDocs.mockResolvedValue(makeQueueSnap([
      { id: 'playerA', data: { uid: 'playerA', username: 'A', color: 1, status: 'waiting', joinedAt: Date.now() } },
      { id: 'playerB', data: { uid: 'playerB', username: 'B', color: 2, status: 'waiting', joinedAt: Date.now() } },
    ]));

    // Transaction succeeds (we are the initiator)
    mockRunTransaction.mockImplementation(async (_db: unknown, fn: (t: unknown) => Promise<void>) => {
      const fakeTransaction = {
        get: (ref: { __id: string }) => Promise.resolve({
          exists: () => true,
          data: () => ({ status: 'waiting' }),
        }),
        update: vi.fn(),
        set: vi.fn(),
      };
      await fn(fakeTransaction);
    });

    // enterQueue triggers immediate tryFindMatch
    await enterQueue('playerA', 'A', 1);

    // Let the immediate tryFindMatch resolve
    await vi.advanceTimersByTimeAsync(0);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      opponents: [{ uid: 'playerB', name: 'B', color: 2, mapVote: null }],
      isInitiator: true,
      myMapVote: null,
    }));

    // Cleanup
    await leaveQueue('playerA');
  });

  it('passive player gets callback when createMatch fails (race condition)', async () => {
    const callback = vi.fn();
    onMatchFound(callback);

    // Presence shows both online
    mockGet.mockResolvedValue(makePresenceSnap(['playerA', 'playerB']));

    // Queue shows playerB waiting (playerA finds them)
    mockGetDocs
      // First call: pruneStaleQueue in enterQueue — empty
      .mockResolvedValueOnce(makeQueueSnap([]))
      // Second call: tryFindMatch — sees playerB waiting
      .mockResolvedValueOnce(makeQueueSnap([
        { id: 'playerA', data: { uid: 'playerA', username: 'A', color: 1, status: 'waiting', joinedAt: Date.now() } },
        { id: 'playerB', data: { uid: 'playerB', username: 'B', color: 2, status: 'waiting', joinedAt: Date.now() } },
      ]));

    // Transaction FAILS — opponent already matched us (race lost)
    mockRunTransaction.mockRejectedValue(new Error('Already matched'));

    const matchDoc = {
      id: 'match123',
      players: [
        { uid: 'playerB', username: 'B', color: 2 },
        { uid: 'playerA', username: 'A', color: 1 },
      ],
      seed: 42,
      status: 'pending',
      createdAt: Date.now(),
    };
    // First getDoc: queue doc shows matched; second getDoc: onlineMatches direct fetch
    mockGetDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ uid: 'playerA', status: 'matched', matchId: 'match123' }) })
      .mockResolvedValueOnce({ exists: () => true, data: () => matchDoc, id: 'match123' });

    await enterQueue('playerA', 'A', 1);
    await vi.advanceTimersByTimeAsync(0);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      matchId: 'match123',
      opponents: [{ uid: 'playerB', name: 'B', color: 2, mapVote: null }],
      isInitiator: false,
      myMapVote: null,
    }));

    await leaveQueue('playerA');
  });

  it('listenForMatch fires when queue doc changes to matched', async () => {
    const callback = vi.fn();
    let snapshotCallback: ((snap: unknown) => void) | null = null;

    // Capture the onSnapshot callback
    mockOnSnapshot.mockImplementation((_docRef: unknown, cb: (snap: unknown) => void) => {
      snapshotCallback = cb;
      return vi.fn(); // unsub function
    });

    // Set _searching = true by entering queue (with empty queue so no match attempt)
    mockGet.mockResolvedValue(makePresenceSnap([]));
    mockGetDocs.mockResolvedValue(makeQueueSnap([]));

    onMatchFound(callback);
    listenForMatch('playerA', callback);
    await enterQueue('playerA', 'A', 1);
    await vi.advanceTimersByTimeAsync(0);

    expect(snapshotCallback).not.toBeNull();

    // Direct fetch of onlineMatches doc (replaces findMyMatch query)
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        players: [
          { uid: 'playerB', username: 'B', color: 2 },
          { uid: 'playerA', username: 'A', color: 1 },
        ],
        seed: 99,
        status: 'pending',
        createdAt: Date.now(),
      }),
      id: 'match456',
    });

    // Simulate opponent matching us — queue doc changes to 'matched'
    snapshotCallback!({
      exists: () => true,
      data: () => ({ uid: 'playerA', status: 'matched', matchId: 'match456' }),
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      matchId: 'match456',
      opponents: [{ uid: 'playerB', name: 'B', color: 2, mapVote: null }],
      isInitiator: false,
      myMapVote: null,
    }));

    await leaveQueue('playerA');
  });

  it('passive listener survives a failed createMatch attempt', async () => {
    // This is the EXACT bug scenario: player A is in queue, polling finds
    // player B, createMatch fails, but the listenForMatch onSnapshot should
    // still be alive and able to fire.

    const callback = vi.fn();
    let snapshotCallback: ((snap: unknown) => void) | null = null;

    mockOnSnapshot.mockImplementation((_docRef: unknown, cb: (snap: unknown) => void) => {
      snapshotCallback = cb;
      return vi.fn();
    });

    onMatchFound(callback);
    listenForMatch('playerA', callback);

    // First: empty queue during enterQueue's pruneStaleQueue
    mockGet.mockResolvedValue(makePresenceSnap(['playerA', 'playerB']));
    mockGetDocs
      .mockResolvedValueOnce(makeQueueSnap([])) // pruneStaleQueue
      .mockResolvedValueOnce(makeQueueSnap([    // tryFindMatch — finds playerB
        { id: 'playerA', data: { uid: 'playerA', username: 'A', color: 1, status: 'waiting', joinedAt: Date.now() } },
        { id: 'playerB', data: { uid: 'playerB', username: 'B', color: 2, status: 'waiting', joinedAt: Date.now() } },
      ]));

    // createMatch fails
    mockRunTransaction.mockRejectedValue(new Error('Already matched'));

    // getDoc for own queue doc — not yet matched (tight race: opponent's tx hasn't committed)
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ uid: 'playerA', status: 'waiting' }),
    });

    // findMyMatch returns nothing (match doc not visible yet)
    mockGetDocs.mockResolvedValue(makeQueueSnap([]));

    await enterQueue('playerA', 'A', 1);
    await vi.advanceTimersByTimeAsync(0);

    // At this point: createMatch failed, own doc still 'waiting',
    // so we fell through to "resume searching". Callback NOT yet fired.
    expect(callback).not.toHaveBeenCalled();

    // Now the passive listener should still be alive.
    // Simulate it firing (opponent's transaction commits, queue doc → matched)
    expect(snapshotCallback).not.toBeNull();

    // Direct fetch of onlineMatches doc after snapshot fires
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        players: [
          { uid: 'playerB', username: 'B', color: 2 },
          { uid: 'playerA', username: 'A', color: 1 },
        ],
        seed: 55,
        status: 'pending',
        createdAt: Date.now(),
      }),
      id: 'match789',
    });

    snapshotCallback!({
      exists: () => true,
      data: () => ({ uid: 'playerA', status: 'matched', matchId: 'match789' }),
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      matchId: 'match789',
      opponents: [{ uid: 'playerB', name: 'B', color: 2, mapVote: null }],
      isInitiator: false,
      myMapVote: null,
    }));

    await leaveQueue('playerA');
  });

  it('does not double-fire callback when listenForMatch and fallback both trigger', async () => {
    // Race scenario: createMatch fails, listenForMatch fires during the
    // fallback's getDoc await. Only ONE showMatchFound should fire.

    const callback = vi.fn();
    let snapshotCallback: ((snap: unknown) => void) | null = null;

    mockOnSnapshot.mockImplementation((_docRef: unknown, cb: (snap: unknown) => void) => {
      snapshotCallback = cb;
      return vi.fn();
    });

    onMatchFound(callback);
    listenForMatch('playerA', callback);

    mockGet.mockResolvedValue(makePresenceSnap(['playerA', 'playerB']));
    mockGetDocs
      .mockResolvedValueOnce(makeQueueSnap([])) // pruneStaleQueue
      .mockResolvedValueOnce(makeQueueSnap([    // tryFindMatch
        { id: 'playerA', data: { uid: 'playerA', username: 'A', color: 1, status: 'waiting', joinedAt: Date.now() } },
        { id: 'playerB', data: { uid: 'playerB', username: 'B', color: 2, status: 'waiting', joinedAt: Date.now() } },
      ]));

    // createMatch fails (opponent matched us first)
    mockRunTransaction.mockRejectedValue(new Error('Already matched'));

    const matchDoc = {
      id: 'match999',
      players: [
        { uid: 'playerB', username: 'B', color: 2 },
        { uid: 'playerA', username: 'A', color: 1 },
      ],
      seed: 77,
      status: 'pending',
      createdAt: Date.now(),
    };

    // getDoc dispatches by doc id:
    // - 'playerA' (queue doc): fires snapshotCallback to simulate race, then returns matched status
    // - 'match999' (onlineMatches doc): returns the match document
    mockGetDoc.mockImplementation((docRef: { __id: string }) => {
      if (docRef.__id === 'playerA') {
        // Simulate the onSnapshot firing DURING this queue-doc await
        if (snapshotCallback) {
          snapshotCallback({
            exists: () => true,
            data: () => ({ uid: 'playerA', status: 'matched', matchId: 'match999' }),
          });
        }
        return Promise.resolve({
          exists: () => true,
          data: () => ({ uid: 'playerA', status: 'matched', matchId: 'match999' }),
        });
      }
      // onlineMatches direct fetch
      return Promise.resolve({ exists: () => true, data: () => matchDoc, id: 'match999' });
    });

    await enterQueue('playerA', 'A', 1);
    await vi.advanceTimersByTimeAsync(0);

    // Callback should fire exactly ONCE, not twice
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      matchId: 'match999',
      opponents: [{ uid: 'playerB', name: 'B', color: 2, mapVote: null }],
      isInitiator: false,
      myMapVote: null,
    }));

    await leaveQueue('playerA');
  });

  it('enterQueue persists mapVote to the queue doc', async () => {
    mockGet.mockResolvedValue(makePresenceSnap([]));
    mockGetDocs.mockResolvedValue(makeQueueSnap([]));

    await enterQueue('playerA', 'A', 'red', 'synth_pit');
    await vi.advanceTimersByTimeAsync(0);

    const queueWrite = mockSetDoc.mock.calls.find(([ref]) => ref.__id === 'playerA');
    expect(queueWrite).toBeDefined();
    expect(queueWrite![1]).toEqual(expect.objectContaining({
      uid: 'playerA',
      username: 'A',
      color: 'red',
      mapVote: 'synth_pit',
    }));

    await leaveQueue('playerA');
  });

  it('createMatch plumbs both mapVotes into match doc + MatchFoundData (initiator)', async () => {
    const callback = vi.fn();
    onMatchFound(callback);

    mockGet.mockResolvedValue(makePresenceSnap(['playerA', 'playerB']));
    mockGetDocs.mockResolvedValue(makeQueueSnap([
      { id: 'playerA', data: { uid: 'playerA', username: 'A', color: 'red', status: 'waiting', joinedAt: Date.now(), mapVote: 'midtown_bowl' } },
      { id: 'playerB', data: { uid: 'playerB', username: 'B', color: 'teal', status: 'waiting', joinedAt: Date.now(), mapVote: 'synth_city' } },
    ]));

    let matchDocWrite: Record<string, unknown> | null = null;
    mockRunTransaction.mockImplementation(async (_db: unknown, fn: (t: unknown) => Promise<void>) => {
      const fakeTransaction = {
        get: (ref: { __id: string }) => Promise.resolve({
          exists: () => true,
          data: () => ref.__id === 'playerA'
            ? { status: 'waiting', mapVote: 'midtown_bowl' }
            : { status: 'waiting', mapVote: 'synth_city' },
        }),
        update: vi.fn(),
        set: (ref: { __id: string }, payload: Record<string, unknown>) => {
          if (ref.__id !== 'playerA' && ref.__id !== 'playerB') matchDocWrite = payload;
        },
      };
      await fn(fakeTransaction);
    });

    await enterQueue('playerA', 'A', 'red', 'midtown_bowl');
    await vi.advanceTimersByTimeAsync(0);

    // Match doc carries both players' mapVotes
    expect(matchDocWrite).not.toBeNull();
    expect((matchDocWrite as { players: Array<{ uid: string; mapVote: string }> }).players).toEqual([
      expect.objectContaining({ uid: 'playerA', mapVote: 'midtown_bowl' }),
      expect.objectContaining({ uid: 'playerB', mapVote: 'synth_city' }),
    ]);

    // MatchFoundData carries opponent's mapVote + my mapVote
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      opponents: [{ uid: 'playerB', name: 'B', color: 'teal', mapVote: 'synth_city' }],
      myMapVote: 'midtown_bowl',
      isInitiator: true,
    }));

    await leaveQueue('playerA');
  });

  it('listenForMatch surfaces both mapVotes from match doc (passive)', async () => {
    const callback = vi.fn();
    let snapshotCallback: ((snap: unknown) => void) | null = null;
    mockOnSnapshot.mockImplementation((_ref: unknown, cb: (snap: unknown) => void) => {
      snapshotCallback = cb;
      return vi.fn();
    });

    mockGet.mockResolvedValue(makePresenceSnap([]));
    mockGetDocs.mockResolvedValue(makeQueueSnap([]));

    onMatchFound(callback);
    listenForMatch('playerA', callback);
    await enterQueue('playerA', 'A', 'red', 'midtown_bowl');
    await vi.advanceTimersByTimeAsync(0);

    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        players: [
          { uid: 'playerB', username: 'B', color: 'teal', mapVote: 'synth_city' },
          { uid: 'playerA', username: 'A', color: 'red', mapVote: 'midtown_bowl' },
        ],
        seed: 7,
        status: 'pending',
        createdAt: Date.now(),
      }),
      id: 'match-xyz',
    });

    snapshotCallback!({
      exists: () => true,
      data: () => ({ uid: 'playerA', status: 'matched', matchId: 'match-xyz' }),
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      opponents: [{ uid: 'playerB', name: 'B', color: 'teal', mapVote: 'synth_city' }],
      myMapVote: 'midtown_bowl',
      isInitiator: false,
    }));

    await leaveQueue('playerA');
  });

  it('listenForMatch unsubscribes previous listener before registering new one', () => {
    const unsub1 = vi.fn();
    const unsub2 = vi.fn();
    mockOnSnapshot.mockReturnValueOnce(unsub1).mockReturnValueOnce(unsub2);

    listenForMatch('user1', vi.fn());
    listenForMatch('user1', vi.fn());

    expect(unsub1).toHaveBeenCalledOnce();
    expect(unsub2).not.toHaveBeenCalled();
  });
});
