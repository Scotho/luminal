// ── Lockstep Telemetry Tests ─────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  buildRoundTelemetry,
  classifyHealth,
  type RawTelemetryInput,
  type RoundTelemetry,
  type ExtendedHealthSignals,
} from './lockstepTelemetry';
import { RingBuffer } from '../telemetry';

function makeRing(values: number[], cap = 120): RingBuffer<number> {
  const buf = new RingBuffer<number>(cap);
  for (const v of values) buf.push(v);
  return buf;
}

function makePairRing(values: Array<{ depth: number; costMs: number }>, cap = 120): RingBuffer<{ depth: number; costMs: number }> {
  const buf = new RingBuffer<{ depth: number; costMs: number }>(cap);
  for (const v of values) buf.push(v);
  return buf;
}

function baseRaw(overrides: Partial<RawTelemetryInput> = {}): RawTelemetryInput {
  return {
    rollbackDepths: [],
    rollbackCount: 0,
    peakPredictAhead: 0,
    lateInputCount: 0,
    desyncCount: 0,
    recoveryCount: 0,
    stallCount: 0,
    totalTicks: 100,
    simTickCostSamples: makeRing([]),
    peakSimTickMs: 0,
    rollbackCostMs: makeRing([], 60),
    peakRollbackMs: 0,
    recoveryCostMs: makeRing([], 30),
    peakRecoveryMs: 0,
    recoverySnapshotBytes: makeRing([], 30),
    inputLatencyBuckets: {},
    mispredictionCount: 0,
    correctPredictionCount: 0,
    inputBufferDepth: 0,
    hashCostSamples: makeRing([], 30),
    snapshotMissCount: 0,
    rollbackDepthCostPairs: makePairRing([]),
    snapshotSerdeCostSamples: makeRing([], 30),
    stallDurationSamples: makeRing([], 60),
    peakStallMs: 0,
    quantizeCostSamples: makeRing([], 60),
    lateInputBurstCount: 0,
    lateInputPeakStreak: 0,
    proximityCostSamples: makeRing([], 60),
    peakProximityCostMs: 0,
    visualCorrectionSamples: makeRing([], 120),
    peakVisualCorrectionDist: 0,
    ...overrides,
  };
}

