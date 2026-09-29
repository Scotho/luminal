// admin/src/sections/analytics.ts — Map/mode usage + performance budget
import { db } from '../firebase';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { escapeHtml } from '../ui/render';
import { icon } from '../ui/icons';

export async function renderAnalytics(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <h2 style="margin:0;">${icon('activity', 18)} Analytics</h2>
      <button id="analytics-refresh" class="refresh-btn">Refresh</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div>
        <h3 style="font-family:var(--font-display);font-size:11px;font-weight:700;letter-spacing:2px;color:var(--text-heading);margin:0 0 12px;">MAP USAGE</h3>
        <div id="analytics-maps"><p style="color:var(--text-dim);">Loading map data...</p></div>
      </div>
      <div>
        <h3 style="font-family:var(--font-display);font-size:11px;font-weight:700;letter-spacing:2px;color:var(--text-heading);margin:0 0 12px;">PERFORMANCE BUDGET</h3>
        <div id="analytics-perf"><p style="color:var(--text-dim);">Loading performance data...</p></div>
      </div>
    </div>
  `;

  await Promise.all([loadMapUsage(), loadPerfBudget()]);
  container.querySelector('#analytics-refresh')?.addEventListener('click', () => renderAnalytics(container));
}

async function loadMapUsage(): Promise<void> {
  const el = document.getElementById('analytics-maps');
  if (!el) return;

  const mapCounts: Record<string, number> = {};
  const modeCounts: Record<string, number> = {};

  try {
    const q = query(collection(db, 'matches'), orderBy('endedAt', 'desc'), limit(100));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      const data = d.data();
      const map = data.map ?? 'unknown';
      const mode = data.mode ?? 'standard';
      mapCounts[map] = (mapCounts[map] || 0) + 1;
      modeCounts[mode] = (modeCounts[mode] || 0) + 1;
    }
  } catch (err) {
    console.warn('[analytics] Failed to query match data:', err);
    el.innerHTML = '<p style="color:var(--text-dim);font-size:11px;">No match data available</p>';
    return;
  }

  const total = Object.values(mapCounts).reduce((a, b) => a + b, 0) || 1;

  const mapRows = Object.entries(mapCounts).sort(([, a], [, b]) => b - a).map(([map, count]) => {
    const pct = Math.round((count / total) * 100);
    return `
      <div style="margin-bottom:6px;">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;">
          <span>${escapeHtml(map)}</span>
          <span style="color:var(--text-dim);">${count} (${pct}%)</span>
        </div>
        <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:2px;"></div>
        </div>
      </div>
    `;
  }).join('');

  const modeRows = Object.entries(modeCounts).sort(([, a], [, b]) => b - a).map(([mode, count]) =>
    `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid var(--border);border-radius:2px;font-size:10px;margin:2px;">
      ${escapeHtml(mode)} <strong>${count}</strong>
    </span>`
  ).join('');

  el.innerHTML = `
    <div style="margin-bottom:16px;">${mapRows || '<p style="color:var(--text-dim);font-size:11px;">No map data</p>'}</div>
    <h4 style="font-size:10px;color:var(--text-dim);margin:0 0 6px;">GAME MODES</h4>
    <div style="display:flex;flex-wrap:wrap;gap:4px;">${modeRows}</div>
  `;
}

// ── Perf Budget Types ────────────────────────────────────────────────────────

interface PerfHistoryEntry {
  timestamp: string;
  bundleSize: number;
  bundleGzip: number;
  lighthouse: number | null;
  fps: number | null;
  loadTime: number;
}

interface PerfBudgetData {
  bundleSize?: string;
  lighthouse?: number | null;
  fps?: number | null;
  loadTime?: string;
  history?: PerfHistoryEntry[];
}

// Budget thresholds — keep in sync with scripts/perf-budget.ts
const THRESHOLDS = {
  maxBundleKB: 2048,
  maxLoadTimeMs: 3000,
  minLighthouse: 70,
  minFps: 55,
} as const;

// ── Trend & Chart Helpers ────────────────────────────────────────────────────

/** Return trend arrow + color for a metric where lower is better. */
function trendLowerBetter(current: number, previous: number): string {
  if (current < previous) return '<span style="color:#22c55e;font-weight:700;"> &#9650;</span>';
  if (current > previous) return '<span style="color:#ef4444;font-weight:700;"> &#9660;</span>';
  return '<span style="color:var(--text-dim);"> =</span>';
}

/** Return trend arrow + color for a metric where higher is better. */
function trendHigherBetter(current: number, previous: number): string {
  if (current > previous) return '<span style="color:#22c55e;font-weight:700;"> &#9650;</span>';
  if (current < previous) return '<span style="color:#ef4444;font-weight:700;"> &#9660;</span>';
  return '<span style="color:var(--text-dim);"> =</span>';
}

/** Render a CSS-based inline bar chart from numeric values (last N entries). */
function miniBarChart(values: number[], maxVal: number, color: string): string {
  if (values.length === 0) return '';
  const barWidth = Math.max(4, Math.floor(80 / values.length));
  const bars = values.map((v) => {
    const pct = maxVal > 0 ? Math.min(100, Math.round((v / maxVal) * 100)) : 0;
    return `<div style="width:${barWidth}px;height:${pct}%;min-height:1px;background:${color};border-radius:1px;" title="${v}"></div>`;
  }).join('');
  return `<div style="display:flex;align-items:flex-end;gap:1px;height:28px;margin-top:4px;">${bars}</div>`;
}

/** Return a red warning badge if threshold is exceeded. */
function warningBadge(label: string): string {
  return `<span style="display:inline-block;background:#ef4444;color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:2px;margin-left:4px;">${escapeHtml(label)}</span>`;
}

/** Build a stat card with optional trend indicator and threshold warning. */
function perfStatCard(
  value: string,
  label: string,
  trendHtml: string,
  chartHtml: string,
  exceeded: boolean,
): string {
  return `
    <div style="background:var(--bg-panel-alt);border-radius:6px;padding:10px 12px;border:1px solid ${exceeded ? '#ef4444' : 'var(--border)'};">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <span class="stat-val" style="font-size:18px;">${value}</span>
        ${trendHtml}
      </div>
      <div class="stat-label" style="font-size:10px;margin-top:2px;">
        ${escapeHtml(label)}${exceeded ? warningBadge('OVER BUDGET') : ''}
      </div>
      ${chartHtml}
    </div>
  `;
}

async function loadPerfBudget(): Promise<void> {
  const el = document.getElementById('analytics-perf');
  if (!el) return;

  let budget: PerfBudgetData = {};
  try {
    const res = await fetch('/data/perf-budget.json');
    if (res.ok) budget = await res.json() as PerfBudgetData;
  } catch (err) {
    console.warn('[analytics] Failed to load perf-budget.json:', err);
  }

  const hasBudgetData = !!(budget.bundleSize || budget.lighthouse || budget.fps || budget.loadTime);

  if (!hasBudgetData) {
    el.innerHTML = `
      <div style="padding:20px;text-align:center;color:var(--text-dim);font-size:12px;">
        <p style="margin:0 0 8px;">No performance data collected yet.</p>
        <p style="margin:0;font-size:10px;color:var(--text-quiet);">Run <code>npm run perf-budget</code> to generate metrics.</p>
      </div>
    `;
    return;
  }

  const history = budget.history ?? [];
  const last10 = history.slice(-10);
  const current = history.length > 0 ? history[history.length - 1] : null;
  const previous = history.length > 1 ? history[history.length - 2] : null;

  // ── Bundle Size card ─────────────────────────────────────
  const bundleSizes = last10.map((e) => e.bundleSize);
  const maxBundle = Math.max(...bundleSizes, 1);
  const bundleTrend = current && previous
    ? trendLowerBetter(current.bundleSize, previous.bundleSize) : '';
  const bundleExceeded = current !== null && current.bundleSize > THRESHOLDS.maxBundleKB * 1024;
  const bundleCard = perfStatCard(
    budget.bundleSize ?? '—', 'Bundle Size', bundleTrend,
    miniBarChart(bundleSizes, maxBundle, 'var(--accent, #38bdf8)'),
    bundleExceeded,
  );

  // ── Lighthouse card ──────────────────────────────────────
  const lhScores = last10.map((e) => e.lighthouse ?? 0);
  const lhTrend = current?.lighthouse != null && previous?.lighthouse != null
    ? trendHigherBetter(current.lighthouse, previous.lighthouse) : '';
  const lhExceeded = current?.lighthouse != null && current.lighthouse < THRESHOLDS.minLighthouse;
  const lhCard = perfStatCard(
    budget.lighthouse != null ? String(budget.lighthouse) : 'n/a', 'Lighthouse', lhTrend,
    miniBarChart(lhScores, 100, '#a78bfa'),
    lhExceeded,
  );

  // ── FPS card ─────────────────────────────────────────────
  const fpsValues = last10.map((e) => e.fps ?? 0);
  const fpsTrend = current?.fps != null && previous?.fps != null
    ? trendHigherBetter(current.fps, previous.fps) : '';
  const fpsExceeded = current?.fps != null && current.fps < THRESHOLDS.minFps;
  const fpsCard = perfStatCard(
    budget.fps != null ? String(budget.fps) : 'n/a', 'Avg FPS', fpsTrend,
    miniBarChart(fpsValues, 120, '#34d399'),
    fpsExceeded,
  );

  // ── Load Time card ───────────────────────────────────────
  const loadTimes = last10.map((e) => e.loadTime);
  const maxLoad = Math.max(...loadTimes, 1);
  const loadTrend = current && previous
    ? trendLowerBetter(current.loadTime, previous.loadTime) : '';
  const loadExceeded = current !== null && current.loadTime > THRESHOLDS.maxLoadTimeMs;
  const loadCard = perfStatCard(
    budget.loadTime ?? '—', 'Load Time', loadTrend,
    miniBarChart(loadTimes, maxLoad, '#fb923c'),
    loadExceeded,
  );

  // ── History table (last 5) ───────────────────────────────
  const last5 = history.slice(-5).reverse();
  const historyRows = last5.map((e) => {
    const date = new Date(e.timestamp);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
    const kb = Math.round(e.bundleSize / 1024);
    return `<tr style="font-size:10px;color:var(--text-dim);">
      <td style="padding:2px 6px;">${dateStr}</td>
      <td style="padding:2px 6px;text-align:right;">${kb} KB</td>
      <td style="padding:2px 6px;text-align:right;">${e.lighthouse ?? '—'}</td>
      <td style="padding:2px 6px;text-align:right;">${e.fps ?? '—'}</td>
      <td style="padding:2px 6px;text-align:right;">${e.loadTime}ms</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
      ${bundleCard}${lhCard}${fpsCard}${loadCard}
    </div>
    ${last5.length > 0 ? `
      <details style="margin-top:4px;">
        <summary style="font-size:10px;color:var(--text-dim);cursor:pointer;user-select:none;">
          History (${history.length} entries)
        </summary>
        <table style="width:100%;border-collapse:collapse;margin-top:4px;">
          <thead><tr style="font-size:9px;color:var(--text-quiet);text-transform:uppercase;letter-spacing:1px;">
            <th style="padding:2px 6px;text-align:left;">Date</th>
            <th style="padding:2px 6px;text-align:right;">Bundle</th>
            <th style="padding:2px 6px;text-align:right;">LH</th>
            <th style="padding:2px 6px;text-align:right;">FPS</th>
            <th style="padding:2px 6px;text-align:right;">Load</th>
          </tr></thead>
          <tbody>${historyRows}</tbody>
        </table>
      </details>` : ''}
    <p style="font-size:10px;color:var(--text-quiet);margin-top:8px;">
      Run <code>npm run perf-budget</code> to update. Thresholds: bundle &lt;${THRESHOLDS.maxBundleKB} KB, load &lt;${THRESHOLDS.maxLoadTimeMs}ms, LH &gt;${THRESHOLDS.minLighthouse}, FPS &gt;${THRESHOLDS.minFps}.
    </p>
  `;
}
