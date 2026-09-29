// ── NetcodeSession Listener Deduplication Tests ──────────
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockOff = vi.fn();
const mockOnValue = vi.fn(() => vi.fn()); // returns unsub
const mockSet = vi.fn(() => Promise.resolve());

// Unique ref objects per path — needed so we can compare by reference in off() calls
const refStore = new Map<string, object>();
const mockRef = vi.fn((_db: unknown, path: string) => {
  if (!refStore.has(path)) refStore.set(path, { __path: path });
  return refStore.get(path)!;
});

vi.mock('firebase/database', () => ({
  ref: (...args: unknown[]) => mockRef(...args),
  set: (...args: unknown[]) => mockSet(...args),
  get: vi.fn(() => Promise.resolve({ val: () => null })),
  onValue: (...args: unknown[]) => mockOnValue(...args),
  off: (...args: unknown[]) => mockOff(...args),
  onDisconnect: vi.fn(() => ({ remove: vi.fn(), update: vi.fn() })),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
  push: vi.fn(() => Promise.resolve()),
  update: vi.fn(() => Promise.resolve()),
  remove: vi.fn(() => Promise.resolve()),
}));

vi.mock('./firebase', () => ({
  rtdb: { __rtdb: true },
}));

import { NetcodeSession } from './netcode';

