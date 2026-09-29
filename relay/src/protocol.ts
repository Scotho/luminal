// ── Relay Protocol Validation ────────────────────────────
// Server-side message validation with size and shape checks.

export const VALID_RELAY_KINDS = new Set([
  'inputs', 'hash', 'snapshot', 'ping', 'pong', 'resync-request',
]);

export const LIMITS = {
  maxInputFrames: 24,
  maxMessageBytes: 16_384,
  maxSnapshotBytes: 65_536,
  maxMessagesPerSecond: 60,
} as const;

export interface AuthMessage {
  kind: 'auth';
  token: string;
  matchId: string;
  uid: string;
}

export function isAuthMessage(msg: unknown): msg is AuthMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return (
    m.kind === 'auth' &&
    typeof m.token === 'string' &&
    typeof m.matchId === 'string' &&
    typeof m.uid === 'string'
  );
}

export function isValidGameMessage(msg: unknown): boolean {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  if (typeof m.kind !== 'string') return false;
  if (!VALID_RELAY_KINDS.has(m.kind)) return false;

  switch (m.kind) {
    case 'inputs':
      if (!Array.isArray(m.payload)) return false;
      if (m.payload.length > LIMITS.maxInputFrames) return false;
      break;
    case 'hash':
      if (typeof m.tick !== 'number' || typeof m.hash !== 'number') return false;
      break;
    case 'snapshot':
      if (m.payload === undefined) return false;
      break;
    // ping, pong, resync-request: no additional validation needed
  }

  return true;
}
