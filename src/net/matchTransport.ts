// ── Match Transport Interface ────────────────────────────
// Narrow abstraction for latency-sensitive lockstep packet lane only.
// RTDB barriers (accept, ready, loaded, nextRound, rematch, roundEnd),
// events, and heartbeat remain on NetcodeSession directly.

import type { InputFrame } from '../core/simulation';
import type { MessageTypeStats } from './packetTelemetry';

export type { MessageTypeStats } from './packetTelemetry';

export interface MatchTransport {
  /** Open the transport connection. Resolves when ready to send/receive. */
  connect(): Promise<void>;

  /** Tear down the transport. Idempotent. */
  disconnect(): void;

  /** Send local input packet (InputFrame[] with redundancy window). */
  sendInputs(packet: InputFrame[]): void;

  /** Send local state hash for desync detection. */
  sendHash(tick: number, hash: number): void;

  /** Send full state snapshot for desync recovery. */
  sendSnapshot(data: unknown): void;

  /** Register callback for incoming opponent input packets. */
  onRemoteInputs(cb: (playerIndex: number, frames: InputFrame[]) => void): void;

  /** Register callback for incoming opponent hash. */
  onRemoteHash(cb: (tick: number, hash: number) => void): void;

  /** Register callback for incoming opponent recovery snapshot. */
  onRemoteSnapshot(cb: (data: unknown) => void): void;

  /** Register callback for transport-level disconnect. */
  onDisconnect(cb: () => void): void;

  /** Current RTT estimate in milliseconds. */
  readonly estimatedRttMs: number;

  /** Transport-level telemetry (byte counts, jitter). Optional — not all transports track this. */
  readonly transportTelemetry?: TransportTelemetry;

  // NOTE: requestResync() / onResyncRequest() intentionally omitted.
  // Mid-match reconnect is not implemented in this pass — disconnect
  // falls through to the existing RTDB heartbeat → forfeit path.
  // These methods will be added when reconnect support is built.
}

/** Transport-level telemetry snapshot. */
export interface TransportTelemetry {
  bytesSent: number;
  bytesReceived: number;
  messagesSent: number;
  messagesReceived: number;
  jitterMs: number;
  /** Average outbound message size in bytes. */
  avgMessageSizeOut: number;
  /** Peak outbound message size in bytes. */
  peakMessageSizeOut: number;
  /** Average inbound message size in bytes. */
  avgMessageSizeIn: number;
  /** Peak inbound message size in bytes. */
  peakMessageSizeIn: number;
  /** Number of reconnection attempts since initial connect. */
  reconnectAttempts: number;
  /** Auth handshake latency in ms (time from ws-open to auth-ok). */
  connectLatencyMs: number;
  /** Current transport connection state. */
  state: 'connected' | 'reconnecting' | 'disconnected';
  /** Per-message-type breakdown (inputs, hash, snapshot). */
  messageTypes: Record<string, MessageTypeStats>;
  /** Outbound bytes per second (rolling 10s window). */
  sendRateBps: number;
  /** Inbound bytes per second (rolling 10s window). */
  recvRateBps: number;
  /** Average JSON.stringify cost (ms) for outbound messages. */
  serializeCostAvgMs: number;
  /** Average JSON.parse cost (ms) for inbound messages. */
  deserializeCostAvgMs: number;
  /** Pending outbound bytes in the send buffer (WebSocket.bufferedAmount). */
  bufferedBytes: number;
  /** Cumulative time spent disconnected (ms). */
  totalDowntimeMs: number;
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
}

/** Transport selection result from negotiation. */
export type TransportKind = 'websocket' | 'firebase';
