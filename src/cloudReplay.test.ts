// ── Cloud Replay Tests ────────────────────────────────────
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// ── Polyfill CompressionStream / DecompressionStream for jsdom ────────────────
// jsdom does not implement the Compression Streams API. We mock both as identity
// transforms so the gzip code paths are exercised without actually compressing.
class IdentityTransformStream implements GenericTransformStream {
  readonly readable: ReadableStream;
  readonly writable: WritableStream;
  constructor() {
    let controller: ReadableStreamDefaultController;
    this.readable = new ReadableStream({
      start(c) { controller = c; },
    });
    this.writable = new WritableStream({
      write(chunk) { controller.enqueue(chunk); },
      close() { controller.close(); },
    });
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).CompressionStream = IdentityTransformStream;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).DecompressionStream = IdentityTransformStream;

// Polyfill Blob.prototype.stream for jsdom (returns a ReadableStream of the blob bytes)
if (!Blob.prototype.stream) {
  Blob.prototype.stream = function () {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const blob = this;
    return new ReadableStream({
      async start(controller) {
        const buffer = await blob.arrayBuffer();
        controller.enqueue(new Uint8Array(buffer));
        controller.close();
      },
    });
  };
}

// ── Mock Firebase modules BEFORE importing cloudReplay ────
const mockRef = vi.fn((_storage: unknown, path: string) => ({ path }));
const mockUploadBytes = vi.fn(() => Promise.resolve());
const mockGetBlob = vi.fn();

vi.mock('firebase/storage', () => ({
  ref: (...args: unknown[]) => mockRef(...args),
  uploadBytes: (...args: unknown[]) => mockUploadBytes(...args),
  getBlob: (...args: unknown[]) => mockGetBlob(...args),
}));

const mockDoc = vi.fn((_db: unknown, col: string, id: string) => ({ __col: col, __id: id }));
const mockSetDoc = vi.fn(() => Promise.resolve());
const mockCollection = vi.fn((_db: unknown, col: string) => ({ __col: col }));
const mockQuery = vi.fn((...args: unknown[]) => ({ __query: args }));
const mockWhere = vi.fn((...args: unknown[]) => ({ __where: args }));
const mockOrderBy = vi.fn((...args: unknown[]) => ({ __orderBy: args }));
const mockLimit = vi.fn((n: number) => ({ __limit: n }));
const mockGetDocs = vi.fn();
const mockStartAfter = vi.fn((doc: unknown) => ({ __startAfter: doc }));
const mockTimestampNow = vi.fn(() => ({ seconds: 1234567890 }));

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => mockDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  limit: (n: unknown) => mockLimit(n as number),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  startAfter: (...args: unknown[]) => mockStartAfter(...args),
  Timestamp: { now: () => mockTimestampNow() },
}));

vi.mock('./firebase', () => ({ db: { __db: true }, storage: { __storage: true } }));

import { uploadReplay, fetchMatchHistory, downloadReplay } from './cloudReplay';
import type { CompressedFrame } from './types/index';

// ── Helpers ───────────────────────────────────────────────

function makeMetadata() {
  return {
    players: [
      { uid: 'uid-1', username: 'P1', color: 0, vehicle: 'bike' },
      { uid: 'uid-2', username: 'P2', color: 1, vehicle: 'bike' },
    ],
    result: 'win',
    winnerUid: 'uid-1',
    series: 1,
    matchType: 'casual' as const,
    duration: 90,
    map: 'default',
    seriesScore: { p1: 1, p2: 0 },
    participantUids: ['uid-1', 'uid-2'],
  };
}

function makeDocSnap(id: string, data: Record<string, unknown>) {
  return {
    id,
    data: () => data,
  };
}

// ── uploadReplay ──────────────────────────────────────────

describe('uploadReplay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls ref with correct storage path', async () => {
    const frames: CompressedFrame[] = [];
    await uploadReplay('match-abc', frames, makeMetadata());
    expect(mockRef).toHaveBeenCalledWith({ __storage: true }, 'replays/match-abc.bin');
  });

  it('calls uploadBytes with the storage ref', async () => {
    const frames: CompressedFrame[] = [];
    await uploadReplay('match-abc', frames, makeMetadata());
    expect(mockUploadBytes).toHaveBeenCalledOnce();
    const [refArg, blobArg] = (mockUploadBytes as Mock).mock.calls[0];
    expect(refArg).toEqual({ path: 'replays/match-abc.bin' });
    expect(blobArg).toBeInstanceOf(Blob);
  });

  it('uploadBytes blob contains JSON-encoded frames', async () => {
    const frames = [{ t: 1, x: 100 }] as unknown as CompressedFrame[];
    await uploadReplay('match-xyz', frames, makeMetadata());
    const [, blobArg] = (mockUploadBytes as Mock).mock.calls[0];
    const text = await (blobArg as Blob).text();
    expect(JSON.parse(text)).toEqual(frames);
  });

  it('calls setDoc with correct Firestore doc path', async () => {
    await uploadReplay('match-123', [], makeMetadata());
    expect(mockDoc).toHaveBeenCalledWith({ __db: true }, 'matches', 'match-123');
    expect(mockSetDoc).toHaveBeenCalledOnce();
  });

  it('includes replayStoragePath in the Firestore doc', async () => {
    await uploadReplay('match-123', [], makeMetadata());
    const [, data] = (mockSetDoc as Mock).mock.calls[0];
    expect(data.replayStoragePath).toBe('replays/match-123.bin');
  });

  it('includes createdAt (Timestamp.now()) in the Firestore doc', async () => {
    await uploadReplay('match-123', [], makeMetadata());
    const [, data] = (mockSetDoc as Mock).mock.calls[0];
    expect(data.createdAt).toEqual({ seconds: 1234567890 });
  });

  it('spreads all metadata fields into the Firestore doc', async () => {
    const meta = makeMetadata();
    await uploadReplay('match-123', [], meta);
    const [, data] = (mockSetDoc as Mock).mock.calls[0];
    expect(data.winnerUid).toBe('uid-1');
    expect(data.series).toBe(1);
    expect(data.matchType).toBe('casual');
    expect(data.participantUids).toEqual(['uid-1', 'uid-2']);
  });
});

