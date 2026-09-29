// admin/src/sections/flakinessTracker.ts — Historical pass/fail tracker for flaky test detection
import type { TestFlakinessRecord, TestFlakinessHistoryEntry } from '../types';
import { escapeHtml, statCard } from '../ui/render';
import { icon } from '../ui/icons';

// ── Module state ──────────────────────────────────────────────

type FilterMode = 'all' | 'flaky' | 'quarantined';

interface FlakinessUiState {
  records: TestFlakinessRecord[];
  filter: FilterMode;
  expanded: Set<string>;
  loading: boolean;
  error: string | null;
}

// ── Data fetching ─────────────────────────────────────────────

async function fetchRecords(): Promise<TestFlakinessRecord[]> {
  const res = await fetch('/__admin_flakiness/list');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as TestFlakinessRecord[];
  return Array.isArray(data) ? data : [];
}

async function postQuarantine(testName: string, quarantined: boolean, reason?: string): Promise<void> {
  const body: Record<string, unknown> = { testName, quarantined };
  if (reason) body.reason = reason;
  const res = await fetch('/__admin_flakiness/quarantine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`quarantine failed: ${res.status}`);
}

async function deleteRecord(testName: string): Promise<void> {
  const qs = new URLSearchParams({ testName });
  const res = await fetch(`/__admin_flakiness/record?${qs.toString()}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete failed: ${res.status}`);
}

// ── Pure helpers (exported for tests) ─────────────────────────

export function applyFilter(records: readonly TestFlakinessRecord[], mode: FilterMode): TestFlakinessRecord[] {
  switch (mode) {
    case 'flaky':
      return records.filter(r => r.flakinessScore > 0);
    case 'quarantined':
      return records.filter(r => r.quarantined);
    case 'all':
    default:
      return [...records];
  }
}

export function computeStats(records: readonly TestFlakinessRecord[]): { total: number; flaky: number; quarantined: number } {
  let flaky = 0;
  let quarantined = 0;
  for (const r of records) {
    if (r.flakinessScore > 0) flaky++;
    if (r.quarantined) quarantined++;
  }
  return { total: records.length, flaky, quarantined };
}

/**
 * Render history as a compact inline SVG sparkline where each run is a
 * colored vertical bar: green=pass, red=fail, grey=skip.
 */
export function renderSparkline(history: readonly TestFlakinessHistoryEntry[]): string {
  if (history.length === 0) return '<span style="color:var(--text-dim);font-size:10px;">(no history)</span>';
  const barW = 8;
  const gap = 2;
  const height = 20;
  const width = history.length * (barW + gap);
  const bars = history.map((h, i) => {
    const x = i * (barW + gap);
    const color = h.status === 'pass' ? 'var(--green,#4caf50)'
      : h.status === 'fail' ? 'var(--red,#d45234)'
      : 'var(--text-dim)';
    return `<rect x="${x}" y="0" width="${barW}" height="${height}" fill="${color}" />`;
  }).join('');
  return `<svg class="flakiness-spark" width="${width}" height="${height}" role="img" aria-label="Recent history">${bars}</svg>`;
}

function statusPill(status: TestFlakinessRecord['lastStatus']): string {
  const color = status === 'pass' ? 'var(--green,#4caf50)'
    : status === 'fail' ? 'var(--red,#d45234)'
    : 'var(--text-dim)';
  return `<span style="display:inline-block;padding:2px 6px;border-radius:3px;background:${color}22;color:${color};font-size:10px;font-weight:600;text-transform:uppercase;">${escapeHtml(status)}</span>`;
}

function renderRow(r: TestFlakinessRecord, expanded: boolean): string {
  const scoreColor = r.flakinessScore >= 0.5 ? 'var(--red,#d45234)'
    : r.flakinessScore > 0 ? 'var(--yellow,#e6b422)'
    : 'var(--text-dim)';
  const ratio = r.runs > 0 ? `${r.passes}/${r.fails}` : '0/0';
  return `
    <tr class="flakiness-row${expanded ? ' flakiness-row--expanded' : ''}" data-test-name="${escapeHtml(r.testName)}" style="cursor:pointer;border-bottom:1px solid var(--border);">
      <td style="padding:6px 8px;font-size:12px;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(r.testName)}">${escapeHtml(r.testName)}</td>
      <td style="padding:6px 8px;font-size:11px;color:var(--text-dim);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(r.file)}">${escapeHtml(r.file)}</td>
      <td style="padding:6px 8px;font-size:11px;text-align:right;">${r.runs}</td>
      <td style="padding:6px 8px;font-size:11px;text-align:right;">${escapeHtml(ratio)}</td>
      <td style="padding:6px 8px;font-size:11px;text-align:right;color:${scoreColor};font-weight:700;">${r.flakinessScore.toFixed(2)}</td>
      <td style="padding:6px 8px;text-align:center;">${statusPill(r.lastStatus)}</td>
      <td style="padding:6px 8px;text-align:center;">
        <label class="flakiness-quarantine" style="display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--text-dim);cursor:pointer;">
          <input type="checkbox" class="flakiness-quarantine-toggle" data-test-name="${escapeHtml(r.testName)}" ${r.quarantined ? 'checked' : ''} />
          <span>quarantine</span>
        </label>
      </td>
    </tr>
    ${expanded ? renderDetail(r) : ''}
  `;
}

function renderDetail(r: TestFlakinessRecord): string {
  const spark = renderSparkline(r.recentHistory);
  const lastRun = r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : '(never)';
  const reason = r.quarantineReason ? `<div><strong>Quarantine reason:</strong> ${escapeHtml(r.quarantineReason)}</div>` : '';
  return `
    <tr class="flakiness-detail" data-test-name="${escapeHtml(r.testName)}">
      <td colspan="7" style="padding:10px 16px;background:var(--bg-hover,rgba(255,255,255,0.02));font-size:11px;color:var(--text-dim);">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;">
          <span><strong>Recent runs:</strong></span>${spark}
        </div>
        <div><strong>Last run:</strong> ${escapeHtml(lastRun)}</div>
        <div><strong>Runs:</strong> ${r.runs} · <strong>Passes:</strong> ${r.passes} · <strong>Fails:</strong> ${r.fails}</div>
        ${reason}
        <div style="margin-top:8px;">
          <button class="refresh-btn flakiness-clear-btn" data-test-name="${escapeHtml(r.testName)}" style="font-size:10px;">Clear history</button>
        </div>
      </td>
    </tr>
  `;
}

// ── Main render ───────────────────────────────────────────────

export function renderFlakinessTracker(container: HTMLElement): () => void {
  const state: FlakinessUiState = {
    records: [],
    filter: 'all',
    expanded: new Set<string>(),
    loading: true,
    error: null,
  };

  let disposed = false;

  function scaffold(): void {
    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <h2 style="margin:0;">${icon('activity', 18)} Flakiness Tracker</h2>
        <div style="display:flex;gap:6px;align-items:center;">
          <select id="flakiness-filter" class="refresh-btn" style="font-size:11px;padding:4px 8px;">
            <option value="all">All tests</option>
            <option value="flaky">Only flaky (&gt; 0)</option>
            <option value="quarantined">Quarantined</option>
          </select>
          <button id="flakiness-refresh" class="refresh-btn">Refresh</button>
        </div>
      </div>
      <div id="flakiness-stats" style="display:flex;gap:8px;margin-bottom:12px;"></div>
      <div id="flakiness-body"></div>
    `;
  }

  function renderBody(): void {
    const bodyEl = container.querySelector<HTMLElement>('#flakiness-body');
    const statsEl = container.querySelector<HTMLElement>('#flakiness-stats');
    if (!bodyEl || !statsEl) return;

    if (state.loading) {
      bodyEl.innerHTML = '<p style="color:var(--text-dim);">Loading flakiness data...</p>';
      statsEl.innerHTML = '';
      return;
    }
    if (state.error) {
      bodyEl.innerHTML = `<p style="color:var(--red,#d45234);">Error: ${escapeHtml(state.error)}</p>`;
      statsEl.innerHTML = '';
      return;
    }

    const stats = computeStats(state.records);
    statsEl.innerHTML = [
      statCard(stats.total, 'Tracked'),
      statCard(stats.flaky, 'Flaky'),
      statCard(stats.quarantined, 'Quarantined'),
    ].join('');

    const filtered = applyFilter(state.records, state.filter);
    if (filtered.length === 0) {
      bodyEl.innerHTML = '<p style="color:var(--text-dim);font-size:12px;padding:12px;">No records match the current filter.</p>';
      return;
    }

    const rows = filtered.map(r => renderRow(r, state.expanded.has(r.testName))).join('');
    bodyEl.innerHTML = `
      <table class="flakiness-table" style="width:100%;border-collapse:collapse;font-family:var(--font-mono);">
        <thead>
          <tr style="border-bottom:1px solid var(--border);color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:1px;">
            <th style="padding:6px 8px;text-align:left;">Test</th>
            <th style="padding:6px 8px;text-align:left;">File</th>
            <th style="padding:6px 8px;text-align:right;">Runs</th>
            <th style="padding:6px 8px;text-align:right;">P/F</th>
            <th style="padding:6px 8px;text-align:right;">Score</th>
            <th style="padding:6px 8px;text-align:center;">Last</th>
            <th style="padding:6px 8px;text-align:center;">Action</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  async function load(): Promise<void> {
    state.loading = true;
    state.error = null;
    renderBody();
    try {
      state.records = await fetchRecords();
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    } finally {
      state.loading = false;
      if (!disposed) renderBody();
    }
  }

  function onClick(e: Event): void {
    const target = e.target as HTMLElement;

    // Quarantine toggle — handle before row expansion so the label click doesn't bubble into expansion.
    const toggle = target.closest<HTMLInputElement>('.flakiness-quarantine-toggle');
    if (toggle) {
      e.stopPropagation();
      const name = toggle.dataset['testName'] ?? '';
      if (!name) return;
      const checked = toggle.checked;
      const reason = checked ? (window.prompt('Quarantine reason (optional):') ?? undefined) : undefined;
      void postQuarantine(name, checked, reason).then(() => {
        const record = state.records.find(r => r.testName === name);
        if (record) {
          record.quarantined = checked;
          if (checked && reason) record.quarantineReason = reason;
          if (!checked) delete record.quarantineReason;
        }
        renderBody();
      }).catch(err => {
        console.warn('[flakinessTracker] quarantine failed', err);
      });
      return;
    }

    // Clear history — handle before row expansion toggle.
    const clearBtn = target.closest<HTMLElement>('.flakiness-clear-btn');
    if (clearBtn) {
      e.stopPropagation();
      const name = clearBtn.dataset['testName'] ?? '';
      if (!name) return;
      if (!window.confirm(`Clear history for ${name}?`)) return;
      void deleteRecord(name).then(() => {
        state.records = state.records.filter(r => r.testName !== name);
        state.expanded.delete(name);
        renderBody();
      }).catch(err => {
        console.warn('[flakinessTracker] delete failed', err);
      });
      return;
    }

    // Row click — toggle expansion.
    const row = target.closest<HTMLElement>('.flakiness-row');
    if (row) {
      const name = row.dataset['testName'] ?? '';
      if (!name) return;
      if (state.expanded.has(name)) state.expanded.delete(name);
      else state.expanded.add(name);
      renderBody();
    }
  }

  function onChange(e: Event): void {
    const target = e.target as HTMLElement;
    if (target.id === 'flakiness-filter') {
      const value = (target as HTMLSelectElement).value as FilterMode;
      state.filter = value === 'all' || value === 'flaky' || value === 'quarantined' ? value : 'all';
      renderBody();
    }
  }

  function onRefresh(): void {
    void load();
  }

  scaffold();
  container.addEventListener('click', onClick);
  container.addEventListener('change', onChange);
  const refreshBtn = container.querySelector<HTMLElement>('#flakiness-refresh');
  refreshBtn?.addEventListener('click', onRefresh);

  void load();

  return () => {
    disposed = true;
    container.removeEventListener('click', onClick);
    container.removeEventListener('change', onChange);
    refreshBtn?.removeEventListener('click', onRefresh);
  };
}
