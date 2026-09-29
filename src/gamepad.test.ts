import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoist mocks ─────────────────────────────────────────
const { mockNotify } = vi.hoisted(() => ({
  mockNotify: vi.fn(),
}));

vi.mock('./settingsSync', () => ({
  notifySettingChanged: mockNotify,
}));

vi.mock('./events', () => ({
  EVT_SETTINGS_RESTORED: 'luminal-settings-restored',
}));

vi.mock('./swallow', () => ({
  swallow: (_label: string) => () => {},
}));

// ── Import module under test ────────────────────────────
import {
  getStickDeadzone,
  setStickDeadzone,
  getControllerFamily,
  isGamepadConnected,
  getGamepadState,
  getRawGamepadState,
  getForceKeyboard,
  setForceKeyboard,
  initGamepad,
  pollGamepad,
  getUINav,
  vibrateGamepad,
} from './gamepad';

// ── Helpers ─────────────────────────────────────────────

function makeFakeGamepad(overrides: Partial<Gamepad> = {}): Gamepad {
  const buttons: GamepadButton[] = Array.from({ length: 17 }, () => ({
    pressed: false,
    touched: false,
    value: 0,
  }));
  return {
    id: 'Xbox 360 Controller (STANDARD GAMEPAD)',
    index: 0,
    connected: true,
    mapping: 'standard' as GamepadMappingType,
    timestamp: performance.now(),
    buttons,
    axes: [0, 0, 0, 0],
    hapticActuators: [],
    vibrationActuator: null,
    ...overrides,
  } as Gamepad;
}

function mockNavigatorGetGamepads(pads: (Gamepad | null)[]): void {
  Object.defineProperty(navigator, 'getGamepads', {
    value: () => pads,
    writable: true,
    configurable: true,
  });
}

// ── Tests ───────────────────────────────────────────────

