// admin/src/sections/__tests__/flakinessTracker.test.ts — TASK-13
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { TestFlakinessRecord } from '../../types';
import {
  renderFlakinessTracker,
  applyFilter,
  computeStats,
  renderSparkline,
} from '../flakinessTracker';

// ── Fixture helpers ───────────────────────────────────────────

function makeRecord(partial: Partial<TestFlakinessRecord>): TestFlakinessRecord {
  return {
    testName: 'foo > bar',
    file: 'foo.test.ts',
    runs: 10,
    passes: 5,
    fails: 5,
    lastRunAt: Date.now(),
    lastStatus: 'pass',
    recentHistory: [],
    flakinessScore: 0.5,
    quarantined: false,
    ...partial,
  };
}

function setupContainer(): HTMLElement {
  document.body.innerHTML = '<div id="section-flakiness-tracker" class="section"></div>';
  return document.getElementById('section-flakiness-tracker')!;
}

let mockRecords: TestFlakinessRecord[] = [];
let quarantineCalls: Array<{ testName: string; quarantined: boolean; reason?: string }> = [];
let deleteCalls: string[] = [];

function installFetchMock(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/__admin_flakiness/list')) {
      return { ok: true, status: 200, json: async () => mockRecords } as Response;
    }
    if (url.includes('/__admin_flakiness/quarantine')) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      quarantineCalls.push(body);
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
    }
    if (url.includes('/__admin_flakiness/record') && init?.method === 'DELETE') {
      const parsed = new URL(url, 'http://localhost');
      deleteCalls.push(parsed.searchParams.get('testName') ?? '');
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }));
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

// ── Pure helper tests ──────────────────────────────────────────

describe('applyFilter', () => {
  const records: TestFlakinessRecord[] = [
    makeRecord({ testName: 'a', flakinessScore: 0, quarantined: false }),
    makeRecord({ testName: 'b', flakinessScore: 0.5, quarantined: false }),
    makeRecord({ testName: 'c', flakinessScore: 0, quarantined: true }),
  ];

  it('returns all records for mode=all', () => {
    expect(applyFilter(records, 'all')).toHaveLength(3);
  });

  it('returns only flaky records for mode=flaky', () => {
    const result = applyFilter(records, 'flaky');
    expect(result).toHaveLength(1);
    expect(result[0].testName).toBe('b');
  });

  it('returns only quarantined records for mode=quarantined', () => {
    const result = applyFilter(records, 'quarantined');
    expect(result).toHaveLength(1);
    expect(result[0].testName).toBe('c');
  });
});

describe('computeStats', () => {
  it('counts total, flaky, and quarantined correctly', () => {
    const records: TestFlakinessRecord[] = [
      makeRecord({ testName: 'a', flakinessScore: 0 }),
      makeRecord({ testName: 'b', flakinessScore: 0.3 }),
      makeRecord({ testName: 'c', flakinessScore: 0, quarantined: true }),
      makeRecord({ testName: 'd', flakinessScore: 0.8, quarantined: true }),
    ];
    const stats = computeStats(records);
    expect(stats.total).toBe(4);
    expect(stats.flaky).toBe(2);
    expect(stats.quarantined).toBe(2);
  });
});

describe('renderSparkline', () => {
  it('returns placeholder for empty history', () => {
    const html = renderSparkline([]);
    expect(html).toContain('no history');
  });

  it('emits one rect per entry with color per status', () => {
    const html = renderSparkline([
      { ts: 1, status: 'pass' },
      { ts: 2, status: 'fail' },
      { ts: 3, status: 'skip' },
    ]);
    const rectCount = (html.match(/<rect /g) ?? []).length;
    expect(rectCount).toBe(3);
    expect(html).toContain('green');
    expect(html).toContain('red');
    expect(html).toContain('<svg');
  });

  it('produces deterministic bar widths based on history length', () => {
    const html = renderSparkline([
      { ts: 1, status: 'pass' },
      { ts: 2, status: 'pass' },
    ]);
    // barW=8, gap=2 → width = 2*(8+2) = 20
    expect(html).toContain('width="20"');
  });
});

