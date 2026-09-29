// ── Touch Button Controls ────────────────────────────────
// On-screen button overlay for mobile — pedal-style layout
// modeled after Asphalt 8/9 and Real Racing 3.
// Outputs the same TouchState as the gesture system so the
// input pipeline in input.ts works without changes.
//
// Industry best practices applied:
// - Buttons in lower thumb arcs (landscape two-thumb grip)
// - Minimum 48px touch targets with clamp() fluid sizing
// - 55% default opacity so gameplay stays visible
// - Haptic feedback on press (20ms tap via navigator.vibrate)
// - Semi-transparent backdrop blur for glass-pedal effect

import type { TouchState } from './touch';
import type { VehicleType } from './types/index';

// ── Button Definitions ──────────────────────────────────

interface ButtonDef {
  id: string;
  label: string;
  className: string;
  ariaLabel: string;
}

const BUTTONS: ButtonDef[] = [
  { id: 'tb-left',  label: '\u25C0', className: 'tb-btn tb-btn--left',  ariaLabel: 'Steer left' },
  { id: 'tb-right', label: '\u25B6', className: 'tb-btn tb-btn--right', ariaLabel: 'Steer right' },
  { id: 'tb-gas',   label: 'GAS',    className: 'tb-btn tb-btn--gas',   ariaLabel: 'Accelerate' },
  { id: 'tb-brake', label: 'BRAKE',  className: 'tb-btn tb-btn--brake', ariaLabel: 'Brake' },
  { id: 'tb-boost', label: 'BOOST',  className: 'tb-btn tb-btn--boost', ariaLabel: 'Boost' },
];

const CONTEXT_BTN_ID = 'tb-context';

// ── State ───────────────────────────────────────────────

const _state: TouchState = { left: false, right: false, accelerate: false, dash: false, brake: false };
let _specialActive = false;

const _buttonTouches = new Map<string, Set<number>>();

let _overlay: HTMLElement | null = null;
let _contextBtn: HTMLButtonElement | null = null;
let _initialized = false;
let _vehicleType: VehicleType = 'bike';

// ── Haptic Feedback ─────────────────────────────────────

const HAPTIC_TAP_MS = 18;

function _haptic(): void {
  try {
    if (navigator.vibrate) navigator.vibrate(HAPTIC_TAP_MS);
  } catch { /* expected: vibrate blocked or unsupported on this device */ }
}

// ── State Rebuild ───────────────────────────────────────

function _rebuildState(): void {
  _state.left = _hasTouches('tb-left');
  _state.right = _hasTouches('tb-right');
  _state.accelerate = _hasTouches('tb-gas') || _hasTouches('tb-boost');
  _state.dash = _hasTouches('tb-boost');
  _state.brake = _hasTouches('tb-brake');

  // Context button: car = drift (brake), hoverboard = hover (special)
  const ctxActive = _hasTouches(CONTEXT_BTN_ID);
  if (ctxActive) {
    if (_vehicleType === 'car') {
      _state.brake = true;
    } else if (_vehicleType === 'hoverboard') {
      _specialActive = true;
    }
  } else {
    _specialActive = false;
  }

  // Visual feedback classes
  for (const def of BUTTONS) {
    const el = document.getElementById(def.id);
    if (el) el.classList.toggle('tb-btn--active', _hasTouches(def.id));
  }
  if (_contextBtn) {
    _contextBtn.classList.toggle('tb-btn--active', ctxActive);
  }
}

function _hasTouches(btnId: string): boolean {
  const set = _buttonTouches.get(btnId);
  return set !== undefined && set.size > 0;
}

// ── Event Handlers ──────────────────────────────────────

function _onBtnTouchStart(btnId: string, e: TouchEvent): void {
  e.preventDefault();
  e.stopPropagation();
  let set = _buttonTouches.get(btnId);
  const wasEmpty = !set || set.size === 0;
  if (!set) {
    set = new Set();
    _buttonTouches.set(btnId, set);
  }
  for (let i = 0; i < e.changedTouches.length; i++) {
    set.add(e.changedTouches[i].identifier);
  }
  if (wasEmpty) _haptic();
  _rebuildState();
}

