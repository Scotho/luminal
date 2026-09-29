// admin/src/sections/perfTracker.ts — Performance Benchmark Tracker
//
// Renders a dashboard section that charts per-sample perf metrics
// (avg frame time, p95 frame time, load time, bundle size) over time,
// lists recent samples, and exposes a "Refresh" + "Ingest from
// perf-budget.json" control pair.

import { escapeHtml } from '../ui/render';
import { icon } from '../ui/icons';

// ── Types (mirror perfRoutes.ts, kept local to avoid cross-imports) ─────────
export interface PerfSampleMetrics {
  avgFrameTime?: number;
  p95FrameTime?: number;
  loadTimeMs?: number;
  bundleSizeKb?: number;
}

export interface PerfSample {
  id: string;
  version: string;
  commit: string;
  timestamp: number;
  metrics: PerfSampleMetrics;
  source?: string;
  notes?: string;
}

export interface MetricConfig {
  key: keyof PerfSampleMetrics;
  label: string;
  color: string;
  unit: string;
  /** True if lower is better (frame time, load, bundle). */
  lowerBetter: boolean;
}

export const METRICS: MetricConfig[] = [
  { key: 'avgFrameTime',  label: 'Avg Frame Time', color: '#38bdf8', unit: 'ms', lowerBetter: true },
  { key: 'p95FrameTime',  label: 'P95 Frame Time', color: '#a78bfa', unit: 'ms', lowerBetter: true },
  { key: 'loadTimeMs',    label: 'Load Time',      color: '#fb923c', unit: 'ms', lowerBetter: true },
  { key: 'bundleSizeKb',  label: 'Bundle Size',    color: '#34d399', unit: 'kb', lowerBetter: true },
];

// ── Pure helpers (exported for tests) ───────────────────────────────────────

/** Sort samples oldest-first for chart rendering. */
export function sortOldestFirst(samples: PerfSample[]): PerfSample[] {
  return [...samples].sort((a, b) => a.timestamp - b.timestamp);
}

