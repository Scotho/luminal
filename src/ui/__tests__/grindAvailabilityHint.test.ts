// ── GrindAvailabilityHint DOM Tests (TASK-265) ─────────
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GrindAvailabilityHint } from '../grindAvailabilityHint';

describe('GrindAvailabilityHint', () => {
  let hint: GrindAvailabilityHint;

  beforeEach(() => {
    hint = new GrindAvailabilityHint();
  });

  afterEach(() => {
    hint.dispose();
  });

  it('creates root with chevron, label, and key elements on construction', () => {
    const root = document.querySelector('.grind-avail-root');
    expect(root).toBeTruthy();
    expect(root!.querySelector('.grind-avail-chevron')).toBeTruthy();
    expect(root!.querySelector('.grind-avail-label')).toBeTruthy();
    expect(root!.querySelector('.grind-avail-key')).toBeTruthy();
  });

  it('label reads GRIND READY and key reads PRESS SPACE', () => {
    const label = document.querySelector('.grind-avail-label')!;
    const key = document.querySelector('.grind-avail-key')!;
    expect(label.textContent).toBe('GRIND READY');
    expect(key.textContent).toBe('PRESS SPACE');
  });

  it('injects styles once even across multiple instances', () => {
    const second = new GrindAvailabilityHint();
    expect(document.querySelectorAll('#grind-avail-styles').length).toBe(1);
    second.dispose();
  });

  it('is hidden by default', () => {
    const root = document.querySelector('.grind-avail-root')!;
    expect(root.classList.contains('visible')).toBe(false);
  });

  it('setAvailable(true) adds visible class', () => {
    const root = document.querySelector('.grind-avail-root')!;
    hint.setAvailable(true);
    expect(root.classList.contains('visible')).toBe(true);
  });

  it('setAvailable(false) after true removes visible and adds hiding', () => {
    const root = document.querySelector('.grind-avail-root')!;
    hint.setAvailable(true);
    hint.setAvailable(false);
    expect(root.classList.contains('visible')).toBe(false);
    expect(root.classList.contains('hiding')).toBe(true);
  });

  it('hiding class clears after fade-out window', () => {
    vi.useFakeTimers();
    const root = document.querySelector('.grind-avail-root')!;
    hint.setAvailable(true);
    hint.setAvailable(false);
    expect(root.classList.contains('hiding')).toBe(true);
    vi.advanceTimersByTime(200);
    expect(root.classList.contains('hiding')).toBe(false);
    vi.useRealTimers();
  });

  it('setAvailable is idempotent — repeated true calls do not re-toggle', () => {
    const root = document.querySelector('.grind-avail-root')!;
    hint.setAvailable(true);
    hint.setAvailable(true);
    hint.setAvailable(true);
    expect(root.classList.contains('visible')).toBe(true);
    expect(root.classList.contains('hiding')).toBe(false);
  });

  it('setGlowColor sets the CSS custom property', () => {
    const root = document.querySelector('.grind-avail-root') as HTMLElement;
    hint.setGlowColor(0xff6020);
    expect(root.style.getPropertyValue('--avail-glow')).toBe('rgb(255,96,32)');
  });

  it('dispose removes DOM', () => {
    hint.dispose();
    expect(document.querySelector('.grind-avail-root')).toBeNull();
  });

  it('setAvailable after dispose does not throw', () => {
    hint.dispose();
    expect(() => hint.setAvailable(true)).not.toThrow();
  });
});
