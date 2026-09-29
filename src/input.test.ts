import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mocks so factories can reference them ──────────
const { mockGetGamepadState, mockGetTouchState } = vi.hoisted(() => ({
  mockGetGamepadState: vi.fn(() => null),
  mockGetTouchState: vi.fn(() => null),
}));

// ── Mock dependencies before importing input.ts ──────────
vi.mock('./events', () => ({
  EVT_SETTINGS_RESTORED: 'settings-restored',
}));

vi.mock('./settingsSync', () => ({
  notifySettingChanged: vi.fn(),
}));

vi.mock('./gamepad', () => ({
  getGamepadState: mockGetGamepadState,
}));

vi.mock('./touch', () => ({
  getTouchState: mockGetTouchState,
}));

// ── Import the module under test ─────────────────────────
import {
  TOUCH_ENABLED,
  _getKeysRef,
  getBinds,
  getDefaultBinds,
  setBind,
  resetBinds,
  isLeft,
  isRight,
  isAccelerate,
  isBrake,
  isDash,
  isDriftBrake,
  isSpecial,
  isEnter,
  consumeEnter,
} from './input';

import { notifySettingChanged } from './settingsSync';

// ── Helpers ───────────────────────────────────────────────

/** Press a key (fires keydown on window). */
function keyDown(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
}

/** Release a key (fires keyup on window). */
function keyUp(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
}

/** Reset the internal keys record by releasing every tracked key. */
function releaseAllKeys(): void {
  const keys = _getKeysRef();
  for (const code of Object.keys(keys)) {
    keys[code] = false;
  }
}

// ═════════════════════════════════════════════════════════
// Group 1: TOUCH_ENABLED export
// ═════════════════════════════════════════════════════════
describe('TOUCH_ENABLED', () => {
  it('is a boolean', () => {
    expect(typeof TOUCH_ENABLED).toBe('boolean');
  });
});

// ═════════════════════════════════════════════════════════
// Group 2: getDefaultBinds / getBinds
// ═════════════════════════════════════════════════════════
describe('getDefaultBinds', () => {
  it('returns an object with all required action names', () => {
    const defaults = getDefaultBinds();
    const expected = [
      'left', 'right', 'accelerate', 'brake', 'dash',
      'rPlayPause', 'rCamPrev', 'rCamNext',
      'rSkipBack', 'rSkipFwd', 'rFineBack', 'rFineFwd', 'rToggleUI',
    ];
    for (const action of expected) {
      expect(defaults).toHaveProperty(action);
    }
  });

  it('each action bind is a two-element tuple of strings', () => {
    const defaults = getDefaultBinds();
    for (const value of Object.values(defaults)) {
      expect(Array.isArray(value)).toBe(true);
      expect(value).toHaveLength(2);
      expect(typeof value[0]).toBe('string');
      expect(typeof value[1]).toBe('string');
    }
  });

  it('contains expected default keys for left', () => {
    expect(getDefaultBinds().left).toEqual(['KeyA', 'ArrowLeft']);
  });

  it('contains expected default keys for right', () => {
    expect(getDefaultBinds().right).toEqual(['KeyD', 'ArrowRight']);
  });

  it('contains expected default keys for accelerate', () => {
    expect(getDefaultBinds().accelerate).toEqual(['KeyW', 'Mouse2']);
  });

  it('contains expected default keys for brake', () => {
    expect(getDefaultBinds().brake).toEqual(['Space', 'KeyS']);
  });

  it('contains expected default keys for dash', () => {
    expect(getDefaultBinds().dash).toEqual(['ShiftLeft', 'Mouse0']);
  });
});

describe('getBinds', () => {
  beforeEach(() => {
    localStorage.clear();
    resetBinds();
    vi.mocked(notifySettingChanged).mockClear();
  });

  it('returns binds object with all expected action names', () => {
    const binds = getBinds();
    expect(binds).toHaveProperty('left');
    expect(binds).toHaveProperty('right');
    expect(binds).toHaveProperty('accelerate');
    expect(binds).toHaveProperty('brake');
    expect(binds).toHaveProperty('dash');
  });

  it('initially matches default binds after reset', () => {
    const binds = getBinds();
    const defaults = getDefaultBinds();
    expect(binds.left).toEqual(defaults.left);
    expect(binds.right).toEqual(defaults.right);
    expect(binds.accelerate).toEqual(defaults.accelerate);
    expect(binds.brake).toEqual(defaults.brake);
    expect(binds.dash).toEqual(defaults.dash);
  });
});

