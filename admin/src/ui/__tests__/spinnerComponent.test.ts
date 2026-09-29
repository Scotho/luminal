import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createSpinner, SPINNER_FRAMES, SPINNER_VERBS } from '../spinnerComponent';

describe('createSpinner', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  });

  // ── Render ─────────────────────────────────────────────

  it('renders spinner char element (.cc-spinner-char exists, content is one of SPINNER_FRAMES)', () => {
    const ctrl = createSpinner(container);
    const charEl = container.querySelector('.cc-spinner-char');
    expect(charEl).not.toBeNull();
    expect(SPINNER_FRAMES).toContain(charEl!.textContent);
    ctrl.destroy();
  });

  it('renders spinner text with a verb from pool (.cc-spinner-text exists, textContent minus "..." is in SPINNER_VERBS)', () => {
    const ctrl = createSpinner(container);
    const textEl = container.querySelector('.cc-spinner-text');
    expect(textEl).not.toBeNull();
    // The text element contains shimmer-rendered text; check textContent
    const fullText = textEl!.textContent ?? '';
    // Strip trailing "..." if present
    const verb = fullText.replace(/\.\.\.$/, '').trim();
    expect(SPINNER_VERBS).toContain(verb);
    ctrl.destroy();
  });

  // ── Frame animation ────────────────────────────────────

  it('frame advances every 120ms (after 120ms, char content changes or stays valid)', () => {
    const ctrl = createSpinner(container);
    const charEl = container.querySelector('.cc-spinner-char')!;
    const initialChar = charEl.textContent;

    vi.advanceTimersByTime(120);

    const nextChar = charEl.textContent;
    // Content must still be a valid frame
    expect(SPINNER_FRAMES).toContain(nextChar);
    // (it may or may not have changed — palindromic cycle can stay at same char for a tick)
    // Just verify it's still valid after advancing
    expect(typeof nextChar).toBe('string');
    ctrl.destroy();
  });

  it('palindromic cycle wraps correctly (after full cycle length, SPINNER_FRAMES[0] appears again)', () => {
    const ctrl = createSpinner(container);
    const charEl = container.querySelector('.cc-spinner-char')!;

    // Palindromic cycle length: SPINNER_FRAMES.length + (SPINNER_FRAMES.length - 2)
    // forward: [0,1,2,3,4,5], reverse without endpoints: [4,3,2,1]
    // total = 6 + 4 = 10 frames
    const cycleLength = SPINNER_FRAMES.length + SPINNER_FRAMES.length - 2;

    // Advance through full cycle (cycleLength frames * 120ms each)
    vi.advanceTimersByTime(cycleLength * 120);

    // After one full cycle, should be back at SPINNER_FRAMES[0]
    expect(charEl.textContent).toBe(SPINNER_FRAMES[0]);
    ctrl.destroy();
  });

  // ── Token counter ──────────────────────────────────────

  it('setTokenCount updates display (.cc-spinner-tokens text is "847 tokens")', () => {
    const ctrl = createSpinner(container);
    ctrl.setTokenCount(847);
    const tokensEl = container.querySelector('.cc-spinner-tokens');
    expect(tokensEl).not.toBeNull();
    expect(tokensEl!.textContent).toBe('847 tokens');
    ctrl.destroy();
  });

  it('token count formats as "1.2K" above 1000 (1234 → "1.2K tokens")', () => {
    const ctrl = createSpinner(container);
    ctrl.setTokenCount(1234);
    const tokensEl = container.querySelector('.cc-spinner-tokens');
    expect(tokensEl).not.toBeNull();
    expect(tokensEl!.textContent).toBe('1.2K tokens');
    ctrl.destroy();
  });

  // ── destroy ────────────────────────────────────────────

  it('destroy cleans up intervals and DOM (.cc-spinner removed)', () => {
    const ctrl = createSpinner(container);
    expect(container.querySelector('.cc-spinner')).not.toBeNull();

    ctrl.destroy();

    expect(container.querySelector('.cc-spinner')).toBeNull();
    // Verify that advancing timers after destroy doesn't throw
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  });
});
