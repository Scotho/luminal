// ── Debug Log Tests ──────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerDebugRefs, getNetcodeStats, getNetLog } from './debugLog';

// Minimal mock for the game ref shape expected by debugLog
function createMockGameRef(overrides: Record<string, unknown> = {}) {
  return {
    state: 'playing',
    mode: 'online',
    matchTime: 42.5,
    _onlineMatch: null as unknown,
    _lockstep: null as unknown,
    ...overrides,
  };
}

function createMockRenderer() {
  return {
    info: {
      render: { calls: 100, triangles: 5000 },
      memory: { geometries: 50, textures: 20 },
      programs: new Array(10),
    },
    getContext: () => ({ getParameter: () => 'Mock GPU' }),
  } as unknown;
}

describe('debugLog', () => {
  beforeEach(() => {
    // Reset refs by re-registering null-ish values
    registerDebugRefs(null as never, null as never);
  });

  describe('getNetcodeStats', () => {
    it('returns null when no game is registered', () => {
      expect(getNetcodeStats()).toBeNull();
    });

    it('returns null when game has no online match', () => {
      registerDebugRefs(
        createMockGameRef() as never,
        createMockRenderer() as never,
      );
      expect(getNetcodeStats()).toBeNull();
    });

    it('returns stats when online match with netcode exists', () => {
      const mockNetcode = {
        estimatedRttMs: 45,
        jitterMs: 3.2,
        packetLossRate: 0.01,
        packetLossCount: 2,
        packetsReceived: 198,
        isOpponentConnected: () => true,
        inputAckStats: { avgLatencyMs: 50, missCount: 0, ackCount: 10, pendingCount: 1 },
        getPacketTelemetry: () => ({
          packetLossRate: 0.01, packetLossCount: 2, packetReorderCount: 1, packetsReceived: 198,
          jitterMs: 3.2, jitterP50Ms: 2.5, jitterP95Ms: 5.0, jitterP99Ms: 8.0,
          inputAckAvgMs: 50, inputAckMissCount: 0,
          inputAckP50Ms: 45, inputAckP95Ms: 80, inputAckP99Ms: 120,
          transportBytes: null,
          transportReconnects: 0, transportConnectMs: 0,
        }),
        _seqNum: 100,
        _lastRemoteSeqMap: new Map(),
        _remoteStatesMap: new Map(),
        _serverTimeOffset: 10,
        _lastHeartbeats: new Map(),
      };
      const mockMatch = {
        netcode: mockNetcode,
        matchId: 'test-match',
        myUid: 'uid1',
        opponentUid: 'uid2',
        opponentName: 'TestOpp',
        round: 1,
        seriesLength: 3,
        state: 'playing',
        scores: {},
        deathGraceMs: 200,
      };
      registerDebugRefs(
        createMockGameRef({ _onlineMatch: mockMatch }) as never,
        createMockRenderer() as never,
      );
      const stats = getNetcodeStats();
      expect(stats).not.toBeNull();
      expect(stats!.rtt).toBe(45);
      expect(stats!.connected).toBe(true);
      expect(stats!.health).toBe('connected');
    });

    it('returns health from lockstep telemetry when available', () => {
      const mockNetcode = {
        estimatedRttMs: 30,
        jitterMs: 1.5,
        packetLossRate: 0,
        packetLossCount: 0,
        packetsReceived: 500,
        isOpponentConnected: () => true,
        inputAckStats: { avgLatencyMs: 30, missCount: 0, ackCount: 50, pendingCount: 0 },
        getPacketTelemetry: () => ({
          packetLossRate: 0, packetLossCount: 0, packetReorderCount: 0, packetsReceived: 500,
          jitterMs: 1.5, jitterP50Ms: 1.0, jitterP95Ms: 2.5, jitterP99Ms: 4.0,
          inputAckAvgMs: 30, inputAckMissCount: 0,
          inputAckP50Ms: 28, inputAckP95Ms: 55, inputAckP99Ms: 90,
          transportBytes: null,
          transportReconnects: 0, transportConnectMs: 0,
        }),
        _seqNum: 50,
        _lastRemoteSeqMap: new Map(),
        _remoteStatesMap: new Map(),
        _serverTimeOffset: 5,
        _lastHeartbeats: new Map(),
      };
      const mockMatch = {
        netcode: mockNetcode,
        matchId: 'test-match',
        myUid: 'uid1',
        opponentUid: 'uid2',
        opponentName: 'TestOpp',
        round: 1,
        seriesLength: 3,
        state: 'playing',
        scores: {},
        deathGraceMs: 200,
      };
      const mockLockstep = {
        tick: 100,
        started: true,
        inputBuffer: { inputDelay: 2 },
        renderAlpha: 0.5,
        getTelemetry: () => ({
          rollbackCount: 0,
          desyncCount: 0,
          rollbackDepths: {},
          rollbackMaxDepth: 0,
          rollbackAvgDepth: 0,
          peakPredictAhead: 2,
          lateInputCount: 0,
          recoveryCount: 0,
          stallCount: 0,
          totalTicks: 100,
          avgSimTickCostMs: 0.15,
          peakSimTickCostMs: 0.42,
          avgRollbackCostMs: 0,
          peakRollbackCostMs: 0,
          avgRecoveryCostMs: 0,
          peakRecoveryCostMs: 0,
          avgRecoverySnapshotBytes: 0,
          simTickP50Ms: 0.1,
          simTickP95Ms: 0.3,
          simTickP99Ms: 0.4,
          inputLatencyBuckets: {},
          mispredictionCount: 0,
          correctPredictionCount: 0,
          inputBufferDepth: 0,
        }),
        getMyPlayer: () => ({ x: 10, z: 20, speed: 40, alive: true }),
        getPlayerByIndex: (i: number) => i === 0 ? { x: 10, z: 20, speed: 40, alive: true } : { x: 30, z: 40, speed: 40, alive: true },
        playerCount: 2,
        myIndex: 0,
        myVisualOffset: { x: 0, z: 0 },
        getVisualOffset: () => ({ x: 0, z: 0 }),
      };
      registerDebugRefs(
        createMockGameRef({ _onlineMatch: mockMatch, _lockstep: mockLockstep }) as never,
        createMockRenderer() as never,
      );
      const stats = getNetcodeStats();
      expect(stats).not.toBeNull();
      expect(stats!.health).toBe('healthy');
      expect(stats!.rtt).toBe(30);
    });
  });

  describe('getNetLog', () => {
    it('returns diagnostic string when no game registered', () => {
      const log = getNetLog();
      expect(log).toContain('NETLOG');
      expect(log).toContain('not registered');
    });

    it('returns match info when game is registered with no match', () => {
      registerDebugRefs(
        createMockGameRef() as never,
        createMockRenderer() as never,
      );
      const log = getNetLog();
      expect(log).toContain('NETLOG');
      expect(log).toContain('match: none');
    });
  });

  describe('registerDebugRefs', () => {
    it('accepts game and renderer refs without throwing', () => {
      expect(() => {
        registerDebugRefs(
          createMockGameRef() as never,
          createMockRenderer() as never,
        );
      }).not.toThrow();
    });
  });
});
