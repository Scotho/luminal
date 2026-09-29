// ── Purge section tests ────────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock firebase before importing the module under test
vi.mock('../firebase', () => ({
  functions: {},
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => vi.fn(),
}));

vi.mock('../ui/confirm', () => ({
  confirmAction: vi.fn(),
}));

import { renderPurge, showResult } from '../sections/purge';

// ── showResult ──────────────────────────────────────────────

describe('showResult', () => {
  let container: HTMLElement;
  let resultEl: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    resultEl = document.createElement('div');
    resultEl.id = 'purge-result';
    resultEl.style.display = 'none';
    container.appendChild(resultEl);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('displays message text in the result element', () => {
    showResult(container, 'Purged 5 of 10 lobbies');
    expect(resultEl.textContent).toBe('Purged 5 of 10 lobbies');
  });

  it('sets green color for success messages', () => {
    showResult(container, 'Done');
    expect(resultEl.style.color).toBe('var(--green)');
  });

  it('sets red color for error messages', () => {
    showResult(container, 'Failed', true);
    expect(resultEl.style.color).toBe('var(--red)');
  });

  it('makes result element visible', () => {
    showResult(container, 'Done');
    expect(resultEl.style.display).toBe('block');
  });

  it('hides result element after 5 seconds', () => {
    showResult(container, 'Done');
    expect(resultEl.style.display).toBe('block');
    vi.advanceTimersByTime(5000);
    expect(resultEl.style.display).toBe('none');
  });

  it('does nothing if result element is missing', () => {
    const emptyContainer = document.createElement('div');
    // Should not throw
    expect(() => showResult(emptyContainer, 'message')).not.toThrow();
  });
});

// ── renderPurge ─────────────────────────────────────────────

describe('renderPurge', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'section-purge';
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('renders without crashing', () => {
    expect(() => renderPurge(container)).not.toThrow();
  });

  it('renders the Admin Actions heading', () => {
    renderPurge(container);
    expect(container.innerHTML).toContain('Admin Actions');
  });

  it('renders all 8 purge buttons (6 actions + export + import)', () => {
    renderPurge(container);
    const buttons = container.querySelectorAll('button.purge-btn');
    expect(buttons).toHaveLength(8);
  });

  it('renders lobby purge buttons with correct ids', () => {
    renderPurge(container);
    expect(container.querySelector('#purge-all-lobbies')).not.toBeNull();
    expect(container.querySelector('#purge-unknown-lobbies')).not.toBeNull();
    expect(container.querySelector('#purge-waiting-lobbies')).not.toBeNull();
    expect(container.querySelector('#purge-stale-lobbies')).not.toBeNull();
  });

  it('renders data purge buttons with correct ids', () => {
    renderPurge(container);
    expect(container.querySelector('#purge-all-matches')).not.toBeNull();
    expect(container.querySelector('#purge-all-reports')).not.toBeNull();
  });

  it('renders hidden result element for status messages', () => {
    renderPurge(container);
    const result = container.querySelector<HTMLElement>('#purge-result');
    expect(result).not.toBeNull();
    expect(result!.style.display).toBe('none');
  });

  it('renders confirmation instructions', () => {
    renderPurge(container);
    expect(container.innerHTML).toContain('double-click confirmation');
  });
});
