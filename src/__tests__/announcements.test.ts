// ── Announcement system tests ────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { filterAnnouncements, initAnnouncements, teardownAnnouncements } from '../announcements';
import type { Announcement } from '../announcements';

// ── Mock Firebase ───────────────────────────────────────

let _onValueCallback: ((snap: { val: () => unknown }) => void) | null = null;
const _mockUnsub = vi.fn();

vi.mock('../firebase', () => ({
  rtdb: {},
}));

vi.mock('firebase/database', () => ({
  ref: vi.fn(() => ({})),
  onValue: vi.fn((_ref: unknown, cb: (snap: { val: () => unknown }) => void) => {
    _onValueCallback = cb;
    return _mockUnsub;
  }),
}));

// ── Helpers ─────────────────────────────────────────────

/** Base timestamp used across filter tests. */
const BASE_NOW = 1700000000000;

function makeAnnouncement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: 'ann-1',
    text: 'Test announcement',
    type: 'info',
    priority: 5,
    active: true,
    startAt: BASE_NOW - 60_000,
    endAt: 0,
    createdBy: 'system',
    createdAt: BASE_NOW - 60_000,
    ...overrides,
  };
}

function makeRawMap(announcements: Announcement[]): Record<string, Partial<Announcement>> {
  const map: Record<string, Partial<Announcement>> = {};
  for (const ann of announcements) {
    const { id, ...rest } = ann;
    map[id] = rest;
  }
  return map;
}

// ── Tests ───────────────────────────────────────────────