describe('buildRoundTelemetry', () => {
  it('returns zeroed telemetry for empty inputs', () => {
    const t = buildRoundTelemetry(baseRaw());
    expect(t.rollbackCount).toBe(0);
    expect(t.rollbackMaxDepth).toBe(0);
    expect(t.rollbackAvgDepth).toBe(0);
    expect(t.avgSimTickCostMs).toBe(0);
    expect(t.rollbackP50Ms).toBe(0);
    expect(t.rollbackP95Ms).toBe(0);
    expect(t.rollbackP99Ms).toBe(0);
    expect(t.snapshotMissCount).toBe(0);
  });

  it('computes rollback depth distribution', () => {
    const t = buildRoundTelemetry(baseRaw({
      rollbackDepths: [2, 3, 2, 5, 2],
      rollbackCount: 5,
    }));
    expect(t.rollbackDepths).toEqual({ 2: 3, 3: 1, 5: 1 });
    expect(t.rollbackMaxDepth).toBe(5);
    expect(t.rollbackAvgDepth).toBeCloseTo(2.8, 1);
  });

  it('computes rollback cost percentiles from RingBuffer', () => {
    // 20 samples: 1, 2, ..., 20 ms
    const samples = Array.from({ length: 20 }, (_, i) => i + 1);
    const t = buildRoundTelemetry(baseRaw({
      rollbackCostMs: makeRing(samples, 60),
      rollbackCount: 20,
    }));
    expect(t.rollbackP50Ms).toBeGreaterThan(0);
    expect(t.rollbackP95Ms).toBeGreaterThanOrEqual(t.rollbackP50Ms);
    expect(t.rollbackP99Ms).toBeGreaterThanOrEqual(t.rollbackP95Ms);
  });

  it('computes sim tick percentiles from RingBuffer', () => {
    const samples = Array.from({ length: 30 }, (_, i) => 0.5 + i * 0.1);
    const t = buildRoundTelemetry(baseRaw({
      simTickCostSamples: makeRing(samples),
    }));
    expect(t.simTickP50Ms).toBeGreaterThan(0);
    expect(t.simTickP95Ms).toBeGreaterThanOrEqual(t.simTickP50Ms);
    expect(t.simTickP99Ms).toBeGreaterThanOrEqual(t.simTickP95Ms);
  });

  it('preserves peak high-water marks', () => {
    const t = buildRoundTelemetry(baseRaw({
      peakSimTickMs: 5.5,
      peakRollbackMs: 12.3,
      peakRecoveryMs: 8.7,
    }));
    expect(t.peakSimTickCostMs).toBe(5.5);
    expect(t.peakRollbackCostMs).toBe(12.3);
    expect(t.peakRecoveryCostMs).toBe(8.7);
  });

  it('averages recovery snapshot bytes', () => {
    const t = buildRoundTelemetry(baseRaw({
      recoverySnapshotBytes: makeRing([1000, 2000, 3000], 30),
      recoveryCount: 3,
    }));
    expect(t.avgRecoverySnapshotBytes).toBe(2000);
  });

  it('computes hash cost percentiles', () => {
    const samples = Array.from({ length: 10 }, (_, i) => 0.1 + i * 0.05);
    const t = buildRoundTelemetry(baseRaw({
      hashCostSamples: makeRing(samples, 30),
    }));
    expect(t.avgHashCostMs).toBeGreaterThan(0);
    // peakHashCostMs uses p99 of hash costs
    expect(t.peakHashCostMs).toBeGreaterThanOrEqual(0);
  });

  it('copies input latency buckets without mutation', () => {
    const buckets = { 0: 10, 1: 5, 3: 2 };
    const t = buildRoundTelemetry(baseRaw({ inputLatencyBuckets: buckets }));
    expect(t.inputLatencyBuckets).toEqual(buckets);
    // Should be a copy, not the same reference
    expect(t.inputLatencyBuckets).not.toBe(buckets);
  });

  it('aggregates rollback cost by depth', () => {
    const t = buildRoundTelemetry(baseRaw({
      rollbackDepthCostPairs: makePairRing([
        { depth: 2, costMs: 1.0 },
        { depth: 2, costMs: 3.0 },
        { depth: 5, costMs: 8.0 },
      ]),
    }));
    expect(t.rollbackCostByDepth[2]).toEqual({ avgMs: 2, peakMs: 3, count: 2 });
    expect(t.rollbackCostByDepth[5]).toEqual({ avgMs: 8, peakMs: 8, count: 1 });
  });

  it('returns empty rollbackCostByDepth when no pairs', () => {
    const t = buildRoundTelemetry(baseRaw());
    expect(t.rollbackCostByDepth).toEqual({});
  });

  it('computes snapshot serde cost from samples', () => {
    const t = buildRoundTelemetry(baseRaw({
      snapshotSerdeCostSamples: makeRing([0.5, 1.0, 1.5], 30),
    }));
    expect(t.snapshotSerdeCostAvgMs).toBe(1);
    expect(t.snapshotSerdeCostPeakMs).toBeGreaterThan(0);
  });

  it('returns zero serde cost when no samples', () => {
    const t = buildRoundTelemetry(baseRaw());
    expect(t.snapshotSerdeCostAvgMs).toBe(0);
    expect(t.snapshotSerdeCostPeakMs).toBe(0);
  });

  it('passes through counters verbatim', () => {
    const t = buildRoundTelemetry(baseRaw({
      mispredictionCount: 15,
      correctPredictionCount: 85,
      inputBufferDepth: 3,
      snapshotMissCount: 2,
      desyncCount: 4,
      stallCount: 7,
      lateInputCount: 20,
      totalTicks: 500,
    }));
    expect(t.mispredictionCount).toBe(15);
    expect(t.correctPredictionCount).toBe(85);
    expect(t.inputBufferDepth).toBe(3);
    expect(t.snapshotMissCount).toBe(2);
    expect(t.desyncCount).toBe(4);
    expect(t.stallCount).toBe(7);
    expect(t.lateInputCount).toBe(20);
    expect(t.totalTicks).toBe(500);
  });

  it('avgStallDurationMs is ring average of stallDurationSamples', () => {
    const t = buildRoundTelemetry(baseRaw({
      stallDurationSamples: makeRing([10, 20, 30], 60),
    }));
    expect(t.avgStallDurationMs).toBe(20);
  });

  it('peakStallDurationMs is raw.peakStallMs rounded to 2dp', () => {
    const t = buildRoundTelemetry(baseRaw({
      peakStallMs: 12.3456,
    }));
    expect(t.peakStallDurationMs).toBe(12.35);
  });

  it('stall durations are 0 when no samples exist', () => {
    const t = buildRoundTelemetry(baseRaw());
    expect(t.avgStallDurationMs).toBe(0);
    expect(t.peakStallDurationMs).toBe(0);
  });
});

