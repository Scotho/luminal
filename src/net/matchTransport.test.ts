// ── FirebaseMatchTransport Tests ─────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockSet = vi.fn(() => Promise.resolve());

// Track unsubscribe functions returned by onValue
const unsubSpies: ReturnType<typeof vi.fn>[] = [];
const mockOnValue = vi.fn(() => {
  const unsub = vi.fn();
  unsubSpies.push(unsub);
  return unsub;
});

const refStore = new Map<string, { __path: string }>();
const mockRef = vi.fn((_db: unknown, path: string) => {
  if (!refStore.has(path)) refStore.set(path, { __path: path });
  return refStore.get(path)!;
});

vi.mock('firebase/database', () => ({
  ref: (...args: unknown[]) => mockRef(...args),
  set: (...args: unknown[]) => mockSet(...args),
  onValue: (...args: unknown[]) => mockOnValue(...args),
}));

vi.mock('../firebase', () => ({
  rtdb: { __rtdb: true },
}));

import { FirebaseMatchTransport } from './firebaseMatchTransport';

describe('FirebaseMatchTransport', () => {
  let transport: FirebaseMatchTransport;
  const matchId = 'match1';
  const myUid = 'uid1';
  const opponentUids = ['uid2'];
  const uidToIndex = new Map([['uid2', 1]]);

  beforeEach(() => {
    vi.clearAllMocks();
    refStore.clear();
    unsubSpies.length = 0;
    transport = new FirebaseMatchTransport(matchId, myUid, opponentUids, uidToIndex);
  });

  describe('connect', () => {
    it('registers onValue listeners for each opponent for inputs, hashes, snapshots', async () => {
      await transport.connect();
      // 1 input + 1 hash + 1 snapshot listener per opponent = 3
      expect(mockOnValue).toHaveBeenCalledTimes(3);
    });
  });

  describe('disconnect', () => {
    it('calls unsub on all registered listeners', async () => {
      await transport.connect();
      expect(unsubSpies).toHaveLength(3);
      transport.disconnect();
      for (const unsub of unsubSpies) {
        expect(unsub).toHaveBeenCalledTimes(1);
      }
    });

    it('is idempotent', async () => {
      await transport.connect();
      transport.disconnect();
      transport.disconnect();
      // Each unsub called exactly once (second disconnect is a no-op)
      for (const unsub of unsubSpies) {
        expect(unsub).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('sendInputs', () => {
    it('writes to RTDB inputs path for myUid', () => {
      const packet = [{ tick: 1, turnDir: 0 as const, accelerate: false, dash: false, brake: false }];
      transport.sendInputs(packet);
      expect(mockSet).toHaveBeenCalledTimes(1);
      const setRef = mockSet.mock.calls[0][0] as { __path: string };
      expect(setRef.__path).toBe(`matches/${matchId}/inputs/${myUid}`);
      expect(mockSet.mock.calls[0][1]).toBe(packet);
    });
  });

  describe('sendHash', () => {
    it('writes to RTDB hashes path for myUid', () => {
      transport.sendHash(60, 12345);
      expect(mockSet).toHaveBeenCalledTimes(1);
      const setRef = mockSet.mock.calls[0][0] as { __path: string };
      expect(setRef.__path).toBe(`matches/${matchId}/hashes/${myUid}`);
      expect(mockSet.mock.calls[0][1]).toEqual({ tick: 60, hash: 12345 });
    });
  });

  describe('sendSnapshot', () => {
    it('writes to RTDB snapshot path for myUid', () => {
      const data = { tick: 100, players: [] };
      transport.sendSnapshot(data);
      expect(mockSet).toHaveBeenCalledTimes(1);
      const setRef = mockSet.mock.calls[0][0] as { __path: string };
      expect(setRef.__path).toBe(`matches/${matchId}/snapshot/${myUid}`);
    });
  });

  describe('onRemoteInputs callback', () => {
    it('fires callback when onValue delivers input data', async () => {
      const cb = vi.fn();
      transport.onRemoteInputs(cb);
      await transport.connect();

      const inputCall = mockOnValue.mock.calls.find(
        ([r]: [{ __path?: string }]) => r.__path?.includes('/inputs/uid2'),
      );
      expect(inputCall).toBeDefined();

      const firebaseCb = inputCall![1] as (snap: { val: () => unknown }) => void;
      const frames = [{ tick: 1, turnDir: 0, accelerate: false, dash: false, brake: false }];
      firebaseCb({ val: () => frames });

      expect(cb).toHaveBeenCalledWith(1, frames);
    });

    it('ignores null snapshots', async () => {
      const cb = vi.fn();
      transport.onRemoteInputs(cb);
      await transport.connect();

      const inputCall = mockOnValue.mock.calls.find(
        ([r]: [{ __path?: string }]) => r.__path?.includes('/inputs/uid2'),
      );
      const firebaseCb = inputCall![1] as (snap: { val: () => unknown }) => void;
      firebaseCb({ val: () => null });

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('repeated connect cleans up previous listeners', () => {
    it('calls unsub on previous listeners before re-registering', async () => {
      await transport.connect();
      const firstBatchUnsubs = [...unsubSpies];
      await transport.connect();
      // First batch should have been called
      for (const unsub of firstBatchUnsubs) {
        expect(unsub).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('estimatedRttMs', () => {
    it('returns 0 (RTT is measured by NetcodeSession, not the transport)', () => {
      expect(transport.estimatedRttMs).toBe(0);
    });
  });
});
