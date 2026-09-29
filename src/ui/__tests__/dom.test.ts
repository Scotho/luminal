// ── DOM Helpers Tests ────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { escapeHtml, show, hide, toggleVisible, updateBadge } from '../dom';

describe('escapeHtml', () => {
  it('escapes HTML tags', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('passes through plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('show / hide / toggleVisible', () => {
  let el: HTMLDivElement;

  beforeEach(() => {
    el = document.createElement('div');
    el.id = 'test-el';
    el.classList.add('hidden');
    document.body.appendChild(el);
  });

  afterEach(() => {
    el.remove();
  });

  it('show removes hidden class via HTMLElement', () => {
    show(el);
    expect(el.classList.contains('hidden')).toBe(false);
  });

  it('show removes hidden class via string ID', () => {
    show('test-el');
    expect(el.classList.contains('hidden')).toBe(false);
  });

  it('hide adds hidden class', () => {
    el.classList.remove('hidden');
    hide(el);
    expect(el.classList.contains('hidden')).toBe(true);
  });

  it('hide via string ID', () => {
    el.classList.remove('hidden');
    hide('test-el');
    expect(el.classList.contains('hidden')).toBe(true);
  });

  it('no-op for nonexistent ID', () => {
    expect(() => show('does-not-exist')).not.toThrow();
    expect(() => hide('does-not-exist')).not.toThrow();
  });

  it('toggleVisible true shows element', () => {
    toggleVisible(el, true);
    expect(el.classList.contains('hidden')).toBe(false);
  });

  it('toggleVisible false hides element', () => {
    el.classList.remove('hidden');
    toggleVisible(el, false);
    expect(el.classList.contains('hidden')).toBe(true);
  });

  it('toggleVisible via string ID', () => {
    toggleVisible('test-el', true);
    expect(el.classList.contains('hidden')).toBe(false);
  });
});

describe('updateBadge', () => {
  let badge: HTMLSpanElement;

  beforeEach(() => {
    badge = document.createElement('span');
    badge.id = 'test-badge';
    badge.classList.add('hidden');
    document.body.appendChild(badge);
  });

  afterEach(() => {
    badge.remove();
  });

  it('shows badge and sets text when count > 0', () => {
    updateBadge('test-badge', 5);
    expect(badge.textContent).toBe('5');
    expect(badge.classList.contains('hidden')).toBe(false);
  });

  it('hides badge when count is 0', () => {
    badge.classList.remove('hidden');
    updateBadge('test-badge', 0);
    expect(badge.classList.contains('hidden')).toBe(true);
  });

  it('no-op for nonexistent ID', () => {
    expect(() => updateBadge('nope', 3)).not.toThrow();
  });
});
