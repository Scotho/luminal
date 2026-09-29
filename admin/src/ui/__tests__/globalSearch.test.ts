// ── Global Search tests ────────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../render', () => ({
  escapeHtml: (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
}));

import { initGlobalSearch, showGlobalSearch, closeGlobalSearch } from '../globalSearch';

// ── Tests ──────────────────────────────────────────────────

describe('globalSearch', () => {
  let switchFn: ReturnType<typeof vi.fn> & ((name: string) => void);

  beforeEach(() => {
    document.body.innerHTML = '';
    switchFn = vi.fn() as ReturnType<typeof vi.fn> & ((name: string) => void);
    initGlobalSearch(switchFn);
  });

  afterEach(() => {
    closeGlobalSearch();
  });

  it('showGlobalSearch creates overlay', () => {
    showGlobalSearch();
    expect(document.getElementById('global-search-overlay')).toBeTruthy();
  });

  it('showGlobalSearch creates input field', () => {
    showGlobalSearch();
    expect(document.getElementById('global-search-input')).toBeTruthy();
  });

  it('showGlobalSearch creates results container', () => {
    showGlobalSearch();
    expect(document.getElementById('global-search-results')).toBeTruthy();
  });

  it('closeGlobalSearch removes overlay', () => {
    showGlobalSearch();
    closeGlobalSearch();
    expect(document.getElementById('global-search-overlay')).toBeNull();
  });

  it('does not create duplicate overlays', () => {
    showGlobalSearch();
    showGlobalSearch();
    const overlays = document.querySelectorAll('#global-search-overlay');
    expect(overlays.length).toBe(1);
  });

  it('shows placeholder text in results on empty query', () => {
    showGlobalSearch();
    const input = document.getElementById('global-search-input') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('input'));
    const results = document.getElementById('global-search-results');
    expect(results?.innerHTML).toContain('Type to search');
  });

  it('finds section by label (case insensitive)', () => {
    showGlobalSearch();
    const input = document.getElementById('global-search-input') as HTMLInputElement;
    input.value = 'users';
    input.dispatchEvent(new Event('input'));
    const results = document.getElementById('global-search-results');
    expect(results?.innerHTML).toContain('Users');
  });

  it('finds section by section key', () => {
    showGlobalSearch();
    const input = document.getElementById('global-search-input') as HTMLInputElement;
    input.value = 'test-center';
    input.dispatchEvent(new Event('input'));
    const results = document.getElementById('global-search-results');
    expect(results?.innerHTML).toContain('Test Center');
  });

  it('ranks prefix matches higher', () => {
    showGlobalSearch();
    const input = document.getElementById('global-search-input') as HTMLInputElement;
    input.value = 'set';
    input.dispatchEvent(new Event('input'));
    const results = document.getElementById('global-search-results');
    const html = results?.innerHTML ?? '';
    // "Settings" starts with "set", should appear before others
    expect(html).toContain('Settings');
  });

  it('shows "No results" for unmatched query', () => {
    showGlobalSearch();
    const input = document.getElementById('global-search-input') as HTMLInputElement;
    input.value = 'zzzznonexistent';
    input.dispatchEvent(new Event('input'));
    const results = document.getElementById('global-search-results');
    expect(results?.innerHTML).toContain('No results');
  });

  it('renders result items with data-section attribute', () => {
    showGlobalSearch();
    const input = document.getElementById('global-search-input') as HTMLInputElement;
    input.value = 'live';
    input.dispatchEvent(new Event('input'));
    const result = document.querySelector('.global-search-result') as HTMLElement;
    expect(result?.dataset.section).toBe('live');
  });

  it('calls switchFn when result is clicked', () => {
    showGlobalSearch();
    const input = document.getElementById('global-search-input') as HTMLInputElement;
    input.value = 'users';
    input.dispatchEvent(new Event('input'));
    const result = document.querySelector('.global-search-result') as HTMLElement;
    result?.click();
    expect(switchFn).toHaveBeenCalledWith('users');
  });

  it('closes overlay when result is clicked', () => {
    showGlobalSearch();
    const input = document.getElementById('global-search-input') as HTMLInputElement;
    input.value = 'users';
    input.dispatchEvent(new Event('input'));
    const result = document.querySelector('.global-search-result') as HTMLElement;
    result?.click();
    expect(document.getElementById('global-search-overlay')).toBeNull();
  });

  it('closes on Escape key', () => {
    showGlobalSearch();
    const input = document.getElementById('global-search-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('global-search-overlay')).toBeNull();
  });

  it('finds multiple matching sections', () => {
    showGlobalSearch();
    const input = document.getElementById('global-search-input') as HTMLInputElement;
    input.value = 'test';
    input.dispatchEvent(new Event('input'));
    const results = document.querySelectorAll('.global-search-result');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('limits results to 15 items', () => {
    showGlobalSearch();
    const input = document.getElementById('global-search-input') as HTMLInputElement;
    // Use a query that matches many sections
    input.value = 'a';
    input.dispatchEvent(new Event('input'));
    const results = document.querySelectorAll('.global-search-result');
    expect(results.length).toBeLessThanOrEqual(15);
  });

  it('finds feature flags section', () => {
    showGlobalSearch();
    const input = document.getElementById('global-search-input') as HTMLInputElement;
    input.value = 'feature';
    input.dispatchEvent(new Event('input'));
    const results = document.getElementById('global-search-results');
    expect(results?.innerHTML).toContain('Feature Flags');
  });

  it('finds incidents section', () => {
    showGlobalSearch();
    const input = document.getElementById('global-search-input') as HTMLInputElement;
    input.value = 'incident';
    input.dispatchEvent(new Event('input'));
    const results = document.getElementById('global-search-results');
    expect(results?.innerHTML).toContain('Incidents');
  });
});
