// ── Transport Integration Smoke Tests ────────────────────
// Verifies NetcodeSession delegates correctly through MatchTransport
// without hitting real Firebase or WebSocket.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MatchTransport } from './matchTransport';
import type { InputFrame } from '../core/simulation';

// ── Inline mock transport ────────────────────────────────
function createMockTransport(): MatchTransport & {
  _fireRemoteInputs: (idx: number, frames: InputFrame[]) => void;
  _fireRemoteHash: (tick: number, hash: number) => void;
  _fireRemoteSnapshot: (data: unknown) => void;
  _fireDisconnect: () => void;
  _fireResyncRequest: () => void;
  sentInputs: InputFrame[][];
  sentHashes: { tick: number; hash: number }[];
  sentSnapshots: unknown[];
} {
  let inputsCb: ((idx: number, frames: InputFrame[]) => void) | null = null;
  let hashCb: ((tick: number, hash: number) => void) | null = null;
  let snapshotCb: ((data: unknown) => void) | null = null;
  let disconnectCb: (() => void) | null = null;

  const t = {
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(),
    sendInputs: vi.fn((p: InputFrame[]) => { t.sentInputs.push(p); }),
    sendHash: vi.fn((tick: number, hash: number) => { t.sentHashes.push({ tick, hash }); }),
    sendSnapshot: vi.fn((d: unknown) => { t.sentSnapshots.push(d); }),
    onRemoteInputs: vi.fn((cb: (idx: number, frames: InputFrame[]) => void) => { inputsCb = cb; }),
    onRemoteHash: vi.fn((cb: (tick: number, hash: number) => void) => { hashCb = cb; }),
    onRemoteSnapshot: vi.fn((cb: (data: unknown) => void) => { snapshotCb = cb; }),
    onDisconnect: vi.fn((cb: () => void) => { disconnectCb = cb; }),
    get estimatedRttMs() { return 42; },

    _fireRemoteInputs: (idx: number, frames: InputFrame[]) => { if (inputsCb) inputsCb(idx, frames); },
    _fireRemoteHash: (tick: number, hash: number) => { if (hashCb) hashCb(tick, hash); },
    _fireRemoteSnapshot: (data: unknown) => { if (snapshotCb) snapshotCb(data); },
    _fireDisconnect: () => { if (disconnectCb) disconnectCb(); },
    sentInputs: [] as InputFrame[][],
    sentHashes: [] as { tick: number; hash: number }[],
    sentSnapshots: [] as unknown[],
  };
  return t;
}

// Mock Firebase to avoid import errors
const mockOnValue = vi.fn(() => vi.fn());
vi.mock('firebase/database', () => ({
  ref: vi.fn((_db: unknown, path: string) => ({ __path: path })),
  set: vi.fn(() => Promise.resolve()),
  get: vi.fn(() => Promise.resolve({ val: () => null })),
  onValue: (...args: unknown[]) => mockOnValue(...args),
  off: vi.fn(),
  onDisconnect: vi.fn(() => ({ remove: vi.fn(), update: vi.fn() })),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
  push: vi.fn(() => Promise.resolve()),
  update: vi.fn(() => Promise.resolve()),
  remove: vi.fn(() => Promise.resolve()),
}));
vi.mock('../firebase', () => ({ rtdb: { __rtdb: true } }));

import { NetcodeSession } from '../netcode';

describe('NetcodeSession + MatchTransport integration', () => {
  let session: NetcodeSession;
  let transport: ReturnType<typeof createMockTransport>;

  beforeEach(() => {
    vi.clearAllMocks();
    session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
    transport = createMockTransport();
    session.attachTransport(transport);
  });

  it('sends inputs through transport', () => {
    const frames: InputFrame[] = [{ tick: 1, turnDir: 0, accelerate: false, dash: false, brake: false }];
    session.sendInputs(frames);
    expect(transport.sentInputs).toHaveLength(1);
    expect(transport.sentInputs[0]).toBe(frames);
  });

  it('sends hashes through transport', () => {
    session.sendHash(60, 99999);
    expect(transport.sentHashes).toEqual([{ tick: 60, hash: 99999 }]);
  });

  it('sends snapshots through transport', () => {
    const snap = { tick: 100, players: [] };
    session.sendSnapshot(snap);
    expect(transport.sentSnapshots).toEqual([snap]);
  });

  it('delivers remote inputs through session callbacks', () => {
    const cb = vi.fn();
    session.onRemoteInputs(cb);
    session.attachTransport(transport); // Re-attach to wire callback

    const frames: InputFrame[] = [{ tick: 5, turnDir: 1, accelerate: true, dash: false, brake: false }];
    transport._fireRemoteInputs(1, frames);
    expect(cb).toHaveBeenCalledWith(1, frames);
  });

  it('delivers remote hashes through session callbacks', () => {
    const cb = vi.fn();
    session.onRemoteHash(cb);
    session.attachTransport(transport);

    transport._fireRemoteHash(120, 54321);
    expect(cb).toHaveBeenCalledWith(120, 54321);
  });

  it('delivers remote snapshots through session callbacks', () => {
    const cb = vi.fn();
    session.onRemoteSnapshot(cb);
    session.attachTransport(transport);

    const data = { tick: 200, players: [{}] };
    transport._fireRemoteSnapshot(data);
    expect(cb).toHaveBeenCalledWith(data);
  });

  it('skips RTDB listener registration when transport is attached', () => {
    mockOnValue.mockClear();
    session.startInputSync(new Map([['uid2', 1]]));
    session.startHashSync();
    session.startSnapshotSync();
    // onValue should not have been called for these paths
    const inputHashSnapCalls = mockOnValue.mock.calls.filter(
      ([r]: [{ __path?: string }]) => {
        const p = r?.__path || '';
        return p.includes('/inputs/') || p.includes('/hashes/') || p.includes('/snapshot/');
      },
    );
    expect(inputHashSnapCalls).toHaveLength(0);
  });
});
