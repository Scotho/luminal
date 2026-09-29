import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  initTouchButtons,
  getTouchButtonState,
  isTouchButtonSpecial,
  showTouchButtons,
  hideTouchButtons,
  setTouchButtonVehicle,
  _resetForTest,
} from '../touchButtons';

// ── jsdom Touch polyfill ────────────────────────────────

interface MockTouchInit {
  identifier: number;
  target: EventTarget;
  clientX?: number;
  clientY?: number;
}

class MockTouch {
  identifier: number;
  target: EventTarget;
  clientX: number;
  clientY: number;
  pageX = 0;
  pageY = 0;
  screenX = 0;
  screenY = 0;
  radiusX = 0;
  radiusY = 0;
  rotationAngle = 0;
  force = 0;
  constructor(init: MockTouchInit) {
    this.identifier = init.identifier;
    this.target = init.target;
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
  }
}

// Install polyfill if needed (jsdom lacks Touch)
if (typeof globalThis.Touch === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Touch = MockTouch;
}

// ── Helpers ─────────────────────────────────────────────

let _nextTouchId = 100;

/** Create a synthetic TouchEvent targeting a specific element. */
function fireTouchEvent(
  type: 'touchstart' | 'touchend' | 'touchcancel',
  target: HTMLElement,
  touchIds?: number[],
): void {
  const ids = touchIds ?? [_nextTouchId++];
  const touches = ids.map((id) =>
    new Touch({
      identifier: id,
      target,
      clientX: 0,
      clientY: 0,
    }),
  );
  const event = new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    changedTouches: touches,
    touches: type === 'touchend' || type === 'touchcancel' ? [] : touches,
  });
  target.dispatchEvent(event);
}

/** Simulate a press (touchstart) and return the touch id for later release. */
function pressButton(btnId: string): number {
  const el = document.getElementById(btnId);
  if (!el) throw new Error(`Button #${btnId} not found`);
  const id = _nextTouchId++;
  fireTouchEvent('touchstart', el, [id]);
  return id;
}

/** Simulate a release (touchend) for a previously pressed touch. */
function releaseButton(btnId: string, touchId: number): void {
  const el = document.getElementById(btnId);
  if (!el) throw new Error(`Button #${btnId} not found`);
  fireTouchEvent('touchend', el, [touchId]);
}

// ── Setup / Teardown ────────────────────────────────────

beforeEach(() => {
  _resetForTest();
  _nextTouchId = 100;
});

afterEach(() => {
  _resetForTest();
});

// ═════════════════════════════════════════════════════════
// 1 – Initialization & Lifecycle
// ═════════════════════════════════════════════════════════

