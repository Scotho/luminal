import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GrindBustOverlay } from '../grindBustOverlay';

describe('GrindBustOverlay', () => {
  let overlay: GrindBustOverlay;

  beforeEach(() => {
    overlay = new GrindBustOverlay();
  });

  afterEach(() => {
    overlay.dispose();
  });

  it('injects styles once even if constructed twice', () => {
    const second = new GrindBustOverlay();
    expect(document.querySelectorAll('#grind-bust-styles').length).toBe(1);
    second.dispose();
  });

  it('creates root + text elements on construction', () => {
    const root = document.querySelector('.grind-bust-root');
    expect(root).toBeTruthy();
    expect(root!.querySelector('.grind-bust-title')).toBeTruthy();
    expect(root!.querySelector('.grind-bust-score')).toBeTruthy();
  });

  it('is hidden by default', () => {
    const root = document.querySelector('.grind-bust-root')!;
    expect(root.classList.contains('visible')).toBe(false);
  });

  it('flash() shows the container and sets score text', () => {
    overlay.flash(1200, 0x00d4ff);
    const root = document.querySelector('.grind-bust-root')!;
    const score = document.querySelector('.grind-bust-score')!;
    expect(root.classList.contains('visible')).toBe(true);
    expect(score.textContent).toBe('-1,200');
  });

  it('flash() uses the color hex as theme', () => {
    overlay.flash(500, 0xff6020);
    const root = document.querySelector('.grind-bust-root') as HTMLElement;
    expect(root.style.getPropertyValue('--bust-color')).toBe('rgb(255,96,32)');
  });

  it('hides after 800ms total duration', () => {
    vi.useFakeTimers();
    overlay.flash(500, 0xff2844);
    const root = document.querySelector('.grind-bust-root')!;
    expect(root.classList.contains('visible')).toBe(true);
    // Simulate update loop: 50 frames × 20ms = 1000ms > 800ms
    for (let i = 0; i < 50; i++) {
      overlay.update(0.02);
    }
    expect(root.classList.contains('visible')).toBe(false);
    vi.useRealTimers();
  });

  it('dispose() removes DOM', () => {
    overlay.dispose();
    expect(document.querySelector('.grind-bust-root')).toBeNull();
  });

  it('update() after dispose() does not throw', () => {
    overlay.flash(500, 0x00d4ff);
    overlay.dispose();
    expect(() => overlay.update(0.02)).not.toThrow();
  });
});
