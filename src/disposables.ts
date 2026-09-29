// ── DisposableBag ────────────────────────────────────────
// Collects cleanup callbacks, event listeners, timers, and intervals
// so they can all be torn down in a single reset() or dispose() call.

import { warnDev } from './swallow';

type CleanupFn = () => void;

export class DisposableBag {
  private _fns: CleanupFn[] = [];

  /** Register an arbitrary cleanup callback. */
  add(fn: CleanupFn): void {
    this._fns.push(fn);
  }

  /** Register a DOM event listener and schedule its removal on reset/dispose. */
  addEventListener<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    listener: (this: Window, ev: WindowEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    listener: (this: Document, ev: DocumentEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  /** Fallback overload for custom event names not present in the standard maps. */
  addEventListener(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    target.addEventListener(type, listener, options);
    this._fns.push(() => target.removeEventListener(type, listener, options));
  }

  /** Register a setTimeout and cancel it on reset/dispose. Returns the timer id. */
  setTimeout(fn: () => void, ms: number): ReturnType<typeof globalThis.setTimeout> {
    const id = globalThis.setTimeout(fn, ms);
    this._fns.push(() => clearTimeout(id));
    return id;
  }

  /** Register a setInterval and cancel it on reset/dispose. Returns the interval id. */
  setInterval(fn: () => void, ms: number): ReturnType<typeof globalThis.setInterval> {
    const id = globalThis.setInterval(fn, ms);
    this._fns.push(() => clearInterval(id));
    return id;
  }

  /** Run all cleanup callbacks and clear the list. Safe to call multiple times. */
  dispose(): void {
    for (const fn of this._fns) {
      try {
        fn();
      } catch (err) {
        warnDev('DisposableBag: cleanup callback threw', err);
      }
    }
    this._fns = [];
  }

  /** Alias for dispose() — clears all registrations so the bag can be reused. */
  reset(): void {
    this.dispose();
  }
}