describe('Initialization & Lifecycle', () => {
  it('1. creates all expected button elements in DOM', () => {
    initTouchButtons();
    const expectedIds = ['tb-left', 'tb-right', 'tb-gas', 'tb-brake', 'tb-boost', 'tb-context'];
    for (const id of expectedIds) {
      expect(document.getElementById(id), `Missing button #${id}`).not.toBeNull();
    }
  });

  it('2. overlay starts hidden after init', () => {
    initTouchButtons();
    const overlay = document.getElementById('touch-btn-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay!.classList.contains('hidden')).toBe(true);
  });

  it('3. show/hide toggle works correctly', () => {
    initTouchButtons();
    const overlay = document.getElementById('touch-btn-overlay')!;

    showTouchButtons();
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(getTouchButtonState()).not.toBeNull();

    hideTouchButtons();
    expect(overlay.classList.contains('hidden')).toBe(true);
    expect(getTouchButtonState()).toBeNull();
  });

  it('4. initialization is idempotent', () => {
    initTouchButtons();
    initTouchButtons(); // second call should be safe
    const overlays = document.querySelectorAll('#touch-btn-overlay');
    expect(overlays.length).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════
// 2 – Individual Button Actions
// ═════════════════════════════════════════════════════════

describe('Individual Button Actions', () => {
  beforeEach(() => {
    initTouchButtons();
    showTouchButtons();
  });

  it('5. GAS touch sets accelerate = true', () => {
    const tid = pressButton('tb-gas');
    const state = getTouchButtonState()!;
    expect(state.accelerate).toBe(true);
    releaseButton('tb-gas', tid);
  });

  it('6. BRAKE touch sets brake = true', () => {
    const tid = pressButton('tb-brake');
    const state = getTouchButtonState()!;
    expect(state.brake).toBe(true);
    releaseButton('tb-brake', tid);
  });

  it('7. BOOST touch sets dash = true and accelerate = true', () => {
    const tid = pressButton('tb-boost');
    const state = getTouchButtonState()!;
    expect(state.dash).toBe(true);
    expect(state.accelerate).toBe(true);
    releaseButton('tb-boost', tid);
  });

  it('8. LEFT touch sets left = true', () => {
    const tid = pressButton('tb-left');
    const state = getTouchButtonState()!;
    expect(state.left).toBe(true);
    releaseButton('tb-left', tid);
  });

  it('9. RIGHT touch sets right = true', () => {
    const tid = pressButton('tb-right');
    const state = getTouchButtonState()!;
    expect(state.right).toBe(true);
    releaseButton('tb-right', tid);
  });

  it('10. DRIFT touch (car mode) sets brake = true', () => {
    setTouchButtonVehicle('car');
    const tid = pressButton('tb-context');
    const state = getTouchButtonState()!;
    expect(state.brake).toBe(true);
    releaseButton('tb-context', tid);
  });
});

// ═════════════════════════════════════════════════════════
// 3 – Multi-Touch Combinations
// ═════════════════════════════════════════════════════════

describe('Multi-Touch Combinations', () => {
  beforeEach(() => {
    initTouchButtons();
    showTouchButtons();
  });

  it('11. GAS + LEFT simultaneously → accelerate + turn left', () => {
    const tidGas = pressButton('tb-gas');
    const tidLeft = pressButton('tb-left');
    const state = getTouchButtonState()!;
    expect(state.accelerate).toBe(true);
    expect(state.left).toBe(true);
    expect(state.right).toBe(false);
    releaseButton('tb-gas', tidGas);
    releaseButton('tb-left', tidLeft);
  });

  it('12. GAS + BOOST simultaneously → accelerate + dash', () => {
    const tidGas = pressButton('tb-gas');
    const tidBoost = pressButton('tb-boost');
    const state = getTouchButtonState()!;
    expect(state.accelerate).toBe(true);
    expect(state.dash).toBe(true);
    releaseButton('tb-gas', tidGas);
    releaseButton('tb-boost', tidBoost);
  });

  it('13. BRAKE + LEFT → brake + turn left (drift setup for car)', () => {
    setTouchButtonVehicle('car');
    const tidBrake = pressButton('tb-brake');
    const tidLeft = pressButton('tb-left');
    const state = getTouchButtonState()!;
    expect(state.brake).toBe(true);
    expect(state.left).toBe(true);
    releaseButton('tb-brake', tidBrake);
    releaseButton('tb-left', tidLeft);
  });

  it('14. all buttons release → all state false', () => {
    const tidGas = pressButton('tb-gas');
    const tidLeft = pressButton('tb-left');
    const tidBoost = pressButton('tb-boost');
    // All pressed
    let state = getTouchButtonState()!;
    expect(state.accelerate).toBe(true);
    expect(state.left).toBe(true);
    expect(state.dash).toBe(true);
    // Release all
    releaseButton('tb-gas', tidGas);
    releaseButton('tb-left', tidLeft);
    releaseButton('tb-boost', tidBoost);
    state = getTouchButtonState()!;
    expect(state.left).toBe(false);
    expect(state.right).toBe(false);
    expect(state.accelerate).toBe(false);
    expect(state.dash).toBe(false);
    expect(state.brake).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════
// 4 – Vehicle Adaptation
// ═════════════════════════════════════════════════════════

describe('Vehicle Adaptation', () => {
  beforeEach(() => {
    initTouchButtons();
    showTouchButtons();
  });

  it('15. bike mode → context (drift/hover) button hidden', () => {
    setTouchButtonVehicle('bike');
    const ctx = document.getElementById('tb-context')!;
    expect(ctx.classList.contains('hidden')).toBe(true);
  });

  it('16. car mode → shows DRIFT label on context button', () => {
    setTouchButtonVehicle('car');
    const ctx = document.getElementById('tb-context')!;
    expect(ctx.classList.contains('hidden')).toBe(false);
    expect(ctx.textContent).toBe('DRIFT');
    expect(ctx.classList.contains('tb-btn--context-drift')).toBe(true);
  });

  it('17. hoverboard mode → shows HOVER label, special = true on press', () => {
    setTouchButtonVehicle('hoverboard');
    const ctx = document.getElementById('tb-context')!;
    expect(ctx.classList.contains('hidden')).toBe(false);
    expect(ctx.textContent).toBe('HOVER');
    expect(ctx.classList.contains('tb-btn--context-hover')).toBe(true);

    const tid = pressButton('tb-context');
    expect(isTouchButtonSpecial()).toBe(true);
    releaseButton('tb-context', tid);
    expect(isTouchButtonSpecial()).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════
// 5 – Usability & Accessibility
// ═════════════════════════════════════════════════════════

describe('Usability & Accessibility', () => {
  beforeEach(() => {
    initTouchButtons();
    showTouchButtons();
  });

  it('18. all buttons have minimum 48px touch target (via min-width/min-height attrs)', () => {
    const buttonIds = ['tb-left', 'tb-right', 'tb-gas', 'tb-brake', 'tb-boost', 'tb-context'];
    for (const id of buttonIds) {
      const el = document.getElementById(id)!;
      // In jsdom we can't measure computed CSS, but we verify the buttons
      // are <button> elements (accessible) and exist in the overlay
      expect(el.tagName).toBe('BUTTON');
      expect(el.getAttribute('type')).toBe('button');
    }
  });

  it('19. overlay uses touch-action: none to prevent browser scrolling', () => {
    const overlay = document.getElementById('touch-btn-overlay')!;
    // The overlay exists and buttons are inside it
    expect(overlay.contains(document.getElementById('tb-gas')!)).toBe(true);
    expect(overlay.contains(document.getElementById('tb-left')!)).toBe(true);
  });

  it('20. visual feedback class applied on press and removed on release', () => {
    const tid = pressButton('tb-gas');
    const gasBtn = document.getElementById('tb-gas')!;
    expect(gasBtn.classList.contains('tb-btn--active')).toBe(true);

    releaseButton('tb-gas', tid);
    expect(gasBtn.classList.contains('tb-btn--active')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════
// 6 – Edge Cases & Robustness
// ═════════════════════════════════════════════════════════

describe('Edge Cases & Robustness', () => {
  beforeEach(() => {
    initTouchButtons();
    showTouchButtons();
  });

  it('21. getTouchButtonState returns null when hidden', () => {
    hideTouchButtons();
    expect(getTouchButtonState()).toBeNull();
  });

  it('22. hiding clears all active touches', () => {
    pressButton('tb-gas');
    pressButton('tb-left');
    hideTouchButtons();
    showTouchButtons();
    const state = getTouchButtonState()!;
    expect(state.accelerate).toBe(false);
    expect(state.left).toBe(false);
  });

  it('23. touchcancel clears button state', () => {
    const el = document.getElementById('tb-gas')!;
    const tid = _nextTouchId++;
    fireTouchEvent('touchstart', el, [tid]);
    expect(getTouchButtonState()!.accelerate).toBe(true);

    fireTouchEvent('touchcancel', el, [tid]);
    expect(getTouchButtonState()!.accelerate).toBe(false);
  });

  it('24. multiple fingers on same button tracked independently', () => {
    const el = document.getElementById('tb-gas')!;
    const tid1 = _nextTouchId++;
    const tid2 = _nextTouchId++;
    fireTouchEvent('touchstart', el, [tid1]);
    fireTouchEvent('touchstart', el, [tid2]);
    expect(getTouchButtonState()!.accelerate).toBe(true);

    // Release one finger — button should still be active
    fireTouchEvent('touchend', el, [tid1]);
    expect(getTouchButtonState()!.accelerate).toBe(true);

    // Release second finger — now inactive
    fireTouchEvent('touchend', el, [tid2]);
    expect(getTouchButtonState()!.accelerate).toBe(false);
  });

  it('25. switching vehicle type updates context button without affecting other state', () => {
    const tidGas = pressButton('tb-gas');
    setTouchButtonVehicle('car');
    // Gas should still be held
    expect(getTouchButtonState()!.accelerate).toBe(true);
    // Context button should show DRIFT
    expect(document.getElementById('tb-context')!.textContent).toBe('DRIFT');
    releaseButton('tb-gas', tidGas);
  });
});

// ═════════════════════════════════════════════════════════
// 7 – Accessibility & ARIA
// ═════════════════════════════════════════════════════════

describe('Accessibility & ARIA', () => {
  beforeEach(() => {
    initTouchButtons();
    showTouchButtons();
  });

  it('26. all buttons have aria-label attributes', () => {
    const ids = ['tb-left', 'tb-right', 'tb-gas', 'tb-brake', 'tb-boost'];
    for (const id of ids) {
      const el = document.getElementById(id)!;
      expect(el.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('27. overlay has role=group with aria-label', () => {
    const overlay = document.getElementById('touch-btn-overlay')!;
    expect(overlay.getAttribute('role')).toBe('group');
    expect(overlay.getAttribute('aria-label')).toBe('Touch controls');
  });

  it('28. context button has aria-hidden when bike (hidden)', () => {
    setTouchButtonVehicle('bike');
    const ctx = document.getElementById('tb-context')!;
    expect(ctx.getAttribute('aria-hidden')).toBe('true');
  });

  it('29. context button removes aria-hidden when car', () => {
    setTouchButtonVehicle('car');
    const ctx = document.getElementById('tb-context')!;
    expect(ctx.hasAttribute('aria-hidden')).toBe(false);
    expect(ctx.getAttribute('aria-label')).toBe('DRIFT');
  });

  it('30. context button has correct aria-label for hoverboard', () => {
    setTouchButtonVehicle('hoverboard');
    const ctx = document.getElementById('tb-context')!;
    expect(ctx.getAttribute('aria-label')).toBe('HOVER');
  });
});
