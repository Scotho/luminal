// ── Touch Input ──────────────────────────────────────────
// Two-zone (50/50 left/right) multitouch with vertical slide gestures
// for throttle/brake and dual-tap timing for boost detection.
// Vehicle-aware: car mode changes two-finger behavior to support
// drift + counter-steer instead of boost.

import type { VehicleType } from './types/index';

export interface TouchState {
  left: boolean;
  right: boolean;
  accelerate: boolean;
  dash: boolean;
  brake: boolean;
}

// ── Tunable Constants ────────────────────────────────────
const DUAL_TAP_WINDOW_MS = 100;
const ACCEL_THRESHOLD  = 0.04;   // 4% of screen height
const BOOST_THRESHOLD  = 0.12;   // 12% of screen height
const BRAKE_THRESHOLD  = 0.04;   // 4% of screen height
const HARD_BRAKE_THRESHOLD = 0.12; // 12% of screen height

// ── Per-Touch Tracking ───────────────────────────────────

interface TrackedTouch {
  side: 'left' | 'right';  // locked at touch start
  startY: number;
  startTime: number;
  currentY: number;
}

const _state: TouchState = { left: false, right: false, accelerate: false, dash: false, brake: false };
const _touches = new Map<number, TrackedTouch>();
let _firstTouchSide: 'left' | 'right' | null = null;

let _overlay: HTMLElement | null = null;
let _glowLeft: HTMLElement | null = null;
let _glowRight: HTMLElement | null = null;
let _driftLabel: HTMLElement | null = null;
let _initialized = false;

// ── Vehicle Awareness ────────────────────────────────────
let _vehicleType: VehicleType = 'bike';
let _drifting = false; // fed from game state for visual feedback

// ── Helpers ──────────────────────────────────────────────

function _classifySide(t: Touch): 'left' | 'right' {
  return t.clientX < window.innerWidth * 0.5 ? 'left' : 'right';
}

function _rebuildState(): void {
  const screenH = window.innerHeight;

  // Collect raw side presence + vertical slide signals
  let hasLeft = false;
  let hasRight = false;
  let wantAccel = false;
  let wantDash = false;
  let wantBrake = false;

  for (const t of _touches.values()) {
    if (t.side === 'left') hasLeft = true;
    if (t.side === 'right') hasRight = true;

    const deltaY = t.startY - t.currentY; // positive = finger moved UP
    if (deltaY >= BOOST_THRESHOLD * screenH) {
      wantDash = true;
    } else if (deltaY >= ACCEL_THRESHOLD * screenH) {
      wantAccel = true;
    } else if (deltaY <= -HARD_BRAKE_THRESHOLD * screenH) {
      wantBrake = true;
    } else if (deltaY <= -BRAKE_THRESHOLD * screenH) {
      wantBrake = true;
    }
  }

  // -- Dual-tap / boost-while-turning detection --
  let dualTapBoost = false;
  let boostWhileTurning = false;

  // Car drift detection: is any finger in brake position (slid down)?
  let hasBrakingTouch = false;
  let carDriftCounterSteer = false;
  if (_vehicleType === 'car') {
    for (const t of _touches.values()) {
      const dy = t.startY - t.currentY;
      if (dy <= -BRAKE_THRESHOLD * screenH) {
        hasBrakingTouch = true;
        break;
      }
    }
  }

  if (_touches.size >= 2 && hasLeft && hasRight) {
    if (_vehicleType === 'car' && hasBrakingTouch) {
      // ── Car drift + counter-steer ──
      // One finger is braking (sustaining drift), the other steers.
      // Do NOT activate boost — this is drift control.
      carDriftCounterSteer = true;
    } else {
      // ── Normal boost detection (bike, or car without brake held) ──
      const times: number[] = [];
      for (const t of _touches.values()) times.push(t.startTime);
      const minT = Math.min(...times);
      const maxT = Math.max(...times);
      if (maxT - minT <= DUAL_TAP_WINDOW_MS) {
        dualTapBoost = true;
      } else {
        boostWhileTurning = true;
      }
    }
  }

  // -- Steering --
  if (dualTapBoost || boostWhileTurning) {
    // Both sides held: boost straight, suppress turning
    _state.left = false;
    _state.right = false;
  } else if (carDriftCounterSteer) {
    // Car drift: the non-braking finger determines turn direction.
    // Find which side the non-braking finger is on.
    let steerSide: 'left' | 'right' | null = null;
    for (const t of _touches.values()) {
      const dy = t.startY - t.currentY;
      if (dy > -BRAKE_THRESHOLD * screenH) {
        // This finger is NOT braking — it's the steering finger
        steerSide = t.side;
        break;
      }
    }
    if (steerSide) {
      _state.left = steerSide === 'left';
      _state.right = steerSide === 'right';
    } else {
      // Both fingers braking — keep original sides
      _state.left = hasLeft;
      _state.right = hasRight;
    }
  } else {
    _state.left = hasLeft;
    _state.right = hasRight;
  }

  // -- Speed modifiers --
  _state.dash = wantDash || dualTapBoost || boostWhileTurning;
  _state.accelerate = wantAccel || _state.dash;
  _state.brake = wantBrake && !_state.dash;

  // -- Visual feedback --
  _updateOverlayVisuals();
}

