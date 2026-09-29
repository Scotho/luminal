// ── NetcodeStatsSnapshot — Admin panel netcode summary ───
// Extracted from debugLog.ts for file size compliance.

export interface NetcodeStatsSnapshot {
  rtt: number;
  jitter: number;
  packetLossRate: number;
  health: string;
  connected: boolean;
  debug: boolean;
  simCost?: { avg: number; peak: number; p95: number; p99: number };
  rollbackCost?: { avg: number; peak: number; p50: number; p95: number; p99: number };
  recoveryCost?: { avg: number; peak: number; snapshotBytes: number };
  inputAckAvgMs: number;
  inputAckMissCount: number;
  /** Jitter percentiles (ms). */
  jitterP95?: number;
  jitterP99?: number;
  /** Per-input ACK latency percentiles (ms). */
  inputAckP95?: number;
  inputAckP99?: number;
  frameTimeP95?: number;
  gcPauseCount?: number;
  /** Heap growth rate (KB/frame, positive = growing). */
  heapDeltaAvgKB?: number;
  /** Heap pressure: usedJSHeapSize / jsHeapSizeLimit (0–1). */
  heapPressure?: number;
  /** Frame-time standard deviation (ms). */
  frameTimeStdDevMs?: number;
  /** Cumulative GC pause duration (ms). */
  gcPauseTotalMs?: number;
  transportBytesSent?: number;
  transportBytesRecv?: number;
  /** Transport reconnection attempts. */
  transportReconnects?: number;
  /** Auth handshake latency (ms). */
  transportConnectMs?: number;
  /** Misprediction count (predictions that differed from actual input). */
  mispredictionCount?: number;
  /** Correct prediction count. */
  correctPredictionCount?: number;
  /** Current input buffer depth (ticks ahead of confirmed remote). */
  inputBufferDepth?: number;
  /** Hash computation cost (ms). */
  hashCost?: { avg: number; peak: number };
  /** Heartbeat misses (>6s gaps). */
  heartbeatMissCount?: number;
  /** Average heartbeat interval (ms). */
  heartbeatAvgMs?: number;
  /** Jank events (3+ consecutive frames >33ms). */
  jankEventCount?: number;
  /** Longest jank streak (consecutive frames >33ms). */
  jankPeakStreak?: number;
  /** Outbound bandwidth (bytes/sec). */
  sendRateBps?: number;
  /** Inbound bandwidth (bytes/sec). */
  recvRateBps?: number;
  /** RTT percentiles (ms). */
  rttP50?: number;
  rttP95?: number;
  rttP99?: number;
  /** Aborted rollbacks due to missing snapshots. */
  snapshotMissCount?: number;
  /** Out-of-order packet arrivals (distinct from loss). */
  packetReorderCount?: number;
  /** Transport serialization cost (ms). */
  serializeCostAvgMs?: number;
  /** Transport deserialization cost (ms). */
  deserializeCostAvgMs?: number;
  /** Pending outbound bytes in the transport send buffer. */
  transportBufferedBytes?: number;
  /** Rollback cost by depth: depth → { avgMs, peakMs, count }. */
  rollbackCostByDepth?: Record<number, { avgMs: number; peakMs: number; count: number }>;
  /** Average snapshot serialization cost during recovery (ms). */
  snapshotSerdeCostAvgMs?: number;
  /** Heartbeat interval percentiles (ms). */
  heartbeatP95?: number;
  heartbeatP99?: number;
  /** Average stall duration (ms). */
  stallAvgMs?: number;
  /** Peak stall duration (ms). */
  stallPeakMs?: number;
  /** Cumulative transport downtime (ms). */
  transportDowntimeMs?: number;
  /** Total prediction stalls (sim paused waiting for remote input). */
  stallCount?: number;
  /** Late input rate (lateInputCount / totalTicks, 0–1). */
  lateInputRate?: number;
  /** Average quantization cost (ms). */
  quantizeCostAvgMs?: number;
  /** Peak quantization cost (ms). */
  quantizeCostPeakMs?: number;
  /** Average reconnect duration (ms). */
  reconnectAvgMs?: number;
  /** Peak reconnect duration (ms). */
  reconnectPeakMs?: number;
  /** GC pause severity histogram. */
  gcPauseHistogram?: { minor: number; moderate: number; major: number };
  /** Late input bursts (3+ consecutive late inputs). */
  lateInputBurstCount?: number;
  /** Longest consecutive late input streak. */
  lateInputPeakStreak?: number;
  /** Packet loss bursts (3+ consecutive seq gaps). */
  packetLossBurstCount?: number;
  /** Longest consecutive packet loss streak. */
  packetLossPeakBurst?: number;
  /** Cumulative backpressure duration (ms, send buffer >16KB). */
  backpressureTotalMs?: number;
  /** Successful reconnect cycles. */
  reconnectSuccessCount?: number;
  /** Failed reconnect cycles (exhausted max attempts). */
  reconnectFailCount?: number;
  /** Firebase server clock offset (ms). */
  serverTimeOffsetMs?: number;
  /** Average visual correction distance from rollbacks/recovery (units). */
  visualCorrectionAvg?: number;
  /** Peak visual correction distance (units). */
  visualCorrectionPeak?: number;
  /** Number of inputs stuck pending ack for >1s. */
  stuckInputCount?: number;
  /** Serialize cost p95 (ms). */
  serializeCostP95Ms?: number;
  /** Serialize cost p99 (ms). */
  serializeCostP99Ms?: number;
  /** Deserialize cost p95 (ms). */
  deserializeCostP95Ms?: number;
  /** Deserialize cost p99 (ms). */
  deserializeCostP99Ms?: number;
  /** Average snapshot deserialization (clone) cost during recovery (ms). */
  snapshotDeserdeCostAvgMs?: number;
  /** Peak snapshot deserialization (clone) cost during recovery (ms). */
  snapshotDeserdeCostPeakMs?: number;
}
