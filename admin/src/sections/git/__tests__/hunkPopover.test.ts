// admin/src/sections/git/__tests__/hunkPopover.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPopover } from '../hunkPopover';

// Minimal DOM setup provided by jsdom via vitest config

describe('createPopover', () => {
  let anchor: HTMLElement;
  let parent: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    parent = document.createElement('div');
    document.body.appendChild(parent);
    anchor = document.createElement('div');
    parent.appendChild(anchor);

    // Stub clipboard
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('inserts el into parentElement when no .diff-hunk ancestor', () => {
    const handle = createPopover({ anchor });
    expect(parent.contains(handle.el)).toBe(true);
  });

  it('inserts el into .diff-hunk ancestor when present', () => {
    const hunk = document.createElement('div');
    hunk.className = 'diff-hunk';
    const inner = document.createElement('div');
    hunk.appendChild(inner);
    document.body.appendChild(hunk);

    const hunkAnchor = document.createElement('span');
    inner.appendChild(hunkAnchor);

    const handle = createPopover({ anchor: hunkAnchor });
    expect(hunk.contains(handle.el)).toBe(true);
  });

  it('shows Thinking... initially', () => {
    const handle = createPopover({ anchor });
    expect(handle.el.textContent).toContain('Thinking...');
  });

  it('appendToken clears Thinking... on first token', () => {
    const handle = createPopover({ anchor });
    handle.appendToken('Hello');
    expect(handle.el.textContent).not.toContain('Thinking...');
    expect(handle.el.textContent).toContain('Hello');
  });

  it('appendToken accumulates subsequent tokens', () => {
    const handle = createPopover({ anchor });
    handle.appendToken('foo');
    handle.appendToken(' bar');
    handle.appendToken(' baz');
    expect(handle.el.textContent).toContain('foo bar baz');
  });

  it('setContent replaces body html', () => {
    const handle = createPopover({ anchor });
    handle.setContent('<strong>result</strong>');
    expect(handle.el.innerHTML).toContain('<strong>result</strong>');
    expect(handle.el.textContent).not.toContain('Thinking...');
  });

  it('close() removes el from DOM (after animation)', async () => {
    vi.useFakeTimers();
    const handle = createPopover({ anchor });
    expect(document.body.contains(handle.el)).toBe(true);
    handle.close();
    vi.advanceTimersByTime(200);
    expect(document.body.contains(handle.el)).toBe(false);
    vi.useRealTimers();
  });

  it('close() is idempotent', () => {
    vi.useFakeTimers();
    const handle = createPopover({ anchor });
    handle.close();
    expect(() => handle.close()).not.toThrow();
    vi.useRealTimers();
  });

  it('Esc key closes the popover', () => {
    vi.useFakeTimers();
    const handle = createPopover({ anchor });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    vi.advanceTimersByTime(200);
    expect(document.body.contains(handle.el)).toBe(false);
    vi.useRealTimers();
  });

  it('renders title text', () => {
    const handle = createPopover({ anchor, title: 'My Title' });
    expect(handle.el.textContent).toContain('My Title');
  });

  it('renders Auto-fix button when onAutofix provided', () => {
    const onAutofix = vi.fn();
    const handle = createPopover({ anchor, onAutofix });
    const btn = Array.from(handle.el.querySelectorAll('button')).find(
      b => b.textContent === 'Auto-fix',
    );
    expect(btn).toBeTruthy();
    btn!.click();
    expect(onAutofix).toHaveBeenCalledOnce();
  });

  it('does not render Auto-fix button when onAutofix not provided', () => {
    const handle = createPopover({ anchor });
    const btn = Array.from(handle.el.querySelectorAll('button')).find(
      b => b.textContent === 'Auto-fix',
    );
    expect(btn).toBeUndefined();
  });

  it('renders Ask Followup button when onFollowup provided', () => {
    const handle = createPopover({ anchor, onFollowup: vi.fn() });
    const btn = Array.from(handle.el.querySelectorAll('button')).find(
      b => b.textContent === 'Ask Followup',
    );
    expect(btn).toBeTruthy();
  });

  it('Ask Followup replaces actions with input + Send', () => {
    const handle = createPopover({ anchor, onFollowup: vi.fn() });
    const followupBtn = Array.from(handle.el.querySelectorAll('button')).find(
      b => b.textContent === 'Ask Followup',
    )!;
    followupBtn.click();
    expect(handle.el.querySelector('input')).toBeTruthy();
    const sendBtn = Array.from(handle.el.querySelectorAll('button')).find(
      b => b.textContent === 'Send',
    );
    expect(sendBtn).toBeTruthy();
  });

  it('followup Send button calls onFollowup with input text', () => {
    const onFollowup = vi.fn();
    const handle = createPopover({ anchor, onFollowup });
    const followupBtn = Array.from(handle.el.querySelectorAll('button')).find(
      b => b.textContent === 'Ask Followup',
    )!;
    followupBtn.click();
    const input = handle.el.querySelector('input')!;
    input.value = 'Why is this slow?';
    const sendBtn = Array.from(handle.el.querySelectorAll('button')).find(
      b => b.textContent === 'Send',
    )!;
    sendBtn.click();
    expect(onFollowup).toHaveBeenCalledWith('Why is this slow?');
  });

  it('Enter key in followup input calls onFollowup', () => {
    const onFollowup = vi.fn();
    const handle = createPopover({ anchor, onFollowup });
    const followupBtn = Array.from(handle.el.querySelectorAll('button')).find(
      b => b.textContent === 'Ask Followup',
    )!;
    followupBtn.click();
    const input = handle.el.querySelector('input')!;
    input.value = 'explain this';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onFollowup).toHaveBeenCalledWith('explain this');
  });

  it('Copy button calls clipboard.writeText', async () => {
    const handle = createPopover({ anchor });
    handle.appendToken('some code');
    const copyBtn = Array.from(handle.el.querySelectorAll('button')).find(
      b => b.textContent === 'Copy',
    )!;
    copyBtn.click();
    await Promise.resolve();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('some code');
  });
});