// ── fetchMatchHistory ─────────────────────────────────────

describe('fetchMatchHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleDocData = {
    players: [{ uid: 'uid-1', username: 'P1', color: 0, vehicle: 'bike' }],
    result: 'win',
    winnerUid: 'uid-1',
    series: 1,
    matchType: 'casual',
    duration: 45,
    map: 'arena',
    seriesScore: { p1: 1, p2: 0 },
    participantUids: ['uid-1', 'uid-2'],
    replayStoragePath: 'replays/m1.bin',
    createdAt: { toDate: () => new Date('2025-06-01T12:00:00Z') },
  };

  it('returns mapped entries with correct field mapping', async () => {
    const snap = { docs: [makeDocSnap('match-1', sampleDocData)] };
    mockGetDocs.mockResolvedValue(snap);

    const result = await fetchMatchHistory('uid-1');
    expect(result.entries).toHaveLength(1);
    const entry = result.entries[0];
    expect(entry.id).toBe('match-1');
    expect(entry.winnerUid).toBe('uid-1');
    expect(entry.matchType).toBe('casual');
    expect(entry.replayStoragePath).toBe('replays/m1.bin');
    expect(entry.createdAt).toBeInstanceOf(Date);
    expect(entry.createdAt.toISOString()).toBe('2025-06-01T12:00:00.000Z');
  });

  it('handles missing createdAt by returning null', async () => {
    const dataNoDate = { ...sampleDocData, createdAt: undefined };
    const snap = { docs: [makeDocSnap('match-2', dataNoDate)] };
    mockGetDocs.mockResolvedValue(snap);

    const result = await fetchMatchHistory('uid-1');
    expect(result.entries[0].createdAt).toBeNull();
  });

  it('returns lastDoc as the last document in the snapshot', async () => {
    const doc1 = makeDocSnap('m1', sampleDocData);
    const doc2 = makeDocSnap('m2', sampleDocData);
    const snap = { docs: [doc1, doc2] };
    mockGetDocs.mockResolvedValue(snap);

    const result = await fetchMatchHistory('uid-1');
    expect(result.lastDoc).toBe(doc2);
  });

  it('returns null lastDoc for empty results', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    const result = await fetchMatchHistory('uid-1');
    expect(result.entries).toHaveLength(0);
    expect(result.lastDoc).toBeNull();
  });

  it('uses startAfter when lastDoc is provided', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    const lastDoc = makeDocSnap('prev', {});
    await fetchMatchHistory('uid-1', 20, lastDoc as unknown as import('firebase/firestore').DocumentSnapshot);

    // startAfter should have been called
    expect(mockStartAfter).toHaveBeenCalledWith(lastDoc);
  });

  it('does not call startAfter when no lastDoc provided', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    await fetchMatchHistory('uid-1');
    expect(mockStartAfter).not.toHaveBeenCalled();
  });

  it('queries the correct collection with participantUids filter', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    await fetchMatchHistory('uid-42');
    expect(mockCollection).toHaveBeenCalledWith({ __db: true }, 'matches');
    expect(mockWhere).toHaveBeenCalledWith('participantUids', 'array-contains', 'uid-42');
    expect(mockOrderBy).toHaveBeenCalledWith('createdAt', 'desc');
  });

  it('respects custom pageSize', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    await fetchMatchHistory('uid-1', 5);
    expect(mockLimit).toHaveBeenCalledWith(5);
  });
});

// ── downloadReplay ────────────────────────────────────────

describe('downloadReplay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls ref with the correct storage path', async () => {
    const frames = [{ t: 1 }, { t: 2 }] as unknown as CompressedFrame[];
    const mockBlob = new Blob([JSON.stringify(frames)], { type: 'application/json' });
    mockGetBlob.mockResolvedValue(mockBlob);

    await downloadReplay('replays/test-match.bin');
    expect(mockRef).toHaveBeenCalledWith({ __storage: true }, 'replays/test-match.bin');
  });

  it('calls getBlob with the storage ref', async () => {
    const frames: CompressedFrame[] = [];
    const mockBlob = new Blob([JSON.stringify(frames)]);
    mockGetBlob.mockResolvedValue(mockBlob);

    await downloadReplay('replays/m1.bin');
    expect(mockGetBlob).toHaveBeenCalledWith({ path: 'replays/m1.bin' });
  });

  it('parses JSON blob into CompressedFrame array', async () => {
    const frames = [{ t: 10, data: 'abc' }, { t: 20, data: 'xyz' }] as unknown as CompressedFrame[];
    const mockBlob = new Blob([JSON.stringify(frames)], { type: 'application/json' });
    mockGetBlob.mockResolvedValue(mockBlob);

    const result = await downloadReplay('replays/m1.bin');
    expect(result).toEqual(frames);
  });

  it('returns an empty array for empty frame list', async () => {
    const mockBlob = new Blob([JSON.stringify([])]);
    mockGetBlob.mockResolvedValue(mockBlob);

    const result = await downloadReplay('replays/empty.bin');
    expect(result).toEqual([]);
  });
});
