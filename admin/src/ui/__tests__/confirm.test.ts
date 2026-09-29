// ── Admin confirm action tests ────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { confirmAction } from '../confirm';

function makeButton(id: string, label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = id;
  btn.textContent = label;
  document.body.appendChild(btn);
  return btn;
}

describe('confirmAction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows CONFIRM? on first click', () => {
    const btn = makeButton('btn-1', 'DELETE');
    confirmAction(btn, 'DELETE', vi.fn());

    btn.click();

    expect(btn.textContent).toBe('CONFIRM?');
    expect(btn.classList.contains('confirming')).toBe(true);
  });

  it('executes action on second click within 3s', () => {
    const action = vi.fn();
    const btn = makeButton('btn-2', 'WIPE');
    confirmAction(btn, 'WIPE', action);

    btn.click();
    btn.click();

    expect(action).toHaveBeenCalledOnce();
  });

  it('resets to original label if no second click within 3s', () => {
    const action = vi.fn();
    const btn = makeButton('btn-3', 'PURGE');
    confirmAction(btn, 'PURGE', action);

    btn.click();
    expect(btn.textContent).toBe('CONFIRM?');

    vi.advanceTimersByTime(3001);

    expect(btn.textContent).toBe('PURGE');
    expect(btn.classList.contains('confirming')).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it('shows DONE after async action resolves', async () => {
    const action = vi.fn(() => Promise.resolve());
    const btn = makeButton('btn-4', 'RUN');
    confirmAction(btn, 'RUN', action);

    btn.click();
    btn.click();

    await Promise.resolve(); // flush microtasks for the promise chain

    expect(btn.textContent).toBe('DONE');
    expect(btn.classList.contains('done')).toBe(true);
  });

  it('shows FAILED after async action rejects', async () => {
    const action = vi.fn(() => Promise.reject(new Error('boom')));
    const btn = makeButton('btn-5', 'SEND');
    confirmAction(btn, 'SEND', action);

    btn.click();
    btn.click();

    // Flush microtasks through .catch and .finally
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(btn.textContent).toBe('FAILED');
  });

  it('resets to original label 2s after async completion', async () => {
    const action = vi.fn(() => Promise.resolve());
    const btn = makeButton('btn-6', 'GO');
    confirmAction(btn, 'GO', action);

    btn.click();
    btn.click();

    // Flush the resolved promise through the .then/.finally chain
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    vi.advanceTimersByTime(2001);

    expect(btn.textContent).toBe('GO');
    expect(btn.className).toBe('purge-btn');
  });
});
