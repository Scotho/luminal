// ── Packet Telemetry Types & Builder ─────────────────────
// Extracted from netcode.ts for file size compliance.

import { computePercentiles, type RingBuffer } from '../telemetry';
import type { TransportTelemetry } from './matchTransport';

export interface MessageTypeStats {
  bytesSent: number;
  bytesReceived: number;
  count: number;
}

export interface PacketTelemetry {
  packetLossRate: number;
  packetLossCount: number;
  /** Out-of-order packet arrivals (seq ≤ lastSeq, distinct from loss). */
  packetReorderCount: number;
  packetsReceived: number;
  jitterMs: number;
  /** Jitter percentiles from rolling sample window (ms). */
  jitterP50Ms: number;
  jitterP95Ms: number;
  jitterP99Ms: number;
  /** RTT percentiles from rolling sample window (ms). */
  rttP50Ms: number;
  rttP95Ms: number;
  rttP99Ms: number;
  inputAckAvgMs: number;
  inputAckMissCount: number;
  /** Per-input ACK latency percentiles (ms). */
  inputAckP50Ms: number;
  inputAckP95Ms: number;
  inputAckP99Ms: number;
  transportBytes: { sent: number; received: number } | null;
  /** Transport reconnection attempts. */
  transportReconnects: number;
  /** Auth handshake latency (ms). */
  transportConnectMs: number;
  /** Heartbeat misses (>6s gap, 2x expected 3s interval). */
  heartbeatMissCount: number;
  /** Average heartbeat interval (ms) from rolling window. */
  heartbeatAvgMs: number;
  /** Heartbeat interval percentiles (ms). */
  heartbeatP50Ms: number;
  heartbeatP95Ms: number;
  heartbeatP99Ms: number;
  /** Per-message-type byte breakdown (from transport, if available). */
  messageTypes: Record<string, MessageTypeStats> | null;
  /** Outbound bandwidth (bytes/sec, from transport). */
  sendRateBps: number;
  /** Inbound bandwidth (bytes/sec, from transport). */
  recvRateBps: number;
  /** Average transport serialization cost (ms, from transport). */
  serializeCostAvgMs: number;
  /** Average transport deserialization cost (ms, from transport). */
  deserializeCostAvgMs: number;
  /** Pending outbound bytes in the transport send buffer. */
  transportBufferedBytes: number;
  /** Cumulative transport downtime (ms). */
  transportDowntimeMs: number;
  /** Average reconnect duration (ms). */
  reconnectAvgMs: number;
  /** Peak reconnect duration (ms). */
  reconnectPeakMs: number;
  /** Cumulative backpressure duration (ms, send buffer >16KB). */
  backpressureTotalMs: number;
  /** Successful reconnect cycles. */
  reconnectSuccessCount: number;
  /** Failed reconnect cycles (exhausted max attempts). */
  reconnectFailCount: number;
  /** Packet loss bursts (3+ consecutive seq gaps). */
  packetLossBurstCount: number;
  /** Longest consecutive packet loss streak. */
  packetLossPeakBurst: number;
  /** Firebase server clock offset (ms): serverTime ≈ Date.now() + offset. */
  serverTimeOffsetMs: number;
  /** Number of inputs stuck pending ack for >1s. */
  stuckInputCount: number;
  /** Serialize cost p95 (ms). */
  serializeCostP95Ms: number;
  /** Serialize cost p99 (ms). */
  serializeCostP99Ms: number;
  /** Deserialize cost p95 (ms). */
  deserializeCostP95Ms: number;
  /** Deserialize cost p99 (ms). */
  deserializeCostP99Ms: number;
}

