// ── Lockstep Telemetry Types & Health Classification ─────
// Extracted from lockstepManager.ts for file size compliance.

import { computePercentiles, type RingBuffer } from '../telemetry';

export interface RoundTelemetry {
  rollbackCount: number;
  rollbackDepths: Record<number, number>;  // depth -> occurrence count
  rollbackMaxDepth: number;
  rollbackAvgDepth: number;
  peakPredictAhead: number;
  lateInputCount: number;
  desyncCount: number;
  recoveryCount: number;
  stallCount: number;
  totalTicks: number;
  avgSimTickCostMs: number;
  peakSimTickCostMs: number;
  avgRollbackCostMs: number;
  peakRollbackCostMs: number;
  /** Rollback cost percentiles (ms). */
  rollbackP50Ms: number;
  rollbackP95Ms: number;
  rollbackP99Ms: number;
  avgRecoveryCostMs: number;
  /** Peak snapshot recovery cost (ms). */
  peakRecoveryCostMs: number;
  /** Average recovery snapshot payload size (JSON bytes). */
  avgRecoverySnapshotBytes: number;
  /** Sim tick cost percentiles (ms) */
  simTickP50Ms: number;
  simTickP95Ms: number;
  simTickP99Ms: number;
  /** Input latency distribution: ticksLate -> count */
  inputLatencyBuckets: Record<number, number>;
  /** Number of predictions that differed from actual remote input (triggered rollbacks). */
  mispredictionCount: number;
  /** Number of predictions that matched actual remote input. */
  correctPredictionCount: number;
  /** Current input buffer depth: how many ticks ahead of confirmed remote input. */
  inputBufferDepth: number;
  /** Average hash computation cost (ms). */
  avgHashCostMs: number;
  /** Peak hash computation cost (ms, p99 of rolling window). */
  peakHashCostMs: number;
  /** Number of aborted rollbacks due to missing snapshots. */
  snapshotMissCount: number;
  /** Rollback cost aggregated by depth: depth → { avgMs, peakMs, count }. */
  rollbackCostByDepth: Record<number, { avgMs: number; peakMs: number; count: number }>;
  /** Average snapshot serialization cost during recovery (ms). */
  snapshotSerdeCostAvgMs: number;
  /** Peak snapshot serialization cost during recovery (ms). */
  snapshotSerdeCostPeakMs: number;
  /** Average snapshot deserialization (clone) cost during recovery (ms). */
  snapshotDeserdeCostAvgMs: number;
  /** Peak snapshot deserialization (clone) cost during recovery (ms). */
  snapshotDeserdeCostPeakMs: number;
  /** Average stall duration (ms). */
  avgStallDurationMs: number;
  /** Peak stall duration (ms). */
  peakStallDurationMs: number;
  /** Average quantization cost (ms) — tracks quantizeSimState / quantizePlayers overhead. */
  avgQuantizeCostMs: number;
  /** Peak quantization cost (ms). */
  peakQuantizeCostMs: number;
  /** Late input bursts: events where 3+ consecutive inputs arrived late. */
  lateInputBurstCount: number;
  /** Longest consecutive late input streak. */
  lateInputPeakStreak: number;
  /** Average proximity/meter computation cost per tick (ms). */
  avgProximityCostMs: number;
  /** Peak proximity/meter computation cost (ms). */
  peakProximityCostMs: number;
  /** Average visual correction distance from rollbacks/recovery (units). */
  avgVisualCorrectionDist: number;
  /** Peak visual correction distance (units). */
  peakVisualCorrectionDist: number;
}

// ── Telemetry Builder ───────────────────────────────────