// ═════════════════════════════════════════════════════════
// Group 3: setBind
// ═════════════════════════════════════════════════════════
describe('setBind', () => {
  beforeEach(() => {
    localStorage.clear();
    resetBinds();
    vi.mocked(notifySettingChanged).mockClear();
  });

  it('updates the specified action slot', () => {
    setBind('left', 'KeyZ', 0);
    expect(getBinds().left[0]).toBe('KeyZ');
  });

  it('updates slot 1 when specified', () => {
    setBind('right', 'KeyM', 1);
    expect(getBinds().right[1]).toBe('KeyM');
  });

  it('defaults to slot 0 when no slot provided', () => {
    setBind('accelerate', 'KeyT');
    expect(getBinds().accelerate[0]).toBe('KeyT');
  });

  it('persists the change to localStorage', () => {
    setBind('brake', 'KeyB', 0);
    const stored = JSON.parse(localStorage.getItem('luminal-keybinds') || 'null');
    expect(stored).not.toBeNull();
    expect(stored.brake[0]).toBe('KeyB');
  });

  it('calls notifySettingChanged after setting a bind', () => {
    setBind('dash', 'KeyX', 0);
    expect(notifySettingChanged).toHaveBeenCalled();
  });

  it('does not affect other actions', () => {
    setBind('left', 'KeyQ', 0);
    expect(getBinds().right).toEqual(getDefaultBinds().right);
    expect(getBinds().accelerate).toEqual(getDefaultBinds().accelerate);
  });
});

