import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InputFrame } from '../core/simulation';

// ── Firebase mocks ──────────────────────────────────────
const mockSet = vi.fn(() => Promise.resolve());
const mockOnValue = vi.fn(() => vi.fn()); // returns unsubscribe fn

vi.mock('firebase/database', () => ({
  ref: vi.fn((_db: unknown, path: string) => ({ path })),
  set: (...args: unknown[]) => mockSet(...args),
  onValue: (...args: unknown[]) => mockOnValue(...args),
}));

vi.mock('../firebase', () => ({
  rtdb: { __brand: 'mock-rtdb' },
}));

import { FirebaseMatchTransport } from './firebaseMatchTransport';
import { ref } from 'firebase/database';

// ── Helpers ─────────────────────────────────────────────
function makeTransport(opponentUids = ['opp1', 'opp2']): FirebaseMatchTransport {
  const uidToIndex = new Map<string, number>();
  uidToIndex.set('me', 0);
  opponentUids.forEach((uid, i) => uidToIndex.set(uid, i + 1));
  return new FirebaseMatchTransport('match-42', 'me', opponentUids, uidToIndex);
}

// ── Tests ───────────────────────────────────────────────
describe('FirebaseMatchTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Constructor ──
  describe('constructor', () => {
    it('creates an instance without throwing', () => {
      const t = makeTransport();
      expect(t).toBeDefined();
    });

    it('estimatedRttMs is 0 (Firebase has no RTT estimate)', () => {
      expect(makeTransport().estimatedRttMs).toBe(0);
    });
  });

  // ── connect() ──
  describe('connect', () => {
    it('subscribes to inputs, hashes, and snapshot for each opponent', async () => {
      const t = makeTransport(['opp1', 'opp2']);
      await t.connect();

      // 3 listeners per opponent (inputs, hashes, snapshot) x 2 opponents = 6
      expect(mockOnValue).toHaveBeenCalledTimes(6);
    });

    it('creates refs with correct RTDB paths', async () => {
      const t = makeTransport(['opp1']);
      await t.connect();

      const refCalls = vi.mocked(ref).mock.calls.map(c => c[1]);
      expect(refCalls).toContain('matches/match-42/inputs/opp1');
      expect(refCalls).toContain('matches/match-42/hashes/opp1');
      expect(refCalls).toContain('matches/match-42/snapshot/opp1');
    });
  });

  // ── disconnect() ──
  describe('disconnect', () => {
    it('calls all unsubscribe functions', async () => {
      const unsub1 = vi.fn();
      const unsub2 = vi.fn();
      const unsub3 = vi.fn();
      mockOnValue
        .mockReturnValueOnce(unsub1)
        .mockReturnValueOnce(unsub2)
        .mockReturnValueOnce(unsub3);

      const t = makeTransport(['opp1']);
      await t.connect();
      t.disconnect();

      expect(unsub1).toHaveBeenCalledTimes(1);
      expect(unsub2).toHaveBeenCalledTimes(1);
      expect(unsub3).toHaveBeenCalledTimes(1);
    });

    it('is idempotent — double disconnect does not throw', async () => {
      const t = makeTransport(['opp1']);
      await t.connect();
      t.disconnect();
      expect(() => t.disconnect()).not.toThrow();
    });

    it('disconnect before connect is safe', () => {
      const t = makeTransport();
      expect(() => t.disconnect()).not.toThrow();
    });
  });

  // ── sendInputs ──
  describe('sendInputs', () => {
    it('writes to the correct RTDB path', () => {
      const t = makeTransport();
      const frames: InputFrame[] = [];
      t.sendInputs(frames);

      expect(mockSet).toHaveBeenCalledTimes(1);
      const refArg = mockSet.mock.calls[0][0] as { path: string };
      expect(refArg.path).toBe('matches/match-42/inputs/me');
      expect(mockSet.mock.calls[0][1]).toBe(frames);
    });
  });

  // ── sendHash ──
  describe('sendHash', () => {
    it('writes tick and hash to RTDB', () => {
      const t = makeTransport();
      t.sendHash(10, 0xABCD);

      expect(mockSet).toHaveBeenCalledTimes(1);
      const refArg = mockSet.mock.calls[0][0] as { path: string };
      expect(refArg.path).toBe('matches/match-42/hashes/me');
      expect(mockSet.mock.calls[0][1]).toEqual({ tick: 10, hash: 0xABCD });
    });
  });

  // ── sendSnapshot ──
  describe('sendSnapshot', () => {
    it('writes snapshot data to RTDB', () => {
      const t = makeTransport();
      const data = { tick: 5, state: [1, 2, 3] };
      t.sendSnapshot(data);

      const refArg = mockSet.mock.calls[0][0] as { path: string };
      expect(refArg.path).toBe('matches/match-42/snapshot/me');
      expect(mockSet.mock.calls[0][1]).toEqual(data);
    });
  });

  // ── Callback registration ──
  describe('callback registration', () => {
    it('onRemoteInputs callback fires when listener receives data', async () => {
      const cb = vi.fn();
      const t = makeTransport(['opp1']);
      t.onRemoteInputs(cb);

      // Capture the onValue callback for the inputs listener
      await t.connect();
      const inputListenerCb = mockOnValue.mock.calls[0][1] as (snap: unknown) => void;

      const fakeSnap = { val: () => [{ tick: 1, input: 0 }] };
      inputListenerCb(fakeSnap);

      expect(cb).toHaveBeenCalledWith(1, [{ tick: 1, input: 0 }]);
    });

    it('onRemoteInputs callback does not fire for null data', async () => {
      const cb = vi.fn();
      const t = makeTransport(['opp1']);
      t.onRemoteInputs(cb);
      await t.connect();

      const inputListenerCb = mockOnValue.mock.calls[0][1] as (snap: unknown) => void;
      inputListenerCb({ val: () => null });

      expect(cb).not.toHaveBeenCalled();
    });

    it('onRemoteHash callback fires for valid hash data', async () => {
      const cb = vi.fn();
      const t = makeTransport(['opp1']);
      t.onRemoteHash(cb);
      await t.connect();

      // Hash listener is the second onValue call for the first opponent
      const hashListenerCb = mockOnValue.mock.calls[1][1] as (snap: unknown) => void;
      hashListenerCb({ val: () => ({ tick: 5, hash: 999 }) });

      expect(cb).toHaveBeenCalledWith(5, 999);
    });

    it('onRemoteHash callback does not fire for incomplete data', async () => {
      const cb = vi.fn();
      const t = makeTransport(['opp1']);
      t.onRemoteHash(cb);
      await t.connect();

      const hashListenerCb = mockOnValue.mock.calls[1][1] as (snap: unknown) => void;
      hashListenerCb({ val: () => ({ tick: 5 }) }); // missing hash

      expect(cb).not.toHaveBeenCalled();
    });

    it('onRemoteSnapshot callback fires for valid snapshot', async () => {
      const cb = vi.fn();
      const t = makeTransport(['opp1']);
      t.onRemoteSnapshot(cb);
      await t.connect();

      // Snapshot listener is the third onValue call
      const snapListenerCb = mockOnValue.mock.calls[2][1] as (snap: unknown) => void;
      const payload = { tick: 10, state: 'data' };
      snapListenerCb({ val: () => payload });

      expect(cb).toHaveBeenCalledWith(payload);
    });

    it('onRemoteSnapshot callback does not fire when tick is missing', async () => {
      const cb = vi.fn();
      const t = makeTransport(['opp1']);
      t.onRemoteSnapshot(cb);
      await t.connect();

      const snapListenerCb = mockOnValue.mock.calls[2][1] as (snap: unknown) => void;
      snapListenerCb({ val: () => ({ state: 'no-tick' }) });

      expect(cb).not.toHaveBeenCalled();
    });

    it('onDisconnect stores callback', () => {
      const t = makeTransport();
      const cb = vi.fn();
      expect(() => t.onDisconnect(cb)).not.toThrow();
    });
  });

  // ── connect() clears previous listeners ──
  describe('reconnect', () => {
    it('connect() cleans up previous listeners before resubscribing', async () => {
      const unsub = vi.fn();
      mockOnValue.mockReturnValue(unsub);

      const t = makeTransport(['opp1']);
      await t.connect();
      await t.connect(); // second connect should disconnect first

      // First connect: 3 listeners created, then disconnect called (3 unsubs), then 3 more created
      expect(unsub).toHaveBeenCalledTimes(3);
    });
  });

  // ── Bug #5: Network error logging (verifying fix) ──
  describe('error logging', () => {
    it('sendInputs catches rejected set() and logs via net.warn', async () => {
      const netMod = await import('../netLog');
      const warnSpy = vi.spyOn(netMod.net, 'warn');

      mockSet.mockRejectedValueOnce(new Error('RTDB write failed'));
      const t = makeTransport();
      t.sendInputs([]);

      // Let the promise rejection propagate through microtask queue
      await new Promise(r => setTimeout(r, 10));

      expect(warnSpy).toHaveBeenCalledWith(
        '[transport] sendInputs failed:',
        expect.any(Error),
      );
      warnSpy.mockRestore();
    });

    it('sendHash catches rejected set() and logs via net.warn', async () => {
      const netMod = await import('../netLog');
      const warnSpy = vi.spyOn(netMod.net, 'warn');

      mockSet.mockRejectedValueOnce(new Error('RTDB write failed'));
      const t = makeTransport();
      t.sendHash(1, 42);

      await new Promise(r => setTimeout(r, 10));

      expect(warnSpy).toHaveBeenCalledWith(
        '[transport] sendHash failed:',
        expect.any(Error),
      );
      warnSpy.mockRestore();
    });

    it('sendSnapshot catches rejected set() and logs via net.warn', async () => {
      const netMod = await import('../netLog');
      const warnSpy = vi.spyOn(netMod.net, 'warn');

      mockSet.mockRejectedValueOnce(new Error('RTDB write failed'));
      const t = makeTransport();
      t.sendSnapshot({ tick: 1 });

      await new Promise(r => setTimeout(r, 10));

      expect(warnSpy).toHaveBeenCalledWith(
        '[transport] sendSnapshot failed:',
        expect.any(Error),
      );
      warnSpy.mockRestore();
    });
  });

  // ── Transport Telemetry ──
  describe('transportTelemetry', () => {
    it('starts with all counters at zero', () => {
      const t = makeTransport();
      const tel = t.transportTelemetry;
      expect(tel.bytesSent).toBe(0);
      expect(tel.bytesReceived).toBe(0);
      expect(tel.messagesSent).toBe(0);
      expect(tel.messagesReceived).toBe(0);
    });

    it('bytesSent accumulates after sendInputs', () => {
      const t = makeTransport();
      const frames: InputFrame[] = [{ tick: 1, input: 0 }];
      t.sendInputs(frames);

      const expectedBytes = JSON.stringify(frames).length;
      expect(t.transportTelemetry.bytesSent).toBe(expectedBytes);
    });

    it('bytesSent accumulates after sendHash', () => {
      const t = makeTransport();
      t.sendHash(10, 0xABCD);

      const expectedBytes = JSON.stringify({ tick: 10, hash: 0xABCD }).length;
      expect(t.transportTelemetry.bytesSent).toBe(expectedBytes);
    });

    it('bytesSent accumulates after sendSnapshot', () => {
      const t = makeTransport();
      const data = { tick: 5, state: [1, 2, 3] };
      t.sendSnapshot(data);

      const expectedBytes = JSON.stringify(data).length;
      expect(t.transportTelemetry.bytesSent).toBe(expectedBytes);
    });

    it('bytesSent accumulates across multiple sends', () => {
      const t = makeTransport();
      const frames: InputFrame[] = [{ tick: 1, input: 0 }];
      const hashPayload = { tick: 10, hash: 42 };
      const snapPayload = { tick: 5, state: [1] };

      t.sendInputs(frames);
      t.sendHash(10, 42);
      t.sendSnapshot(snapPayload);

      const expected =
        JSON.stringify(frames).length +
        JSON.stringify(hashPayload).length +
        JSON.stringify(snapPayload).length;

      expect(t.transportTelemetry.bytesSent).toBe(expected);
    });

    it('bytesReceived accumulates from inbound listener callbacks', async () => {
      const t = makeTransport(['opp1']);
      t.onRemoteInputs(vi.fn());
      t.onRemoteHash(vi.fn());
      await t.connect();

      const inputCb = mockOnValue.mock.calls[0][1] as (snap: unknown) => void;
      const hashCb = mockOnValue.mock.calls[1][1] as (snap: unknown) => void;

      const inputData = [{ tick: 1, input: 0 }];
      const hashData = { tick: 5, hash: 999 };

      inputCb({ val: () => inputData });
      hashCb({ val: () => hashData });

      const expected =
        JSON.stringify(inputData).length +
        JSON.stringify(hashData).length;

      expect(t.transportTelemetry.bytesReceived).toBe(expected);
    });

    it('messagesSent increments once per send call', () => {
      const t = makeTransport();
      t.sendInputs([]);
      t.sendInputs([{ tick: 1, input: 0 }]);
      t.sendHash(1, 42);
      t.sendSnapshot({ tick: 1 });

      expect(t.transportTelemetry.messagesSent).toBe(4);
    });

    it('messagesReceived increments once per inbound callback', async () => {
      const t = makeTransport(['opp1']);
      t.onRemoteInputs(vi.fn());
      t.onRemoteHash(vi.fn());
      t.onRemoteSnapshot(vi.fn());
      await t.connect();

      const inputCb = mockOnValue.mock.calls[0][1] as (snap: unknown) => void;
      const hashCb = mockOnValue.mock.calls[1][1] as (snap: unknown) => void;
      const snapCb = mockOnValue.mock.calls[2][1] as (snap: unknown) => void;

      inputCb({ val: () => [{ tick: 1, input: 0 }] });
      hashCb({ val: () => ({ tick: 5, hash: 999 }) });
      snapCb({ val: () => ({ tick: 10, state: 'ok' }) });

      expect(t.transportTelemetry.messagesReceived).toBe(3);
    });

    it('messagesReceived does not increment for null/invalid data', async () => {
      const t = makeTransport(['opp1']);
      t.onRemoteInputs(vi.fn());
      t.onRemoteHash(vi.fn());
      await t.connect();

      const inputCb = mockOnValue.mock.calls[0][1] as (snap: unknown) => void;
      const hashCb = mockOnValue.mock.calls[1][1] as (snap: unknown) => void;

      inputCb({ val: () => null });
      hashCb({ val: () => ({ tick: 5 }) }); // missing hash field

      expect(t.transportTelemetry.messagesReceived).toBe(0);
    });

    it('messageTypes tracks per-type byte breakdown for outbound', () => {
      const t = makeTransport();
      const frames: InputFrame[] = [{ tick: 1, input: 0 }];
      t.sendInputs(frames);
      t.sendHash(10, 42);
      t.sendSnapshot({ tick: 5, state: [1] });

      const types = t.transportTelemetry.messageTypes;

      expect(types['inputs']).toBeDefined();
      expect(types['inputs'].bytesSent).toBe(JSON.stringify(frames).length);
      expect(types['inputs'].count).toBe(1);

      expect(types['hash']).toBeDefined();
      expect(types['hash'].bytesSent).toBe(JSON.stringify({ tick: 10, hash: 42 }).length);
      expect(types['hash'].count).toBe(1);

      expect(types['snapshot']).toBeDefined();
      expect(types['snapshot'].bytesSent).toBe(JSON.stringify({ tick: 5, state: [1] }).length);
      expect(types['snapshot'].count).toBe(1);
    });

    it('messageTypes tracks per-type byte breakdown for inbound', async () => {
      const t = makeTransport(['opp1']);
      t.onRemoteInputs(vi.fn());
      t.onRemoteHash(vi.fn());
      await t.connect();

      const inputCb = mockOnValue.mock.calls[0][1] as (snap: unknown) => void;
      const hashCb = mockOnValue.mock.calls[1][1] as (snap: unknown) => void;

      const inputData = [{ tick: 1, input: 0 }];
      const hashData = { tick: 5, hash: 999 };

      inputCb({ val: () => inputData });
      hashCb({ val: () => hashData });

      const types = t.transportTelemetry.messageTypes;

      expect(types['inputs'].bytesReceived).toBe(JSON.stringify(inputData).length);
      expect(types['hash'].bytesReceived).toBe(JSON.stringify(hashData).length);
    });

    it('messageTypes accumulates counts for repeated sends of the same type', () => {
      const t = makeTransport();
      t.sendInputs([{ tick: 1, input: 0 }]);
      t.sendInputs([{ tick: 2, input: 1 }]);
      t.sendInputs([{ tick: 3, input: 2 }]);

      const inputStats = t.transportTelemetry.messageTypes['inputs'];
      expect(inputStats.count).toBe(3);

      const totalBytes =
        JSON.stringify([{ tick: 1, input: 0 }]).length +
        JSON.stringify([{ tick: 2, input: 1 }]).length +
        JSON.stringify([{ tick: 3, input: 2 }]).length;
      expect(inputStats.bytesSent).toBe(totalBytes);
    });

    it('connectLatencyMs measured from connect() to first onValue callback', async () => {
      const t = makeTransport(['opp1']);
      t.onRemoteInputs(vi.fn());

      // Mock performance.now to control timing
      const perfSpy = vi.spyOn(performance, 'now');
      perfSpy.mockReturnValue(1000); // connect start time
      await t.connect();

      // Before any inbound data, connectLatencyMs should be 0
      expect(t.transportTelemetry.connectLatencyMs).toBe(0);

      // Simulate first data arriving 150ms later
      perfSpy.mockReturnValue(1150);
      const inputCb = mockOnValue.mock.calls[0][1] as (snap: unknown) => void;
      inputCb({ val: () => [{ tick: 1, input: 0 }] });

      expect(t.transportTelemetry.connectLatencyMs).toBe(150);

      perfSpy.mockRestore();
    });

    it('connectLatencyMs only records the first inbound message', async () => {
      const t = makeTransport(['opp1']);
      t.onRemoteInputs(vi.fn());
      t.onRemoteHash(vi.fn());

      const perfSpy = vi.spyOn(performance, 'now');
      perfSpy.mockReturnValue(2000);
      await t.connect();

      // First message at 2200ms
      perfSpy.mockReturnValue(2200);
      const inputCb = mockOnValue.mock.calls[0][1] as (snap: unknown) => void;
      inputCb({ val: () => [{ tick: 1, input: 0 }] });
      expect(t.transportTelemetry.connectLatencyMs).toBe(200);

      // Second message at 2500ms — should NOT update connectLatencyMs
      perfSpy.mockReturnValue(2500);
      const hashCb = mockOnValue.mock.calls[1][1] as (snap: unknown) => void;
      hashCb({ val: () => ({ tick: 5, hash: 999 }) });
      expect(t.transportTelemetry.connectLatencyMs).toBe(200);

      perfSpy.mockRestore();
    });

    it('avgMessageSizeOut calculated correctly', () => {
      const t = makeTransport();
      const small = [{ tick: 1, input: 0 }];
      const large = [{ tick: 1, input: 0 }, { tick: 2, input: 1 }, { tick: 3, input: 2 }];

      t.sendInputs(small);
      t.sendInputs(large);

      const totalBytes = JSON.stringify(small).length + JSON.stringify(large).length;
      const expected = Math.round(totalBytes / 2);
      expect(t.transportTelemetry.avgMessageSizeOut).toBe(expected);
    });

    it('avgMessageSizeOut is zero when no messages sent', () => {
      const t = makeTransport();
      expect(t.transportTelemetry.avgMessageSizeOut).toBe(0);
    });

    it('avgMessageSizeIn calculated correctly', async () => {
      const t = makeTransport(['opp1']);
      t.onRemoteInputs(vi.fn());
      t.onRemoteHash(vi.fn());
      await t.connect();

      const inputCb = mockOnValue.mock.calls[0][1] as (snap: unknown) => void;
      const hashCb = mockOnValue.mock.calls[1][1] as (snap: unknown) => void;

      const inputData = [{ tick: 1, input: 0 }];
      const hashData = { tick: 5, hash: 999 };

      inputCb({ val: () => inputData });
      hashCb({ val: () => hashData });

      const totalBytes = JSON.stringify(inputData).length + JSON.stringify(hashData).length;
      const expected = Math.round(totalBytes / 2);
      expect(t.transportTelemetry.avgMessageSizeIn).toBe(expected);
    });

    it('avgMessageSizeIn is zero when no messages received', () => {
      const t = makeTransport();
      expect(t.transportTelemetry.avgMessageSizeIn).toBe(0);
    });

    it('state reflects connected vs disconnected', async () => {
      const t = makeTransport(['opp1']);
      expect(t.transportTelemetry.state).toBe('disconnected');

      await t.connect();
      expect(t.transportTelemetry.state).toBe('connected');

      t.disconnect();
      expect(t.transportTelemetry.state).toBe('disconnected');
    });

    it('peakMessageSizeOut tracks the largest outbound message', () => {
      const t = makeTransport();
      const small = [{ tick: 1, input: 0 }];
      const large = [{ tick: 1, input: 0 }, { tick: 2, input: 1 }, { tick: 3, input: 2 }];

      t.sendInputs(small);
      t.sendInputs(large);

      expect(t.transportTelemetry.peakMessageSizeOut).toBe(JSON.stringify(large).length);
    });

    it('peakMessageSizeIn tracks the largest inbound message', async () => {
      const t = makeTransport(['opp1']);
      t.onRemoteInputs(vi.fn());
      t.onRemoteHash(vi.fn());
      await t.connect();

      const inputCb = mockOnValue.mock.calls[0][1] as (snap: unknown) => void;
      const hashCb = mockOnValue.mock.calls[1][1] as (snap: unknown) => void;

      const smallData = { tick: 5, hash: 1 };
      const largeData = [{ tick: 1, input: 0 }, { tick: 2, input: 1 }];

      hashCb({ val: () => smallData });
      inputCb({ val: () => largeData });

      expect(t.transportTelemetry.peakMessageSizeIn).toBe(JSON.stringify(largeData).length);
    });

    it('messageTypes returns a defensive copy', () => {
      const t = makeTransport();
      t.sendInputs([{ tick: 1, input: 0 }]);

      const types1 = t.transportTelemetry.messageTypes;
      const types2 = t.transportTelemetry.messageTypes;

      // Should be equal values but not the same object reference
      expect(types1).toEqual(types2);
      expect(types1).not.toBe(types2);
      expect(types1['inputs']).not.toBe(types2['inputs']);
    });
  });
});