/** Raw counters/buffers from LockstepManager for telemetry aggregation. */
export interface RawTelemetryInput {
  rollbackDepths: number[];
  rollbackCount: number;
  peakPredictAhead: number;
  lateInputCount: number;
  desyncCount: number;
  recoveryCount: number;
  stallCount: number;
  totalTicks: number;
  simTickCostSamples: RingBuffer<number>;
  peakSimTickMs: number;
  rollbackCostMs: RingBuffer<number>;
  peakRollbackMs: number;
  recoveryCostMs: RingBuffer<number>;
  peakRecoveryMs: number;
  recoverySnapshotBytes: RingBuffer<number>;
  inputLatencyBuckets: Record<number, number>;
  mispredictionCount: number;
  correctPredictionCount: number;
  inputBufferDepth: number;
  hashCostSamples: RingBuffer<number>;
  snapshotMissCount: number;
  /** Paired (depth, costMs) entries for per-depth rollback cost analysis. */
  rollbackDepthCostPairs: RingBuffer<{ depth: number; costMs: number }>;
  /** Snapshot serialization cost samples (ms). */
  snapshotSerdeCostSamples: RingBuffer<number>;
  /** Stall duration samples (ms). */
  stallDurationSamples: RingBuffer<number>;
  /** Peak stall duration (ms). */
  peakStallMs: number;
  /** Quantization cost samples (ms). */
  quantizeCostSamples: RingBuffer<number>;
  /** Late input burst count (3+ consecutive late inputs). */
  lateInputBurstCount: number;
  /** Longest consecutive late input streak. */
  lateInputPeakStreak: number;
  /** Proximity/meter computation cost samples (ms). */
  proximityCostSamples: RingBuffer<number>;
  /** Peak proximity/meter computation cost (ms). */
  peakProximityCostMs: number;
  /** Visual correction distance samples (units) from rollbacks and recovery. */
  visualCorrectionSamples: RingBuffer<number>;
  /** Peak visual correction distance (units). */
  peakVisualCorrectionDist: number;
}

function ringAvg(buf: RingBuffer<number>): number {
  if (buf.length === 0) return 0;
  return buf.reduce((a: number, b: number) => a + b, 0) / buf.length;
}

/** Build a RoundTelemetry snapshot from raw counters and rolling buffers. */
export function buildRoundTelemetry(raw: RawTelemetryInput): RoundTelemetry {
  const depthDist: Record<number, number> = {};
  let maxDepth = 0;
  let totalDepth = 0;
  for (const d of raw.rollbackDepths) {
    depthDist[d] = (depthDist[d] || 0) + 1;
    if (d > maxDepth) maxDepth = d;
    totalDepth += d;
  }

  // Aggregate rollback cost by depth (avg + peak per depth)
  const costByDepthAcc: Record<number, { totalMs: number; peakMs: number; count: number }> = {};
  for (let i = 0; i < raw.rollbackDepthCostPairs.length; i++) {
    const pair = raw.rollbackDepthCostPairs.get(i);
    const entry = costByDepthAcc[pair.depth] ?? { totalMs: 0, peakMs: 0, count: 0 };
    entry.totalMs += pair.costMs;
    if (pair.costMs > entry.peakMs) entry.peakMs = pair.costMs;
    entry.count++;
    costByDepthAcc[pair.depth] = entry;
  }
  const rollbackCostByDepth: Record<number, { avgMs: number; peakMs: number; count: number }> = {};
  for (const [d, acc] of Object.entries(costByDepthAcc)) {
    rollbackCostByDepth[Number(d)] = {
      avgMs: Math.round(acc.totalMs / acc.count * 100) / 100,
      peakMs: Math.round(acc.peakMs * 100) / 100,
      count: acc.count,
    };
  }

  const rbPct = computePercentiles(raw.rollbackCostMs);
  const simPct = computePercentiles(raw.simTickCostSamples);
  const hashPct = computePercentiles(raw.hashCostSamples);

  return {
    rollbackCount: raw.rollbackCount,
    rollbackDepths: depthDist,
    rollbackMaxDepth: maxDepth,
    rollbackAvgDepth: raw.rollbackDepths.length > 0 ? totalDepth / raw.rollbackDepths.length : 0,
    peakPredictAhead: raw.peakPredictAhead,
    lateInputCount: raw.lateInputCount,
    desyncCount: raw.desyncCount,
    recoveryCount: raw.recoveryCount,
    stallCount: raw.stallCount,
    totalTicks: raw.totalTicks,
    avgSimTickCostMs: Math.round(ringAvg(raw.simTickCostSamples) * 100) / 100,
    peakSimTickCostMs: Math.round(raw.peakSimTickMs * 100) / 100,
    avgRollbackCostMs: Math.round(ringAvg(raw.rollbackCostMs) * 100) / 100,
    peakRollbackCostMs: Math.round(raw.peakRollbackMs * 100) / 100,
    rollbackP50Ms: rbPct.p50,
    rollbackP95Ms: rbPct.p95,
    rollbackP99Ms: rbPct.p99,
    avgRecoveryCostMs: Math.round(ringAvg(raw.recoveryCostMs) * 100) / 100,
    peakRecoveryCostMs: Math.round(raw.peakRecoveryMs * 100) / 100,
    avgRecoverySnapshotBytes: raw.recoverySnapshotBytes.length > 0
      ? Math.round(raw.recoverySnapshotBytes.reduce((a: number, b: number) => a + b, 0) / raw.recoverySnapshotBytes.length)
      : 0,
    simTickP50Ms: simPct.p50,
    simTickP95Ms: simPct.p95,
    simTickP99Ms: simPct.p99,
    inputLatencyBuckets: { ...raw.inputLatencyBuckets },
    mispredictionCount: raw.mispredictionCount,
    correctPredictionCount: raw.correctPredictionCount,
    inputBufferDepth: raw.inputBufferDepth,
    avgHashCostMs: Math.round(ringAvg(raw.hashCostSamples) * 100) / 100,
    peakHashCostMs: Math.round(hashPct.p99 > 0 ? hashPct.p99 : 0),
    snapshotMissCount: raw.snapshotMissCount,
    rollbackCostByDepth,
    snapshotSerdeCostAvgMs: Math.round(ringAvg(raw.snapshotSerdeCostSamples) * 100) / 100,
    snapshotSerdeCostPeakMs: raw.snapshotSerdeCostSamples.length > 0
      ? Math.round(computePercentiles(raw.snapshotSerdeCostSamples).p99 * 100) / 100
      : 0,
    avgStallDurationMs: Math.round(ringAvg(raw.stallDurationSamples) * 100) / 100,
    peakStallDurationMs: Math.round(raw.peakStallMs * 100) / 100,
    avgQuantizeCostMs: Math.round(ringAvg(raw.quantizeCostSamples) * 100) / 100,
    peakQuantizeCostMs: raw.quantizeCostSamples.length > 0
      ? Math.round(computePercentiles(raw.quantizeCostSamples).p99 * 100) / 100
      : 0,
    lateInputBurstCount: raw.lateInputBurstCount,
    lateInputPeakStreak: raw.lateInputPeakStreak,
    avgProximityCostMs: Math.round(ringAvg(raw.proximityCostSamples) * 100) / 100,
    peakProximityCostMs: Math.round(raw.peakProximityCostMs * 100) / 100,
    avgVisualCorrectionDist: Math.round(ringAvg(raw.visualCorrectionSamples) * 100) / 100,
    peakVisualCorrectionDist: Math.round(raw.peakVisualCorrectionDist * 100) / 100,
    snapshotDeserdeCostAvgMs: Math.round(ringAvg(raw.snapshotSerdeCostSamples) * 100) / 100,
    snapshotDeserdeCostPeakMs: raw.snapshotSerdeCostSamples.length > 0
      ? Math.round(computePercentiles(raw.snapshotSerdeCostSamples).p99 * 100) / 100
      : 0,
  };
}

