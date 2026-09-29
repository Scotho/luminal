// ── Replay freecam key clearing on focus loss ───────────
import { describe, it, expect, beforeEach } from 'vitest';
import { _getFreeCamKeysRef } from '../replayUI';

describe('Replay freecam key clearing on focus loss', () => {
  let fcKeys: Record<string, boolean>;

  beforeEach(() => {
    fcKeys = _getFreeCamKeysRef();
    // Clear state
    for (const k in fcKeys) delete fcKeys[k];
  });

  /** Simulate holding a key (keydown sets true in the dict) */
  function holdKey(code: string): void {
    fcKeys[code] = true;
  }

  it('clears all freecam keys on window blur', () => {
    holdKey('KeyW');
    holdKey('KeyA');
    holdKey('Space');
    expect(fcKeys['KeyW']).toBe(true);
    expect(fcKeys['KeyA']).toBe(true);
    expect(fcKeys['Space']).toBe(true);

    window.dispatchEvent(new Event('blur'));

    expect(fcKeys['KeyW']).toBe(false);
    expect(fcKeys['KeyA']).toBe(false);
    expect(fcKeys['Space']).toBe(false);
  });

  it('clears freecam keys on visibilitychange when hidden', () => {
    holdKey('KeyS');
    holdKey('ShiftLeft');
    holdKey('ControlLeft');
    expect(fcKeys['KeyS']).toBe(true);

    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(fcKeys['KeyS']).toBe(false);
    expect(fcKeys['ShiftLeft']).toBe(false);
    expect(fcKeys['ControlLeft']).toBe(false);

    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
  });

  it('does not clear freecam keys on visibilitychange when visible', () => {
    holdKey('KeyD');
    expect(fcKeys['KeyD']).toBe(true);

    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(fcKeys['KeyD']).toBe(true);
  });

  it('simulates alt-tab during freecam movement (the bug scenario)', () => {
    // User is holding W+A to move forward-left in freecam
    holdKey('KeyW');
    holdKey('KeyA');
    expect(fcKeys['KeyW']).toBe(true);
    expect(fcKeys['KeyA']).toBe(true);

    // User clicks off the browser window — blur fires, keyup never does
    window.dispatchEvent(new Event('blur'));

    // Keys should be cleared — no perpetual movement
    expect(fcKeys['KeyW']).toBe(false);
    expect(fcKeys['KeyA']).toBe(false);
  });

  it('handles multiple blur events gracefully', () => {
    holdKey('KeyW');
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('blur'));

    expect(fcKeys['KeyW']).toBe(false);
  });

  it('allows normal key input after blur recovery', () => {
    holdKey('KeyW');
    window.dispatchEvent(new Event('blur'));
    expect(fcKeys['KeyW']).toBe(false);

    // User returns and presses W again
    holdKey('KeyW');
    expect(fcKeys['KeyW']).toBe(true);
  });
});
