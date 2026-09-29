// ── Protocol Message Validation Tests ─────────────────────
import { describe, it, expect } from 'vitest';
import { isValidRelayMessage } from './protocol';

describe('isValidRelayMessage', () => {
  it('accepts a valid inputs message', () => {
    const msg = { kind: 'inputs' as const, payload: [{ tick: 1, turnDir: 0, accelerate: false, dash: false, brake: false }] };
    expect(isValidRelayMessage(msg)).toBe(true);
  });

  it('accepts a valid hash message', () => {
    const msg = { kind: 'hash' as const, tick: 60, hash: 12345 };
    expect(isValidRelayMessage(msg)).toBe(true);
  });

  it('accepts a valid snapshot message', () => {
    const msg = { kind: 'snapshot' as const, payload: { tick: 100, players: [] } };
    expect(isValidRelayMessage(msg)).toBe(true);
  });

  it('accepts a valid ping message', () => {
    expect(isValidRelayMessage({ kind: 'ping' as const, ts: Date.now() })).toBe(true);
  });

  it('accepts a valid pong message', () => {
    expect(isValidRelayMessage({ kind: 'pong' as const, ts: Date.now() })).toBe(true);
  });

  it('accepts a valid resync-request message', () => {
    expect(isValidRelayMessage({ kind: 'resync-request' as const })).toBe(true);
  });

  it('rejects unknown kind', () => {
    expect(isValidRelayMessage({ kind: 'explode' })).toBe(false);
  });

  it('rejects missing kind', () => {
    expect(isValidRelayMessage({ payload: [] })).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isValidRelayMessage('hello')).toBe(false);
    expect(isValidRelayMessage(null)).toBe(false);
  });
});