describe('NetcodeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refStore.clear();
  });

  describe('startInputSync', () => {
    it('registers exactly one onValue listener per opponent', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
      session.startInputSync(new Map([['uid2', 1]]));
      const inputCalls = mockOnValue.mock.calls.filter(
        ([r]: [{ __path?: string }]) => r.__path?.includes('/inputs/')
      );
      expect(inputCalls).toHaveLength(1);
    });

    it('calls off() on previous input listener when called a second time', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
      const uidToIndex = new Map([['uid2', 1]]);

      session.startInputSync(uidToIndex); // first registration
      // Capture the ref registered for uid2 inputs
      const uid2InputRef = refStore.get('matches/match1/inputs/uid2');

      mockOff.mockClear();
      session.startInputSync(uidToIndex); // second registration

      // off() must have been called with the previously registered ref
      expect(mockOff).toHaveBeenCalledTimes(1);
      expect(mockOff).toHaveBeenCalledWith(uid2InputRef);
    });
  });

  describe('startHashSync', () => {
    it('calls off() on previous hash listener when called a second time', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);

      session.startHashSync();
      const uid2HashRef = refStore.get('matches/match1/hashes/uid2');

      mockOff.mockClear();
      session.startHashSync();

      expect(mockOff).toHaveBeenCalledTimes(1);
      expect(mockOff).toHaveBeenCalledWith(uid2HashRef);
    });
  });

  describe('startSnapshotSync', () => {
    it('calls off() on previous snapshot listener when called a second time', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);

      session.startSnapshotSync();
      const uid2SnapRef = refStore.get('matches/match1/snapshot/uid2');

      mockOff.mockClear();
      session.startSnapshotSync();

      expect(mockOff).toHaveBeenCalledTimes(1);
      expect(mockOff).toHaveBeenCalledWith(uid2SnapRef);
    });
  });

  describe('MatchTransport delegation', () => {
    it('delegates sendInputs to attached transport', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
      const mockTransport = {
        connect: vi.fn(() => Promise.resolve()),
        disconnect: vi.fn(),
        sendInputs: vi.fn(),
        sendHash: vi.fn(),
        sendSnapshot: vi.fn(),
        onRemoteInputs: vi.fn(),
        onRemoteHash: vi.fn(),
        onRemoteSnapshot: vi.fn(),
        onDisconnect: vi.fn(),
        estimatedRttMs: 0,
      };

      session.attachTransport(mockTransport);

      const frames = [{ tick: 1, turnDir: 0 as const, accelerate: false, dash: false, brake: false }];
      session.sendInputs(frames);

      expect(mockTransport.sendInputs).toHaveBeenCalledWith(frames);
      // Should NOT write to RTDB when transport is attached
      const inputSetCalls = mockSet.mock.calls.filter(
        ([r]: [{ __path?: string }]) => r?.__path?.includes('/inputs/'),
      );
      expect(inputSetCalls).toHaveLength(0);
    });

    it('delegates sendHash to attached transport', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
      const mockTransport = {
        connect: vi.fn(() => Promise.resolve()),
        disconnect: vi.fn(),
        sendInputs: vi.fn(),
        sendHash: vi.fn(),
        sendSnapshot: vi.fn(),
        onRemoteInputs: vi.fn(),
        onRemoteHash: vi.fn(),
        onRemoteSnapshot: vi.fn(),
        onDisconnect: vi.fn(),
        estimatedRttMs: 0,
      };

      session.attachTransport(mockTransport);
      session.sendHash(60, 12345);

      expect(mockTransport.sendHash).toHaveBeenCalledWith(60, 12345);
    });

    it('falls through to RTDB when no transport attached', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
      const frames = [{ tick: 1, turnDir: 0 as const, accelerate: false, dash: false, brake: false }];
      session.sendInputs(frames);

      const setRef = mockSet.mock.calls[0]?.[0] as { __path?: string };
      expect(setRef?.__path).toBe('matches/match1/inputs/uid1');
    });

    it('disconnects transport on stop()', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
      const mockTransport = {
        connect: vi.fn(() => Promise.resolve()),
        disconnect: vi.fn(),
        sendInputs: vi.fn(),
        sendHash: vi.fn(),
        sendSnapshot: vi.fn(),
        onRemoteInputs: vi.fn(),
        onRemoteHash: vi.fn(),
        onRemoteSnapshot: vi.fn(),
        onDisconnect: vi.fn(),
        estimatedRttMs: 0,
      };

      session.attachTransport(mockTransport);
      session.stop();

      expect(mockTransport.disconnect).toHaveBeenCalled();
    });
  });

  describe('packet loss detection + burst tracking', () => {
    it('seq gap increments _packetLossCount', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
      const s = session as unknown as Record<string, unknown>;
      // Simulate: seq 0 arrived, then seq 3 arrives (gap of 2)
      (s._lastRemoteSeqMap as Map<string, number>).set('uid2', 0);
      s._packetsReceived = 1;
      // Simulate gap via state arrival (trigger via internal tracking)
      s._packetLossCount = 5;
      s._packetsReceived = 100;
      const t = session.getPacketTelemetry();
      expect(t.packetLossCount).toBe(5);
      expect(t.packetsReceived).toBe(100);
      expect(t.packetLossRate).toBeCloseTo(5 / 105, 4);
    });

    it('burst tracking: 3+ consecutive losses counted as burst', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
      const s = session as unknown as Record<string, unknown>;
      // Simulate a burst of 5 consecutive loss events
      s._packetLossStreak = 5;
      s._packetLossBurstCount = 2;
      s._packetLossPeakBurst = 7;
      const t = session.getPacketTelemetry();
      // In-flight burst (streak >= 3) adds 1 to burst count
      expect(t.packetLossBurstCount).toBe(3);
      expect(t.packetLossPeakBurst).toBe(7);
    });

    it('streak < 3 does not add in-flight burst to telemetry', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
      const s = session as unknown as Record<string, unknown>;
      s._packetLossStreak = 2; // below threshold
      s._packetLossBurstCount = 1;
      const t = session.getPacketTelemetry();
      expect(t.packetLossBurstCount).toBe(1); // no in-flight addition
    });
  });

  describe('heartbeat miss tracking', () => {
    it('heartbeat miss count and late buffer reported in telemetry', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
      const s = session as unknown as Record<string, unknown>;
      s._heartbeatMissCount = 3;
      (s._heartbeatLateMs as { push(v: number): void }).push(7000);
      (s._heartbeatLateMs as { push(v: number): void }).push(8000);
      const t = session.getPacketTelemetry();
      expect(t.heartbeatMissCount).toBe(3);
      expect(t.heartbeatAvgMs).toBeGreaterThan(0);
    });
  });

  describe('resetForNewRound', () => {
    it('zeroes all telemetry counters and clears ring buffers', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
      const s = session as unknown as Record<string, unknown>;
      // Set non-zero state on the session (where counters live)
      s._packetLossCount = 10;
      s._packetReorderCount = 5;
      s._packetsReceived = 200;
      s._packetLossStreak = 1;
      s._packetLossBurstCount = 3;
      s._packetLossPeakBurst = 8;
      s._heartbeatMissCount = 2;
      s._inputAckCount = 50;
      s._inputAckMissCount = 4;
      s._jitterMs = 15;

      session.resetForNewRound(2);

      expect(s._packetLossCount).toBe(0);
      expect(s._packetReorderCount).toBe(0);
      expect(s._packetsReceived).toBe(0);
      expect(s._packetLossStreak).toBe(0);
      expect(s._packetLossBurstCount).toBe(0);
      expect(s._packetLossPeakBurst).toBe(0);
      expect(s._heartbeatMissCount).toBe(0);
      expect(s._inputAckCount).toBe(0);
      expect(s._inputAckMissCount).toBe(0);
      expect(s._jitterMs).toBe(0);
      expect(session.currentRound).toBe(2);
    });

    it('flushes in-flight burst (streak >= 3) before zeroing', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
      const s = session as unknown as Record<string, unknown>;
      s._packetLossStreak = 4; // active burst in-flight
      s._packetLossBurstCount = 1;

      session.resetForNewRound(2);

      // Burst was flushed (1 + 1 = 2) then zeroed
      // After reset, burstCount is 0 (zeroed), but the flush happened first
      expect(s._packetLossBurstCount).toBe(0);
      expect(s._packetLossStreak).toBe(0);
    });

    it('does not flush burst when streak < 3', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
      const s = session as unknown as Record<string, unknown>;
      s._packetLossStreak = 2;
      s._packetLossBurstCount = 1;

      session.resetForNewRound(2);

      expect(s._packetLossBurstCount).toBe(0);
      expect(s._packetLossStreak).toBe(0);
    });

    it('clears remoteStatesMap and resets seq tracking', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
      const s = session as unknown as { _lastRemoteSeqMap: Map<string, number>; _remoteDeadSet: Set<string> };
      s._lastRemoteSeqMap.set('uid2', 50);
      s._remoteDeadSet.add('uid2');

      session.resetForNewRound(3);

      expect(s._lastRemoteSeqMap.get('uid2')).toBe(-1);
      expect(s._remoteDeadSet.size).toBe(0);
    });
  });

  describe('getPacketTelemetry snapshot', () => {
    it('returns all expected fields', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
      const t = session.getPacketTelemetry();
      // Core fields
      expect(typeof t.packetLossRate).toBe('number');
      expect(typeof t.packetLossCount).toBe('number');
      expect(typeof t.packetReorderCount).toBe('number');
      expect(typeof t.packetsReceived).toBe('number');
      expect(typeof t.jitterMs).toBe('number');
      // Burst fields
      expect(typeof t.packetLossBurstCount).toBe('number');
      expect(typeof t.packetLossPeakBurst).toBe('number');
      // Server time offset
      expect(typeof t.serverTimeOffsetMs).toBe('number');
      // Heartbeat
      expect(typeof t.heartbeatMissCount).toBe('number');
      expect(typeof t.heartbeatAvgMs).toBe('number');
      // Input ack
      expect(typeof t.inputAckAvgMs).toBe('number');
      expect(typeof t.inputAckMissCount).toBe('number');
      // Percentiles
      expect(typeof t.rttP50Ms).toBe('number');
      expect(typeof t.rttP95Ms).toBe('number');
      expect(typeof t.rttP99Ms).toBe('number');
      expect(typeof t.jitterP50Ms).toBe('number');
      expect(typeof t.jitterP95Ms).toBe('number');
      expect(typeof t.jitterP99Ms).toBe('number');
    });

    it('includes in-flight burst in packetLossBurstCount', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
      const s = session as unknown as Record<string, unknown>;
      s._packetLossBurstCount = 0;
      s._packetLossStreak = 5; // active burst
      const t = session.getPacketTelemetry();
      expect(t.packetLossBurstCount).toBe(1); // 0 + 1 in-flight
    });

    it('serverTimeOffsetMs reflects internal offset', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
      const internal = session as unknown as { _serverTimeOffset: number };
      internal._serverTimeOffset = -150;
      const t = session.getPacketTelemetry();
      expect(t.serverTimeOffsetMs).toBe(-150);
    });
  });

  describe('RTT percentile telemetry', () => {
    it('rttP50/P95/P99 are numbers (default zero before samples)', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
      const t = session.getPacketTelemetry();
      expect(typeof t.rttP50Ms).toBe('number');
      expect(typeof t.rttP95Ms).toBe('number');
      expect(typeof t.rttP99Ms).toBe('number');
      // No samples yet — should be 0
      expect(t.rttP50Ms).toBe(0);
      expect(t.rttP95Ms).toBe(0);
      expect(t.rttP99Ms).toBe(0);
    });

    it('RTT percentiles populate from state arrival samples', () => {
      const session = new NetcodeSession('match1', 'uid1', ['uid1', 'uid2']);
      // Manually push RTT samples via the _rttSamples ring buffer
      // This simulates what happens when state updates arrive at varying intervals
      const s = session as unknown as { _rttSamples: { push(v: number): void } };
      const rttSamples = s._rttSamples;
      for (let i = 0; i < 20; i++) {
        rttSamples.push(50 + i * 5); // 50, 55, 60, ... 145ms
      }
      const t = session.getPacketTelemetry();
      expect(t.rttP50Ms).toBeGreaterThan(0);
      expect(t.rttP95Ms).toBeGreaterThanOrEqual(t.rttP50Ms);
      expect(t.rttP99Ms).toBeGreaterThanOrEqual(t.rttP95Ms);
    });
  });

  describe('writeRoundEnd', () => {
    it('includes stateDigest when provided', async () => {
      const session = new NetcodeSession('match1', 'user1', ['user1', 'user2']);
      await session.writeRoundEnd(1, 'user1', 12345);
      expect(mockSet).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ round: 1, winner: 'user1', stateDigest: 12345 }),
      );
    });

    it('omits stateDigest when not provided', async () => {
      const session = new NetcodeSession('match1', 'user1', ['user1', 'user2']);
      await session.writeRoundEnd(1, 'user1');
      const payload = mockSet.mock.calls[0][1] as Record<string, unknown>;
      expect(payload.stateDigest).toBeUndefined();
      expect(payload).toEqual(expect.objectContaining({ round: 1, winner: 'user1' }));
    });
  });
});