// ── Match Health Classification ──────────────────────────
// Treats repeated desync recovery and fallback activation as instability
// signals rather than silent success. Recovery and fallback remain in place
// for resilience, but the system no longer counts them as proof of health.

export type MatchHealthLevel = 'healthy' | 'degraded' | 'unstable';

export interface HealthSignal {
  level: MatchHealthLevel;
  reasons: string[];
}

/** Cross-layer signals from packet telemetry + perf telemetry.
 *  Optional second parameter to classifyHealth(). */
export interface ExtendedHealthSignals {
  jitterP95Ms: number;
  jitterP99Ms: number;
  heartbeatMissCount: number;
  /** Heartbeat interval P95 (ms). */
  heartbeatP95Ms: number;
  gcPauseCount: number;
  gcPauseTotalMs: number;
  heapPressure: number;
  frameTimeP95Ms: number;
  frameTimeStdDevMs: number;
  jankEventCount: number;
  jankPeakStreak: number;
  transportReconnects: number;
  mispredictionRate: number;
  /** Out-of-order packet arrivals. */
  packetReorderCount: number;
  /** Total packets received (denominator for reorder rate). */
  packetsReceived: number;
  /** Bytes buffered in the transport send queue (backpressure indicator). */
  transportBufferedBytes: number;
  /** Server clock offset in ms (negative = client ahead). */
  serverTimeOffsetMs: number;
  /** Number of inputs stuck pending ack for >1s. */
  stuckInputCount: number;
}

/** Classify match health from round telemetry and optional cross-layer signals.
 *  Recovery and fallback usage are reclassified as instability indicators. */
