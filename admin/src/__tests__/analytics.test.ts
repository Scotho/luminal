// ── Analytics section tests ────────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock firebase before import ────────────────────────────
vi.mock('../firebase', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
}));

vi.mock('../ui/render', () => ({
  escapeHtml: (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  statCard: (value: string | number, label: string) => `<div class="stat-card">${value} ${label}</div>`,
}));

vi.mock('../ui/icons', () => ({
  icon: (_name: string) => '<svg></svg>',
}));

import { renderAnalytics } from '../sections/analytics';

const mockFetchFn = vi.fn();

// ── Tests ──────────────────────────────────────────────────

describe('renderAnalytics', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="analytics-container"></div><div id="analytics-maps"></div><div id="analytics-perf"></div>';
    container = document.getElementById('analytics-container')!;
    vi.restoreAllMocks();
    mockFetchFn.mockReset();
    vi.stubGlobal('fetch', mockFetchFn);
  });

  it('renders Analytics heading', async () => {
    mockFetchFn.mockResolvedValue({ ok: false });
    await renderAnalytics(container);
    expect(container.innerHTML).toContain('Analytics');
  });

  it('renders MAP USAGE section header', async () => {
    mockFetchFn.mockResolvedValue({ ok: false });
    await renderAnalytics(container);
    expect(container.innerHTML).toContain('MAP USAGE');
  });

  it('renders PERFORMANCE BUDGET section header', async () => {
    mockFetchFn.mockResolvedValue({ ok: false });
    await renderAnalytics(container);
    expect(container.innerHTML).toContain('PERFORMANCE BUDGET');
  });

  it('renders refresh button', async () => {
    mockFetchFn.mockResolvedValue({ ok: false });
    await renderAnalytics(container);
    expect(container.querySelector('#analytics-refresh')).toBeTruthy();
  });

  it('renders performance empty state when no budget data', async () => {
    mockFetchFn.mockResolvedValue({ ok: true, json: async () => ({}) });
    await renderAnalytics(container);
    const perfEl = document.getElementById('analytics-perf');
    expect(perfEl?.innerHTML).toContain('No performance data collected yet');
  });

  it('renders perf stat cards when data exists', async () => {
    mockFetchFn.mockResolvedValue({
      ok: true,
      json: async () => ({
        bundleSize: '450KB',
        lighthouse: 92,
        fps: 60,
        loadTime: '1.2s',
      }),
    });
    await renderAnalytics(container);
    const perfEl = document.getElementById('analytics-perf');
    expect(perfEl?.innerHTML).toContain('450KB');
    expect(perfEl?.innerHTML).toContain('Bundle Size');
    expect(perfEl?.innerHTML).toContain('92');
    expect(perfEl?.innerHTML).toContain('Lighthouse');
    expect(perfEl?.innerHTML).toContain('60');
    expect(perfEl?.innerHTML).toContain('Avg FPS');
    expect(perfEl?.innerHTML).toContain('1.2s');
    expect(perfEl?.innerHTML).toContain('Load Time');
  });

  it('renders map empty state when firestore returns no docs', async () => {
    mockFetchFn.mockResolvedValue({ ok: false });
    await renderAnalytics(container);
    const mapsEl = document.getElementById('analytics-maps');
    // After firestore returns empty docs, map section shows "No map data"
    expect(mapsEl?.innerHTML).toContain('No map data');
  });

  it('renders perf-budget run instruction', async () => {
    mockFetchFn.mockResolvedValue({ ok: true, json: async () => ({}) });
    await renderAnalytics(container);
    const perfEl = document.getElementById('analytics-perf');
    expect(perfEl?.innerHTML).toContain('npm run perf-budget');
  });

  it('renders two-column grid layout', async () => {
    mockFetchFn.mockResolvedValue({ ok: false });
    await renderAnalytics(container);
    expect(container.innerHTML).toContain('grid-template-columns');
  });
});