function _onBtnTouchEnd(btnId: string, e: TouchEvent): void {
  e.preventDefault();
  e.stopPropagation();
  const set = _buttonTouches.get(btnId);
  if (set) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      set.delete(e.changedTouches[i].identifier);
    }
  }
  _rebuildState();
}

// ── DOM Creation ────────────────────────────────────────

function _createOverlay(): void {
  _overlay = document.createElement('div');
  _overlay.id = 'touch-btn-overlay';
  _overlay.classList.add('hidden');
  _overlay.setAttribute('role', 'group');
  _overlay.setAttribute('aria-label', 'Touch controls');

  for (const def of BUTTONS) {
    const btn = document.createElement('button');
    btn.id = def.id;
    btn.className = def.className;
    btn.textContent = def.label;
    btn.type = 'button';
    btn.setAttribute('aria-label', def.ariaLabel);
    btn.addEventListener('touchstart', (e) => _onBtnTouchStart(def.id, e), { passive: false });
    btn.addEventListener('touchend', (e) => _onBtnTouchEnd(def.id, e), { passive: false });
    btn.addEventListener('touchcancel', (e) => _onBtnTouchEnd(def.id, e), { passive: false });
    _overlay.appendChild(btn);
  }

  // Context button (drift/hover) — hidden for bike
  _contextBtn = document.createElement('button');
  _contextBtn.id = CONTEXT_BTN_ID;
  _contextBtn.className = 'tb-btn tb-btn--context';
  _contextBtn.type = 'button';
  _updateContextButton();
  _contextBtn.addEventListener('touchstart', (e) => _onBtnTouchStart(CONTEXT_BTN_ID, e), { passive: false });
  _contextBtn.addEventListener('touchend', (e) => _onBtnTouchEnd(CONTEXT_BTN_ID, e), { passive: false });
  _contextBtn.addEventListener('touchcancel', (e) => _onBtnTouchEnd(CONTEXT_BTN_ID, e), { passive: false });
  _overlay.appendChild(_contextBtn);

  // Block unhandled touches on overlay from reaching the game canvas
  _overlay.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

  document.body.appendChild(_overlay);
}

function _updateContextButton(): void {
  if (!_contextBtn) return;
  if (_vehicleType === 'bike') {
    _contextBtn.classList.add('hidden');
    _contextBtn.setAttribute('aria-hidden', 'true');
  } else {
    _contextBtn.classList.remove('hidden');
    _contextBtn.removeAttribute('aria-hidden');
    const label = _vehicleType === 'car' ? 'DRIFT' : 'HOVER';
    _contextBtn.textContent = label;
    _contextBtn.setAttribute('aria-label', label);
    _contextBtn.classList.toggle('tb-btn--context-drift', _vehicleType === 'car');
    _contextBtn.classList.toggle('tb-btn--context-hover', _vehicleType === 'hoverboard');
  }
}

// ── Public API ──────────────────────────────────────────

// ts-prune-ignore-next
export function initTouchButtons(): void {
  if (_initialized) return;
  _initialized = true;
  _createOverlay();
}

// ts-prune-ignore-next
export function getTouchButtonState(): TouchState | null {
  if (!_initialized || !_overlay || _overlay.classList.contains('hidden')) return null;
  return _state;
}

// ts-prune-ignore-next
export function isTouchButtonSpecial(): boolean {
  return _specialActive;
}

// ts-prune-ignore-next
export function showTouchButtons(): void {
  if (_overlay) _overlay.classList.remove('hidden');
  _clearAllTouches();
  _rebuildState();
}

// ts-prune-ignore-next
export function hideTouchButtons(): void {
  if (_overlay) _overlay.classList.add('hidden');
  _clearAllTouches();
  _rebuildState();
}

export function setTouchButtonVehicle(type: VehicleType): void {
  _vehicleType = type;
  _updateContextButton();
}

function _clearAllTouches(): void {
  for (const set of _buttonTouches.values()) set.clear();
  _specialActive = false;
}

/** Reset module state for testing. */
// ts-prune-ignore-next
export function _resetForTest(): void {
  _initialized = false;
  _overlay?.remove();
  _overlay = null;
  _contextBtn = null;
  _buttonTouches.clear();
  _state.left = false;
  _state.right = false;
  _state.accelerate = false;
  _state.dash = false;
  _state.brake = false;
  _specialActive = false;
  _vehicleType = 'bike';
}