describe('filterAnnouncements', () => {
  const NOW = BASE_NOW;

  it('returns empty array for null input', () => {
    expect(filterAnnouncements(null, NOW)).toEqual([]);
  });

  it('returns empty array for empty object', () => {
    expect(filterAnnouncements({}, NOW)).toEqual([]);
  });

  it('filters out inactive announcements', () => {
    const raw = makeRawMap([
      makeAnnouncement({ id: 'a1', active: false }),
      makeAnnouncement({ id: 'a2', active: true }),
    ]);
    const result = filterAnnouncements(raw, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a2');
  });

  it('filters out announcements that have not started yet', () => {
    const raw = makeRawMap([
      makeAnnouncement({ id: 'a1', startAt: NOW + 60_000 }),
      makeAnnouncement({ id: 'a2', startAt: NOW - 60_000 }),
    ]);
    const result = filterAnnouncements(raw, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a2');
  });

  it('filters out expired announcements', () => {
    const raw = makeRawMap([
      makeAnnouncement({ id: 'a1', endAt: NOW - 1000 }),
      makeAnnouncement({ id: 'a2', endAt: NOW + 60_000 }),
    ]);
    const result = filterAnnouncements(raw, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a2');
  });

  it('includes announcements with endAt === 0 (no expiry)', () => {
    const raw = makeRawMap([
      makeAnnouncement({ id: 'a1', endAt: 0 }),
    ]);
    const result = filterAnnouncements(raw, NOW);
    expect(result).toHaveLength(1);
  });

  it('sorts by priority ascending (1 = highest)', () => {
    const raw = makeRawMap([
      makeAnnouncement({ id: 'low', priority: 10 }),
      makeAnnouncement({ id: 'high', priority: 1 }),
      makeAnnouncement({ id: 'mid', priority: 5 }),
    ]);
    const result = filterAnnouncements(raw, NOW);
    expect(result.map(a => a.id)).toEqual(['high', 'mid', 'low']);
  });

  it('filters out announcements with empty text', () => {
    const raw = makeRawMap([
      makeAnnouncement({ id: 'a1', text: '' }),
      makeAnnouncement({ id: 'a2', text: 'Hello' }),
    ]);
    const result = filterAnnouncements(raw, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a2');
  });

  it('handles mixed valid and invalid entries', () => {
    const raw: Record<string, Partial<Announcement>> = {
      'valid': { text: 'OK', type: 'info', priority: 1, active: true, startAt: NOW - 1000, endAt: 0, createdBy: 'sys', createdAt: NOW },
      'missing-text': { type: 'info', priority: 1, active: true, startAt: NOW - 1000, endAt: 0 },
      'inactive': { text: 'Nope', type: 'info', priority: 1, active: false, startAt: NOW - 1000, endAt: 0 },
    };
    const result = filterAnnouncements(raw, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('valid');
  });
});

describe('initAnnouncements / teardownAnnouncements', () => {
  beforeEach(() => {
    _onValueCallback = null;
    _mockUnsub.mockClear();

    // Set up a minimal announcement panel in the DOM
    const existing = document.getElementById('announcement-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'announcement-panel';
    panel.innerHTML = `
      <span class="ann-close"></span>
      <div class="ann-header">ANNOUNCEMENT</div>
      <div class="ann-body"></div>
    `;
    document.body.appendChild(panel);
  });

  afterEach(() => {
    teardownAnnouncements();
    const panel = document.getElementById('announcement-panel');
    if (panel) panel.remove();
  });

  it('sets up a Firebase listener on init', () => {
    initAnnouncements();
    expect(_onValueCallback).not.toBeNull();
  });

  it('renders announcement text into DOM when data arrives', () => {
    initAnnouncements();

    const raw = makeRawMap([
      makeAnnouncement({ id: 'a1', text: 'Server maintenance at 10pm' }),
    ]);

    _onValueCallback?.({ val: () => raw });

    const body = document.querySelector('.ann-body');
    expect(body?.textContent).toBe('Server maintenance at 10pm');
  });

  it('renders type label in header based on announcement type', () => {
    initAnnouncements();

    const raw = makeRawMap([
      makeAnnouncement({ id: 'a1', type: 'maintenance' }),
    ]);

    _onValueCallback?.({ val: () => raw });

    const header = document.querySelector('.ann-header');
    expect(header?.textContent).toBe('MAINTENANCE');
  });

  it('shows indicator when multiple announcements exist', () => {
    initAnnouncements();

    const raw = makeRawMap([
      makeAnnouncement({ id: 'a1', priority: 1 }),
      makeAnnouncement({ id: 'a2', priority: 2 }),
    ]);

    _onValueCallback?.({ val: () => raw });

    const indicator = document.querySelector('.ann-indicator');
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toBe('1/2');
  });

  it('does not show indicator for single announcement', () => {
    initAnnouncements();

    const raw = makeRawMap([
      makeAnnouncement({ id: 'a1' }),
    ]);

    _onValueCallback?.({ val: () => raw });

    const indicator = document.querySelector('.ann-indicator');
    expect(indicator).toBeNull();
  });

  it('rotates announcements on interval', () => {
    vi.useFakeTimers();
    initAnnouncements();

    const raw = makeRawMap([
      makeAnnouncement({ id: 'first', text: 'First', priority: 1 }),
      makeAnnouncement({ id: 'second', text: 'Second', priority: 2 }),
    ]);

    _onValueCallback?.({ val: () => raw });

    const body = document.querySelector('.ann-body');
    expect(body?.textContent).toBe('First');

    vi.advanceTimersByTime(8_000);
    expect(body?.textContent).toBe('Second');

    vi.advanceTimersByTime(8_000);
    expect(body?.textContent).toBe('First');

    vi.useRealTimers();
  });

  it('teardown removes listener and hides panel', () => {
    initAnnouncements();

    const raw = makeRawMap([makeAnnouncement({ id: 'a1' })]);
    _onValueCallback?.({ val: () => raw });

    teardownAnnouncements();

    expect(_mockUnsub).toHaveBeenCalled();
    const panel = document.getElementById('announcement-panel');
    expect(panel?.classList.contains('announcement--visible')).toBe(false);
  });

  it('does not double-init if called twice', async () => {
    const { onValue } = vi.mocked(await import('firebase/database'));
    onValue.mockClear();

    initAnnouncements();
    initAnnouncements();

    // Should only have been called once (the second call is a no-op)
    // Note: first call was in this test, teardown clears state
    expect(onValue).toHaveBeenCalledTimes(1);
  });

  it('hides panel when no active announcements', () => {
    initAnnouncements();

    // First show something
    const raw = makeRawMap([makeAnnouncement({ id: 'a1' })]);
    _onValueCallback?.({ val: () => raw });

    // Then clear
    _onValueCallback?.({ val: () => null });

    const panel = document.getElementById('announcement-panel');
    expect(panel?.classList.contains('announcement--visible')).toBe(false);
  });
});
