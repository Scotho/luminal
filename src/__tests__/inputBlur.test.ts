// ── Input blur/visibility key-clearing tests ────────────
import { describe, it, expect, beforeEach } from 'vitest';
import { _getKeysRef } from '../input';

describe('Input key clearing on focus loss', () => {
  let keys: Record<string, boolean>;

  beforeEach(() => {
    keys = _getKeysRef();
    // Clear all keys before each test
    for (const k in keys) delete keys[k];
  });

  function pressKey(code: string): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
  }

  it('records keydown events', () => {
    pressKey('KeyW');
    expect(keys['KeyW']).toBe(true);
  });

  it('clears all keys on window blur', () => {
    pressKey('KeyW');
    pressKey('KeyA');
    expect(keys['KeyW']).toBe(true);
    expect(keys['KeyA']).toBe(true);

    window.dispatchEvent(new Event('blur'));

    expect(keys['KeyW']).toBe(false);
    expect(keys['KeyA']).toBe(false);
  });

  it('clears all keys on visibilitychange when hidden', () => {
    pressKey('KeyS');
    pressKey('Space');
    expect(keys['KeyS']).toBe(true);
    expect(keys['Space']).toBe(true);

    // Simulate tab becoming hidden
    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(keys['KeyS']).toBe(false);
    expect(keys['Space']).toBe(false);

    // Restore
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
  });

  it('does not clear keys on visibilitychange when visible', () => {
    pressKey('KeyD');
    expect(keys['KeyD']).toBe(true);

    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(keys['KeyD']).toBe(true);
  });

  it('simulates the alt-tab stuck key scenario', () => {
    // User holds W to move forward
    pressKey('KeyW');
    expect(keys['KeyW']).toBe(true);

    // User alt-tabs away — no keyup fires, but blur does
    window.dispatchEvent(new Event('blur'));
    expect(keys['KeyW']).toBe(false);

    // When user returns, key should not be stuck
    expect(keys['KeyW']).toBe(false);
  });
});
