// admin/src/sections/__tests__/perfTracker.test.ts — Perf Tracker section tests

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock UI deps ────────────────────────────────────────────
vi.mock('../../ui/render', () => ({
  escapeHtml: (s: string): string =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;'),
}));

vi.mock('../../ui/icons', () => ({
  icon: (_name: string): string => '<svg></svg>',
}));

import {
  renderPerfTracker,
  renderLineChartSvg,
  buildChartPoints,
  computeDelta,
  sortNewestFirst,
  sortOldestFirst,
  composeIngestFromBudget,
  renderHistoryTable,
  METRICS,
  type PerfSample,
} from '../perfTracker';

// ── Fixtures ────────────────────────────────────────────────
function makeSample(over: Partial<PerfSample> = {}): PerfSample {
  return {
    id: `perf_${Math.random().toString(36).slice(2, 8)}`,
    version: 'v1.0.0',
    commit: 'abc1234',
    timestamp: Date.now(),
    metrics: { avgFrameTime: 16, p95FrameTime: 22, loadTimeMs: 800, bundleSizeKb: 2400 },
    source: 'manual',
    ...over,
  };
}

// ── sortOldestFirst / sortNewestFirst ───────────────────────
describe('sortOldestFirst / sortNewestFirst', () => {
  const a = makeSample({ id: 'a', timestamp: 1000 });
  const b = makeSample({ id: 'b', timestamp: 3000 });
  const c = makeSample({ id: 'c', timestamp: 2000 });

  it('sortOldestFirst returns ascending by timestamp', () => {
    const out = sortOldestFirst([a, b, c]);
    expect(out.map(s => s.id)).toEqual(['a', 'c', 'b']);
  });

  it('sortNewestFirst returns descending by timestamp', () => {
    const out = sortNewestFirst([a, b, c]);
    expect(out.map(s => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate input', () => {
    const input = [b, a, c];
    sortOldestFirst(input);
    expect(input.map(s => s.id)).toEqual(['b', 'a', 'c']);
  });
});

// ── buildChartPoints ────────────────────────────────────────
describe('buildChartPoints', () => {
  it('returns empty points when no samples', () => {
    const out = buildChartPoints([], 'avgFrameTime', 400, 100, 10);
    expect(out.points).toEqual([]);
  });

  it('returns one point per sample with numeric metric', () => {
    const samples = [
      makeSample({ id: 'a', timestamp: 1, metrics: { avgFrameTime: 10 } }),
      makeSample({ id: 'b', timestamp: 2, metrics: { avgFrameTime: 20 } }),
      makeSample({ id: 'c', timestamp: 3, metrics: { avgFrameTime: 15 } }),
    ];
    const out = buildChartPoints(samples, 'avgFrameTime', 400, 100, 10);
    expect(out.points).toHaveLength(3);
    expect(out.minV).toBe(10);
    expect(out.maxV).toBe(20);
  });

  it('skips samples where metric is missing', () => {
    const samples = [
      makeSample({ id: 'a', metrics: { avgFrameTime: 10 } }),
      makeSample({ id: 'b', metrics: {} }),
      makeSample({ id: 'c', metrics: { avgFrameTime: 15 } }),
    ];
    const out = buildChartPoints(samples, 'avgFrameTime', 400, 100, 10);
    expect(out.points).toHaveLength(2);
  });

  it('places min value at bottom, max value at top', () => {
    const samples = [
      makeSample({ id: 'a', timestamp: 1, metrics: { avgFrameTime: 10 } }),
      makeSample({ id: 'b', timestamp: 2, metrics: { avgFrameTime: 20 } }),
    ];
    const out = buildChartPoints(samples, 'avgFrameTime', 400, 100, 10);
    const minPoint = out.points.find(p => p.value === 10)!;
    const maxPoint = out.points.find(p => p.value === 20)!;
    // SVG y: lower = top, so max should have smaller y
    expect(maxPoint.y).toBeLessThan(minPoint.y);
  });
});

// ── renderLineChartSvg ──────────────────────────────────────
describe('renderLineChartSvg', () => {
  const metric = METRICS.find(m => m.key === 'avgFrameTime')!;

  it('renders a no-data SVG when samples are empty', () => {
    const svg = renderLineChartSvg([], metric);
    expect(svg).toContain('<svg');
    expect(svg).toContain('No data');
    expect(svg).toContain('data-point-count="0"');
  });

  it('renders the correct number of points for N samples', () => {
    const samples = Array.from({ length: 5 }, (_, i) =>
      makeSample({ id: `s${i}`, timestamp: i * 1000, metrics: { avgFrameTime: 10 + i } }),
    );
    const svg = renderLineChartSvg(samples, metric);
    expect(svg).toContain('data-point-count="5"');
    const circles = svg.match(/<circle /g) ?? [];
    expect(circles).toHaveLength(5);
  });

  it('includes polyline with coordinates', () => {
    const samples = [
      makeSample({ id: 'a', timestamp: 1, metrics: { avgFrameTime: 10 } }),
      makeSample({ id: 'b', timestamp: 2, metrics: { avgFrameTime: 15 } }),
    ];
    const svg = renderLineChartSvg(samples, metric);
    expect(svg).toMatch(/<polyline[^>]*points="[^"]+"/);
  });
});

// ── computeDelta ────────────────────────────────────────────
describe('computeDelta', () => {
  it('returns null when fewer than 2 samples', () => {
    const samples = [makeSample({ metrics: { avgFrameTime: 10 } })];
    expect(computeDelta(samples, 'avgFrameTime', true)).toBeNull();
  });

  it('returns null when metric is missing on one sample', () => {
    const samples = [
      makeSample({ timestamp: 1, metrics: {} }),
      makeSample({ timestamp: 2, metrics: { avgFrameTime: 10 } }),
    ];
    expect(computeDelta(samples, 'avgFrameTime', true)).toBeNull();
  });

  it('reports "up" (regression) when latest is higher and lowerBetter=true', () => {
    const samples = [
      makeSample({ timestamp: 1, metrics: { avgFrameTime: 10 } }),
      makeSample({ timestamp: 2, metrics: { avgFrameTime: 15 } }),
    ];
    const delta = computeDelta(samples, 'avgFrameTime', true);
    expect(delta).not.toBeNull();
    expect(delta!.direction).toBe('up');
    expect(delta!.diff).toBe(5);
    expect(delta!.current).toBe(15);
    expect(delta!.previous).toBe(10);
  });

  it('reports "down" (improvement) when latest is lower and lowerBetter=true', () => {
    const samples = [
      makeSample({ timestamp: 1, metrics: { avgFrameTime: 15 } }),
      makeSample({ timestamp: 2, metrics: { avgFrameTime: 10 } }),
    ];
    const delta = computeDelta(samples, 'avgFrameTime', true);
    expect(delta!.direction).toBe('down');
    expect(delta!.diff).toBe(-5);
  });

  it('reports "flat" when values are equal', () => {
    const samples = [
      makeSample({ timestamp: 1, metrics: { avgFrameTime: 10 } }),
      makeSample({ timestamp: 2, metrics: { avgFrameTime: 10 } }),
    ];
    const delta = computeDelta(samples, 'avgFrameTime', true);
    expect(delta!.direction).toBe('flat');
    expect(delta!.diff).toBe(0);
  });

  it('uses the oldest-first ordering regardless of input order', () => {
    const samples = [
      makeSample({ timestamp: 200, metrics: { avgFrameTime: 20 } }),
      makeSample({ timestamp: 100, metrics: { avgFrameTime: 10 } }),
    ];
    const delta = computeDelta(samples, 'avgFrameTime', true);
    expect(delta!.current).toBe(20);
    expect(delta!.previous).toBe(10);
  });

  it('inverts direction when lowerBetter=false', () => {
    const samples = [
      makeSample({ timestamp: 1, metrics: { avgFrameTime: 10 } }),
      makeSample({ timestamp: 2, metrics: { avgFrameTime: 15 } }),
    ];
    const delta = computeDelta(samples, 'avgFrameTime', false);
    expect(delta!.direction).toBe('down');   // higher value = improvement
  });
});

// ── renderHistoryTable ──────────────────────────────────────
describe('renderHistoryTable', () => {
  it('renders placeholder when no samples', () => {
    const html = renderHistoryTable([]);
    expect(html).toContain('No samples recorded yet');
  });

  it('renders one row per sample in provided order', () => {
    const samples = [
      makeSample({ id: 's1', version: 'v1.0.1' }),
      makeSample({ id: 's2', version: 'v1.0.0' }),
    ];
    const html = renderHistoryTable(samples);
    expect(html).toContain('v1.0.1');
    expect(html).toContain('v1.0.0');
    // s1 should appear before s2 (as given)
    expect(html.indexOf('v1.0.1')).toBeLessThan(html.indexOf('v1.0.0'));
  });

  it('escapes version and commit values', () => {
    const samples = [makeSample({ version: '<script>', commit: '<xss>' })];
    const html = renderHistoryTable(samples);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;xss&gt;');
  });

  it('limits rows to 20 even when given more', () => {
    const samples = Array.from({ length: 30 }, (_, i) =>
      makeSample({ id: `s${i}`, version: `v${i}` }),
    );
    const html = renderHistoryTable(samples);
    // 20 rows expected — count the <tr with data-sample-id
    const rows = html.match(/<tr data-sample-id=/g) ?? [];
    expect(rows).toHaveLength(20);
  });
});

// ── composeIngestFromBudget ─────────────────────────────────
describe('composeIngestFromBudget', () => {
  it('extracts bundleSizeKb and loadTimeMs from latest history entry', () => {
    const budget = {
      bundleSize: '2.3 MB',
      loadTime: '766ms',
      history: [
        { timestamp: '2026-04-09T16:07:42.251Z', bundleSize: 2424808, loadTime: 766, fps: null },
      ],
    };
    const body = composeIngestFromBudget(budget, 'v1.0.9', 'abc1234');
    expect(body.version).toBe('v1.0.9');
    expect(body.commit).toBe('abc1234');
    expect(body.metrics.bundleSizeKb).toBe(Math.round(2424808 / 1024));
    expect(body.metrics.loadTimeMs).toBe(766);
    expect(body.source).toBe('budget-ingest');
  });

  it('converts fps to avgFrameTime when present', () => {
    const budget = {
      history: [{ bundleSize: 1000, loadTime: 500, fps: 60 }],
    };
    const body = composeIngestFromBudget(budget);
    expect(body.metrics.avgFrameTime).toBe(Math.round((1000 / 60) * 100) / 100);
  });

  it('omits metrics when history is missing', () => {
    const body = composeIngestFromBudget({});
    expect(body.metrics.bundleSizeKb).toBeUndefined();
    expect(body.metrics.loadTimeMs).toBeUndefined();
    expect(body.metrics.avgFrameTime).toBeUndefined();
  });

  it('uses default version and commit when omitted', () => {
    const body = composeIngestFromBudget({});
    expect(body.version).toBe('dev');
    expect(body.commit).toBe('HEAD');
  });
});

// ── renderPerfTracker (integration) ─────────────────────────
describe('renderPerfTracker', () => {
  let container: HTMLElement;
  const mockFetch = vi.fn();

  beforeEach(() => {
    document.body.innerHTML = '<div id="perf"></div>';
    container = document.getElementById('perf')!;
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('renders header and buttons', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
    const cleanup = renderPerfTracker(container);
    // wait for initial draw
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(container.innerHTML).toContain('Performance Benchmark Tracker');
    expect(container.querySelector('#perf-refresh')).toBeTruthy();
    expect(container.querySelector('#perf-ingest')).toBeTruthy();
    cleanup();
  });

  it('renders all four metric cards', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
    const cleanup = renderPerfTracker(container);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    const cards = container.querySelectorAll('.perf-metric-card');
    expect(cards).toHaveLength(METRICS.length);
    cleanup();
  });

  it('Ingest POST composes correct body shape via composeIngestFromBudget', async () => {
    // Called on initial draw + on ingest
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/__admin_perf/list') {
        return { ok: true, json: async () => [] };
      }
      if (url === '/data/perf-budget.json') {
        return {
          ok: true,
          json: async () => ({
            history: [{ bundleSize: 2000000, loadTime: 800, fps: 60 }],
          }),
        };
      }
      if (url === '/__admin_perf/sample') {
        const body = JSON.parse((init?.body as string) ?? '{}') as {
          version: string;
          commit: string;
          metrics: Record<string, number>;
          source: string;
        };
        // Stash on the mock for assertion
        (mockFetch as unknown as { _lastPostBody?: unknown })._lastPostBody = body;
        return { ok: true, json: async () => ({ ok: true, sample: { id: 'x' } }) };
      }
      return { ok: false, json: async () => ({}) };
    });

    const cleanup = renderPerfTracker(container);
    // initial draw
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    const ingestBtn = container.querySelector<HTMLButtonElement>('#perf-ingest');
    expect(ingestBtn).toBeTruthy();
    ingestBtn!.click();
    // allow async chain
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    const posted = (mockFetch as unknown as { _lastPostBody?: {
      version: string; commit: string; metrics: Record<string, number>; source: string;
    } })._lastPostBody;
    expect(posted).toBeDefined();
    expect(posted!.version).toBe('dev');
    expect(posted!.commit).toBe('HEAD');
    expect(posted!.source).toBe('budget-ingest');
    expect(posted!.metrics.bundleSizeKb).toBe(Math.round(2000000 / 1024));
    expect(posted!.metrics.loadTimeMs).toBe(800);
    expect(posted!.metrics.avgFrameTime).toBeCloseTo(16.67, 1);
    cleanup();
  });
});
