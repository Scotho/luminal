// ── DragScroll Tests ────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDragScroll, initElasticScroll, revealScrollItem } from '../dragScroll';

// ── Helpers ─────────────────────────────────────────────

/** Create a fake scrollable container with measurable dimensions. */
function makeScrollContainer(scrollWidth = 1000, clientWidth = 300): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scrollWidth, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientWidth, configurable: true });
  // setPointerCapture / releasePointerCapture stubs
  el.setPointerCapture = vi.fn();
  el.releasePointerCapture = vi.fn();
  return el;
}

function pointerEvent(type: string, opts: Partial<PointerEventInit & { pointerId: number }> = {}): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    button: 0,
    pointerId: opts.pointerId ?? 1,
    pointerType: opts.pointerType ?? 'mouse',
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    ...opts,
  });
}

// ── initDragScroll ──────────────────────────────────────

describe('initDragScroll', () => {
  let el: HTMLDivElement;
  let cleanup: () => void;

  beforeEach(() => {
    el = makeScrollContainer();
    cleanup = initDragScroll(el);
  });

  afterEach(() => {
    cleanup();
    el.remove();
  });

  it('returns a cleanup function', () => {
    expect(typeof cleanup).toBe('function');
  });

  it('adds drag-scroll class to element', () => {
    expect(el.classList.contains('drag-scroll')).toBe(true);
  });

  it('pointer down + move beyond threshold adds drag-scrolling class', () => {
    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 100 }));
    // Move past 8px threshold
    el.dispatchEvent(pointerEvent('pointermove', { clientX: 120 }));

    expect(el.classList.contains('drag-scrolling')).toBe(true);
  });

  it('pointer down + small move does not trigger drag', () => {
    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 100 }));
    // Move only 3px — below 8px threshold
    el.dispatchEvent(pointerEvent('pointermove', { clientX: 103 }));

    expect(el.classList.contains('drag-scrolling')).toBe(false);
  });

  it('sets scrollLeft based on drag distance', () => {
    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 200 }));
    // Drag left by 50px (move mouse right → scrollLeft decreases, move left → scrollLeft increases)
    el.dispatchEvent(pointerEvent('pointermove', { clientX: 150 }));

    // scrollLeft starts at 0, drag of -50 means scrollStart - dx = 0 - (-50) = 50
    expect(el.scrollLeft).toBe(50);
  });

  it('clamps scrollLeft to max scroll range', () => {
    // scrollWidth=1000, clientWidth=300 → max=700
    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 0 }));
    // Drag far left → desiredScroll = 0 - (-900) = 900, clamped to 700
    el.dispatchEvent(pointerEvent('pointermove', { clientX: -900 }));

    expect(el.scrollLeft).toBe(700);
  });

  it('pointer up removes drag-scrolling class', () => {
    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, pointerId: 5 }));
    el.dispatchEvent(pointerEvent('pointermove', { clientX: 120, pointerId: 5 }));
    expect(el.classList.contains('drag-scrolling')).toBe(true);

    el.dispatchEvent(pointerEvent('pointerup', { pointerId: 5 }));
    expect(el.classList.contains('drag-scrolling')).toBe(false);
  });

  it('captures pointer on real drag start', () => {
    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, pointerId: 7 }));
    el.dispatchEvent(pointerEvent('pointermove', { clientX: 120, pointerId: 7 }));

    expect(el.setPointerCapture).toHaveBeenCalledWith(7);
  });

  it('releases pointer capture on pointer up', () => {
    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, pointerId: 7 }));
    el.dispatchEvent(pointerEvent('pointermove', { clientX: 120, pointerId: 7 }));
    el.dispatchEvent(pointerEvent('pointerup', { pointerId: 7 }));

    expect(el.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it('ignores touch pointer type', () => {
    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, pointerType: 'touch' }));
    el.dispatchEvent(pointerEvent('pointermove', { clientX: 150, pointerType: 'touch' }));

    expect(el.classList.contains('drag-scrolling')).toBe(false);
    expect(el.scrollLeft).toBe(0);
  });

  it('ignores non-primary button', () => {
    el.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 2, pointerType: 'mouse', clientX: 100,
    }));
    el.dispatchEvent(pointerEvent('pointermove', { clientX: 150 }));

    expect(el.classList.contains('drag-scrolling')).toBe(false);
  });

  it('suppresses click after drag', () => {
    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, pointerId: 1 }));
    el.dispatchEvent(pointerEvent('pointermove', { clientX: 130, pointerId: 1 }));

    const clickHandler = vi.fn();
    el.addEventListener('click', clickHandler);

    const clickEvent = new MouseEvent('click', { bubbles: true });
    el.dispatchEvent(clickEvent);

    // The capture handler should have stopped propagation
    expect(clickHandler).not.toHaveBeenCalled();
  });

  it('cleanup removes drag-scroll class', () => {
    cleanup();
    expect(el.classList.contains('drag-scroll')).toBe(false);
  });

  it('cleanup prevents further dragging', () => {
    cleanup();
    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 100 }));
    el.dispatchEvent(pointerEvent('pointermove', { clientX: 150 }));
    expect(el.classList.contains('drag-scrolling')).toBe(false);
    expect(el.scrollLeft).toBe(0);
  });

  it('pointercancel ends drag', () => {
    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, pointerId: 1 }));
    el.dispatchEvent(pointerEvent('pointermove', { clientX: 120, pointerId: 1 }));
    expect(el.classList.contains('drag-scrolling')).toBe(true);

    el.dispatchEvent(pointerEvent('pointercancel', { pointerId: 1 }));
    expect(el.classList.contains('drag-scrolling')).toBe(false);
  });
});

