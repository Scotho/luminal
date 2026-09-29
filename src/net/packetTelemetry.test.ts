// ── Packet Telemetry Builder Tests ──────────────────────
import { describe, it, expect } from 'vitest';
import { buildPacketTelemetry, type RawPacketTelemetryInput } from './packetTelemetry';
import { RingBuffer } from '../telemetry';

function makeRing(values: number[], cap = 30): RingBuffer<number> {
  const buf = new RingBuffer<number>(cap);
  for (const v of values) buf.push(v);
  return buf;
}

function baseRaw(overrides: Partial<RawPacketTelemetryInput> = {}): RawPacketTelemetryInput {
  return {
    packetLossRate: 0,
    packetLossCount: 0,
    packetReorderCount: 0,
    packetsReceived: 0,
    jitterMs: 0,
    jitterSamples: makeRing([]),
    rttSamples: makeRing([]),
    inputAckLatencies: makeRing([], 60),
    heartbeatLateMs: makeRing([], 20),
    inputAckAvgMs: 0,
    inputAckMissCount: 0,
    heartbeatMissCount: 0,
    transportTelemetry: undefined,
    packetLossBurstCount: 0,
    packetLossPeakBurst: 0,
    serverTimeOffsetMs: 0,
    ...overrides,
  };
}

describe('buildPacketTelemetry', () => {
  it('returns zeroed telemetry for empty inputs', () => {
    const t = buildPacketTelemetry(baseRaw());
    expect(t.packetLossRate).toBe(0);
    expect(t.jitterP50Ms).toBe(0);
    expect(t.rttP50Ms).toBe(0);
    expect(t.inputAckP50Ms).toBe(0);
    expect(t.heartbeatAvgMs).toBe(0);
    expect(t.transportBytes).toBeNull();
    expect(t.messageTypes).toBeNull();
  });

  it('computes RTT percentiles from samples', () => {
    const samples = Array.from({ length: 20 }, (_, i) => 50 + i * 5);
    const t = buildPacketTelemetry(baseRaw({ rttSamples: makeRing(samples) }));
    expect(t.rttP50Ms).toBeGreaterThan(0);
    expect(t.rttP95Ms).toBeGreaterThanOrEqual(t.rttP50Ms);
    expect(t.rttP99Ms).toBeGreaterThanOrEqual(t.rttP95Ms);
  });

  it('computes jitter percentiles from samples', () => {
    const samples = Array.from({ length: 15 }, (_, i) => i * 3);
    const t = buildPacketTelemetry(baseRaw({ jitterSamples: makeRing(samples) }));
    expect(t.jitterP50Ms).toBeGreaterThanOrEqual(0);
    expect(t.jitterP95Ms).toBeGreaterThanOrEqual(t.jitterP50Ms);
    expect(t.jitterP99Ms).toBeGreaterThanOrEqual(t.jitterP95Ms);
  });

  it('computes input ack percentiles from samples', () => {
    const samples = Array.from({ length: 20 }, (_, i) => 30 + i * 2);
    const t = buildPacketTelemetry(baseRaw({
      inputAckLatencies: makeRing(samples, 60),
      inputAckAvgMs: 40,
    }));
    expect(t.inputAckP50Ms).toBeGreaterThan(0);
    expect(t.inputAckP95Ms).toBeGreaterThanOrEqual(t.inputAckP50Ms);
    expect(t.inputAckP99Ms).toBeGreaterThanOrEqual(t.inputAckP95Ms);
  });

  it('computes heartbeat average from samples', () => {
    const t = buildPacketTelemetry(baseRaw({
      heartbeatLateMs: makeRing([3000, 3100, 2900], 20),
    }));
    expect(t.heartbeatAvgMs).toBe(3000);
  });

  it('includes transport bytes when transport exists', () => {
    const t = buildPacketTelemetry(baseRaw({
      transportTelemetry: {
        bytesSent: 5000,
        bytesReceived: 8000,
        messagesSent: 100,
        messagesReceived: 150,
        jitterMs: 5,
        avgMessageSizeOut: 50,
        peakMessageSizeOut: 200,
        avgMessageSizeIn: 53,
        peakMessageSizeIn: 220,
        reconnectAttempts: 1,
        connectLatencyMs: 120,
        state: 'connected',
        messageTypes: { inputs: { bytesSent: 3000, bytesReceived: 6000, count: 80 } },
        sendRateBps: 500,
        recvRateBps: 800,
        serializeCostAvgMs: 0.2,
        deserializeCostAvgMs: 0.3,
      },
    }));
    expect(t.transportBytes).toEqual({ sent: 5000, received: 8000 });
    expect(t.transportReconnects).toBe(1);
    expect(t.transportConnectMs).toBe(120);
    expect(t.sendRateBps).toBe(500);
    expect(t.recvRateBps).toBe(800);
    expect(t.serializeCostAvgMs).toBe(0.2);
    expect(t.deserializeCostAvgMs).toBe(0.3);
    expect(t.messageTypes).not.toBeNull();
  });

  it('rounds packet loss rate to 4 decimal places', () => {
    const t = buildPacketTelemetry(baseRaw({ packetLossRate: 0.123456789 }));
    expect(t.packetLossRate).toBe(0.1235);
  });

  it('returns zero transportBufferedBytes without transport', () => {
    const t = buildPacketTelemetry(baseRaw());
    expect(t.transportBufferedBytes).toBe(0);
  });

  it('includes transportBufferedBytes from transport', () => {
    const t = buildPacketTelemetry(baseRaw({
      transportTelemetry: {
        bytesSent: 1000,
        bytesReceived: 2000,
        messagesSent: 50,
        messagesReceived: 60,
        jitterMs: 3,
        avgMessageSizeOut: 20,
        peakMessageSizeOut: 100,
        avgMessageSizeIn: 33,
        peakMessageSizeIn: 150,
        reconnectAttempts: 0,
        connectLatencyMs: 80,
        state: 'connected',
        messageTypes: {},
        sendRateBps: 100,
        recvRateBps: 200,
        serializeCostAvgMs: 0.1,
        deserializeCostAvgMs: 0.15,
        bufferedBytes: 512,
      },
    }));
    expect(t.transportBufferedBytes).toBe(512);
  });

  it('passes through serverTimeOffsetMs', () => {
    const t = buildPacketTelemetry(baseRaw({ serverTimeOffsetMs: -142 }));
    expect(t.serverTimeOffsetMs).toBe(-142);
  });

  it('defaults serverTimeOffsetMs to zero', () => {
    const t = buildPacketTelemetry(baseRaw());
    expect(t.serverTimeOffsetMs).toBe(0);
  });
});