/** Sort samples newest-first for table display. */
export function sortNewestFirst(samples: PerfSample[]): PerfSample[] {
  return [...samples].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Compute delta indicator for the latest sample vs the previous.
 * Returns `null` if either value is missing.
 * `direction` is 'up' (regression) or 'down' (improvement) relative
 * to `lowerBetter`.
 */
export function computeDelta(
  samples: PerfSample[],
  key: keyof PerfSampleMetrics,
  lowerBetter: boolean,
): { current: number; previous: number; diff: number; direction: 'up' | 'down' | 'flat' } | null {
  const oldest = sortOldestFirst(samples);
  if (oldest.length < 2) return null;
  const curr = oldest[oldest.length - 1].metrics[key];
  const prev = oldest[oldest.length - 2].metrics[key];
  if (typeof curr !== 'number' || typeof prev !== 'number') return null;
  const diff = curr - prev;
  let direction: 'up' | 'down' | 'flat' = 'flat';
  if (diff > 0) direction = lowerBetter ? 'up' : 'down';
  else if (diff < 0) direction = lowerBetter ? 'down' : 'up';
  return { current: curr, previous: prev, diff, direction };
}

/** Build SVG line chart points for a given metric. */
export function buildChartPoints(
  samples: PerfSample[],
  key: keyof PerfSampleMetrics,
  width: number,
  height: number,
  padding: number,
): { points: Array<{ x: number; y: number; value: number; sample: PerfSample }>; minV: number; maxV: number } {
  const ordered = sortOldestFirst(samples).filter(s => typeof s.metrics[key] === 'number');
  if (ordered.length === 0) return { points: [], minV: 0, maxV: 0 };

  const values = ordered.map(s => s.metrics[key] as number);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const step = ordered.length > 1 ? innerW / (ordered.length - 1) : 0;

  const points = ordered.map((sample, i) => {
    const value = sample.metrics[key] as number;
    const x = padding + step * i;
    const y = padding + innerH - ((value - minV) / range) * innerH;
    return { x, y, value, sample };
  });
  return { points, minV, maxV };
}

/** Render SVG markup for a single metric line chart. */
export function renderLineChartSvg(
  samples: PerfSample[],
  metric: MetricConfig,
  width = 560,
  height = 120,
): string {
  const padding = 20;
  const { points, minV, maxV } = buildChartPoints(samples, metric.key, width, height, padding);

  if (points.length === 0) {
    return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" class="perf-chart" data-metric="${metric.key}" data-point-count="0">
      <rect x="0" y="0" width="${width}" height="${height}" fill="var(--bg-panel-alt)" rx="6" />
      <text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="var(--text-dim)" font-size="11" font-family="var(--font-mono)">No data</text>
    </svg>`;
  }

  const polyline = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const dots = points.map(p => {
    const title = `${escapeHtml(p.sample.version)} @ ${escapeHtml(p.sample.commit)} — ${p.value}${metric.unit}`;
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${metric.color}"><title>${title}</title></circle>`;
  }).join('');

  const minLabel = `${Math.round(minV)}${metric.unit}`;
  const maxLabel = `${Math.round(maxV)}${metric.unit}`;

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" class="perf-chart" data-metric="${metric.key}" data-point-count="${points.length}" role="img" aria-label="${escapeHtml(metric.label)} trend">
    <rect x="0" y="0" width="${width}" height="${height}" fill="var(--bg-panel-alt)" rx="6" />
    <text x="6" y="14" fill="var(--text-dim)" font-size="9" font-family="var(--font-mono)">${escapeHtml(maxLabel)}</text>
    <text x="6" y="${height - 6}" fill="var(--text-dim)" font-size="9" font-family="var(--font-mono)">${escapeHtml(minLabel)}</text>
    <polyline fill="none" stroke="${metric.color}" stroke-width="1.5" points="${polyline}" />
    ${dots}
  </svg>`;
}

/** Render a single perf stat card with chart and delta indicator. */
function renderMetricCard(samples: PerfSample[], metric: MetricConfig): string {
  const delta = computeDelta(samples, metric.key, metric.lowerBetter);
  const latest = sortOldestFirst(samples).reverse().find(s => typeof s.metrics[metric.key] === 'number');
  const latestValue = latest ? latest.metrics[metric.key] : null;

  let deltaHtml = '<span style="color:var(--text-quiet);font-size:10px;">—</span>';
  if (delta) {
    const arrow = delta.direction === 'up'
      ? '<span style="color:var(--red, #ef4444);font-weight:700;">&#9650;</span>'
      : delta.direction === 'down'
        ? '<span style="color:var(--green, #22c55e);font-weight:700;">&#9660;</span>'
        : '<span style="color:var(--text-dim);">=</span>';
    const sign = delta.diff > 0 ? '+' : '';
    deltaHtml = `<span style="font-size:10px;">${arrow} ${sign}${delta.diff.toFixed(2)}${metric.unit}</span>`;
  }

  const valueText = typeof latestValue === 'number' ? `${latestValue}${metric.unit}` : '—';

  return `
    <div class="perf-metric-card" data-metric="${metric.key}" style="background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
        <span style="font-family:var(--font-display);font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--text-heading);text-transform:uppercase;">${escapeHtml(metric.label)}</span>
        ${deltaHtml}
      </div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;">
        <span style="font-family:var(--font-mono);font-size:18px;color:var(--text);">${escapeHtml(valueText)}</span>
      </div>
      ${renderLineChartSvg(samples, metric)}
    </div>
  `;
}

/** Render the history table — accepts samples already sorted newest-first. */
export function renderHistoryTable(samples: PerfSample[]): string {
  if (samples.length === 0) {
    return `<p style="color:var(--text-dim);font-size:12px;text-align:center;padding:20px;">No samples recorded yet. Click "Ingest from perf-budget.json" to seed.</p>`;
  }

  const rows = samples.slice(0, 20).map(s => {
    const date = new Date(s.timestamp);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
    const m = s.metrics;
    return `<tr data-sample-id="${escapeHtml(s.id)}">
      <td style="padding:6px 8px;">${escapeHtml(s.version)}</td>
      <td style="padding:6px 8px;font-family:var(--font-mono);font-size:10px;color:var(--text-dim);">${escapeHtml(s.commit)}</td>
      <td style="padding:6px 8px;color:var(--text-dim);font-size:10px;">${dateStr}</td>
      <td style="padding:6px 8px;text-align:right;font-family:var(--font-mono);font-size:11px;">${m.avgFrameTime != null ? `${m.avgFrameTime}ms` : '—'}</td>
      <td style="padding:6px 8px;text-align:right;font-family:var(--font-mono);font-size:11px;">${m.p95FrameTime != null ? `${m.p95FrameTime}ms` : '—'}</td>
      <td style="padding:6px 8px;text-align:right;font-family:var(--font-mono);font-size:11px;">${m.loadTimeMs != null ? `${m.loadTimeMs}ms` : '—'}</td>
      <td style="padding:6px 8px;text-align:right;font-family:var(--font-mono);font-size:11px;">${m.bundleSizeKb != null ? `${m.bundleSizeKb}kb` : '—'}</td>
      <td style="padding:6px 8px;color:var(--text-dim);font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s.notes ?? '')}</td>
      <td style="padding:6px 8px;text-align:right;">
        <button class="perf-delete-btn" data-sample-id="${escapeHtml(s.id)}" style="background:none;border:1px solid var(--border);color:var(--text-dim);border-radius:3px;font-size:10px;padding:2px 6px;cursor:pointer;" title="Delete sample">&times;</button>
      </td>
    </tr>`;
  }).join('');

  return `
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:1px solid var(--border);color:var(--text-quiet);font-size:9px;text-transform:uppercase;letter-spacing:1px;">
          <th style="padding:6px 8px;text-align:left;">Version</th>
          <th style="padding:6px 8px;text-align:left;">Commit</th>
          <th style="padding:6px 8px;text-align:left;">When</th>
          <th style="padding:6px 8px;text-align:right;">Avg FT</th>
          <th style="padding:6px 8px;text-align:right;">P95 FT</th>
          <th style="padding:6px 8px;text-align:right;">Load</th>
          <th style="padding:6px 8px;text-align:right;">Bundle</th>
          <th style="padding:6px 8px;text-align:left;">Notes</th>
          <th style="padding:6px 8px;"></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

/**
 * Compose a PerfSample request body from a perf-budget.json payload.
 * Exported for tests so the ingest composition can be verified.
 */
export function composeIngestFromBudget(
  budget: Record<string, unknown>,
  version = 'dev',
  commit = 'HEAD',
): { version: string; commit: string; metrics: PerfSampleMetrics; source: string; notes: string } {
  const metrics: PerfSampleMetrics = {};
  // Best-effort extraction from the shape emitted by scripts/perf-budget.ts:
  // { bundleSize: "2.3 MB", loadTime: "766ms", fps: null, lighthouse: null, history: [...] }
  const history = Array.isArray(budget['history']) ? budget['history'] as Array<Record<string, unknown>> : [];
  const latest = history.length > 0 ? history[history.length - 1] : undefined;

  const rawBundle = latest && typeof latest['bundleSize'] === 'number' ? latest['bundleSize'] : undefined;
  if (typeof rawBundle === 'number') {
    metrics.bundleSizeKb = Math.round(rawBundle / 1024);
  }
  const rawLoad = latest && typeof latest['loadTime'] === 'number' ? latest['loadTime'] : undefined;
  if (typeof rawLoad === 'number') {
    metrics.loadTimeMs = rawLoad;
  }
  const rawFps = latest && typeof latest['fps'] === 'number' ? latest['fps'] : null;
  if (typeof rawFps === 'number' && rawFps > 0) {
    metrics.avgFrameTime = Math.round((1000 / rawFps) * 100) / 100;
  }

  return {
    version,
    commit,
    metrics,
    source: 'budget-ingest',
    notes: `Auto-ingested from perf-budget.json at ${new Date().toISOString()}`,
  };
}

// ── Section renderer ────────────────────────────────────────────────────────

async function fetchSamples(): Promise<PerfSample[]> {
  try {
    const res = await fetch('/__admin_perf/list');
    if (!res.ok) return [];
    return (await res.json()) as PerfSample[];
  } catch {
    return [];
  }
}

async function ingestFromBudget(): Promise<{ ok: boolean; message: string }> {
  try {
    const budgetRes = await fetch('/data/perf-budget.json');
    if (!budgetRes.ok) return { ok: false, message: 'perf-budget.json not found' };
    const budget = await budgetRes.json() as Record<string, unknown>;
    const body = composeIngestFromBudget(budget);
    if (Object.keys(body.metrics).length === 0) {
      return { ok: false, message: 'perf-budget.json has no numeric metrics to ingest' };
    }
    const postRes = await fetch('/__admin_perf/sample', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!postRes.ok) {
      const errJson = await postRes.json().catch(() => ({ error: 'unknown error' })) as { error?: string };
      return { ok: false, message: errJson.error ?? `HTTP ${postRes.status}` };
    }
    return { ok: true, message: 'Sample ingested.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function deleteSample(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/__admin_perf/sample?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

export function renderPerfTracker(container: HTMLElement): () => void {
  let disposed = false;

  const draw = async (): Promise<void> => {
    if (disposed) return;
    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <h2 style="margin:0;">${icon('activity', 18)} Performance Benchmark Tracker</h2>
        <div style="display:flex;gap:8px;">
          <button id="perf-refresh" class="refresh-btn">Refresh</button>
          <button id="perf-ingest" class="refresh-btn">Ingest from perf-budget.json</button>
        </div>
      </div>
      <div id="perf-status" style="min-height:16px;font-size:11px;color:var(--text-dim);margin-bottom:8px;"></div>
      <div id="perf-charts" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div style="color:var(--text-dim);font-size:11px;">Loading…</div>
      </div>
      <h3 style="font-family:var(--font-display);font-size:11px;font-weight:700;letter-spacing:2px;color:var(--text-heading);margin:16px 0 8px;">RECENT SAMPLES</h3>
      <div id="perf-table" style="overflow-x:auto;"></div>
      <p style="font-size:10px;color:var(--text-quiet);margin-top:12px;">
        Samples are stored in <code>admin/data/perf-history.json</code>. POST samples to
        <code>/__admin_perf/sample</code> from CI or e2e runs.
      </p>
    `;

    const samples = await fetchSamples();
    if (disposed) return;

    // Charts (newest-first data flows through sortOldestFirst inside helpers)
    const chartsEl = container.querySelector<HTMLElement>('#perf-charts');
    if (chartsEl) {
      chartsEl.innerHTML = METRICS.map(m => renderMetricCard(samples, m)).join('');
    }

    // Table
    const tableEl = container.querySelector<HTMLElement>('#perf-table');
    if (tableEl) {
      tableEl.innerHTML = renderHistoryTable(sortNewestFirst(samples));
    }

    // Wire delete buttons
    container.querySelectorAll<HTMLButtonElement>('.perf-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.sampleId;
        if (!id) return;
        const ok = await deleteSample(id);
        if (ok) void draw();
      });
    });
  };

  container.querySelector<HTMLButtonElement>('#perf-refresh')?.addEventListener('click', () => void draw());

  void draw().then(() => {
    if (disposed) return;
    container.querySelector<HTMLButtonElement>('#perf-refresh')?.addEventListener('click', () => void draw());
    container.querySelector<HTMLButtonElement>('#perf-ingest')?.addEventListener('click', async () => {
      const statusEl = container.querySelector<HTMLElement>('#perf-status');
      if (statusEl) statusEl.textContent = 'Ingesting…';
      const result = await ingestFromBudget();
      if (statusEl) {
        statusEl.textContent = result.message;
        statusEl.style.color = result.ok ? 'var(--green, #22c55e)' : 'var(--red, #ef4444)';
      }
      if (result.ok) void draw();
    });
  });

  return () => { disposed = true; };
}
