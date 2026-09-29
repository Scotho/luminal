import { EVT_SETTINGS_RESTORED } from './events';
// ── Gamepad Abstraction ──────────────────────────────────
import type { GamepadState, UINav } from './types/index';
import { notifySettingChanged } from './settingsSync';
import { swallow } from './swallow';

let _initialized = false;
let _connected = false;
let _forceKeyboard = localStorage.getItem('luminal-force-kb') === 'true';
let _state: GamepadState | null = null;
let _bannerTimeout: ReturnType<typeof setTimeout> | null = null;

// Configurable stick deadzone (0.05 – 0.50, default 0.25)
let _stickDeadzone: number = parseFloat(localStorage.getItem('luminal-stick-deadzone') || '0.25') || 0.25;

export function getStickDeadzone(): number { return _stickDeadzone; }
export function setStickDeadzone(val: number): void {
  _stickDeadzone = Math.max(0.05, Math.min(0.50, val));
  localStorage.setItem('luminal-stick-deadzone', String(_stickDeadzone));
  notifySettingChanged();
}

// Per-index gamepad states
const _indexedStates: (GamepadState | null)[] = [];
const _indexedPrevButtons: boolean[][] = [];

// ── Controller type detection ────────────────────────────
export type ControllerFamily = 'xbox' | 'playstation' | 'switch' | 'generic';
let _controllerFamily: ControllerFamily = 'generic';

export function getControllerFamily(): ControllerFamily { return _controllerFamily; }

function _detectFamily(id: string): ControllerFamily {
  const low = id.toLowerCase();
  if (low.includes('xbox') || low.includes('xinput') || low.includes('045e')) return 'xbox';
  if (low.includes('playstation') || low.includes('dualshock') || low.includes('dualsense')
      || low.includes('054c') || low.includes('sony')) return 'playstation';
  if (low.includes('pro controller') || low.includes('057e') || low.includes('nintendo')) return 'switch';
  return 'generic';
}

// ── Non-standard controller remap table ──────────────────
// Maps known non-standard controller ID substrings to button/axis remaps.
// Each entry specifies a button index remap (fromIndex → toStandardIndex)
// and/or an alternate hat-switch axis.
interface ControllerRemap {
  idMatch: string;              // substring match against gp.id (lowercase)
  buttons?: Record<number, number>; // raw index → standard index remap
  hatAxis?: number;             // which axis is the hat switch (default: 9)
  hatValues?: {                 // value ranges for hat directions
    up: [number, number];       // [min, max] inclusive
    right: [number, number];
    down: [number, number];
    left: [number, number];
  };
}

// Known non-standard controllers — extend as reports come in
const CONTROLLER_REMAPS: ControllerRemap[] = [
  // Nacon Revolution / Nacon Pro — reports as non-standard, uses axis 9 hat with different ranges
  {
    idMatch: 'nacon',
    hatAxis: 9,
    hatValues: {
      up: [-1.0, -0.75],
      right: [-0.45, -0.15],
      down: [-0.05, 0.15],
      left: [0.2, 0.55],
    },
  },
  // SCUF controllers — typically standard mapping but some report non-standard
  { idMatch: 'scuf', hatAxis: 9 },
  // Victrix Pro — similar to Nacon
  { idMatch: 'victrix', hatAxis: 9 },
  // Hori / fight pads
  { idMatch: 'hori', hatAxis: 9 },
];

// Pre-computed reverse button maps: standardIdx → rawIdx (built once per remap entry)
const _reverseButtonMaps = new Map<ControllerRemap, Map<number, number>>();
for (const r of CONTROLLER_REMAPS) {
  if (r.buttons) {
    const rev = new Map<number, number>();
    for (const [rawStr, stdIdx] of Object.entries(r.buttons)) {
      rev.set(stdIdx, Number(rawStr));
    }
    _reverseButtonMaps.set(r, rev);
  }
}

let _cachedRemapId: string | null = null;
let _cachedRemap: ControllerRemap | null = null;