function _updateOverlayVisuals(): void {
  const isDriftActive = _vehicleType === 'car' && _drifting;
  if (_glowLeft) {
    _glowLeft.classList.toggle('touch-glow--active', !isDriftActive && (_state.left || (_state.dash && _firstTouchSide === 'left')));
    _glowLeft.classList.toggle('touch-glow--drift', isDriftActive && _state.left);
  }
  if (_glowRight) {
    _glowRight.classList.toggle('touch-glow--active', !isDriftActive && (_state.right || (_state.dash && _firstTouchSide === 'right')));
    _glowRight.classList.toggle('touch-glow--drift', isDriftActive && _state.right);
  }
  if (_overlay) {
    _overlay.classList.toggle('touch-accel', _state.accelerate && !_state.dash && !_state.brake);
    _overlay.classList.toggle('touch-boost', _state.dash);
    _overlay.classList.toggle('touch-brake', _state.brake && !isDriftActive);
    _overlay.classList.toggle('touch-drift', isDriftActive);
  }
  if (_driftLabel) {
    _driftLabel.classList.toggle('touch-drift-label--active', isDriftActive);
  }
}

// ── Event Handlers ───────────────────────────────────────

function _onTouchStart(e: TouchEvent): void {
  e.preventDefault();
  if (document.activeElement?.tagName === 'INPUT') return;
  const now = performance.now();

  for (let i = 0; i < e.changedTouches.length; i++) {
    const t = e.changedTouches[i];
    const side = _classifySide(t);
    _touches.set(t.identifier, {
      side,
      startY: t.clientY,
      startTime: now,
      currentY: t.clientY,
    });

    // Track first touch for dual-tap window + boost-while-turning direction
    if (_firstTouchSide === null) {
      _firstTouchSide = side;
    }
  }

  // Schedule re-derive after dual-tap window expires
  // so gesture transitions from potential-dual-tap to held
  setTimeout(() => {
    if (_touches.size > 0) _rebuildState();
  }, DUAL_TAP_WINDOW_MS + 1);

  _rebuildState();
}

function _onTouchMove(e: TouchEvent): void {
  e.preventDefault();
  if (document.activeElement?.tagName === 'INPUT') return;
  for (let i = 0; i < e.changedTouches.length; i++) {
    const t = e.changedTouches[i];
    const tracked = _touches.get(t.identifier);
    if (tracked) {
      tracked.currentY = t.clientY;
      // Side stays locked — no reclassification on move
    }
  }
  _rebuildState();
}

function _onTouchEnd(e: TouchEvent): void {
  e.preventDefault();
  for (let i = 0; i < e.changedTouches.length; i++) {
    _touches.delete(e.changedTouches[i].identifier);
  }
  if (_touches.size === 0) {
    _firstTouchSide = null;
  } else {
    // Update _firstTouchSide to the remaining touch so glow tracks correctly
    const remaining = _touches.values().next().value as TrackedTouch;
    _firstTouchSide = remaining.side;
  }
  _rebuildState();
}

// ── DOM Creation ─────────────────────────────────────────

