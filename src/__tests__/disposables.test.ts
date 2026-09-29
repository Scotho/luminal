// ── DisposableBag tests ──────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DisposableBag } from '../disposables';

describe('DisposableBag', () => {
  let bag: DisposableBag;

  beforeEach(() => {
    bag = new DisposableBag();
  });

  // ── add / dispose ──────────────────────────────────────

  it('add — registered callback fires on dispose', () => {
    const cb = vi.fn();
    bag.add(cb);
    bag.dispose();
    expect(cb).toHaveBeenCalledOnce();
  });

  it('add — multiple callbacks fire in order', () => {
    const order: number[] = [];
    bag.add(() => order.push(1));
    bag.add(() => order.push(2));
    bag.add(() => order.push(3));
    bag.dispose();
    expect(order).toEqual([1, 2, 3]);
  });

  it('dispose — clears the list, second dispose is no-op', () => {
    const cb = vi.fn();
    bag.add(cb);
    bag.dispose();
    bag.dispose();
    expect(cb).toHaveBeenCalledOnce();
  });

  it('dispose — swallows errors from callbacks', () => {
    const safeCb = vi.fn();
    bag.add(() => {
      throw new Error('boom');
    });
    bag.add(safeCb);
    // Should not throw
    expect(() => bag.dispose()).not.toThrow();
    // The safe callback should still have been called
    expect(safeCb).toHaveBeenCalledOnce();
  });

  // ── reset ──────────────────────────────────────────────

  it('reset — is an alias for dispose', () => {
    const cb = vi.fn();
    bag.add(cb);
    bag.reset();
    expect(cb).toHaveBeenCalledOnce();
    // Second reset is also a no-op, same as dispose
    bag.reset();
    expect(cb).toHaveBeenCalledOnce();
  });

  // ── addEventListener ───────────────────────────────────

  it('addEventListener — adds listener and removes on dispose', () => {
    const target = new EventTarget();
    const listener = vi.fn();
    bag.addEventListener(target, 'test', listener);

    // Fire event — listener should be called
    target.dispatchEvent(new Event('test'));
    expect(listener).toHaveBeenCalledOnce();

    // Dispose — listener should be removed
    bag.dispose();
    target.dispatchEvent(new Event('test'));
    expect(listener).toHaveBeenCalledOnce(); // still 1
  });

  it('addEventListener — listener actually works before dispose', () => {
    const target = new EventTarget();
    const received: string[] = [];
    bag.addEventListener(target, 'ping', () => received.push('pong'));

    target.dispatchEvent(new Event('ping'));
    target.dispatchEvent(new Event('ping'));
    expect(received).toEqual(['pong', 'pong']);
  });

  // ── setTimeout ─────────────────────────────────────────

  describe('setTimeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('clears on dispose before timeout fires', () => {
      const cb = vi.fn();
      bag.setTimeout(cb, 1000);
      bag.dispose();
      vi.advanceTimersByTime(2000);
      expect(cb).not.toHaveBeenCalled();
    });

    it('callback fires if not disposed before timeout', () => {
      const cb = vi.fn();
      bag.setTimeout(cb, 500);
      vi.advanceTimersByTime(600);
      expect(cb).toHaveBeenCalledOnce();
    });
  });

  // ── setInterval ────────────────────────────────────────

  describe('setInterval', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('clears on dispose', () => {
      const cb = vi.fn();
      bag.setInterval(cb, 100);
      vi.advanceTimersByTime(350); // would normally fire 3 times
      expect(cb).toHaveBeenCalledTimes(3);

      bag.dispose();
      vi.advanceTimersByTime(500);
      // No more calls after dispose
      expect(cb).toHaveBeenCalledTimes(3);
    });
  });
});