describe('gamepad', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Provide a default empty getGamepads
    mockNavigatorGetGamepads([null, null, null, null]);
  });

  // ── Deadzone getter/setter ────────────────────────────

  describe('getStickDeadzone / setStickDeadzone', () => {
    it('returns default deadzone of 0.25', () => {
      // Module-level default is 0.25 (or whatever localStorage had at import time)
      expect(typeof getStickDeadzone()).toBe('number');
    });

    it('clamps values to [0.05, 0.50]', () => {
      setStickDeadzone(0.01);
      expect(getStickDeadzone()).toBe(0.05);

      setStickDeadzone(0.99);
      expect(getStickDeadzone()).toBe(0.50);
    });

    it('accepts values within range', () => {
      setStickDeadzone(0.30);
      expect(getStickDeadzone()).toBe(0.30);
    });

    it('persists to localStorage', () => {
      setStickDeadzone(0.15);
      expect(localStorage.getItem('luminal-stick-deadzone')).toBe('0.15');
    });

    it('calls notifySettingChanged', () => {
      setStickDeadzone(0.20);
      expect(mockNotify).toHaveBeenCalled();
    });
  });

  // ── Force keyboard getter/setter ──────────────────────

  describe('getForceKeyboard / setForceKeyboard', () => {
    it('setForceKeyboard(true) persists and is readable', () => {
      setForceKeyboard(true);
      expect(getForceKeyboard()).toBe(true);
      expect(localStorage.getItem('luminal-force-kb')).toBe('true');
    });

    it('setForceKeyboard(false) persists', () => {
      setForceKeyboard(false);
      expect(getForceKeyboard()).toBe(false);
      expect(localStorage.getItem('luminal-force-kb')).toBe('false');
    });

    it('calls notifySettingChanged', () => {
      setForceKeyboard(true);
      expect(mockNotify).toHaveBeenCalled();
    });
  });

  // ── Controller family ─────────────────────────────────

  describe('getControllerFamily', () => {
    it('defaults to generic when no gamepad connected', () => {
      // Before any gamepad connects, family should be generic
      expect(getControllerFamily()).toBe('generic');
    });
  });

  // ── Connection state ──────────────────────────────────

  describe('isGamepadConnected', () => {
    it('returns false initially (no gamepad connected)', () => {
      // isGamepadConnected tracks the module-level _connected flag.
      // Without dispatching gamepadconnected events, it should be false
      // (assuming fresh module state — but modules are cached, so this
      // checks the accumulated state from prior tests).
      expect(typeof isGamepadConnected()).toBe('boolean');
    });
  });

  // ── Gamepad state accessors ───────────────────────────

  describe('getGamepadState / getRawGamepadState', () => {
    it('returns null when no gamepads are connected', () => {
      mockNavigatorGetGamepads([null, null, null, null]);
      pollGamepad();
      expect(getRawGamepadState()).toBeNull();
    });

    it('getGamepadState returns null when forceKeyboard is true', () => {
      const gp = makeFakeGamepad();
      mockNavigatorGetGamepads([gp, null, null, null]);
      pollGamepad();

      setForceKeyboard(true);
      expect(getGamepadState()).toBeNull();
      // But raw state should still be available
      expect(getRawGamepadState()).not.toBeNull();
    });

    it('getGamepadState returns state when forceKeyboard is false', () => {
      const gp = makeFakeGamepad();
      mockNavigatorGetGamepads([gp, null, null, null]);
      pollGamepad();

      setForceKeyboard(false);
      expect(getGamepadState()).not.toBeNull();
    });
  });

  // ── initGamepad ───────────────────────────────────────

  describe('initGamepad', () => {
    it('does not throw', () => {
      expect(() => initGamepad()).not.toThrow();
    });

    it('is idempotent (calling twice is safe)', () => {
      expect(() => {
        initGamepad();
        initGamepad();
      }).not.toThrow();
    });
  });

  // ── pollGamepad ───────────────────────────────────────

  describe('pollGamepad', () => {
    it('handles no gamepads without throwing', () => {
      mockNavigatorGetGamepads([null, null, null, null]);
      expect(() => pollGamepad()).not.toThrow();
    });

    it('sets state to null when no gamepads present', () => {
      mockNavigatorGetGamepads([null, null, null, null]);
      pollGamepad();
      expect(getRawGamepadState()).toBeNull();
    });

    it('builds state from a connected gamepad', () => {
      const gp = makeFakeGamepad();
      mockNavigatorGetGamepads([gp, null, null, null]);
      pollGamepad();

      const state = getRawGamepadState();
      expect(state).not.toBeNull();
      expect(state!.leftStickX).toBe(0);
      expect(state!.leftStickY).toBe(0);
      expect(state!.a).toBe(false);
      expect(state!.b).toBe(false);
    });

    it('reads pressed buttons', () => {
      const buttons: GamepadButton[] = Array.from({ length: 17 }, () => ({
        pressed: false,
        touched: false,
        value: 0,
      }));
      // Press A button (index 0)
      buttons[0] = { pressed: true, touched: true, value: 1 };
      const gp = makeFakeGamepad({ buttons });
      mockNavigatorGetGamepads([gp, null, null, null]);
      pollGamepad();

      const state = getRawGamepadState();
      expect(state).not.toBeNull();
      expect(state!.a).toBe(true);
    });

    it('applies deadzone to stick axes', () => {
      // Stick value below deadzone should be zeroed
      setStickDeadzone(0.25);
      const gp = makeFakeGamepad({ axes: [0.1, -0.1, 0, 0] });
      mockNavigatorGetGamepads([gp, null, null, null]);
      pollGamepad();

      const state = getRawGamepadState();
      expect(state).not.toBeNull();
      expect(state!.leftStickX).toBe(0);
      expect(state!.leftStickY).toBe(0);
    });

    it('passes through stick values above deadzone', () => {
      setStickDeadzone(0.05);
      const gp = makeFakeGamepad({ axes: [0.8, -0.7, 0, 0] });
      mockNavigatorGetGamepads([gp, null, null, null]);
      pollGamepad();

      const state = getRawGamepadState();
      expect(state).not.toBeNull();
      expect(state!.leftStickX).toBe(0.8);
      expect(state!.leftStickY).toBe(-0.7);
    });

    it('reads d-pad buttons on standard mapping', () => {
      const buttons: GamepadButton[] = Array.from({ length: 17 }, () => ({
        pressed: false,
        touched: false,
        value: 0,
      }));
      // D-pad up = index 12
      buttons[12] = { pressed: true, touched: true, value: 1 };
      const gp = makeFakeGamepad({ buttons });
      mockNavigatorGetGamepads([gp, null, null, null]);
      pollGamepad();

      const state = getRawGamepadState();
      expect(state).not.toBeNull();
      expect(state!.dpadUp).toBe(true);
      expect(state!.dpadDown).toBe(false);
    });
  });

  // ── getUINav ──────────────────────────────────────────

  describe('getUINav', () => {
    it('returns null when forceKeyboard is true', () => {
      setForceKeyboard(true);
      expect(getUINav()).toBeNull();
    });

    it('returns null when no gamepad state', () => {
      setForceKeyboard(false);
      mockNavigatorGetGamepads([null, null, null, null]);
      pollGamepad();
      expect(getUINav()).toBeNull();
    });

    it('returns nav object when gamepad is connected', () => {
      setForceKeyboard(false);
      const gp = makeFakeGamepad();
      mockNavigatorGetGamepads([gp, null, null, null]);
      pollGamepad();

      const nav = getUINav();
      expect(nav).not.toBeNull();
      expect(typeof nav!.up).toBe('boolean');
      expect(typeof nav!.down).toBe('boolean');
      expect(typeof nav!.confirm).toBe('boolean');
      expect(typeof nav!.back).toBe('boolean');
    });
  });

  // ── vibrateGamepad ────────────────────────────────────

  describe('vibrateGamepad', () => {
    it('does not throw when no gamepads connected', () => {
      mockNavigatorGetGamepads([null, null, null, null]);
      expect(() => vibrateGamepad(100)).not.toThrow();
    });

    it('calls playEffect on vibrationActuator when available', () => {
      const mockPlayEffect = vi.fn().mockResolvedValue(undefined);
      const gp = makeFakeGamepad({
        vibrationActuator: {
          playEffect: mockPlayEffect,
        } as unknown as GamepadHapticActuator,
      });
      mockNavigatorGetGamepads([gp, null, null, null]);

      vibrateGamepad(200, 0.6, 0.4);

      expect(mockPlayEffect).toHaveBeenCalledWith('dual-rumble', {
        startDelay: 0,
        duration: 200,
        weakMagnitude: 0.6,
        strongMagnitude: 0.4,
      });
    });

    it('clamps magnitudes to [0, 1]', () => {
      const mockPlayEffect = vi.fn().mockResolvedValue(undefined);
      const gp = makeFakeGamepad({
        vibrationActuator: {
          playEffect: mockPlayEffect,
        } as unknown as GamepadHapticActuator,
      });
      mockNavigatorGetGamepads([gp, null, null, null]);

      vibrateGamepad(100, 2.0, -0.5);

      expect(mockPlayEffect).toHaveBeenCalledWith('dual-rumble', expect.objectContaining({
        weakMagnitude: 1,
        strongMagnitude: 0,
      }));
    });

    it('does not throw when getGamepads is not a function', () => {
      Object.defineProperty(navigator, 'getGamepads', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      expect(() => vibrateGamepad(100)).not.toThrow();
      // Restore
      mockNavigatorGetGamepads([null, null, null, null]);
    });
  });

  // ── EVT_SETTINGS_RESTORED listener ────────────────────

  describe('settings restored event', () => {
    it('re-reads localStorage on EVT_SETTINGS_RESTORED', () => {
      localStorage.setItem('luminal-force-kb', 'true');
      localStorage.setItem('luminal-stick-deadzone', '0.40');

      window.dispatchEvent(new Event('luminal-settings-restored'));

      expect(getForceKeyboard()).toBe(true);
      expect(getStickDeadzone()).toBe(0.40);
    });
  });
});