function _createOverlay(): void {
  _overlay = document.createElement('div');
  _overlay.id = 'touch-overlay';
  _overlay.classList.add('hidden');

  // Edge glow indicators (left/right only, no center)
  _glowLeft = document.createElement('div');
  _glowLeft.className = 'touch-glow touch-glow--left';
  _overlay.appendChild(_glowLeft);

  _glowRight = document.createElement('div');
  _glowRight.className = 'touch-glow touch-glow--right';
  _overlay.appendChild(_glowRight);

  // Zone labels (positioned beside boost bar at bottom)
  const lblLeft = document.createElement('div');
  lblLeft.className = 'touch-zone-label touch-zone-label--left';
  lblLeft.textContent = 'LEFT';
  _overlay.appendChild(lblLeft);

  const lblRight = document.createElement('div');
  lblRight.className = 'touch-zone-label touch-zone-label--right';
  lblRight.textContent = 'RIGHT';
  _overlay.appendChild(lblRight);

  // Slide hint (right side, vertically centered) with gesture animation
  const slideWrap = document.createElement('div');
  slideWrap.className = 'touch-slide-wrap';
  slideWrap.id = 'touch-slide-wrap';

  const slideAnim = document.createElement('div');
  slideAnim.className = 'touch-slide-anim';
  slideAnim.id = 'touch-slide-anim';
  // Finger dot + trail
  const dot = document.createElement('div');
  dot.className = 'touch-slide-dot';
  slideAnim.appendChild(dot);
  slideWrap.appendChild(slideAnim);

  const slideHint = document.createElement('div');
  slideHint.className = 'touch-slide-hint';
  slideHint.id = 'touch-slide-hint';
  slideHint.textContent = _vehicleType === 'car' ? 'DRIFT' : 'SLIDE';
  slideWrap.appendChild(slideHint);

  _overlay.appendChild(slideWrap);

  // Drift label (car only — shown when actively drifting)
  _driftLabel = document.createElement('div');
  _driftLabel.className = 'touch-drift-label';
  _driftLabel.textContent = 'DRIFT';
  _overlay.appendChild(_driftLabel);

  document.body.appendChild(_overlay);

  // Register touch events on overlay
  _overlay.addEventListener('touchstart', _onTouchStart, { passive: false });
  _overlay.addEventListener('touchmove', _onTouchMove, { passive: false });
  _overlay.addEventListener('touchend', _onTouchEnd, { passive: false });
  _overlay.addEventListener('touchcancel', _onTouchEnd, { passive: false });
}

// ── Public API ───────────────────────────────────────────

export function initTouch(): void {
  if (_initialized) return;
  _initialized = true;
  _createOverlay();
}

export function getTouchState(): TouchState | null {
  if (!_initialized || !_overlay || _overlay.classList.contains('hidden')) return null;
  return _state;
}

export function showTouchControls(): void {
  if (_overlay) _overlay.classList.remove('hidden');
  // Clear stale state from previous session
  _touches.clear();
  _firstTouchSide = null;
  _rebuildState();
}

export function hideTouchControls(): void {
  if (_overlay) _overlay.classList.add('hidden');
  hideSlideHint();
  // Clear all active touches when hiding
  _touches.clear();
  _firstTouchSide = null;
  _drifting = false;
  _rebuildState();
}

/** Set the active vehicle type — changes two-finger gesture interpretation for car. */
export function setTouchVehicle(type: VehicleType): void {
  _vehicleType = type;
  const hint = document.getElementById('touch-slide-hint');
  if (hint) hint.textContent = type === 'car' ? 'DRIFT' : 'SLIDE';
}

/** Feed game drift state for visual feedback. */
export function setTouchDrifting(drifting: boolean): void {
  if (_drifting !== drifting) {
    _drifting = drifting;
    _updateOverlayVisuals();
  }
}

/** Show slide hint + play the two-cycle slide-down animation during countdown. */
export function showSlideHint(): void {
  const wrap = document.getElementById('touch-slide-wrap');
  if (!wrap) return;
  wrap.classList.add('touch-slide-wrap--visible');
  // Trigger the animation: 1.5s play, reset, 1.5s play = 3s total
  const anim = document.getElementById('touch-slide-anim');
  if (anim) {
    anim.classList.remove('touch-slide-anim--play');
    void anim.offsetWidth; // force reflow
    anim.classList.add('touch-slide-anim--play');
  }
}

/** Hide slide hint + animation (call when match starts). */
export function hideSlideHint(): void {
  const wrap = document.getElementById('touch-slide-wrap');
  if (!wrap) return;
  wrap.classList.remove('touch-slide-wrap--visible');
  const anim = document.getElementById('touch-slide-anim');
  if (anim) anim.classList.remove('touch-slide-anim--play');
}