// ── initElasticScroll ───────────────────────────────────

describe('initElasticScroll', () => {
  let el: HTMLDivElement;
  let cleanup: () => void;

  beforeEach(() => {
    el = makeScrollContainer(1000, 300);
    cleanup = initElasticScroll(el);
  });

  afterEach(() => {
    cleanup();
    el.remove();
  });

  it('returns a cleanup function', () => {
    expect(typeof cleanup).toBe('function');
  });

  it('adds wheel listener to element', () => {
    const spy = vi.spyOn(el, 'removeEventListener');
    cleanup();
    // After cleanup, removeEventListener should have been called for 'wheel'
    const wheelCalls = spy.mock.calls.filter(([type]) => type === 'wheel');
    expect(wheelCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('applies elastic offset on overscroll (wheel at start, scrolling left)', () => {
    // scrollLeft is 0 (at start), scroll delta is negative (scroll further left — overscroll)
    Object.defineProperty(el, 'scrollLeft', { value: 0, writable: true, configurable: true });

    const wheelEvent = new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaX: -50, deltaY: 0,
    });
    el.dispatchEvent(wheelEvent);

    // The elastic controller should have applied a translate offset
    // (We can't easily inspect the translate directly, but the wheel handler
    // calls preventDefault when overscrolling)
    expect(wheelEvent.defaultPrevented).toBe(true);
  });

  it('does not prevent default when not at scroll edge', () => {
    // scrollLeft in the middle — no overscroll
    Object.defineProperty(el, 'scrollLeft', { value: 200, writable: true, configurable: true });

    const wheelEvent = new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaX: -10, deltaY: 0,
    });
    el.dispatchEvent(wheelEvent);

    expect(wheelEvent.defaultPrevented).toBe(false);
  });

  it('handles y-axis elastic scroll', () => {
    const elY = makeScrollContainer(300, 300);
    Object.defineProperty(elY, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(elY, 'clientHeight', { value: 300, configurable: true });
    Object.defineProperty(elY, 'scrollTop', { value: 0, writable: true, configurable: true });
    Object.defineProperty(elY, 'scrollWidth', { value: 300, configurable: true });

    const cleanupY = initElasticScroll(elY, { axis: 'y' });

    const wheelEvent = new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaX: 0, deltaY: -30,
    });
    elY.dispatchEvent(wheelEvent);

    expect(wheelEvent.defaultPrevented).toBe(true);

    cleanupY();
    elY.remove();
  });

  it('cleanup removes listeners without error', () => {
    expect(() => cleanup()).not.toThrow();
  });
});

// ── revealScrollItem ────────────────────────────────────