// ── Render / interaction tests ─────────────────────────────────

describe('renderFlakinessTracker', () => {
  beforeEach(() => {
    mockRecords = [];
    quarantineCalls = [];
    deleteCalls = [];
    installFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('renders scaffold with header, filter, and refresh button', async () => {
    const el = setupContainer();
    const cleanup = renderFlakinessTracker(el);
    await flushMicrotasks();
    expect(el.querySelector('#flakiness-filter')).not.toBeNull();
    expect(el.querySelector('#flakiness-refresh')).not.toBeNull();
    expect(el.querySelector('#flakiness-body')).not.toBeNull();
    cleanup();
  });

  it('renders empty-state when there are no records', async () => {
    mockRecords = [];
    const el = setupContainer();
    const cleanup = renderFlakinessTracker(el);
    await flushMicrotasks();
    const body = el.querySelector('#flakiness-body')!;
    expect(body.textContent).toContain('No records');
    cleanup();
  });

  it('renders rows for each record', async () => {
    mockRecords = [
      makeRecord({ testName: 'one', flakinessScore: 0.8 }),
      makeRecord({ testName: 'two', flakinessScore: 0.2 }),
    ];
    const el = setupContainer();
    const cleanup = renderFlakinessTracker(el);
    await flushMicrotasks();
    const rows = el.querySelectorAll('.flakiness-row');
    expect(rows.length).toBe(2);
    cleanup();
  });

  it('applies filter when dropdown changes', async () => {
    mockRecords = [
      makeRecord({ testName: 'clean', flakinessScore: 0 }),
      makeRecord({ testName: 'flaky1', flakinessScore: 0.5 }),
    ];
    const el = setupContainer();
    const cleanup = renderFlakinessTracker(el);
    await flushMicrotasks();

    const select = el.querySelector('#flakiness-filter') as HTMLSelectElement;
    select.value = 'flaky';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    const rows = el.querySelectorAll('.flakiness-row');
    expect(rows.length).toBe(1);
    expect(el.textContent).toContain('flaky1');
    cleanup();
  });

  it('expands a row on click and shows the sparkline detail', async () => {
    mockRecords = [
      makeRecord({
        testName: 'spark',
        recentHistory: [
          { ts: 1, status: 'pass' },
          { ts: 2, status: 'fail' },
        ],
      }),
    ];
    const el = setupContainer();
    const cleanup = renderFlakinessTracker(el);
    await flushMicrotasks();

    const row = el.querySelector<HTMLElement>('.flakiness-row')!;
    row.click();

    const detail = el.querySelector('.flakiness-detail');
    expect(detail).not.toBeNull();
    expect(detail!.querySelector('svg.flakiness-spark')).not.toBeNull();
    expect((detail!.querySelectorAll('svg.flakiness-spark rect')).length).toBe(2);
    cleanup();
  });

  it('calls quarantine endpoint when checkbox is toggled', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('flaky');
    mockRecords = [makeRecord({ testName: 't1', quarantined: false })];
    const el = setupContainer();
    const cleanup = renderFlakinessTracker(el);
    await flushMicrotasks();

    const toggle = el.querySelector<HTMLInputElement>('.flakiness-quarantine-toggle')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('click', { bubbles: true }));

    await flushMicrotasks();
    expect(quarantineCalls).toHaveLength(1);
    expect(quarantineCalls[0].testName).toBe('t1');
    expect(quarantineCalls[0].quarantined).toBe(true);
    promptSpy.mockRestore();
    cleanup();
  });

  it('cleanup function removes listeners without throwing', async () => {
    const el = setupContainer();
    const cleanup = renderFlakinessTracker(el);
    await flushMicrotasks();
    expect(() => cleanup()).not.toThrow();
  });
});
