// ── Wire Protocol Types ──────────────────────────────────
// Message envelopes for the WebSocket relay. Firebase transport
// does not use these — it writes directly to RTDB paths.

import type { InputFrame } from '../core/simulation';

export const RELAY_PROTOCOL_VERSION = 1;

export type RelayMessageKind = 'inputs' | 'hash' | 'snapshot' | 'ping' | 'pong' | 'resync-request';

const VALID_KINDS: ReadonlySet<string> = new Set<RelayMessageKind>([
  'inputs', 'hash', 'snapshot', 'ping', 'pong', 'resync-request',
]);

export interface InputsMessage {
  kind: 'inputs';
  payload: InputFrame[];
}

export interface HashMessage {
  kind: 'hash';
  tick: number;
  hash: number;
}

export interface SnapshotMessage {
  kind: 'snapshot';
  payload: unknown;
}

export interface PingMessage {
  kind: 'ping';
  ts: number;
}

export interface PongMessage {
  kind: 'pong';
  ts: number;
}

export interface ResyncRequestMessage {
  kind: 'resync-request';
}

export type RelayMessage =
  | InputsMessage
  | HashMessage
  | SnapshotMessage
  | PingMessage
  | PongMessage
  | ResyncRequestMessage;

/** Validate that a parsed value is a known relay message shape. */
// ts-prune-ignore-next
export function isValidRelayMessage(val: unknown): val is RelayMessage {
  if (!val || typeof val !== 'object') return false;
  const msg = val as Record<string, unknown>;
  if (typeof msg.kind !== 'string') return false;
  return VALID_KINDS.has(msg.kind);
}

/** Transport capabilities advertised during accept handshake. */
export interface TransportCapabilities {
  websocket: boolean;
  wsProtocol: number;
}