function _findRemap(gp: Gamepad): ControllerRemap | null {
  if (gp.mapping === 'standard') return null;
  // Cache by controller ID to avoid re-scanning each frame
  if (gp.id === _cachedRemapId) return _cachedRemap;
  _cachedRemapId = gp.id;
  const low = gp.id.toLowerCase();
  for (const r of CONTROLLER_REMAPS) {
    if (low.includes(r.idMatch)) { _cachedRemap = r; return r; }
  }
  _cachedRemap = null;
  return null;
}

// ── Shared state builder (single source of truth) ────────
function _buildState(
  gp: Gamepad,
  prevButtons: boolean[],
): { state: GamepadState; newPrevButtons: boolean[] } {
  const remap = _findRemap(gp);

  // Helper: read button as pressed (handles both .pressed and .value for analog buttons)
  const rawBtn = (i: number): boolean => {
    const b = gp.buttons[i];
    if (!b) return false;
    return b.pressed || b.value > 0.5;
  };

  // Apply button remap for non-standard controllers (uses pre-computed reverse map)
  const reverseMap = remap ? _reverseButtonMaps.get(remap) : undefined;
  const btn = (standardIdx: number): boolean => {
    if (reverseMap) {
      const rawIdx = reverseMap.get(standardIdx);
      if (rawIdx !== undefined) return rawBtn(rawIdx);
    }
    return rawBtn(standardIdx);
  };

  const deadzone = _stickDeadzone;
  const lx = Math.abs(gp.axes[0] || 0) > deadzone ? gp.axes[0] : 0;
  const ly = Math.abs(gp.axes[1] || 0) > deadzone ? gp.axes[1] : 0;

  // D-pad: standard buttons first
  let dpadUp = rawBtn(12), dpadDown = rawBtn(13), dpadLeft = rawBtn(14), dpadRight = rawBtn(15);

  // Fallback: hat-switch axis for non-standard controllers
  if (gp.mapping !== 'standard') {
    const hatAxis = remap?.hatAxis ?? 9;
    if (gp.axes.length > hatAxis) {
      const hat = gp.axes[hatAxis];
      // Note: hat === 0 can be a valid direction on some encodings (e.g. "down"),
      // so we only skip undefined. Neutral is typically ~3.29 or -1.
      if (hat !== undefined) {
        if (remap?.hatValues) {
          // Use controller-specific value ranges
          const hv = remap.hatValues;
          if (hat >= hv.up[0] && hat <= hv.up[1]) dpadUp = true;
          else if (hat >= hv.right[0] && hat <= hv.right[1]) dpadRight = true;
          else if (hat >= hv.down[0] && hat <= hv.down[1]) dpadDown = true;
          else if (hat >= hv.left[0] && hat <= hv.left[1]) dpadLeft = true;
        } else {
          // Generic hat-switch decoding — covers most common encodings:
          // Standard: -1 = up, -0.43 = up-right, 0.14 = right, 0.71 = down-right, etc.
          // Alt:      -1 = up, -0.5 = left, 0 = down, 0.5 = right
          // We use broad overlapping ranges and check in priority order
          if (hat < -0.7) dpadUp = true;                          // up
          else if (hat >= -0.7 && hat < -0.3) dpadLeft = true;    // up-left or left
          else if (hat >= -0.3 && hat < 0.3) dpadDown = true;     // down or neutral-ish
          else if (hat >= 0.3 && hat < 0.8) dpadRight = true;     // right or down-right
          // hat >= 0.8 is typically "up" wrap-around on some encodings
          else if (hat >= 0.8) dpadUp = true;
        }
      }
    }
  }

  const state: GamepadState = {
    leftStickX: lx,
    leftStickY: ly,
    a: btn(0),
    b: btn(1),
    x: btn(2),
    y: btn(3),
    lb: btn(4),
    rb: btn(5),
    lt: btn(6),
    rt: btn(7),
    select: btn(8),
    start: btn(9),
    rightStickX: Math.abs(gp.axes[2] || 0) > deadzone ? gp.axes[2] : 0,
    rightStickY: Math.abs(gp.axes[3] || 0) > deadzone ? gp.axes[3] : 0,
    dpadUp,
    dpadDown,
    dpadLeft,
    dpadRight,
    _edges: {},
  };

  // Edge detection for buttons — dynamically sized to match controller
  const btns = gp.buttons.map(b => b.pressed || b.value > 0.5);
  while (prevButtons.length < btns.length) prevButtons.push(false);
  state._edges = {};
  for (let i = 0; i < btns.length; i++) {
    state._edges[i] = btns[i] && !prevButtons[i];
  }

  return { state, newPrevButtons: btns };
}

