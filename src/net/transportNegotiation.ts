// ── Transport Negotiation ────────────────────────────────
// Reads local feature flag and compares all players' capabilities
// to select websocket vs firebase transport.

import type { TransportCapabilities } from './protocol';
import { RELAY_PROTOCOL_VERSION } from './protocol';
import type { TransportKind } from './matchTransport';

export interface TransportCandidate {
  uid: string;
  caps: TransportCapabilities | undefined;
}

/**
 * Read local client's transport capabilities from Vite env.
 * Only advertises websocket support if BOTH the transport flag allows it
 * AND a relay URL is configured. Without a relay URL, the client can't
 * actually connect — advertising websocket would cause a split-transport
 * match where peers listen on different transports and never exchange packets.
 */
export function getLocalCapabilities(): TransportCapabilities {
  const envVal: string = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MATCH_TRANSPORT) || 'auto';
  const hasRelayUrl = !!(typeof import.meta !== 'undefined' && import.meta.env?.VITE_RELAY_URL);
  const wsEnabled = envVal !== 'firebase' && hasRelayUrl;
  return {
    websocket: wsEnabled,
    wsProtocol: wsEnabled ? RELAY_PROTOCOL_VERSION : 0,
  };
}

/**
 * Determine transport from all players' advertised capabilities.
 * WebSocket requires unanimous support — any missing or false capability
 * falls back to Firebase.
 */
export function resolveTransport(candidates: TransportCandidate[]): TransportKind {
  if (candidates.length === 0) return 'firebase';
  const allSupport = candidates.every(
    c => c.caps?.websocket === true && c.caps.wsProtocol >= 1,
  );
  return allSupport ? 'websocket' : 'firebase';
}
