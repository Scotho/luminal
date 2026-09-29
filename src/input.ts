import { EVT_SETTINGS_RESTORED } from './events';
import { getGamepadState } from './gamepad';
import { getTouchState } from './touch';
import { notifySettingChanged } from './settingsSync';
import type { Keybinds, ActionName } from './types/index';
import type { GamepadState } from './types/index';
import { warnDev } from './swallow';

export const TOUCH_ENABLED: boolean = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// True on phone-sized screens (< tablet breakpoint). Evaluated at call time
// since viewport width can change (rotation, resize). Used to gate mobile-only
// UI behaviors like the "hide radar during match" option.
export function isPhoneScreen(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 768;
}

const keys: Record<string, boolean> = {};

/** Expose keys record for external input systems */
// ts-prune-ignore-next
export function _getKeysRef(): Record<string, boolean> { return keys; }

window.addEventListener('keydown', (e: KeyboardEvent) => {
  // Don't capture keys when typing in an input field (chat, login, etc.)
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  keys[e.code] = true;
});

window.addEventListener('keyup', (e: KeyboardEvent) => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  keys[e.code] = false;
});

// Clear all pressed keys when window loses focus (prevents stuck keys on alt-tab)
function clearAllKeys(): void {
  for (const k in keys) keys[k] = false;
}
window.addEventListener('blur', clearAllKeys);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearAllKeys(); });

// Mouse button tracking
window.addEventListener('mousedown', (e: MouseEvent) => {
  if (e.button === 0) keys['Mouse0'] = true;
  if (e.button === 2) keys['Mouse2'] = true;
});
window.addEventListener('mouseup', (e: MouseEvent) => {
  if (e.button === 0) keys['Mouse0'] = false;
  if (e.button === 2) keys['Mouse2'] = false;
});

// ── Custom Keybinds ──────────────────────────────────────
const DEFAULT_BINDS: Keybinds = {
  left:  ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  accelerate: ['KeyW', 'Mouse2'],
  brake: ['Space', 'KeyS'],
  dash:  ['ShiftLeft', 'Mouse0'],
  // Replay
  rPlayPause: ['Space', ''],
  rCamPrev:   ['KeyQ', ''],
  rCamNext:   ['KeyE', 'KeyC'],
  rSkipBack:  ['ArrowLeft', ''],
  rSkipFwd:   ['ArrowRight', ''],
  rFineBack:  ['KeyJ', ''],
  rFineFwd:   ['KeyL', ''],
  rToggleUI:  ['KeyH', ''],
};

let binds: Keybinds = loadBinds();

function loadBinds(): Keybinds {
  const saved: string | null = localStorage.getItem('luminal-keybinds');
  if (saved) {
    try { return JSON.parse(saved) as Keybinds; } catch (err) {
      warnDev('input: corrupt saved keybinds, falling back to defaults', err);
    }
  }
  return structuredClone(DEFAULT_BINDS);
}

function saveBinds(): void {
  localStorage.setItem('luminal-keybinds', JSON.stringify(binds));
  notifySettingChanged();
}

export function getBinds(): Keybinds { return binds; }
// ts-prune-ignore-next
export function getDefaultBinds(): Keybinds { return DEFAULT_BINDS; }

export function setBind(action: ActionName, code: string, slot: number = 0): void {
  if (!binds[action]) binds[action] = ['', ''];
  // Ensure array has two slots
  while (binds[action].length < 2) binds[action].push('');
  binds[action][slot] = code;
  saveBinds();
}

export function resetBinds(): void {
  binds = structuredClone(DEFAULT_BINDS);
  saveBinds();
}

// ── Input Queries ────────────────────────────────────────
export function isLeft(): boolean {
  const gp: GamepadState | null = getGamepadState();
  const ts = getTouchState();
  return binds.left.some((k: string) => keys[k]) || (gp != null && (gp.leftStickX < -0.25 || gp.dpadLeft)) || (ts != null && ts.left);
}

export function isRight(): boolean {
  const gp: GamepadState | null = getGamepadState();
  const ts = getTouchState();
  return binds.right.some((k: string) => keys[k]) || (gp != null && (gp.leftStickX > 0.25 || gp.dpadRight)) || (ts != null && ts.right);
}

export function isAccelerate(): boolean {
  const gp: GamepadState | null = getGamepadState();
  const ts = getTouchState();
  if (ts != null && ts.accelerate) return true;
  if (binds.accelerate.some((k: string) => keys[k])) return true;
  if (!gp) return false;
  // X button, RT, D-pad up, or stick pushed up within 40° of vertical (80° cone)
  if (gp.x || gp.rt || gp.dpadUp) return true;
  if (gp.leftStickY < -0.25) {
    const ratio: number = Math.abs(gp.leftStickX) / Math.abs(gp.leftStickY);
    if (ratio < 0.84) return true; // tan(40°) ≈ 0.84
  }
  return false;
}

export function isDash(): boolean {
  const gp: GamepadState | null = getGamepadState();
  const ts = getTouchState();
  return binds.dash.some((k: string) => keys[k]) || (gp != null && (gp.a || gp.lt)) || (ts != null && ts.dash);
}

export function isBrake(): boolean {
  const gp: GamepadState | null = getGamepadState();
  const ts = getTouchState();
  if (ts != null && ts.brake) return true;
  if (binds.brake.some((k: string) => keys[k])) return true;
  if (!gp) return false;
  // B button, D-pad down, or stick pushed down within 40° of vertical (80° cone)
  if (gp.b || gp.dpadDown) return true;
  if (gp.leftStickY > 0.25) {
    const ratio: number = Math.abs(gp.leftStickX) / Math.abs(gp.leftStickY);
    if (ratio < 0.84) return true;
  }
  return false;
}

/** Drift-initiating brake — only Space (first brake bind) or B button. S / down-stick won't trigger drift. */
export function isDriftBrake(): boolean {
  const gp: GamepadState | null = getGamepadState();
  const ts = getTouchState();
  if (ts != null && ts.brake) return true; // touch brake always counts as drift brake
  if (binds.brake[0] && keys[binds.brake[0]]) return true; // first bind only (Space)
  if (gp && gp.b) return true; // B button only, not down-stick
  return false;
}

/** Special ability input — same physical key as drift brake (Space / B button / touch brake). */
export function isSpecial(): boolean {
  return isDriftBrake();
}

export function isEnter(): boolean {
  return !!keys['Enter'];
}

export function consumeEnter(): void {
  keys['Enter'] = false;
}

// Re-read keybinds when restored from server
window.addEventListener(EVT_SETTINGS_RESTORED, () => {
  binds = loadBinds();
});
