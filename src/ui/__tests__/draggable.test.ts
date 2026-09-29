// ── Draggable Tests ─────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeDraggable, DraggableResult } from '../draggable';

// ── Helpers ─────────────────────────────────────────────

function makeEl(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.position = 'absolute';
  el.style.left = '100px';
  el.style.top = '100px';
  document.body.appendChild(el);
  // getBoundingClientRect stub
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: 100, top: 100, right: 200, bottom: 200,
    width: 100, height: 100, x: 100, y: 100, toJSON: () => {},
  });
  Object.defineProperty(el, 'offsetWidth', { value: 100, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: 100, configurable: true });
  return el;
}

function makeHandle(parent: HTMLElement): HTMLDivElement {
  const handle = document.createElement('div');
  handle.className = 'drag-handle';
  parent.appendChild(handle);
  return handle;
}

function mouseEvent(type: string, opts: Partial<MouseEventInit> = {}): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    button: opts.button ?? 0,
    ...opts,
  });
}

// ── Tests ───────────────────────────────────────────────

describe('makeDraggable', () => {
  let el: HTMLDivElement;
  let handle: HTMLDivElement;
  let result: DraggableResult;

  beforeEach(() => {
    localStorage.clear();
    // Mock window dimensions
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
    el = makeEl();
    handle = makeHandle(el);
  });

  afterEach(() => {
    el.remove();
  });

  it('returns a DraggableResult with isDragging method', () => {
    result = makeDraggable(el, handle);
    expect(typeof result.isDragging).toBe('function');
    expect(result.isDragging()).toBe(false);
  });

  it('sets isDragging to true on mousedown', () => {
    result = makeDraggable(el, handle);
    handle.dispatchEvent(mouseEvent('mousedown', { clientX: 150, clientY: 150 }));
    expect(result.isDragging()).toBe(true);
  });

  it('sets isDragging to false on mouseup', () => {
    result = makeDraggable(el, handle);
    handle.dispatchEvent(mouseEvent('mousedown', { clientX: 150, clientY: 150 }));
    expect(result.isDragging()).toBe(true);

    window.dispatchEvent(mouseEvent('mouseup'));
    expect(result.isDragging()).toBe(false);
  });

  it('moves element on mousemove during drag', () => {
    result = makeDraggable(el, handle);
    handle.dispatchEvent(mouseEvent('mousedown', { clientX: 150, clientY: 150 }));

    window.dispatchEvent(mouseEvent('mousemove', { clientX: 200, clientY: 200 }));

    // Element should have moved. curX = clientX - oX = 200 - (150-100) = 150
    expect(el.style.left).toBe('150px');
    expect(el.style.top).toBe('150px');
  });

  it('does not move element when not dragging', () => {
    result = makeDraggable(el, handle);
    const origLeft = el.style.left;

    window.dispatchEvent(mouseEvent('mousemove', { clientX: 300, clientY: 300 }));

    expect(el.style.left).toBe(origLeft);
  });

  it('clamps position to prevent dragging above topMin', () => {
    result = makeDraggable(el, handle, { topMin: 50 });
    handle.dispatchEvent(mouseEvent('mousedown', { clientX: 150, clientY: 150 }));

    // Try to drag to y=10, which is above topMin=50
    window.dispatchEvent(mouseEvent('mousemove', { clientX: 150, clientY: 60 }));

    const topVal = parseInt(el.style.top, 10);
    expect(topVal).toBeGreaterThanOrEqual(50);
  });

  it('clamps position to prevent dragging off-screen left', () => {
    result = makeDraggable(el, handle);
    handle.dispatchEvent(mouseEvent('mousedown', { clientX: 150, clientY: 150 }));

    // Try to drag far left: curX = -200 - 50 = -250, should clamp to 0
    window.dispatchEvent(mouseEvent('mousemove', { clientX: -200, clientY: 150 }));

    const leftVal = parseInt(el.style.left, 10);
    expect(leftVal).toBeGreaterThanOrEqual(0);
  });

  it('skipSelector prevents drag from matching child', () => {
    const skipChild = document.createElement('button');
    skipChild.className = 'close-btn';
    handle.appendChild(skipChild);

    result = makeDraggable(el, handle, { skipSelector: '.close-btn' });
    skipChild.dispatchEvent(mouseEvent('mousedown', { clientX: 150, clientY: 150 }));

    expect(result.isDragging()).toBe(false);
  });

  it('hitTest returning false prevents drag', () => {
    const hitTest = vi.fn().mockReturnValue(false);
    result = makeDraggable(el, handle, { hitTest });

    handle.dispatchEvent(mouseEvent('mousedown', { clientX: 150, clientY: 150 }));

    expect(hitTest).toHaveBeenCalled();
    expect(result.isDragging()).toBe(false);
  });

  it('hitTest returning true allows drag', () => {
    const hitTest = vi.fn().mockReturnValue(true);
    result = makeDraggable(el, handle, { hitTest });

    handle.dispatchEvent(mouseEvent('mousedown', { clientX: 150, clientY: 150 }));

    expect(hitTest).toHaveBeenCalled();
    expect(result.isDragging()).toBe(true);
  });

  it('saves position to localStorage when saveKey is provided', () => {
    // rAF stub: fire synchronously so momentum tick() runs to completion
    // and save() is called once velocity decays below the threshold.
    const origRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(performance.now()); return 0; }) as typeof window.requestAnimationFrame;
    try {
      result = makeDraggable(el, handle, { saveKey: 'test-drag-pos' });

      handle.dispatchEvent(mouseEvent('mousedown', { clientX: 150, clientY: 150 }));
      window.dispatchEvent(mouseEvent('mousemove', { clientX: 160, clientY: 160 }));
      window.dispatchEvent(mouseEvent('mouseup'));

      const saved = localStorage.getItem('test-drag-pos');
      expect(saved).not.toBeNull();
      const parsed = JSON.parse(saved!);
      expect(typeof parsed.x).toBe('number');
      expect(typeof parsed.y).toBe('number');
    } finally {
      window.requestAnimationFrame = origRAF;
    }
  });

  it('restores edge affinity from localStorage', () => {
    localStorage.setItem('test-drag-pos', JSON.stringify({
      x: 0, y: 36, w: 100, h: 100, sL: true, sR: false, sT: true, sB: false,
    }));

    // Should not throw when restoring
    expect(() => makeDraggable(el, handle, { saveKey: 'test-drag-pos' })).not.toThrow();
  });

  it('handles invalid localStorage gracefully', () => {
    localStorage.setItem('test-key', 'not-json{{{');

    // Should not throw — warnDev is called instead
    expect(() => makeDraggable(el, handle, { saveKey: 'test-key' })).not.toThrow();
  });

  it('applies position as left/top with bottom/right auto', () => {
    result = makeDraggable(el, handle);
    handle.dispatchEvent(mouseEvent('mousedown', { clientX: 150, clientY: 150 }));
    window.dispatchEvent(mouseEvent('mousemove', { clientX: 200, clientY: 200 }));

    expect(el.style.bottom).toBe('auto');
    expect(el.style.right).toBe('auto');
    expect(el.style.transform).toBe('none');
  });

  it('prevents default on mousedown for drag handle', () => {
    result = makeDraggable(el, handle);
    const event = mouseEvent('mousedown', { clientX: 150, clientY: 150 });
    const spy = vi.spyOn(event, 'preventDefault');

    handle.dispatchEvent(event);

    expect(spy).toHaveBeenCalled();
  });

  it('window resize repositions element within bounds', () => {
    result = makeDraggable(el, handle);

    // Simulate drag to bottom-right
    handle.dispatchEvent(mouseEvent('mousedown', { clientX: 150, clientY: 150 }));
    window.dispatchEvent(mouseEvent('mousemove', { clientX: 900, clientY: 700 }));
    window.dispatchEvent(mouseEvent('mouseup'));

    // Shrink window
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true });

    window.dispatchEvent(new Event('resize'));

    // After resize, element should be clamped within new bounds
    const leftVal = parseInt(el.style.left, 10);
    const topVal = parseInt(el.style.top, 10);
    expect(leftVal).toBeLessThanOrEqual(500);
    expect(topVal).toBeLessThanOrEqual(400);
  });
});