// ── Init ─────────────────────────────────────────────────
export function initGamepad(): void {
  if (_initialized) return;
  _initialized = true;
  window.addEventListener('gamepadconnected', (e) => {
    _connected = true;
    _controllerFamily = _detectFamily((e as GamepadEvent).gamepad.id);
    showBanner('CONTROLLER CONNECTED', 'rgb(var(--c-teal))');
  });
  window.addEventListener('gamepaddisconnected', () => {
    _connected = false;
    _controllerFamily = 'generic';
    showBanner('CONTROLLER DISCONNECTED', 'rgb(var(--c-red))');
  });
}

function showBanner(text: string, color: string): void {
  const el = document.getElementById('controller-banner');
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
  el.style.textShadow = `0 0 12px ${color}, 0 0 30px ${color}`;
  el.classList.remove('hidden');
  if (_bannerTimeout) clearTimeout(_bannerTimeout);
  _bannerTimeout = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ── Primary polling ──────────────────────────────────────
export function pollGamepad(): void {
  // Build all indexed states first, then alias _state to index 0
  const gamepads = navigator.getGamepads();

  // Detect connection for first available gamepad
  let anyConnected = false;
  for (const g of gamepads) {
    if (g && g.connected) { anyConnected = true; break; }
  }
  if (!anyConnected) { _state = null; return; }

  // Detect controllers that connect without firing gamepadconnected (e.g. wireless dongles)
  if (!_connected) {
    const first = Array.from(gamepads).find(g => g && g.connected)!;
    _connected = true;
    _controllerFamily = _detectFamily(first.id);
    showBanner('CONTROLLER CONNECTED', 'rgb(var(--c-teal))');
    if (import.meta.env.DEV) console.log('[Gamepad]', first.id, '| mapping:', first.mapping, '| buttons:', first.buttons.length, '| axes:', first.axes.length, '| family:', _controllerFamily);
  }

  // Build indexed states (single pass, single getGamepads call)
  for (let idx = 0; idx < gamepads.length; idx++) {
    const gp = gamepads[idx];
    if (!gp || !gp.connected) { _indexedStates[idx] = null; continue; }

    if (!_indexedPrevButtons[idx]) _indexedPrevButtons[idx] = new Array(20).fill(false);

    const result = _buildState(gp, _indexedPrevButtons[idx]);
    _indexedStates[idx] = result.state;
    _indexedPrevButtons[idx] = result.newPrevButtons;
  }

  // Primary state = first connected gamepad (index 0 or first non-null)
  _state = null;
  for (let idx = 0; idx < _indexedStates.length; idx++) {
    if (_indexedStates[idx]) { _state = _indexedStates[idx]; break; }
  }
}

// ── Accessors ────────────────────────────────────────────
export function isGamepadConnected(): boolean { return _connected; }
export function getGamepadState(): GamepadState | null { return _forceKeyboard ? null : _state; }
export function getRawGamepadState(): GamepadState | null { return _state; }

export function getForceKeyboard(): boolean { return _forceKeyboard; }
export function setForceKeyboard(val: boolean): void {
  _forceKeyboard = val;
  localStorage.setItem('luminal-force-kb', val ? 'true' : 'false');
  notifySettingChanged();
}

// ── UI navigation with edge detection + repeat-rate ──────
let _prevStickUp = false, _prevStickDown = false, _prevStickLeft = false, _prevStickRight = false;

// Repeat-rate state: per-direction timers
const REPEAT_INITIAL_MS = 400;
const REPEAT_RATE_MS = 100;

interface RepeatState {
  held: boolean;
  firstFiredAt: number;   // timestamp of initial edge fire
  lastRepeatedAt: number; // timestamp of last repeat fire
}

const _repeat: Record<string, RepeatState> = {
  up: { held: false, firstFiredAt: 0, lastRepeatedAt: 0 },
  down: { held: false, firstFiredAt: 0, lastRepeatedAt: 0 },
  left: { held: false, firstFiredAt: 0, lastRepeatedAt: 0 },
  right: { held: false, firstFiredAt: 0, lastRepeatedAt: 0 },
};

function _updateRepeat(dir: string, isHeld: boolean, isEdge: boolean): boolean {
  const r = _repeat[dir];
  const now = performance.now();

  if (isEdge) {
    // Fresh press — always fire, reset timers
    r.held = true;
    r.firstFiredAt = now;
    r.lastRepeatedAt = now;
    return true;
  }

  if (!isHeld) {
    r.held = false;
    return false;
  }

  // Held: check repeat timing
  if (!r.held) {
    // Just started holding (edge was missed?) — treat as initial
    r.held = true;
    r.firstFiredAt = now;
    r.lastRepeatedAt = now;
    return true;
  }

  const elapsed = now - r.firstFiredAt;
  if (elapsed < REPEAT_INITIAL_MS) return false; // waiting for initial delay

  const sinceLast = now - r.lastRepeatedAt;
  if (sinceLast >= REPEAT_RATE_MS) {
    r.lastRepeatedAt = now;
    return true;
  }

  return false;
}

export function getUINav(): UINav | null {
  if (_forceKeyboard || !_state) return null;

  const stickUp = _state.leftStickY < -0.6;
  const stickDown = _state.leftStickY > 0.6;
  const stickLeft = _state.leftStickX < -0.6;
  const stickRight = _state.leftStickX > 0.6;

  // Raw edges from d-pad buttons and stick transitions
  const rawEdgeUp = _state._edges[12] || (stickUp && !_prevStickUp);
  const rawEdgeDown = _state._edges[13] || (stickDown && !_prevStickDown);
  const rawEdgeLeft = _state._edges[14] || (stickLeft && !_prevStickLeft);
  const rawEdgeRight = _state._edges[15] || (stickRight && !_prevStickRight);

  // Held state: d-pad button OR stick held past threshold
  const heldUp = _state.dpadUp || stickUp;
  const heldDown = _state.dpadDown || stickDown;
  const heldLeft = _state.dpadLeft || stickLeft;
  const heldRight = _state.dpadRight || stickRight;

  const nav: UINav = {
    up: _updateRepeat('up', heldUp, rawEdgeUp),
    down: _updateRepeat('down', heldDown, rawEdgeDown),
    left: _updateRepeat('left', heldLeft, rawEdgeLeft),
    right: _updateRepeat('right', heldRight, rawEdgeRight),
    confirm: _state._edges[0],
    back: _state._edges[1],
    select: _state._edges[8],
    start: _state._edges[9],
    lb: _state._edges[4],   // left bumper edge
    rb: _state._edges[5],   // right bumper edge
  };

  _prevStickUp = stickUp;
  _prevStickDown = stickDown;
  _prevStickLeft = stickLeft;
  _prevStickRight = stickRight;

  return nav;
}

// ── Vibration ────────────────────────────────────────────
export function vibrateGamepad(
  durationMs: number,
  weakMagnitude: number = 0.5,
  strongMagnitude: number = 0.3,
): void {
  if (typeof navigator.getGamepads !== 'function') return;
  const gamepads = navigator.getGamepads();
  for (const gp of gamepads) {
    if (!gp || !gp.connected) continue;
    const va = gp.vibrationActuator;
    if (va && typeof va.playEffect === 'function') {
      va.playEffect('dual-rumble', {
        startDelay: 0,
        duration: durationMs,
        weakMagnitude: Math.min(1, Math.max(0, weakMagnitude)),
        strongMagnitude: Math.min(1, Math.max(0, strongMagnitude)),
      }).catch(swallow('gamepad'));
    }
    break; // vibrate only primary controller
  }
}

// Re-read force-keyboard when restored from server
window.addEventListener(EVT_SETTINGS_RESTORED, () => {
  _forceKeyboard = localStorage.getItem('luminal-force-kb') === 'true';
  _stickDeadzone = parseFloat(localStorage.getItem('luminal-stick-deadzone') || '0.25') || 0.25;
});
