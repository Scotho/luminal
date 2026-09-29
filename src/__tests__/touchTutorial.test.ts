import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  showTutorialIfNeeded,
  startTutorial,
  dismiss,
  isTutorialActive,
  resetTutorialFlag,
  _resetTutorialForTest,
} from '../touchTutorial';

// ── Setup / Teardown ────────────────────────────────────

beforeEach(() => {
  _resetTutorialForTest();
  localStorage.clear();
});

afterEach(() => {
  _resetTutorialForTest();
  localStorage.clear();
});

// ═════════════════════════════════════════════════════════
// 1 – Tutorial Lifecycle
// ═════════════════════════════════════════════════════════

describe('Tutorial Lifecycle', () => {
  it('1. startTutorial creates overlay in DOM', () => {
    startTutorial('buttons', 'bike');
    const overlay = document.getElementById('touch-tutorial');
    expect(overlay).not.toBeNull();
    expect(overlay!.classList.contains('hidden')).toBe(false);
  });

  it('2. isTutorialActive returns true during tutorial', () => {
    expect(isTutorialActive()).toBe(false);
    startTutorial('buttons', 'bike');
    expect(isTutorialActive()).toBe(true);
  });

  it('3. dismiss hides overlay and marks done', () => {
    startTutorial('buttons', 'bike');
    dismiss();
    expect(isTutorialActive()).toBe(false);
    const overlay = document.getElementById('touch-tutorial');
    expect(overlay!.classList.contains('hidden')).toBe(true);
    expect(localStorage.getItem('luminal-touch-tutorial-done')).toBe('1');
  });

  it('4. showTutorialIfNeeded skips when already done', () => {
    localStorage.setItem('luminal-touch-tutorial-done', '1');
    showTutorialIfNeeded('buttons', 'bike');
    expect(isTutorialActive()).toBe(false);
  });

  it('5. showTutorialIfNeeded starts when not done', () => {
    showTutorialIfNeeded('buttons', 'bike');
    expect(isTutorialActive()).toBe(true);
  });

  it('6. resetTutorialFlag clears completion', () => {
    dismiss();
    expect(localStorage.getItem('luminal-touch-tutorial-done')).toBe('1');
    resetTutorialFlag();
    expect(localStorage.getItem('luminal-touch-tutorial-done')).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════
// 2 – Tutorial Content
// ═════════════════════════════════════════════════════════

describe('Tutorial Content', () => {
  it('7. button mode tutorial shows step text and icon', () => {
    startTutorial('buttons', 'bike');
    const text = document.querySelector('.tt-text');
    const icon = document.querySelector('.tt-icon');
    expect(text).not.toBeNull();
    expect(text!.textContent).toContain('steer left');
    expect(icon!.textContent!.length).toBeGreaterThan(0);
  });

  it('8. gesture mode tutorial shows gesture-specific steps', () => {
    startTutorial('gestures', 'bike');
    const text = document.querySelector('.tt-text');
    expect(text!.textContent).toContain('left or right half');
  });

  it('9. step dots rendered with correct count for bike (5 buttons)', () => {
    startTutorial('buttons', 'bike');
    const dots = document.querySelectorAll('.tt-dot');
    expect(dots.length).toBe(5); // left, right, gas, boost, brake — no context for bike
  });

  it('10. step dots rendered with 6 for car (includes drift)', () => {
    startTutorial('buttons', 'car');
    const dots = document.querySelectorAll('.tt-dot');
    expect(dots.length).toBe(6);
  });

  it('11. step dots rendered with 6 for hoverboard (includes hover)', () => {
    startTutorial('buttons', 'hoverboard');
    const dots = document.querySelectorAll('.tt-dot');
    expect(dots.length).toBe(6);
  });

  it('12. gesture mode has 4 steps for bike, 5 for car', () => {
    startTutorial('gestures', 'bike');
    let dots = document.querySelectorAll('.tt-dot');
    expect(dots.length).toBe(4);

    _resetTutorialForTest();
    startTutorial('gestures', 'car');
    dots = document.querySelectorAll('.tt-dot');
    expect(dots.length).toBe(5);
  });
});

// ═════════════════════════════════════════════════════════
// 3 – Tutorial UI Elements
// ═════════════════════════════════════════════════════════

describe('Tutorial UI Elements', () => {
  it('13. skip button exists and is clickable', () => {
    startTutorial('buttons', 'bike');
    const skipBtn = document.querySelector('.tt-skip');
    expect(skipBtn).not.toBeNull();
    expect(skipBtn!.textContent).toBe('SKIP');
  });

  it('14. skip button dismisses tutorial', () => {
    startTutorial('buttons', 'bike');
    const skipBtn = document.querySelector('.tt-skip') as HTMLElement;
    skipBtn.click();
    expect(isTutorialActive()).toBe(false);
  });

  it('15. highlight element exists', () => {
    startTutorial('buttons', 'bike');
    const highlight = document.querySelector('.tt-highlight');
    expect(highlight).not.toBeNull();
  });

  it('16. card element exists with icon and text', () => {
    startTutorial('buttons', 'bike');
    expect(document.querySelector('.tt-card')).not.toBeNull();
    expect(document.querySelector('.tt-icon')).not.toBeNull();
    expect(document.querySelector('.tt-text')).not.toBeNull();
  });

  it('17. overlay has role=dialog for accessibility', () => {
    startTutorial('buttons', 'bike');
    const overlay = document.getElementById('touch-tutorial')!;
    expect(overlay.getAttribute('role')).toBe('dialog');
    expect(overlay.getAttribute('aria-label')).toBe('Touch controls tutorial');
  });
});

// ═════════════════════════════════════════════════════════
// 4 – Auto-Advance
// ═════════════════════════════════════════════════════════

describe('Auto-Advance', () => {
  it('18. auto-advances to next step after timeout', async () => {
    vi.useFakeTimers();
    startTutorial('buttons', 'bike');
    const text = document.querySelector('.tt-text')!;
    expect(text.textContent).toContain('steer left');

    vi.advanceTimersByTime(2600); // step autoAdvanceMs = 2500
    expect(text.textContent).toContain('steer right');

    vi.useRealTimers();
  });

  it('19. tutorial dismisses after all steps complete', () => {
    vi.useFakeTimers();
    startTutorial('buttons', 'bike');
    // 5 steps at 2500ms each
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(2600);
    }
    expect(isTutorialActive()).toBe(false);
    vi.useRealTimers();
  });

  it('20. tap on overlay advances step immediately', () => {
    startTutorial('buttons', 'bike');
    const overlay = document.getElementById('touch-tutorial')!;
    const text = document.querySelector('.tt-text')!;
    expect(text.textContent).toContain('steer left');

    // Simulate touch on overlay
    const event = new TouchEvent('touchstart', { bubbles: true, cancelable: true });
    overlay.dispatchEvent(event);
    expect(text.textContent).toContain('steer right');
  });
});
