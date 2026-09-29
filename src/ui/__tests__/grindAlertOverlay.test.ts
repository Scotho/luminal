/**
 * Unit tests for GrindAlertOverlay — CSS screen-edge flash overlay.
 * Uses jsdom (vitest default environment).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GrindAlertOverlay } from '../grindAlertOverlay';

describe('GrindAlertOverlay', () => {
  let container: HTMLDivElement;
  let overlay: GrindAlertOverlay;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'game-container';
    document.body.appendChild(container);
    overlay = new GrindAlertOverlay(container);
  });

  afterEach(() => {
    overlay.dispose();
    container.remove();
  });

  it('creates 4 edge divs in the container', () => {
    expect(container.children.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      const el = container.children[i] as HTMLElement;
      expect(el.style.position).toBe('absolute');
      expect(el.style.pointerEvents).toBe('none');
    }
  });

  it('all edges start with opacity 0', () => {
    for (let i = 0; i < 4; i++) {
      const el = container.children[i] as HTMLElement;
      expect(el.style.opacity).toBe('0');
    }
  });

  it('flash sets opacity to 1', () => {
    overlay.flash(0x00ff00, 0.5);
    // After flash, but before update, internal opacity should be 1
    overlay.update(0);
    for (let i = 0; i < 4; i++) {
      const el = container.children[i] as HTMLElement;
      expect(parseFloat(el.style.opacity)).toBeCloseTo(1, 0);
    }
  });

  it('flash applies gradient with correct color', () => {
    overlay.flash(0xff0000, 0.5);
    const el = container.children[0] as HTMLElement;
    // jsdom converts hex to rgba; check for the color presence
    expect(el.style.background).toContain('255, 0, 0');
  });

  it('update decays opacity over time with ease-out', () => {
    overlay.flash(0xffffff, 1.0);
    overlay.update(0.5); // halfway
    const el = container.children[0] as HTMLElement; // top edge (1.3x multiplier)
    const opacity = parseFloat(el.style.opacity);
    // At t=0.5: (1-0.5)^2 = 0.25, then 0.25 * 1.3 = 0.325
    expect(opacity).toBeCloseTo(0.325, 1);
  });

  it('opacity reaches 0 after full duration', () => {
    overlay.flash(0xffffff, 0.5);
    overlay.update(0.5);
    const el = container.children[0] as HTMLElement;
    expect(parseFloat(el.style.opacity)).toBeCloseTo(0, 1);
  });

  it('does not update opacity when not active', () => {
    // No flash called — update should be no-op
    overlay.update(0.016);
    for (let i = 0; i < 4; i++) {
      const el = container.children[i] as HTMLElement;
      expect(el.style.opacity).toBe('0');
    }
  });

  it('dispose removes all edge elements from DOM', () => {
    expect(container.children.length).toBe(4);
    overlay.dispose();
    expect(container.children.length).toBe(0);
  });

  it('re-flash during active flash resets the animation', () => {
    overlay.flash(0xffffff, 1.0);
    overlay.update(0.8); // nearly done
    const elBefore = container.children[0] as HTMLElement;
    const opBefore = parseFloat(elBefore.style.opacity);
    expect(opBefore).toBeLessThan(0.1);

    // Re-flash
    overlay.flash(0xff00ff, 0.5);
    overlay.update(0); // immediately after flash
    const elAfter = container.children[0] as HTMLElement;
    expect(parseFloat(elAfter.style.opacity)).toBeCloseTo(1, 0);
  });

  it('handles hex colors with leading zeros', () => {
    overlay.flash(0x00d4ff, 0.5);
    const el = container.children[0] as HTMLElement;
    // jsdom converts hex to rgba; check for the color presence
    expect(el.style.background).toContain('0, 212, 255');
  });
});
