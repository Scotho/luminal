import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createShimmer } from '../shimmerAnimation';

describe('createShimmer', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.removeChild(container);
  });

  // ── Render ─────────────────────────────────────────────

  it('renders text into element (textContent matches)', () => {
    const ctrl = createShimmer(container, 'Hello world', {
      baseColor: 'rgb(110, 224, 240)',
      shimmerColor: 'rgb(201, 248, 255)',
      speed: 'requesting',
    });
    expect(container.textContent).toBe('Hello world');
    ctrl.destroy();
  });

  it('element has gradient background style (.cc-shimmer class + style contains background)', () => {
    const ctrl = createShimmer(container, 'Shimmer text', {
      baseColor: 'rgb(110, 224, 240)',
      shimmerColor: 'rgb(201, 248, 255)',
      speed: 'responding',
    });
    const span = container.querySelector('.cc-shimmer');
    expect(span).not.toBeNull();
    const style = (span as HTMLElement).style.cssText || (span as HTMLElement).getAttribute('style') || '';
    expect(style).toMatch(/background/i);
    ctrl.destroy();
  });

  // ── updateText ─────────────────────────────────────────

  it('updateText changes displayed content without recreating animation', () => {
    const ctrl = createShimmer(container, 'Initial text', {
      baseColor: 'rgb(110, 224, 240)',
      shimmerColor: 'rgb(201, 248, 255)',
      speed: 'requesting',
    });

    const spanBefore = container.querySelector('.cc-shimmer');
    ctrl.updateText('Updated text');

    // Text should be updated
    expect(container.textContent).toBe('Updated text');

    // The same span element should still be there (no recreation)
    const spanAfter = container.querySelector('.cc-shimmer');
    expect(spanAfter).toBe(spanBefore);
    ctrl.destroy();
  });

  // ── setSpeed ───────────────────────────────────────────

  it('setSpeed changes animation interval without throwing', () => {
    const ctrl = createShimmer(container, 'Speed test', {
      baseColor: 'rgb(110, 224, 240)',
      shimmerColor: 'rgb(201, 248, 255)',
      speed: 'requesting',
    });
    expect(() => ctrl.setSpeed('responding')).not.toThrow();
    expect(() => ctrl.setSpeed('requesting')).not.toThrow();
    ctrl.destroy();
  });

  // ── Stalled detection ──────────────────────────────────

  it('stalled detection triggers after 3000ms — adds cc-shimmer--stalled class', () => {
    const ctrl = createShimmer(container, 'Stalled test', {
      baseColor: 'rgb(110, 224, 240)',
      shimmerColor: 'rgb(201, 248, 255)',
      speed: 'responding',
    });

    // Before 3000ms: not stalled
    vi.advanceTimersByTime(2999);
    const span = container.querySelector('.cc-shimmer');
    expect(span?.classList.contains('cc-shimmer--stalled')).toBe(false);

    // At 3000ms: stalled class should appear
    vi.advanceTimersByTime(1);
    expect(container.querySelector('.cc-shimmer--stalled')).not.toBeNull();
    ctrl.destroy();
  });

  it('stalled intensity reaches 1.0 at 5000ms (3000 threshold + 2000 fade)', () => {
    const ctrl = createShimmer(container, 'Intensity test', {
      baseColor: 'rgb(110, 224, 240)',
      shimmerColor: 'rgb(201, 248, 255)',
      speed: 'responding',
    });

    // Advance 5000ms total (3000 threshold + 2000 full fade)
    vi.advanceTimersByTime(5000);

    const span = container.querySelector('.cc-shimmer') as HTMLElement | null;
    expect(span).not.toBeNull();
    const intensity = span!.style.getPropertyValue('--stalled-intensity');
    expect(parseFloat(intensity)).toBeCloseTo(1.0, 1);
    ctrl.destroy();
  });

  // ── updateTokenTime ────────────────────────────────────

  it('updateTokenTime resets stalled state (removes cc-shimmer--stalled class)', () => {
    const ctrl = createShimmer(container, 'Reset test', {
      baseColor: 'rgb(110, 224, 240)',
      shimmerColor: 'rgb(201, 248, 255)',
      speed: 'responding',
    });

    // Let it go stalled
    vi.advanceTimersByTime(3500);
    expect(container.querySelector('.cc-shimmer--stalled')).not.toBeNull();

    // Reset token time — should clear stalled state
    ctrl.updateTokenTime();
    expect(container.querySelector('.cc-shimmer--stalled')).toBeNull();
    ctrl.destroy();
  });

  // ── destroy ────────────────────────────────────────────

  it('destroy removes element content and cleans up (.cc-shimmer removed from DOM)', () => {
    const ctrl = createShimmer(container, 'Destroy test', {
      baseColor: 'rgb(110, 224, 240)',
      shimmerColor: 'rgb(201, 248, 255)',
      speed: 'requesting',
    });

    expect(container.querySelector('.cc-shimmer')).not.toBeNull();
    ctrl.destroy();

    // Span should be removed
    expect(container.querySelector('.cc-shimmer')).toBeNull();
  });
});
