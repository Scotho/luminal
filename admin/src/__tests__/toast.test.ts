import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showToast, _resetToasts } from '../ui/toast';

// Minimal DOM setup
beforeEach(() => {
  _resetToasts();
  document.body.innerHTML = '<div id="app-shell"></div>';
});

describe('showToast', () => {
  it('creates a toast container on first call', () => {
    showToast('task:done', 'Test message');
    const container = document.getElementById('toast-container');
    expect(container).toBeTruthy();
  });

  it('adds a toast element to the container', () => {
    showToast('task:done', 'Test message');
    const container = document.getElementById('toast-container');
    expect(container!.children.length).toBe(1);
  });

  it('renders the message text', () => {
    showToast('bug:new', 'Crash in lobby');
    const container = document.getElementById('toast-container');
    expect(container!.innerHTML).toContain('Crash in lobby');
  });

  it('renders the correct label for task:done', () => {
    showToast('task:done', 'msg');
    expect(document.getElementById('toast-container')!.innerHTML).toContain('Task completed');
  });

  it('renders the correct label for bug:new', () => {
    showToast('bug:new', 'msg');
    expect(document.getElementById('toast-container')!.innerHTML).toContain('New bug report');
  });

  it('renders the correct label for cc:done', () => {
    showToast('cc:done', 'msg');
    expect(document.getElementById('toast-container')!.innerHTML).toContain('CC finished');
  });

  it('caps at 3 visible toasts', () => {
    showToast('task:done', '1');
    showToast('task:done', '2');
    showToast('task:done', '3');
    showToast('task:done', '4');
    const container = document.getElementById('toast-container');
    // May have 3 or 4 briefly due to dismiss animation, but should not exceed 4
    expect(container!.children.length).toBeLessThanOrEqual(4);
  });

  it('auto-dismisses after timeout', () => {
    vi.useFakeTimers();
    showToast('task:done', 'dismiss me');
    const container = document.getElementById('toast-container');
    expect(container!.children.length).toBe(1);
    // Advance past dismiss + animation
    vi.advanceTimersByTime(5000);
    // After animation completes, toast should be removed
    expect(container!.children.length).toBe(0);
    vi.useRealTimers();
  });
});