/** Raw counters/buffers from NetcodeSession for packet telemetry aggregation. */
export interface RawPacketTelemetryInput {
  packetLossRate: number;
  packetLossCount: number;
  packetReorderCount: number;
  packetsReceived: number;
  jitterMs: number;
  jitterSamples: RingBuffer<number>;
  rttSamples: RingBuffer<number>;
  inputAckLatencies: RingBuffer<number>;
  heartbeatLateMs: RingBuffer<number>;
  inputAckAvgMs: number;
  inputAckMissCount: number;
  heartbeatMissCount: number;
  transportTelemetry: TransportTelemetry | undefined;
  packetLossBurstCount: number;
  packetLossPeakBurst: number;
  serverTimeOffsetMs: number;
  stuckInputCount: number;
}

/** Build a PacketTelemetry snapshot from raw counters and rolling buffers. */
export function buildPacketTelemetry(raw: RawPacketTelemetryInput): PacketTelemetry {
  const tStats = raw.transportTelemetry;
  const jitterPct = computePercentiles(raw.jitterSamples);
  const rttPct = computePercentiles(raw.rttSamples);
  const ackPct = computePercentiles(raw.inputAckLatencies);
  const hbPct = computePercentiles(raw.heartbeatLateMs);
  const hbAvg = raw.heartbeatLateMs.length > 0
    ? Math.round(raw.heartbeatLateMs.reduce((a: number, b: number) => a + b, 0) / raw.heartbeatLateMs.length)
    : 0;
  return {
    packetLossRate: Math.round(raw.packetLossRate * 10000) / 10000,
    packetLossCount: raw.packetLossCount,
    packetReorderCount: raw.packetReorderCount,
    packetsReceived: raw.packetsReceived,
    jitterMs: raw.jitterMs,
    jitterP50Ms: jitterPct.p50,
    jitterP95Ms: jitterPct.p95,
    jitterP99Ms: jitterPct.p99,
    rttP50Ms: rttPct.p50,
    rttP95Ms: rttPct.p95,
    rttP99Ms: rttPct.p99,
    inputAckAvgMs: raw.inputAckAvgMs,
    inputAckMissCount: raw.inputAckMissCount,
    inputAckP50Ms: ackPct.p50,
    inputAckP95Ms: ackPct.p95,
    inputAckP99Ms: ackPct.p99,
    transportBytes: tStats ? { sent: tStats.bytesSent, received: tStats.bytesReceived } : null,
    transportReconnects: tStats?.reconnectAttempts ?? 0,
    transportConnectMs: tStats?.connectLatencyMs ?? 0,
    heartbeatMissCount: raw.heartbeatMissCount,
    heartbeatAvgMs: hbAvg,
    heartbeatP50Ms: hbPct.p50,
    heartbeatP95Ms: hbPct.p95,
    heartbeatP99Ms: hbPct.p99,
    messageTypes: tStats?.messageTypes ?? null,
    sendRateBps: tStats?.sendRateBps ?? 0,
    recvRateBps: tStats?.recvRateBps ?? 0,
    serializeCostAvgMs: tStats?.serializeCostAvgMs ?? 0,
    deserializeCostAvgMs: tStats?.deserializeCostAvgMs ?? 0,
    transportBufferedBytes: tStats?.bufferedBytes ?? 0,
    transportDowntimeMs: tStats?.totalDowntimeMs ?? 0,
    reconnectAvgMs: tStats?.reconnectAvgMs ?? 0,
    reconnectPeakMs: tStats?.reconnectPeakMs ?? 0,
    backpressureTotalMs: tStats?.backpressureTotalMs ?? 0,
    reconnectSuccessCount: tStats?.reconnectSuccessCount ?? 0,
    reconnectFailCount: tStats?.reconnectFailCount ?? 0,
    packetLossBurstCount: raw.packetLossBurstCount,
    packetLossPeakBurst: raw.packetLossPeakBurst,
    serverTimeOffsetMs: raw.serverTimeOffsetMs,
    stuckInputCount: raw.stuckInputCount,
    serializeCostP95Ms: 0,
    serializeCostP99Ms: 0,
    deserializeCostP95Ms: 0,
    deserializeCostP99Ms: 0,
  };
}
