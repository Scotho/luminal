// ── Transport Negotiation Tests ──────────────────────────
import { describe, it, expect, vi } from 'vitest';
import { resolveTransport, getLocalCapabilities, type TransportCandidate } from './transportNegotiation';

describe('getLocalCapabilities', () => {
  it('returns websocket=true when VITE_RELAY_URL is set', () => {
    // Temporarily set the env var the function checks
    const orig = import.meta.env.VITE_RELAY_URL;
    import.meta.env.VITE_RELAY_URL = 'wss://relay.example.com';
    try {
      const caps = getLocalCapabilities();
      expect(caps.websocket).toBe(true);
      expect(caps.wsProtocol).toBeGreaterThanOrEqual(1);
    } finally {
      if (orig === undefined) delete import.meta.env.VITE_RELAY_URL;
      else import.meta.env.VITE_RELAY_URL = orig;
    }
  });
});

describe('resolveTransport', () => {
  it('selects websocket when all candidates support it', () => {
    const candidates: TransportCandidate[] = [
      { uid: 'a', caps: { websocket: true, wsProtocol: 1 } },
      { uid: 'b', caps: { websocket: true, wsProtocol: 1 } },
    ];
    expect(resolveTransport(candidates)).toBe('websocket');
  });

  it('selects firebase when any candidate lacks websocket', () => {
    const candidates: TransportCandidate[] = [
      { uid: 'a', caps: { websocket: true, wsProtocol: 1 } },
      { uid: 'b', caps: { websocket: false, wsProtocol: 0 } },
    ];
    expect(resolveTransport(candidates)).toBe('firebase');
  });

  it('selects firebase when any candidate has no transport caps (legacy client)', () => {
    const candidates: TransportCandidate[] = [
      { uid: 'a', caps: { websocket: true, wsProtocol: 1 } },
      { uid: 'b', caps: undefined },
    ];
    expect(resolveTransport(candidates)).toBe('firebase');
  });

  it('selects firebase for empty candidates', () => {
    expect(resolveTransport([])).toBe('firebase');
  });

  it('selects websocket for 4-player match when all support it', () => {
    const candidates: TransportCandidate[] = [
      { uid: 'a', caps: { websocket: true, wsProtocol: 1 } },
      { uid: 'b', caps: { websocket: true, wsProtocol: 1 } },
      { uid: 'c', caps: { websocket: true, wsProtocol: 1 } },
      { uid: 'd', caps: { websocket: true, wsProtocol: 1 } },
    ];
    expect(resolveTransport(candidates)).toBe('websocket');
  });
});