describe('classifyHealth', () => {
  function healthyTelemetry(overrides: Partial<RoundTelemetry> = {}): RoundTelemetry {
    return buildRoundTelemetry(baseRaw({
      totalTicks: 100,
      ...overrides as Partial<RawTelemetryInput>,
    }));
  }

  it('returns healthy for nominal telemetry', () => {
    const h = classifyHealth(healthyTelemetry());
    expect(h.level).toBe('healthy');
    expect(h.reasons).toHaveLength(0);
  });

  it('detects superlinear rollback cost scaling as degraded', () => {
    // Depth-2 rollbacks cost 1ms, depth-10 rollbacks cost 50ms
    // costRatio = 50, depthRatio = 5, scaling = 10x > 2.5 threshold
    const t = healthyTelemetry();
    t.rollbackCostByDepth = {
      2: { avgMs: 1, peakMs: 2, count: 5 },
      10: { avgMs: 50, peakMs: 80, count: 3 },
    };
    const h = classifyHealth(t);
    expect(h.level).toBe('degraded');
    expect(h.reasons.some(r => r.includes('O(n²)'))).toBe(true);
  });

  it('detects high snapshot serde cost as degraded', () => {
    const t = healthyTelemetry();
    t.snapshotSerdeCostPeakMs = 8;
    const h = classifyHealth(t);
    expect(h.level).toBe('degraded');
    expect(h.reasons.some(r => r.includes('serialization'))).toBe(true);
  });

  it('detects unstable conditions from multiple recoveries', () => {
    const t = healthyTelemetry();
    t.recoveryCount = 3;
    const h = classifyHealth(t);
    expect(h.level).toBe('unstable');
  });

  it('detects degraded from elevated desync count', () => {
    const t = healthyTelemetry();
    t.desyncCount = 4;
    const h = classifyHealth(t);
    expect(h.level).toBe('degraded');
    expect(h.reasons.some(r => r.includes('desync'))).toBe(true);
  });

  function healthyExt(): ExtendedHealthSignals {
    return {
      jitterP95Ms: 0,
      jitterP99Ms: 0,
      heartbeatMissCount: 0,
      heartbeatP95Ms: 0,
      gcPauseCount: 0,
      gcPauseTotalMs: 0,
      heapPressure: 0,
      frameTimeP95Ms: 0,
      frameTimeStdDevMs: 0,
      jankEventCount: 0,
      jankPeakStreak: 0,
      transportReconnects: 0,
      mispredictionRate: 0,
      packetReorderCount: 0,
      packetsReceived: 100,
      transportBufferedBytes: 0,
      serverTimeOffsetMs: 0,
    };
  }

  it('heartbeatP95Ms > 8000 produces degraded with heartbeat delivery unreliable', () => {
    const t = healthyTelemetry();
    const ext = healthyExt();
    ext.heartbeatP95Ms = 9000;
    const h = classifyHealth(t, ext);
    expect(h.level).toBe('degraded');
    expect(h.reasons.some(r => r.includes('heartbeat delivery unreliable'))).toBe(true);
  });

  it('heartbeatP95Ms <= 8000 does not add a heartbeat reason', () => {
    const t = healthyTelemetry();
    const ext = healthyExt();
    ext.heartbeatP95Ms = 8000;
    const h = classifyHealth(t, ext);
    expect(h.reasons.some(r => r.includes('heartbeat'))).toBe(false);
  });

  // ── Visual correction unstable threshold (TASK-142) ──

  it('peakVisualCorrectionDist > 10 produces unstable with catastrophic teleport', () => {
    const t = healthyTelemetry();
    t.peakVisualCorrectionDist = 11;
    const h = classifyHealth(t);
    expect(h.level).toBe('unstable');
    expect(h.reasons.some(r => r.includes('catastrophic teleport'))).toBe(true);
  });

  it('peakVisualCorrectionDist > 3 but <= 10 produces degraded (not unstable)', () => {
    const t = healthyTelemetry();
    t.peakVisualCorrectionDist = 5;
    const h = classifyHealth(t);
    expect(h.level).toBe('degraded');
    expect(h.reasons.some(r => r.includes('visible player teleports'))).toBe(true);
  });

  // ── Server time offset thresholds (TASK-143) ──

  it('serverTimeOffsetMs > 2000 produces unstable', () => {
    const t = healthyTelemetry();
    const ext = healthyExt();
    ext.serverTimeOffsetMs = 2500;
    const h = classifyHealth(t, ext);
    expect(h.level).toBe('unstable');
    expect(h.reasons.some(r => r.includes('extreme drift'))).toBe(true);
  });

  it('serverTimeOffsetMs < -2000 produces unstable', () => {
    const t = healthyTelemetry();
    const ext = healthyExt();
    ext.serverTimeOffsetMs = -2100;
    const h = classifyHealth(t, ext);
    expect(h.level).toBe('unstable');
    expect(h.reasons.some(r => r.includes('extreme drift'))).toBe(true);
  });

  it('serverTimeOffsetMs > 500 but <= 2000 produces degraded', () => {
    const t = healthyTelemetry();
    const ext = healthyExt();
    ext.serverTimeOffsetMs = 800;
    const h = classifyHealth(t, ext);
    expect(h.level).toBe('degraded');
    expect(h.reasons.some(r => r.includes('significant drift'))).toBe(true);
  });

  it('serverTimeOffsetMs within ±500 does not add a clock offset reason', () => {
    const t = healthyTelemetry();
    const ext = healthyExt();
    ext.serverTimeOffsetMs = 300;
    const h = classifyHealth(t, ext);
    expect(h.reasons.some(r => r.includes('clock offset'))).toBe(false);
  });
});