describe('revealScrollItem', () => {
  let container: HTMLDivElement;
  let item: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    item = document.createElement('div');
    document.body.appendChild(container);
    container.appendChild(item);

    // Mock scrollTo
    container.scrollTo = vi.fn();
  });

  afterEach(() => {
    container.remove();
  });

  it('scrolls left when item is before viewport (x-axis)', () => {
    Object.defineProperty(container, 'scrollLeft', { value: 200, configurable: true });
    Object.defineProperty(container, 'clientWidth', { value: 300, configurable: true });
    Object.defineProperty(item, 'offsetLeft', { value: 100, configurable: true });
    Object.defineProperty(item, 'offsetWidth', { value: 50, configurable: true });

    revealScrollItem(container, item, 'x');

    expect(container.scrollTo).toHaveBeenCalledWith({ left: 100, behavior: 'smooth' });
  });

  it('scrolls right when item is after viewport (x-axis)', () => {
    Object.defineProperty(container, 'scrollLeft', { value: 0, configurable: true });
    Object.defineProperty(container, 'clientWidth', { value: 300, configurable: true });
    Object.defineProperty(item, 'offsetLeft', { value: 400, configurable: true });
    Object.defineProperty(item, 'offsetWidth', { value: 100, configurable: true });

    revealScrollItem(container, item, 'x');

    // itemEnd=500 > viewEnd=300 → scrollTo left = 500 - 300 = 200
    expect(container.scrollTo).toHaveBeenCalledWith({ left: 200, behavior: 'smooth' });
  });

  it('does not scroll when item is already visible (x-axis)', () => {
    Object.defineProperty(container, 'scrollLeft', { value: 100, configurable: true });
    Object.defineProperty(container, 'clientWidth', { value: 300, configurable: true });
    Object.defineProperty(item, 'offsetLeft', { value: 150, configurable: true });
    Object.defineProperty(item, 'offsetWidth', { value: 50, configurable: true });

    revealScrollItem(container, item, 'x');

    expect(container.scrollTo).not.toHaveBeenCalled();
  });

  it('scrolls up when item is above viewport (y-axis)', () => {
    Object.defineProperty(container, 'scrollTop', { value: 200, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 300, configurable: true });
    Object.defineProperty(item, 'offsetTop', { value: 100, configurable: true });
    Object.defineProperty(item, 'offsetHeight', { value: 50, configurable: true });

    revealScrollItem(container, item, 'y');

    expect(container.scrollTo).toHaveBeenCalledWith({ top: 100, behavior: 'smooth' });
  });

  it('scrolls down when item is below viewport (y-axis)', () => {
    Object.defineProperty(container, 'scrollTop', { value: 0, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(item, 'offsetTop', { value: 300, configurable: true });
    Object.defineProperty(item, 'offsetHeight', { value: 80, configurable: true });

    revealScrollItem(container, item, 'y');

    // itemEnd=380 > viewEnd=200 → scrollTo top = 380 - 200 = 180
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 180, behavior: 'smooth' });
  });

  it('respects behavior parameter', () => {
    Object.defineProperty(container, 'scrollLeft', { value: 500, configurable: true });
    Object.defineProperty(container, 'clientWidth', { value: 300, configurable: true });
    Object.defineProperty(item, 'offsetLeft', { value: 100, configurable: true });
    Object.defineProperty(item, 'offsetWidth', { value: 50, configurable: true });

    revealScrollItem(container, item, 'x', 'instant');

    expect(container.scrollTo).toHaveBeenCalledWith({ left: 100, behavior: 'instant' });
  });

  it('defaults to x-axis and smooth behavior', () => {
    Object.defineProperty(container, 'scrollLeft', { value: 500, configurable: true });
    Object.defineProperty(container, 'clientWidth', { value: 300, configurable: true });
    Object.defineProperty(item, 'offsetLeft', { value: 100, configurable: true });
    Object.defineProperty(item, 'offsetWidth', { value: 50, configurable: true });

    revealScrollItem(container, item);

    expect(container.scrollTo).toHaveBeenCalledWith({ left: 100, behavior: 'smooth' });
  });
});