// ═════════════════════════════════════════════════════════
// Group 4: resetBinds
// ═════════════════════════════════════════════════════════
describe('resetBinds', () => {
  beforeEach(() => {
    localStorage.clear();
    resetBinds();
    vi.mocked(notifySettingChanged).mockClear();
  });

  it('restores all binds to defaults', () => {
    setBind('left', 'KeyZ', 0);
    setBind('right', 'KeyX', 1);
    resetBinds();
    expect(getBinds().left).toEqual(getDefaultBinds().left);
    expect(getBinds().right).toEqual(getDefaultBinds().right);
  });

  it('persists the reset to localStorage', () => {
    setBind('dash', 'KeyQ', 0);
    resetBinds();
    const stored = JSON.parse(localStorage.getItem('luminal-keybinds') || 'null');
    expect(stored).not.toBeNull();
    expect(stored.dash).toEqual(getDefaultBinds().dash);
  });

  it('calls notifySettingChanged', () => {
    resetBinds();
    expect(notifySettingChanged).toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════
// Group 5: Input state queries — keyboard (no gamepad/touch)
// ═════════════════════════════════════════════════════════
describe('Input state queries via keyboard', () => {
  beforeEach(() => {
    localStorage.clear();
    resetBinds();
    releaseAllKeys();
    mockGetGamepadState.mockReturnValue(null);
    mockGetTouchState.mockReturnValue(null);
  });

  // isLeft
  it('isLeft returns false when no key pressed', () => {
    expect(isLeft()).toBe(false);
  });

  it('isLeft returns true when KeyA is pressed', () => {
    keyDown('KeyA');
    expect(isLeft()).toBe(true);
    keyUp('KeyA');
  });

  it('isLeft returns true when ArrowLeft is pressed', () => {
    keyDown('ArrowLeft');
    expect(isLeft()).toBe(true);
    keyUp('ArrowLeft');
  });

  it('isLeft returns false after key release', () => {
    keyDown('KeyA');
    keyUp('KeyA');
    expect(isLeft()).toBe(false);
  });

  // isRight
  it('isRight returns false when no key pressed', () => {
    expect(isRight()).toBe(false);
  });

  it('isRight returns true when KeyD is pressed', () => {
    keyDown('KeyD');
    expect(isRight()).toBe(true);
    keyUp('KeyD');
  });

  it('isRight returns true when ArrowRight is pressed', () => {
    keyDown('ArrowRight');
    expect(isRight()).toBe(true);
    keyUp('ArrowRight');
  });

  it('isRight returns false after key release', () => {
    keyDown('KeyD');
    keyUp('KeyD');
    expect(isRight()).toBe(false);
  });

  // isAccelerate
  it('isAccelerate returns false when no key pressed', () => {
    expect(isAccelerate()).toBe(false);
  });

  it('isAccelerate returns true when KeyW is pressed', () => {
    keyDown('KeyW');
    expect(isAccelerate()).toBe(true);
    keyUp('KeyW');
  });

  it('isAccelerate returns false after KeyW release', () => {
    keyDown('KeyW');
    keyUp('KeyW');
    expect(isAccelerate()).toBe(false);
  });

  // isBrake
  it('isBrake returns false when no key pressed', () => {
    expect(isBrake()).toBe(false);
  });

  it('isBrake returns true when Space is pressed', () => {
    keyDown('Space');
    expect(isBrake()).toBe(true);
    keyUp('Space');
  });

  it('isBrake returns true when KeyS is pressed', () => {
    keyDown('KeyS');
    expect(isBrake()).toBe(true);
    keyUp('KeyS');
  });

  it('isBrake returns false after Space release', () => {
    keyDown('Space');
    keyUp('Space');
    expect(isBrake()).toBe(false);
  });

  // isDash
  it('isDash returns false when no key pressed', () => {
    expect(isDash()).toBe(false);
  });

  it('isDash returns true when ShiftLeft is pressed', () => {
    keyDown('ShiftLeft');
    expect(isDash()).toBe(true);
    keyUp('ShiftLeft');
  });

  it('isDash returns false after ShiftLeft release', () => {
    keyDown('ShiftLeft');
    keyUp('ShiftLeft');
    expect(isDash()).toBe(false);
  });

  // isDriftBrake
  it('isDriftBrake returns false when no key pressed', () => {
    expect(isDriftBrake()).toBe(false);
  });

  it('isDriftBrake returns true when Space (first brake bind) is pressed', () => {
    keyDown('Space');
    expect(isDriftBrake()).toBe(true);
    keyUp('Space');
  });

  it('isDriftBrake returns false for second brake bind (KeyS)', () => {
    keyDown('KeyS');
    expect(isDriftBrake()).toBe(false);
    keyUp('KeyS');
  });

  // isSpecial
  it('isSpecial returns same as isDriftBrake', () => {
    expect(isSpecial()).toBe(isDriftBrake());
    keyDown('Space');
    expect(isSpecial()).toBe(isDriftBrake());
    keyUp('Space');
  });

  // isEnter / consumeEnter
  it('isEnter returns false when Enter not pressed', () => {
    expect(isEnter()).toBe(false);
  });

  it('isEnter returns true when Enter is pressed', () => {
    keyDown('Enter');
    expect(isEnter()).toBe(true);
    keyUp('Enter');
  });

  it('consumeEnter clears Enter state immediately', () => {
    keyDown('Enter');
    expect(isEnter()).toBe(true);
    consumeEnter();
    expect(isEnter()).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════
// Group 6: Multiple keys pressed simultaneously
// ═════════════════════════════════════════════════════════
describe('Multiple simultaneous keys', () => {
  beforeEach(() => {
    releaseAllKeys();
    mockGetGamepadState.mockReturnValue(null);
    mockGetTouchState.mockReturnValue(null);
  });

  it('isLeft and isRight can both be true at once', () => {
    keyDown('KeyA');
    keyDown('KeyD');
    expect(isLeft()).toBe(true);
    expect(isRight()).toBe(true);
    keyUp('KeyA');
    keyUp('KeyD');
  });

  it('isAccelerate and isBrake can both be true at once', () => {
    keyDown('KeyW');
    keyDown('Space');
    expect(isAccelerate()).toBe(true);
    expect(isBrake()).toBe(true);
    keyUp('KeyW');
    keyUp('Space');
  });

  it('pressing multiple left keys: releasing one still keeps isLeft true', () => {
    keyDown('KeyA');
    keyDown('ArrowLeft');
    keyUp('KeyA');
    expect(isLeft()).toBe(true); // ArrowLeft still held
    keyUp('ArrowLeft');
    expect(isLeft()).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════
// Group 7: Input state queries — gamepad
// ═════════════════════════════════════════════════════════
describe('Input state queries via gamepad', () => {
  const makeGamepad = (overrides: Partial<import('./types/index').GamepadState> = {}) => ({
    leftStickX: 0,
    leftStickY: 0,
    rightStickX: 0,
    rightStickY: 0,
    a: false, b: false, x: false, y: false,
    lb: false, rb: false, lt: false, rt: false,
    select: false, start: false,
    dpadUp: false, dpadDown: false, dpadLeft: false, dpadRight: false,
    _edges: {},
    ...overrides,
  });

  beforeEach(() => {
    releaseAllKeys();
    mockGetTouchState.mockReturnValue(null);
  });

  it('isLeft returns true when gamepad leftStickX < -0.25', () => {
    mockGetGamepadState.mockReturnValue(makeGamepad({ leftStickX: -0.5 }));
    expect(isLeft()).toBe(true);
  });

  it('isLeft returns true when gamepad dpadLeft is pressed', () => {
    mockGetGamepadState.mockReturnValue(makeGamepad({ dpadLeft: true }));
    expect(isLeft()).toBe(true);
  });

  it('isRight returns true when gamepad leftStickX > 0.25', () => {
    mockGetGamepadState.mockReturnValue(makeGamepad({ leftStickX: 0.5 }));
    expect(isRight()).toBe(true);
  });

  it('isRight returns true when gamepad dpadRight is pressed', () => {
    mockGetGamepadState.mockReturnValue(makeGamepad({ dpadRight: true }));
    expect(isRight()).toBe(true);
  });

  it('isAccelerate returns true when gamepad x is pressed', () => {
    mockGetGamepadState.mockReturnValue(makeGamepad({ x: true }));
    expect(isAccelerate()).toBe(true);
  });

  it('isAccelerate returns true when gamepad rt is pressed', () => {
    mockGetGamepadState.mockReturnValue(makeGamepad({ rt: true }));
    expect(isAccelerate()).toBe(true);
  });

  it('isAccelerate returns true when gamepad dpadUp is pressed', () => {
    mockGetGamepadState.mockReturnValue(makeGamepad({ dpadUp: true }));
    expect(isAccelerate()).toBe(true);
  });

  it('isAccelerate returns true when leftStickY < -0.25 and within 40° vertical cone', () => {
    // leftStickY=-0.8, leftStickX=-0.3 → ratio=0.375 < 0.84
    mockGetGamepadState.mockReturnValue(makeGamepad({ leftStickX: -0.3, leftStickY: -0.8 }));
    expect(isAccelerate()).toBe(true);
  });

  it('isAccelerate returns false when leftStickY < -0.25 but outside vertical cone', () => {
    // leftStickY=-0.3, leftStickX=-0.5 → ratio=1.67 > 0.84
    mockGetGamepadState.mockReturnValue(makeGamepad({ leftStickX: -0.5, leftStickY: -0.3 }));
    expect(isAccelerate()).toBe(false);
  });

  it('isBrake returns true when gamepad b is pressed', () => {
    mockGetGamepadState.mockReturnValue(makeGamepad({ b: true }));
    expect(isBrake()).toBe(true);
  });

  it('isBrake returns true when gamepad dpadDown is pressed', () => {
    mockGetGamepadState.mockReturnValue(makeGamepad({ dpadDown: true }));
    expect(isBrake()).toBe(true);
  });

  it('isBrake returns true when leftStickY > 0.25 and within vertical cone', () => {
    mockGetGamepadState.mockReturnValue(makeGamepad({ leftStickX: 0.1, leftStickY: 0.8 }));
    expect(isBrake()).toBe(true);
  });

  it('isDash returns true when gamepad a is pressed', () => {
    mockGetGamepadState.mockReturnValue(makeGamepad({ a: true }));
    expect(isDash()).toBe(true);
  });

  it('isDash returns true when gamepad lt is pressed', () => {
    mockGetGamepadState.mockReturnValue(makeGamepad({ lt: true }));
    expect(isDash()).toBe(true);
  });

  it('isDriftBrake returns true when gamepad b is pressed', () => {
    mockGetGamepadState.mockReturnValue(makeGamepad({ b: true }));
    expect(isDriftBrake()).toBe(true);
  });

  it('isDriftBrake returns false when only dpadDown is pressed (not b button)', () => {
    mockGetGamepadState.mockReturnValue(makeGamepad({ dpadDown: true }));
    expect(isDriftBrake()).toBe(false);
  });

  afterEach(() => {
    mockGetGamepadState.mockReturnValue(null);
  });
});

// ═════════════════════════════════════════════════════════
// Group 8: Input state queries — touch
// ═════════════════════════════════════════════════════════
describe('Input state queries via touch', () => {
  const makeTouchState = (overrides: Record<string, boolean> = {}) => ({
    left: false, right: false, accelerate: false, brake: false, dash: false,
    ...overrides,
  });

  beforeEach(() => {
    releaseAllKeys();
    mockGetGamepadState.mockReturnValue(null);
  });

  it('isLeft returns true from touch state', () => {
    mockGetTouchState.mockReturnValue(makeTouchState({ left: true }));
    expect(isLeft()).toBe(true);
  });

  it('isRight returns true from touch state', () => {
    mockGetTouchState.mockReturnValue(makeTouchState({ right: true }));
    expect(isRight()).toBe(true);
  });

  it('isAccelerate returns true from touch state', () => {
    mockGetTouchState.mockReturnValue(makeTouchState({ accelerate: true }));
    expect(isAccelerate()).toBe(true);
  });

  it('isBrake returns true from touch state', () => {
    mockGetTouchState.mockReturnValue(makeTouchState({ brake: true }));
    expect(isBrake()).toBe(true);
  });

  it('isDash returns true from touch state', () => {
    mockGetTouchState.mockReturnValue(makeTouchState({ dash: true }));
    expect(isDash()).toBe(true);
  });

  it('isDriftBrake returns true from touch brake', () => {
    mockGetTouchState.mockReturnValue(makeTouchState({ brake: true }));
    expect(isDriftBrake()).toBe(true);
  });

  afterEach(() => {
    mockGetTouchState.mockReturnValue(null);
  });
});

// ═════════════════════════════════════════════════════════
// Group 9: Keys ignored when an INPUT element is focused
// ═════════════════════════════════════════════════════════
describe('Keys ignored when input element is focused', () => {
  let input: HTMLInputElement;

  beforeEach(() => {
    releaseAllKeys();
    mockGetGamepadState.mockReturnValue(null);
    mockGetTouchState.mockReturnValue(null);
    input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
  });

  afterEach(() => {
    input.blur();
    document.body.removeChild(input);
    releaseAllKeys();
  });

  it('keydown is ignored when an INPUT element is the active element', () => {
    // input is focused — keydown should not update keys
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', bubbles: true }));
    expect(isLeft()).toBe(false);
  });

  it('keyup is ignored when an INPUT element is the active element', () => {
    // Manually set key state, then verify keyup cannot clear it while input is focused
    const keys = _getKeysRef();
    keys['KeyA'] = true;
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', bubbles: true }));
    // keyup was ignored, so key should still be true
    expect(keys['KeyA']).toBe(true);
    // Clean up
    keys['KeyA'] = false;
  });
});

// ═════════════════════════════════════════════════════════
// Group 10: setBind with custom key affects input queries
// ═════════════════════════════════════════════════════════
describe('Custom binds affect input queries', () => {
  beforeEach(() => {
    localStorage.clear();
    resetBinds();
    releaseAllKeys();
    mockGetGamepadState.mockReturnValue(null);
    mockGetTouchState.mockReturnValue(null);
  });

  afterEach(() => {
    resetBinds();
    releaseAllKeys();
  });

  it('isLeft uses a newly-bound key', () => {
    setBind('left', 'KeyZ', 0);
    keyDown('KeyZ');
    expect(isLeft()).toBe(true);
    keyUp('KeyZ');
  });

  it('isLeft no longer responds to old key after rebind', () => {
    setBind('left', 'KeyZ', 0);
    keyDown('KeyA'); // old bind slot 0
    expect(isLeft()).toBe(false);
    keyUp('KeyA');
  });

  it('isBrake uses a newly-bound key', () => {
    setBind('brake', 'KeyP', 1);
    keyDown('KeyP');
    expect(isBrake()).toBe(true);
    keyUp('KeyP');
  });

  it('isDash uses a newly-bound key', () => {
    setBind('dash', 'KeyO', 0);
    keyDown('KeyO');
    expect(isDash()).toBe(true);
    keyUp('KeyO');
  });
});

// ═════════════════════════════════════════════════════════
// Group 11: EVT_SETTINGS_RESTORED reloads binds
// ═════════════════════════════════════════════════════════
describe('EVT_SETTINGS_RESTORED reloads keybinds from localStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    resetBinds();
    releaseAllKeys();
    mockGetGamepadState.mockReturnValue(null);
    mockGetTouchState.mockReturnValue(null);
  });

  it('reloads binds from localStorage when settings-restored event fires', () => {
    // Put custom binds in localStorage directly (simulating server restore)
    const customBinds = {
      ...getDefaultBinds(),
      left: ['KeyZ', 'KeyX'],
    };
    localStorage.setItem('luminal-keybinds', JSON.stringify(customBinds));

    // Fire the settings-restored event
    window.dispatchEvent(new Event('settings-restored'));

    // The in-memory binds should now reflect localStorage
    expect(getBinds().left[0]).toBe('KeyZ');
  });

  it('falls back to defaults when localStorage is cleared and event fires', () => {
    // Set a custom bind in memory first
    setBind('right', 'KeyM', 0);
    expect(getBinds().right[0]).toBe('KeyM');

    // Clear storage (simulating a restore with no keybinds)
    localStorage.removeItem('luminal-keybinds');

    // Fire the settings-restored event
    window.dispatchEvent(new Event('settings-restored'));

    // Should fall back to defaults
    expect(getBinds().right).toEqual(getDefaultBinds().right);
  });
});
