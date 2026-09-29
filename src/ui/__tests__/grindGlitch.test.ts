/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  enterGrindGlitch,
  exitGrindGlitch,
  updateGrindGlitchIntensity,
  createGrindBankElement,
} from '../../effects/grindGlitch';

describe('grindGlitch', () => {
  let wrap: HTMLElement;

  beforeEach(() => {
    wrap = document.createElement('div');
    document.body.appendChild(wrap);
  });

  it('enterGrindGlitch adds flow-hud--vector class', () => {
    enterGrindGlitch(wrap);
    expect(wrap.classList.contains('flow-hud--vector')).toBe(true);
  });

  it('exitGrindGlitch removes class', () => {
    wrap.classList.add('flow-hud--vector');
    exitGrindGlitch(wrap);
    expect(wrap.classList.contains('flow-hud--vector')).toBe(false);
  });

  it('updateGrindGlitchIntensity at 0s sets amp to 0.35', () => {
    updateGrindGlitchIntensity(wrap, 0);
    expect(wrap.style.getPropertyValue('--vector-glitch-amp')).toBe('0.35');
  });

  it('updateGrindGlitchIntensity at 20s caps amp near 0.89', () => {
    updateGrindGlitchIntensity(wrap, 20);
    const amp = parseFloat(wrap.style.getPropertyValue('--vector-glitch-amp'));
    expect(amp).toBeCloseTo(0.89, 1);
  });

  it('updateGrindGlitchIntensity at 30s caps amp at 0.90', () => {
    updateGrindGlitchIntensity(wrap, 30);
    const amp = parseFloat(wrap.style.getPropertyValue('--vector-glitch-amp'));
    expect(amp).toBe(0.9);
  });

  it('createGrindBankElement creates element with N child spans', () => {
    const el = createGrindBankElement(250);
    expect(el.className).toContain('flow-bank--grind');
    // "+250" = 4 characters
    expect(el.children.length).toBe(4);
  });

  it('each span has digit-index and burst vector CSS variables', () => {
    const el = createGrindBankElement(50);
    const spans = el.querySelectorAll('span');
    for (let i = 0; i < spans.length; i++) {
      expect(spans[i].style.getPropertyValue('--digit-index')).toBe(String(i));
      expect(spans[i].style.getPropertyValue('--burst-x')).toBeTruthy();
      expect(spans[i].style.getPropertyValue('--burst-y')).toBeTruthy();
      expect(spans[i].style.getPropertyValue('--burst-rot')).toBeTruthy();
    }
  });
});