export function classifyHealth(t: RoundTelemetry, ext?: ExtendedHealthSignals): HealthSignal {
  const reasons: string[] = [];

  // ── Unstable checks (lockstep layer) ──
  if (t.recoveryCount >= 2) {
    reasons.push(`${t.recoveryCount} snapshot recoveries — repeated resync is not stable`);
  }
  if (t.desyncCount >= 6) {
    reasons.push(`${t.desyncCount} desyncs — persistent state divergence`);
  }
  if (t.rollbackAvgDepth > 6) {
    reasons.push(`avg rollback depth ${t.rollbackAvgDepth.toFixed(1)} ticks — heavy correction load`);
  }
  if (t.snapshotMissCount >= 3) {
    reasons.push(`${t.snapshotMissCount} snapshot misses — rollbacks aborted, desyncs unrecoverable`);
  }
  if (t.peakVisualCorrectionDist > 10) {
    reasons.push(`visual correction peak ${t.peakVisualCorrectionDist.toFixed(1)} units — catastrophic teleport, unplayable`);
  }

  // ── Unstable checks (extended signals) ──
  if (ext) {
    if (ext.jitterP99Ms > 300) {
      reasons.push(`jitter p99 ${ext.jitterP99Ms.toFixed(0)}ms — unplayable network conditions`);
    }
    if (ext.heartbeatMissCount >= 4) {
      reasons.push(`${ext.heartbeatMissCount} heartbeat misses — imminent disconnect`);
    }
    if (ext.gcPauseCount >= 3) {
      reasons.push(`${ext.gcPauseCount} GC pauses — repeated major GC disruption`);
    }
    if (ext.transportReconnects >= 2) {
      reasons.push(`${ext.transportReconnects} transport reconnects — connection instability`);
    }
    if (ext.packetsReceived > 0 && ext.packetReorderCount / ext.packetsReceived > 0.15) {
      reasons.push(`${ext.packetReorderCount} reordered packets (${Math.round(ext.packetReorderCount / ext.packetsReceived * 100)}%) — severe out-of-order delivery`);
    }
    if (ext.transportBufferedBytes > 262144) {
      reasons.push(`${(ext.transportBufferedBytes / 1024).toFixed(0)}KB transport backpressure — sender vastly outpacing network`);
    }
    if (Math.abs(ext.serverTimeOffsetMs) > 2000) {
      reasons.push(`server clock offset ${ext.serverTimeOffsetMs}ms — extreme drift masks late inputs as network issues`);
    }
  }

  if (reasons.length > 0) {
    return { level: 'unstable', reasons };
  }

  // ── Degraded checks (lockstep layer) ──
  if (t.recoveryCount === 1) {
    reasons.push('1 snapshot recovery — fallback activated');
  }
  if (t.snapshotMissCount >= 1 && t.snapshotMissCount < 3) {
    reasons.push(`${t.snapshotMissCount} snapshot miss(es) — rollback(s) aborted`);
  }
  if (t.desyncCount >= 3) {
    reasons.push(`${t.desyncCount} desyncs — intermittent divergence`);
  }
  if (t.stallCount >= 4) {
    reasons.push(`${t.stallCount} stalls — remote input lagging`);
  }
  if (t.peakPredictAhead > 10) {
    reasons.push(`peak predict-ahead ${t.peakPredictAhead} ticks — extended prediction window`);
  }
  if (t.rollbackCount > 30) {
    reasons.push(`${t.rollbackCount} rollbacks — frequent prediction misses`);
  }
  if (t.rollbackMaxDepth > 10) {
    reasons.push(`rollback depth up to ${t.rollbackMaxDepth} ticks — large catch-up window`);
  }
  if (t.totalTicks > 0 && t.lateInputCount / t.totalTicks > 0.50) {
    reasons.push(`${Math.round(t.lateInputCount / t.totalTicks * 100)}% late inputs — delivery problems`);
  }
  if (t.lateInputBurstCount >= 5) {
    reasons.push(`${t.lateInputBurstCount} late input bursts — sustained delivery stalls`);
  }
  if (t.peakSimTickCostMs > 8) {
    reasons.push(`peak sim tick ${t.peakSimTickCostMs.toFixed(1)}ms — approaching frame budget`);
  }
  if (t.peakRollbackCostMs > 12) {
    reasons.push(`peak rollback ${t.peakRollbackCostMs.toFixed(1)}ms — heavy resimulation cost`);
  }
  if (t.rollbackP99Ms > 8) {
    reasons.push(`rollback p99 ${t.rollbackP99Ms.toFixed(1)}ms — sustained resimulation spikes`);
  }

  // ── Degraded checks (rollback cost scaling) ──
  const depthKeys = t.rollbackCostByDepth
    ? Object.keys(t.rollbackCostByDepth).map(Number).sort((a, b) => a - b)
    : [];
  if (depthKeys.length >= 2) {
    const shallow = t.rollbackCostByDepth[depthKeys[0]];
    const deep = t.rollbackCostByDepth[depthKeys[depthKeys.length - 1]];
    const depthRatio = depthKeys[depthKeys.length - 1] / depthKeys[0];
    const costRatio = deep.avgMs / Math.max(shallow.avgMs, 0.01);
    // Superlinear: cost grows faster than depth (e.g. O(n²) sim tick)
    if (depthRatio > 1 && costRatio / depthRatio > 2.5) {
      reasons.push(`rollback cost scales ${(costRatio / depthRatio).toFixed(1)}x faster than depth — possible O(n²) sim`);
    }
  }
  if ((t.snapshotSerdeCostPeakMs ?? 0) > 5) {
    reasons.push(`snapshot serde peak ${t.snapshotSerdeCostPeakMs.toFixed(1)}ms — serialization bottleneck during recovery`);
  }
  if (t.peakVisualCorrectionDist > 3) {
    reasons.push(`visual correction peak ${t.peakVisualCorrectionDist.toFixed(1)} units — visible player teleports`);
  }

  // ── Degraded checks (extended signals) ──
  if (ext) {
    if (ext.jitterP99Ms > 150) {
      reasons.push(`jitter p99 ${ext.jitterP99Ms.toFixed(0)}ms — elevated network jitter`);
    }
    if (ext.jitterP95Ms > 100) {
      reasons.push(`jitter p95 ${ext.jitterP95Ms.toFixed(0)}ms — majority of packets delayed`);
    }
    if (ext.heartbeatMissCount >= 2) {
      reasons.push(`${ext.heartbeatMissCount} heartbeat misses — intermittent connection issues`);
    }
    if (ext.heartbeatP95Ms > 8000) {
      reasons.push(`heartbeat p95 ${(ext.heartbeatP95Ms / 1000).toFixed(1)}s — heartbeat delivery unreliable`);
    }
    if (ext.jankEventCount >= 3) {
      reasons.push(`${ext.jankEventCount} jank events — sustained rendering stutter`);
    }
    if (ext.jankPeakStreak >= 8) {
      reasons.push(`jank streak ${ext.jankPeakStreak} frames — ${(ext.jankPeakStreak * 33).toFixed(0)}ms visible hitch`);
    }
    if (ext.frameTimeP95Ms > 25) {
      reasons.push(`frame time p95 ${ext.frameTimeP95Ms.toFixed(1)}ms — approaching 30fps`);
    }
    if (ext.frameTimeStdDevMs > 10) {
      reasons.push(`frame time std dev ${ext.frameTimeStdDevMs.toFixed(1)}ms — inconsistent pacing`);
    }
    if (ext.mispredictionRate > 0.60) {
      reasons.push(`${Math.round(ext.mispredictionRate * 100)}% misprediction rate — poor prediction quality`);
    }
    if (ext.heapPressure > 0.85) {
      reasons.push(`heap pressure ${Math.round(ext.heapPressure * 100)}% — GC storm imminent`);
    }
    if (ext.gcPauseTotalMs > 200) {
      reasons.push(`${ext.gcPauseTotalMs.toFixed(0)}ms cumulative GC pauses — eating into gameplay`);
    }
    if (ext.packetsReceived > 0 && ext.packetReorderCount / ext.packetsReceived > 0.05) {
      reasons.push(`${ext.packetReorderCount} reordered packets (${Math.round(ext.packetReorderCount / ext.packetsReceived * 100)}%) — out-of-order delivery`);
    }
    if (ext.transportBufferedBytes > 65536) {
      reasons.push(`${(ext.transportBufferedBytes / 1024).toFixed(0)}KB transport backpressure — sender outpacing network`);
    }
    if (Math.abs(ext.serverTimeOffsetMs) > 500) {
      reasons.push(`server clock offset ${ext.serverTimeOffsetMs}ms — significant drift may misattribute late inputs`);
    }
  }

  if (reasons.length > 0) {
    return { level: 'degraded', reasons };
  }

  return { level: 'healthy', reasons: [] };
}
