import { describe, it, expect } from 'vitest';
import { filterReports, paginateReports, renderBugRow, detectBursts } from '../sections/bugs';
import type { BugReport } from '../types';

function makeBug(overrides: Partial<BugReport> = {}): BugReport {
  return {
    id: 'bug-1',
    username: 'Scotho',
    uid: 'uid-123',
    gameMode: 'online',
    error: 'Cannot read properties of undefined',
    stack: 'at foo.ts:1',
    url: 'https://luminal-game.web.app',
    userAgent: 'Mozilla/5.0',
    ts: Date.now(),
    ...overrides,
  };
}

describe('filterReports', () => {
  const reports = [
    makeBug({ id: '1', username: 'Alice', error: 'null reference', gameMode: 'online' }),
    makeBug({ id: '2', username: 'Bob', error: 'WebSocket closed', gameMode: 'casual' }),
    makeBug({ id: '3', username: 'Alice', error: 'timeout waiting', gameMode: 'online', stack: 'at lobby.ts:50' }),
  ];

  it('returns all reports with empty search and "all" mode', () => {
    expect(filterReports(reports, '', 'all')).toHaveLength(3);
  });

  it('filters by search in error text (case insensitive)', () => {
    expect(filterReports(reports, 'websocket', 'all')).toHaveLength(1);
    expect(filterReports(reports, 'WEBSOCKET', 'all')).toHaveLength(1);
  });

  it('filters by search in username', () => {
    expect(filterReports(reports, 'alice', 'all')).toHaveLength(2);
  });

  it('filters by search in stack trace', () => {
    expect(filterReports(reports, 'lobby.ts', 'all')).toHaveLength(1);
  });

  it('filters by game mode', () => {
    expect(filterReports(reports, '', 'online')).toHaveLength(2);
    expect(filterReports(reports, '', 'casual')).toHaveLength(1);
  });

  it('combines search and mode filters', () => {
    expect(filterReports(reports, 'alice', 'online')).toHaveLength(2);
    expect(filterReports(reports, 'timeout', 'casual')).toHaveLength(0);
  });
});

describe('paginateReports', () => {
  const reports = Array.from({ length: 60 }, (_, i) => makeBug({ id: `bug-${i}` }));

  it('returns correct page size', () => {
    const { items } = paginateReports(reports, 1, 25);
    expect(items).toHaveLength(25);
  });

  it('returns correct total pages', () => {
    const { totalPages } = paginateReports(reports, 1, 25);
    expect(totalPages).toBe(3);
  });

  it('returns last page with fewer items', () => {
    const { items } = paginateReports(reports, 3, 25);
    expect(items).toHaveLength(10);
  });

  it('returns empty items for out-of-range page', () => {
    const { items } = paginateReports(reports, 99, 25);
    expect(items).toHaveLength(0);
  });

  it('returns 1 total page for empty array', () => {
    const { totalPages } = paginateReports([], 1, 25);
    expect(totalPages).toBe(1);
  });
});

describe('renderBugRow', () => {
  it('renders username and escaped error text', () => {
    const html = renderBugRow(makeBug({ username: 'Test<User>', error: 'bad <script>' }), false);
    expect(html).toContain('Test&lt;User&gt;');
    expect(html).toContain('bad &lt;script&gt;');
  });

  it('renders checkbox as checked when selected', () => {
    const html = renderBugRow(makeBug(), true);
    expect(html).toContain('checked');
  });

  it('renders checkbox as unchecked when not selected', () => {
    const html = renderBugRow(makeBug(), false);
    expect(html).not.toContain('checked');
  });

  it('includes data-report-id attribute', () => {
    const html = renderBugRow(makeBug({ id: 'abc-123' }), false);
    expect(html).toContain('data-report-id="abc-123"');
  });

  it('shows relative time', () => {
    const html = renderBugRow(makeBug({ ts: Date.now() - 5000 }), false);
    expect(html).toContain('ago');
  });
});

describe('detectBursts', () => {
  const now = Date.now();
  const WINDOW = 5 * 60 * 1000;

  it('returns empty for no reports', () => {
    expect(detectBursts([])).toEqual([]);
  });

  it('returns empty when reports are below threshold', () => {
    const reports = [
      makeBug({ id: '1', ts: now - 1000 }),
      makeBug({ id: '2', ts: now - 2000 }),
    ];
    expect(detectBursts(reports)).toEqual([]);
  });

  it('detects a burst when 3+ reports fall in the same 5-min window', () => {
    const windowBase = Math.floor(now / WINDOW) * WINDOW;
    const reports = [
      makeBug({ id: '1', ts: windowBase + 1000, error: 'null ref' }),
      makeBug({ id: '2', ts: windowBase + 2000, error: 'null ref' }),
      makeBug({ id: '3', ts: windowBase + 3000, error: 'timeout' }),
    ];
    const bursts = detectBursts(reports);
    expect(bursts).toHaveLength(1);
    expect(bursts[0].count).toBe(3);
  });

  it('clusters errors by message within a burst', () => {
    const windowBase = Math.floor(now / WINDOW) * WINDOW;
    const reports = [
      makeBug({ id: '1', ts: windowBase + 100, error: 'null ref' }),
      makeBug({ id: '2', ts: windowBase + 200, error: 'null ref' }),
      makeBug({ id: '3', ts: windowBase + 300, error: 'timeout' }),
      makeBug({ id: '4', ts: windowBase + 400, error: 'null ref' }),
    ];
    const bursts = detectBursts(reports);
    expect(bursts[0].topErrors[0].message).toBe('null ref');
    expect(bursts[0].topErrors[0].count).toBe(3);
  });

  it('ignores reports older than 1 hour', () => {
    const old = now - 2 * 3600_000;
    const windowBase = Math.floor(old / WINDOW) * WINDOW;
    const reports = [
      makeBug({ id: '1', ts: windowBase + 100, error: 'old error' }),
      makeBug({ id: '2', ts: windowBase + 200, error: 'old error' }),
      makeBug({ id: '3', ts: windowBase + 300, error: 'old error' }),
    ];
    expect(detectBursts(reports)).toEqual([]);
  });

  it('detects multiple bursts across different time windows', () => {
    const windowBase1 = Math.floor(now / WINDOW) * WINDOW;
    const windowBase2 = windowBase1 - WINDOW;
    const reports = [
      makeBug({ id: '1', ts: windowBase1 + 100, error: 'err A' }),
      makeBug({ id: '2', ts: windowBase1 + 200, error: 'err A' }),
      makeBug({ id: '3', ts: windowBase1 + 300, error: 'err A' }),
      makeBug({ id: '4', ts: windowBase2 + 100, error: 'err B' }),
      makeBug({ id: '5', ts: windowBase2 + 200, error: 'err B' }),
      makeBug({ id: '6', ts: windowBase2 + 300, error: 'err B' }),
    ];
    const bursts = detectBursts(reports);
    expect(bursts).toHaveLength(2);
    expect(bursts[0].windowStart).toBe(windowBase1); // most recent first
  });
});
