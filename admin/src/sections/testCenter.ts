import { rtdb } from '../firebase';
import { ref, query, orderByChild, startAt, endAt, get } from 'firebase/database';
import { escapeHtml, sectionHeader, statCard, ago } from '../ui/render';
import { dispatchCC, dispatchOllama } from '../ui/ccPanel';
import { icon } from '../ui/icons';
import { getAvailablePools } from '../ui/agentPools';
import type { TestRun, BugReport } from '../types';
import {
  parseOutputLine, parseVitestJson, parseTestName,
  buildInvestigatePrompt, CONFIG_LABELS,
  TEST_CATALOG, TEST_PRESETS, type TestSuite,
} from './testRunnerHelpers';

// ── Types ────────────────────────────────────────────────────────────────────

type View =
  | { type: 'dashboard' }
  | { type: 'live-run'; config: string }
  | { type: 'run-detail'; run: TestRun };

interface QueueItem {
  suite: TestSuite;
  status: 'pending' | 'active' | 'done' | 'fail';
  result?: TestRun;
  startedAt?: number;
  finishedAt?: number;
}

interface SortState {
  column: string;
  direction: 'asc' | 'desc';
}

// ── State ────────────────────────────────────────────────────────────────────

let _container: HTMLElement | null = null;
let _activeTab: 'runner' | 'portal' = 'runner';
let _view: View = { type: 'dashboard' };
let _runs: TestRun[] = [];
let _claudeGuidance = true;
let _busy = false;
let _eventSource: EventSource | null = null;
let _e2eBugs: BugReport[] = [];

// Queue state
let _queue: QueueItem[] = [];
let _selectedSuites: Set<string> = new Set();
let _queueRunning = false;
let _queueResult: { done: number; failed: number; total: number; dispatchTarget: DispatchTarget; stopped?: boolean } | null = null;
let _queueElapsedTimer: ReturnType<typeof setInterval> | null = null;
let _queueStartedAt = 0;
let _queuePaused = false;
let _queueAborted = false;
let _currentAgentId: string | null = null;
let _currentTestName = '';

// History state
let _historySort: SortState = { column: 'date', direction: 'desc' };
let _historyPage = 0;
let _historyFilter = 'all';
const HISTORY_PAGE_SIZE = 25;

// Live-run mutable state
let _runStartedAt = 0;
let _runPassed = 0;
let _runFailed = 0;
let _runTotal = 0;
let _runFailures: Array<{ file: string; test: string; error: string }> = [];
let _accumulatedOutput: string[] = [];
let _elapsedTimer: ReturnType<typeof setInterval> | null = null;
let _runDone = false;
let _lastRunResult: TestRun | null = null;

// ── Persistence ──────────────────────────────────────────────────────────────

async function loadTestLog(): Promise<TestRun[]> {
  try {
    const res = await fetch('/data/test-log.json');
    if (!res.ok) return [];
    return await res.json() as TestRun[];
  } catch { return []; }
}

async function saveTestLog(runs: TestRun[]): Promise<void> {
  try {
    await fetch('/__admin_save?file=test-log.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(runs, null, 2),
    });
  } catch (e) { console.warn('Failed to save test log:', e); }
}

// ── Firebase helpers ─────────────────────────────────────────────────────────

async function fetchE2eBugs(): Promise<BugReport[]> {
  try {
    const snap = await get(query(ref(rtdb, 'debugReports'), orderByChild('ts')));
    if (!snap.exists()) return [];
    const all: BugReport[] = [];
    snap.forEach(child => {
      const val = child.val() as BugReport;
      if (val.gameMode === 'e2e-test') {
        all.push({ ...val, id: child.key! });
      }
    });
    return all.sort((a, b) => b.ts - a.ts);
  } catch { return []; }
}

async function fetchBugsInRange(startMs: number, endMs: number): Promise<BugReport[]> {
  try {
    const snap = await get(query(
      ref(rtdb, 'debugReports'),
      orderByChild('ts'),
      startAt(startMs),
      endAt(endMs),
    ));
    if (!snap.exists()) return [];
    const result: BugReport[] = [];
    snap.forEach(child => {
      const val = child.val() as BugReport;
      if (val.gameMode === 'e2e-test') {
        result.push({ ...val, id: child.key! });
      }
    });
    return result.sort((a, b) => b.ts - a.ts);
  } catch { return []; }
}

/** Race a promise against a timeout; returns fallback on timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatElapsedCompact(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function colorForType(type: 'pass' | 'fail' | 'info'): string {
  if (type === 'pass') return 'var(--green)';
  if (type === 'fail') return 'var(--red)';
  return 'var(--text-dim)';
}

function statusPip(run: TestRun): string {
  if (run.failed > 0) return '<span class="tc-pip tc-pip--fail"></span>';
  if (run.skipped > 0) return '<span class="tc-pip tc-pip--warn"></span>';
  return '<span class="tc-pip tc-pip--pass"></span>';
}

function configBadge(config: string): string {
  const label = CONFIG_LABELS[config] ?? config;
  return `<span class="tc-config-badge">${escapeHtml(label)}</span>`;
}

function computePassRate(runs: TestRun[]): string {
  if (runs.length === 0) return '--';
  const totalPassed = runs.reduce((s, r) => s + r.passed, 0);
  const totalTests = runs.reduce((s, r) => s + r.total, 0);
  if (totalTests === 0) return '--';
  return `${Math.round((totalPassed / totalTests) * 100)}%`;
}

function lastRunAgo(runs: TestRun[]): string {
  if (runs.length === 0) return '--';
  return ago(new Date(runs[0].startedAt).getTime());
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + '...';
}

function parseExpectedActual(stack: string): { expected?: string; actual?: string } {
  const expMatch = stack.match(/Expected:\s*(.+)/i);
  const actMatch = stack.match(/Actual:\s*(.+)/i);
  return {
    expected: expMatch?.[1]?.trim(),
    actual: actMatch?.[1]?.trim(),
  };
}

/** Check whether a local LLM (Qwen via Ollama) is available. */
function isLocalLlmAvailable(): boolean {
  return getAvailablePools().some(p => p.type === 'local');
}

// ── Dispatch helpers (DRY) ──────────────────────────────────────────────────

type DispatchTarget = 'claude' | 'qwen' | 'manual';

function getDispatchTarget(): DispatchTarget {
  if (_claudeGuidance) return 'claude';
  if (isLocalLlmAvailable()) return 'qwen';
  return 'manual';
}

async function dispatchInvestigation(label: string, prompt: string): Promise<DispatchTarget> {
  const target = getDispatchTarget();
  if (target === 'claude') await dispatchCC(label, prompt);
  else if (target === 'qwen') await dispatchOllama(label, prompt);
  return target;
}

/** Group catalog entries by their group field. */
function groupCatalog(): Map<string, TestSuite[]> {
  const map = new Map<string, TestSuite[]>();
  for (const suite of TEST_CATALOG) {
    const list = map.get(suite.group) ?? [];
    list.push(suite);
    map.set(suite.group, list);
  }
  return map;
}

/** Get sorted + filtered history runs. */
function getFilteredHistory(): TestRun[] {
  let filtered = _historyFilter === 'all'
    ? [..._runs]
    : _runs.filter(r => r.config === _historyFilter);

  const col = _historySort.column;
  const dir = _historySort.direction === 'asc' ? 1 : -1;

  filtered.sort((a, b) => {
    switch (col) {
      case 'status': {
        const sa = a.failed > 0 ? 2 : a.skipped > 0 ? 1 : 0;
        const sb = b.failed > 0 ? 2 : b.skipped > 0 ? 1 : 0;
        return (sa - sb) * dir;
      }
      case 'config': return a.config.localeCompare(b.config) * dir;
      case 'name': return a.config.localeCompare(b.config) * dir;
      case 'date': return (new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()) * dir;
      case 'duration': return (a.duration - b.duration) * dir;
      case 'result': {
        const ra = a.total > 0 ? a.passed / a.total : 0;
        const rb = b.total > 0 ? b.passed / b.total : 0;
        return (ra - rb) * dir;
      }
      case 'followup': {
        const fa = a.followup ? 1 : 0;
        const fb = b.followup ? 1 : 0;
        return (fa - fb) * dir;
      }
      default: return 0;
    }
  });

  return filtered;
}

function sortArrow(column: string): string {
  if (_historySort.column !== column) {
    return '<span class="tc-sort-arrow">\u2195</span>';
  }
  const arrow = _historySort.direction === 'asc' ? '\u2191' : '\u2193';
  return `<span class="tc-sort-arrow tc-sort-arrow--active">${arrow}</span>`;
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function renderTestCenter(container: HTMLElement): Promise<() => void> {
  _container = container;
  _runs = await withTimeout(loadTestLog(), 5_000, []);
  _e2eBugs = await withTimeout(fetchE2eBugs(), 5_000, []);
  _view = { type: 'dashboard' };
  _busy = false;
  _runDone = false;
  _lastRunResult = null;
  _queueResult = null;

  render();

  return () => {
    if (_eventSource) { _eventSource.close(); _eventSource = null; }
    if (_elapsedTimer) { clearInterval(_elapsedTimer); _elapsedTimer = null; }
  };
}

// ── Render dispatcher ────────────────────────────────────────────────────────

function renderTopTabs(): string {
  const tabs = [
    { id: 'runner', label: 'Runner' },
    { id: 'portal', label: 'Portal' },
  ];
  return `<div style="display:flex;gap:2px;margin-bottom:16px;border-bottom:1px solid var(--border);padding-bottom:0;">
    ${tabs.map(t => `<button class="tc-top-tab" data-tab="${t.id}" style="padding:8px 16px;font-size:12px;font-weight:600;border:none;border-bottom:2px solid ${_activeTab === t.id ? 'var(--accent)' : 'transparent'};background:transparent;color:${_activeTab === t.id ? 'var(--accent)' : 'var(--text-dim)'};cursor:pointer;transition:all 0.15s;">${t.label}</button>`).join('')}
  </div>`;
}

function wireTopTabs(): void {
  if (!_container) return;
  _container.querySelectorAll<HTMLElement>('.tc-top-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab as 'runner' | 'portal';
      if (tab === _activeTab) return;
      _activeTab = tab;
      render();
    });
  });
}

function render(): void {
  if (!_container) return;

  if (_activeTab === 'portal') {
    _container.innerHTML = renderTopTabs() + '<div id="tc-portal-mount"></div>';
    wireTopTabs();
    import('./tests').then(m => {
      const mount = document.getElementById('tc-portal-mount');
      if (mount) m.renderTests(mount);
    });
    return;
  }

  switch (_view.type) {
    case 'dashboard': renderDashboard(); break;
    case 'live-run': renderLiveRun(); break;
    case 'run-detail': renderRunDetail(_view.run); break;
  }
}

// ── View 1: Dashboard ────────────────────────────────────────────────────────

function renderDashboard(): void {
  if (!_container) return;

  const groups = groupCatalog();
  const filteredHistory = getFilteredHistory();
  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / HISTORY_PAGE_SIZE));
  if (_historyPage >= totalPages) _historyPage = totalPages - 1;
  const pageRuns = filteredHistory.slice(
    _historyPage * HISTORY_PAGE_SIZE,
    (_historyPage + 1) * HISTORY_PAGE_SIZE,
  );

  const uniqueConfigs = [...new Set(_runs.map(r => r.config))];

  _container.innerHTML = `
    ${renderTopTabs()}
    ${sectionHeader('Test Center', null, async () => {
      _runs = await withTimeout(loadTestLog(), 5_000, []);
      _e2eBugs = await withTimeout(fetchE2eBugs(), 5_000, []);
      renderDashboard();
    })}

    <!-- Stat Cards -->
    <div class="stat-grid">
      ${statCard(_runs.length, 'Total Runs')}
      ${statCard(computePassRate(_runs), 'Pass Rate')}
      ${statCard(lastRunAgo(_runs), 'Last Run')}
      ${statCard(_e2eBugs.length, 'E2E Bugs')}
      ${statCard(_queue.filter(q => q.status === 'pending' || q.status === 'active').length, 'Queue Length')}
    </div>

    <!-- Presets -->
    <div class="tc-section">
      <div class="tc-section-title">Quick Presets</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:4px;">
        ${TEST_PRESETS.map(p => `<button class="tc-preset-btn" data-preset="${escapeHtml(p.id)}" title="${escapeHtml(p.description)}" ${_queueRunning ? 'disabled' : ''} style="font-size:11px; padding:5px 12px; background:var(--bg-hover); border:1px solid var(--border); border-radius:4px; color:var(--text); cursor:pointer;">${escapeHtml(p.name)}</button>`).join('')}
      </div>
      <p style="font-size:10px; color:var(--text-dim); margin:4px 0 0;">Click a preset to load its test suites into the queue.</p>
    </div>

    <!-- Test Catalog -->
    <div class="tc-section">
      <div class="tc-section-title">Test Catalog</div>
      ${[...groups.entries()].map(([group, suites]) => {
        const checkedCount = suites.filter(s => _selectedSuites.has(s.id)).length;
        const allChecked = checkedCount === suites.length && suites.length > 0;
        return `
        <details class="tc-catalog-group">
          <summary>
            <input type="checkbox" class="tc-group-checkbox" data-group="${escapeHtml(group)}" ${allChecked ? 'checked' : ''} ${_queueRunning ? 'disabled' : ''}>
            ${escapeHtml(group)} <span class="tc-catalog-group-count">(${suites.length})</span>
          </summary>
          ${suites.map(s => `
            <div class="tc-catalog-item">
              <input type="checkbox" data-suite-id="${escapeHtml(s.id)}" ${_selectedSuites.has(s.id) ? 'checked' : ''}>
              <span class="tc-catalog-name">${escapeHtml(s.name)}</span>
              <span class="tc-catalog-config">${escapeHtml(s.config)}</span>
              <span class="tc-catalog-desc">${escapeHtml(s.description)}</span>
              <span class="tc-catalog-file">${escapeHtml(s.file)}</span>
            </div>
          `).join('')}
        </details>`;
      }).join('')}
      <div style="margin-top:10px; display:flex; gap:8px;">
        <button class="tc-action-btn" id="tc-add-to-queue" ${_selectedSuites.size === 0 ? 'disabled' : ''}>Add Selected to Queue (${_selectedSuites.size})</button>
        <button class="tc-action-btn" id="tc-select-all">Select All</button>
        <button class="tc-action-btn" id="tc-select-none">Clear Selection</button>
      </div>
    </div>

    <!-- Queue -->
    <div class="tc-section">
      <div class="tc-queue-panel${_queueRunning ? (_queuePaused ? ' tc-queue-panel--running tc-queue-panel--paused' : ' tc-queue-panel--running') : ''}">
        <div class="tc-queue-panel-header">
          <span class="tc-queue-panel-title">Queue (${_queue.length})</span>
          <div class="tc-queue-actions">
            <label class="tc-switch-label" id="tc-guidance-toggle" style="margin:0;">
              <span class="tc-switch ${_claudeGuidance ? 'tc-switch--on' : ''}">
                <span class="tc-switch-knob"></span>
              </span>
              <span class="tc-switch-text">Claude Guidance</span>
            </label>
            ${_queueRunning ? `
              <button class="tc-pause-btn" id="tc-pause-resume">${_queuePaused ? '\u25B6 Resume' : '\u23F8 Pause'}</button>
              <button class="tc-stop-btn" id="tc-stop-all">\u25A0 Stop All</button>
            ` : `
              <button class="tc-run-btn" id="tc-run-queue" ${_queue.length === 0 ? 'disabled' : ''}>\u25B6 Run Queue</button>
              <button class="tc-action-btn" id="tc-clear-queue" ${_queue.length === 0 ? 'disabled' : ''}>Clear</button>
            `}
          </div>
        </div>
        ${_queueRunning ? (() => {
          const done = _queue.filter(q => q.status === 'done' || q.status === 'fail').length;
          const total = _queue.length;
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          const activeItem = _queue.find(q => q.status === 'active');
          return `
            <div class="tc-queue-banner${_queuePaused ? ' tc-queue-banner--paused' : ''}">
              <div class="tc-queue-banner-left">
                <span class="tc-queue-banner-dot"></span>
                <span class="tc-queue-banner-label">${_queuePaused ? 'Paused' : 'Running'}${activeItem ? ': ' + escapeHtml(activeItem.suite.name) : ''}</span>
                ${_currentTestName ? `<span class="tc-queue-banner-test">\u2514 ${escapeHtml(_currentTestName)}</span>` : ''}
              </div>
              <div class="tc-queue-banner-right">
                <span class="tc-queue-banner-progress">${done}/${total}</span>
                <span class="tc-queue-banner-elapsed">${formatElapsedCompact(Date.now() - _queueStartedAt)}</span>
              </div>
              <div class="tc-queue-banner-bar">
                <div class="tc-queue-banner-bar-fill" style="width:${pct}%"></div>
                ${pct < 100 ? '<div class="tc-queue-banner-bar-pulse"></div>' : ''}
              </div>
            </div>`;
        })() : ''}
        ${_queue.length === 0
          ? '<div class="tc-queue-empty">No tests in queue. Select tests from the catalog above.</div>'
          : `<ul class="tc-queue-list">
              ${_queue.map((item, i) => {
                const statusClass = `tc-queue-status--${item.status}`;
                const statusLabel = item.status === 'active' ? 'RUNNING'
                  : item.status === 'done' ? 'PASS'
                  : item.status === 'fail' ? 'FAIL'
                  : 'PENDING';
                const elapsed = item.status === 'active' && item.startedAt
                  ? formatElapsedCompact(Date.now() - item.startedAt)
                  : item.finishedAt && item.startedAt
                  ? formatElapsedCompact(item.finishedAt - item.startedAt)
                  : '';
                return `
                  <li class="tc-queue-item${item.status === 'active' ? ' tc-queue-item--active' : ''}">
                    <span class="tc-queue-status ${statusClass}"></span>
                    <span class="tc-queue-label tc-queue-label--${item.status}">${statusLabel}</span>
                    <span class="tc-queue-item-name">${escapeHtml(item.suite.name)}</span>
                    <span class="tc-queue-item-config">${escapeHtml(item.suite.config)}</span>
                    ${item.result ? `<span class="tc-queue-item-result">${item.result.passed}/${item.result.total}</span>` : ''}
                    ${elapsed ? `<span class="tc-queue-item-elapsed${item.status === 'active' ? ' tc-queue-item-elapsed--active' : ''}">${elapsed}</span>` : ''}
                    ${item.status === 'pending' && !_queueRunning ? `<button class="tc-queue-remove" data-queue-idx="${i}">\u00D7</button>` : ''}
                    ${item.status === 'active' && _currentTestName ? `<div class="tc-queue-current-test">\u2514 ${escapeHtml(_currentTestName)}</div>` : ''}
                  </li>
                `;
              }).join('')}
            </ul>`
        }
      </div>
      ${_queueResult ? (() => {
        const { done, failed, total, dispatchTarget, stopped } = _queueResult;
        let actionHtml = '';
        if (failed > 0 && dispatchTarget === 'claude') {
          actionHtml = `<span style="color:var(--accent); font-size:11px;">Claude dispatched for ${failed} failure${failed > 1 ? 's' : ''}.</span>`;
        } else if (failed > 0 && dispatchTarget === 'qwen') {
          actionHtml = `<span style="color:var(--accent); font-size:11px;">Qwen dispatched for ${failed} failure${failed > 1 ? 's' : ''}.</span>`;
        } else if (failed > 0) {
          actionHtml = `<button class="tc-action-btn tc-action-btn--accent" id="tc-queue-investigate-cc" style="font-size:11px;">Investigate in CC</button>`;
        }
        return `
          <div class="tc-queue-summary" style="margin-top:12px; padding:12px; border:1px solid var(--border); border-radius:6px; background:var(--bg-hover);">
            <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
              <span style="font-size:12px; font-weight:600;">${stopped ? 'Queue Stopped' : 'Queue Complete'}</span>
              <span style="font-size:11px; color:var(--green);">${done} passed</span>
              <span style="font-size:11px; color:var(--red);">${failed} failed</span>
              <span style="font-size:11px; color:var(--text-dim);">${total} total</span>
              ${actionHtml}
              <button class="tc-action-btn" id="tc-dismiss-queue-result" style="font-size:10px; margin-left:auto;">Dismiss</button>
            </div>
          </div>`;
      })() : ''}
    </div>

    <!-- History -->
    <div class="tc-section">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
        <div class="tc-section-title" style="margin-bottom:0;">History</div>
        <select class="tc-history-filter" id="tc-history-filter">
          <option value="all" ${_historyFilter === 'all' ? 'selected' : ''}>All Configs</option>
          ${uniqueConfigs.map(c => `<option value="${escapeHtml(c)}" ${_historyFilter === c ? 'selected' : ''}>${escapeHtml(CONFIG_LABELS[c] ?? c)}</option>`).join('')}
        </select>
      </div>
      ${filteredHistory.length === 0
        ? '<p style="color:var(--text-dim); font-size:12px;">No test runs yet.</p>'
        : `<table class="tc-runs-table">
          <thead>
            <tr>
              <th class="tc-history-header" data-sort="status" style="width:24px;">${sortArrow('status')}</th>
              <th class="tc-history-header" data-sort="config">Config ${sortArrow('config')}</th>
              <th class="tc-history-header" data-sort="name">Test Name ${sortArrow('name')}</th>
              <th class="tc-history-header" data-sort="date">Date ${sortArrow('date')}</th>
              <th class="tc-history-header" data-sort="duration">Duration ${sortArrow('duration')}</th>
              <th class="tc-history-header" data-sort="result">Result ${sortArrow('result')}</th>
              <th class="tc-history-header" data-sort="followup">Followup ${sortArrow('followup')}</th>
            </tr>
          </thead>
          <tbody id="tc-runs-tbody">
            ${pageRuns.map((run) => {
              const globalIdx = _runs.indexOf(run);
              return `
              <tr data-run-idx="${globalIdx}" class="tc-run-row">
                <td>${statusPip(run)}</td>
                <td>${configBadge(run.config)}</td>
                <td style="font-size:11px;">${escapeHtml(CONFIG_LABELS[run.config] ?? run.config)} Tests</td>
                <td style="color:var(--text-dim); font-size:11px;">${escapeHtml(new Date(run.startedAt).toLocaleString())}</td>
                <td style="color:var(--text-dim);">${formatDuration(run.duration)}</td>
                <td>${run.passed}/${run.total}</td>
                <td class="tc-followup-toggle" data-run-idx="${globalIdx}">${run.followup ? '\u{1F6A9}' : ''}</td>
              </tr>
            `;}).join('')}
          </tbody>
        </table>
        <div class="tc-history-pagination">
          <button id="tc-page-prev" ${_historyPage === 0 ? 'disabled' : ''}>\u2190 Prev</button>
          <span>Page ${_historyPage + 1} of ${totalPages}</span>
          <button id="tc-page-next" ${_historyPage >= totalPages - 1 ? 'disabled' : ''}>Next \u2192</button>
        </div>`
      }
    </div>

    <!-- Active E2E Bugs -->
    <div class="tc-section">
      <div class="tc-section-title">Active E2E Bugs <span style="color:var(--text-dim); font-size:10px; font-weight:400;">(${_e2eBugs.length})</span></div>
      ${_e2eBugs.length === 0
        ? '<p style="color:var(--text-dim); font-size:12px;">No active E2E bugs.</p>'
        : `<div id="tc-bugs-list">
          ${_e2eBugs.slice(0, 5).map((bug, i) => {
            const testName = bug.url ? new URL(bug.url, 'http://localhost').pathname : 'unknown';
            const { expected, actual } = parseExpectedActual(bug.stack ?? '');
            return `
              <div class="tc-bug-row" data-bug-idx="${i}">
                <div class="tc-bug-summary">
                  <span class="tc-bug-error">${escapeHtml(truncate(bug.error, 80))}</span>
                  <span class="tc-bug-meta">${ago(bug.ts)} &middot; ${escapeHtml(truncate(testName, 30))}</span>
                </div>
                <div class="tc-bug-detail" id="tc-bug-detail-${i}" style="display:none;">
                  ${expected ? `<div style="font-size:11px;"><span style="color:var(--green);">Expected:</span> ${escapeHtml(expected)}</div>` : ''}
                  ${actual ? `<div style="font-size:11px;"><span style="color:var(--red);">Actual:</span> ${escapeHtml(actual)}</div>` : ''}
                  <pre style="font-size:10px; color:var(--text-dim); white-space:pre-wrap; margin:4px 0 0; max-height:100px; overflow:auto;">${escapeHtml(bug.stack ?? '')}</pre>
                </div>
              </div>
            `;
          }).join('')}
          ${_e2eBugs.length > 5 ? '<div style="margin-top:8px;"><button class="tc-link-btn" id="tc-view-all-bugs">View All</button></div>' : ''}
        </div>`
      }
    </div>
  `;

  wireDashboardEvents();
}

function wireDashboardEvents(): void {
  if (!_container) return;

  wireTopTabs();

  // Group checkboxes — select/deselect all suites in group
  const groups = groupCatalog();
  _container.querySelectorAll<HTMLInputElement>('.tc-group-checkbox').forEach(cb => {
    // Set indeterminate state
    const group = cb.dataset.group;
    if (group) {
      const suites = groups.get(group) ?? [];
      const checkedCount = suites.filter(s => _selectedSuites.has(s.id)).length;
      cb.indeterminate = checkedCount > 0 && checkedCount < suites.length;
    }
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      const g = cb.dataset.group;
      if (!g) return;
      const suites = groups.get(g) ?? [];
      if (cb.checked) {
        suites.forEach(s => _selectedSuites.add(s.id));
      } else {
        suites.forEach(s => _selectedSuites.delete(s.id));
      }
      renderDashboard();
    });
    cb.addEventListener('click', (e) => e.stopPropagation());
  });

  // Catalog checkboxes
  _container.querySelectorAll<HTMLInputElement>('.tc-catalog-item input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.suiteId;
      if (!id) return;
      if (cb.checked) {
        _selectedSuites.add(id);
      } else {
        _selectedSuites.delete(id);
      }
      // Update "Add to Queue" button text + group checkbox states
      const addBtn = _container!.querySelector<HTMLButtonElement>('#tc-add-to-queue');
      if (addBtn) {
        addBtn.textContent = `Add Selected to Queue (${_selectedSuites.size})`;
        addBtn.disabled = _selectedSuites.size === 0;
      }
      // Update group checkbox indeterminate/checked state
      _container!.querySelectorAll<HTMLInputElement>('.tc-group-checkbox').forEach(gcb => {
        const g = gcb.dataset.group;
        if (!g) return;
        const suites = groups.get(g) ?? [];
        const checkedCount = suites.filter(s => _selectedSuites.has(s.id)).length;
        gcb.checked = checkedCount === suites.length && suites.length > 0;
        gcb.indeterminate = checkedCount > 0 && checkedCount < suites.length;
      });
    });
  });

  // Select All
  _container.querySelector('#tc-select-all')?.addEventListener('click', () => {
    TEST_CATALOG.forEach(s => _selectedSuites.add(s.id));
    renderDashboard();
  });

  // Clear Selection
  _container.querySelector('#tc-select-none')?.addEventListener('click', () => {
    _selectedSuites.clear();
    renderDashboard();
  });

  // Preset buttons — load suite IDs into queue
  _container.querySelectorAll<HTMLButtonElement>('.tc-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const presetId = btn.dataset.preset;
      const preset = TEST_PRESETS.find(p => p.id === presetId);
      if (!preset) return;
      const existingIds = new Set(_queue.map(q => q.suite.id));
      for (const sid of preset.suiteIds) {
        if (existingIds.has(sid)) continue;
        const suite = TEST_CATALOG.find(s => s.id === sid);
        if (suite) _queue.push({ suite, status: 'pending' });
      }
      _selectedSuites.clear();
      renderDashboard();
    });
  });

  // Add to Queue
  _container.querySelector('#tc-add-to-queue')?.addEventListener('click', () => {
    const existingIds = new Set(_queue.map(q => q.suite.id));
    for (const id of _selectedSuites) {
      if (existingIds.has(id)) continue;
      const suite = TEST_CATALOG.find(s => s.id === id);
      if (suite) {
        _queue.push({ suite, status: 'pending' });
      }
    }
    _selectedSuites.clear();
    renderDashboard();
  });

  // Queue: remove item
  _container.querySelectorAll<HTMLButtonElement>('.tc-queue-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.queueIdx);
      _queue.splice(idx, 1);
      renderDashboard();
    });
  });

  // Queue: run
  _container.querySelector('#tc-run-queue')?.addEventListener('click', () => {
    if (!_queueRunning && _queue.length > 0) {
      _queueResult = null;
      runQueue();
    }
  });

  // Queue: clear
  _container.querySelector('#tc-clear-queue')?.addEventListener('click', () => {
    _queue = [];
    _queueResult = null;
    renderDashboard();
  });

  // Queue: stop all
  _container.querySelector('#tc-stop-all')?.addEventListener('click', async () => {
    _queueAborted = true;
    _queuePaused = false;
    if (_currentAgentId) {
      try { await fetch(`/__admin_exec/cancel?agent=${encodeURIComponent(_currentAgentId)}`, { method: 'POST' }); } catch { /* ignore */ }
    }
    renderDashboard();
  });

  // Queue: pause/resume
  _container.querySelector('#tc-pause-resume')?.addEventListener('click', () => {
    _queuePaused = !_queuePaused;
    renderDashboard();
  });

  // Queue result: dismiss
  _container.querySelector('#tc-dismiss-queue-result')?.addEventListener('click', () => {
    _queueResult = null;
    renderDashboard();
  });

  // Queue result: manual investigate
  _container.querySelector('#tc-queue-investigate-cc')?.addEventListener('click', async () => {
    const btn = _container?.querySelector<HTMLButtonElement>('#tc-queue-investigate-cc');
    if (btn) { btn.textContent = 'Dispatching...'; btn.disabled = true; }
    const failItems = _queue.filter(q => q.status === 'fail' && q.result);
    const failList = failItems.flatMap(q =>
      (q.result?.failures ?? []).map(f => `- [${q.suite.name}] ${f.test}: ${f.error}`)
    ).join('\n');
    if (failList) {
      await dispatchCC('Queue Investigation', `Investigate failures:\n\n${failList}`);
    }
    if (btn) btn.textContent = 'Dispatched';
  });

  // Guidance toggle
  _container.querySelector('#tc-guidance-toggle')?.addEventListener('click', () => {
    _claudeGuidance = !_claudeGuidance;
    const sw = _container!.querySelector('.tc-switch');
    if (sw) sw.classList.toggle('tc-switch--on', _claudeGuidance);
  });

  // History: sort headers
  _container.querySelectorAll<HTMLElement>('.tc-history-header').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (!col) return;
      if (_historySort.column === col) {
        _historySort.direction = _historySort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        _historySort = { column: col, direction: 'asc' };
      }
      _historyPage = 0;
      renderDashboard();
    });
  });

  // History: filter
  _container.querySelector<HTMLSelectElement>('#tc-history-filter')?.addEventListener('change', (e) => {
    _historyFilter = (e.target as HTMLSelectElement).value;
    _historyPage = 0;
    renderDashboard();
  });

  // History: pagination
  _container.querySelector('#tc-page-prev')?.addEventListener('click', () => {
    if (_historyPage > 0) { _historyPage--; renderDashboard(); }
  });
  _container.querySelector('#tc-page-next')?.addEventListener('click', () => {
    const filtered = getFilteredHistory();
    const totalPages = Math.ceil(filtered.length / HISTORY_PAGE_SIZE);
    if (_historyPage < totalPages - 1) { _historyPage++; renderDashboard(); }
  });

  // History: followup toggle
  _container.querySelectorAll<HTMLElement>('.tc-followup-toggle').forEach(cell => {
    cell.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = Number(cell.dataset.runIdx);
      const run = _runs[idx];
      if (!run) return;
      run.followup = !run.followup;
      cell.textContent = run.followup ? '\u{1F6A9}' : '';
      await saveTestLog(_runs);
    });
  });

  // Run row clicks → detail view
  _container.querySelectorAll<HTMLElement>('.tc-run-row').forEach(row => {
    row.addEventListener('click', (e) => {
      // Don't navigate if clicking followup toggle
      if ((e.target as HTMLElement).classList.contains('tc-followup-toggle')) return;
      const idx = Number(row.dataset.runIdx);
      const run = _runs[idx];
      if (run) {
        _view = { type: 'run-detail', run };
        render();
      }
    });
  });

  // Bug row expand
  _container.querySelectorAll<HTMLElement>('.tc-bug-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx = row.dataset.bugIdx;
      const detail = _container!.querySelector<HTMLElement>(`#tc-bug-detail-${idx}`);
      if (detail) {
        detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
      }
    });
  });

  // View all bugs
  _container.querySelector('#tc-view-all-bugs')?.addEventListener('click', () => {
    const navItem = document.querySelector<HTMLElement>('.nav-item[data-section="bugs"]');
    if (navItem) navItem.click();
  });
}

// ── Queue Execution ──────────────────────────────────────────────────────────

async function runQueue(): Promise<void> {
  _queueRunning = true;
  _queuePaused = false;
  _queueAborted = false;
  _currentTestName = '';
  _queueStartedAt = Date.now();

  // Start a 200ms interval to live-update elapsed timers and current test name
  if (_queueElapsedTimer) clearInterval(_queueElapsedTimer);
  _queueElapsedTimer = setInterval(() => {
    const bannerEl = _container?.querySelector('.tc-queue-banner-elapsed') as HTMLElement | null;
    if (bannerEl) bannerEl.textContent = formatElapsedCompact(Date.now() - _queueStartedAt);
    const activeTimer = _container?.querySelector('.tc-queue-item-elapsed--active') as HTMLElement | null;
    const activeItem = _queue.find(q => q.status === 'active');
    if (activeTimer && activeItem?.startedAt) {
      activeTimer.textContent = formatElapsedCompact(Date.now() - activeItem.startedAt);
    }
    // Live-update current test name displays
    const testEl = _container?.querySelector('.tc-queue-current-test') as HTMLElement | null;
    if (testEl) testEl.textContent = _currentTestName ? '\u2514 ' + _currentTestName : '';
    const bannerTestEl = _container?.querySelector('.tc-queue-banner-test') as HTMLElement | null;
    if (bannerTestEl) bannerTestEl.textContent = _currentTestName ? '\u2514 ' + _currentTestName : '';
  }, 200);

  renderDashboard();

  for (const item of _queue) {
    if (_queueAborted) break;
    // Wait while paused
    while (_queuePaused && !_queueAborted) {
      await new Promise(r => setTimeout(r, 200));
    }
    if (_queueAborted) break;
    if (item.status !== 'pending') continue;

    _currentTestName = '';
    item.status = 'active';
    item.startedAt = Date.now();
    renderDashboard();

    try {
      const result = await runSingleTest(item.suite.config, (counts) => {
        if (counts.currentTest) _currentTestName = counts.currentTest;
        // Live-update the active queue item's display with progress counts
        const activeEl = _container?.querySelector('.tc-queue-status--active');
        const li = activeEl?.closest('.tc-queue-item');
        if (li) {
          let countsEl = li.querySelector('.tc-queue-live-counts') as HTMLElement | null;
          if (!countsEl) {
            countsEl = document.createElement('span');
            countsEl.className = 'tc-queue-live-counts';
            countsEl.style.cssText = 'font-size:10px; color:var(--text-dim); margin-left:auto;';
            li.appendChild(countsEl);
          }
          countsEl.innerHTML = `<span style="color:var(--green);">${counts.passed}</span>/<span style="color:var(--red);">${counts.failed}</span>/<span>${counts.total}</span>`;
        }
      });
      item.result = result;
      item.status = result.failed > 0 ? 'fail' : 'done';
    } catch {
      item.status = 'fail';
    }
    item.finishedAt = Date.now();
    renderDashboard();
  }

  if (_queueElapsedTimer) { clearInterval(_queueElapsedTimer); _queueElapsedTimer = null; }
  _queueRunning = false;
  _currentAgentId = null;
  _currentTestName = '';

  // Build queue summary
  const done = _queue.filter(q => q.status === 'done').length;
  const failed = _queue.filter(q => q.status === 'fail').length;
  const total = _queue.length;
  const stopped = _queueAborted;
  const target = getDispatchTarget();

  _queueResult = { done, failed, total, dispatchTarget: target, stopped };

  // Auto-dispatch investigation for failures (skip if user stopped the queue)
  if (failed > 0 && !stopped) {
    const failItems = _queue.filter(q => q.status === 'fail' && q.result);
    const failList = failItems.flatMap(q =>
      (q.result?.failures ?? []).map(f => `- [${q.suite.name}] ${f.test}: ${f.error}`)
    ).join('\n');
    if (failList) {
      const investigatePrompt = `${failed} test suite(s) failed in queue run:\n\n${failList}\n\nInvestigate each failure. Read the test files and source. Diagnose root causes and apply fixes where straightforward.`;
      await dispatchInvestigation('Queue Investigation', investigatePrompt);
    }
  }

  renderDashboard();
}

function runSingleTest(
  config: string,
  onProgress?: (counts: { passed: number; failed: number; total: number; currentTest?: string }) => void,
): Promise<TestRun> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let passed = 0;
    let failed = 0;
    let total = 0;
    const failures: Array<{ file: string; test: string; error: string }> = [];
    const output: string[] = [];

    fetch(`/__admin_exec/test?config=${encodeURIComponent(config)}`, { method: 'POST' })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ ok: boolean; agentId: string }>;
      })
      .then(body => {
        _currentAgentId = body.agentId;
        const es = new EventSource('/__admin_exec/stream?agent=' + encodeURIComponent(body.agentId));

        es.addEventListener('stdout', (ev: MessageEvent) => {
          let line: string;
          try {
            const payload = JSON.parse((ev as MessageEvent<string>).data) as { line: string };
            line = payload.line;
          } catch { line = (ev as MessageEvent<string>).data; }
          output.push(line);
          const parsed = parseOutputLine(line);
          if (parsed.type === 'pass') passed++;
          if (parsed.type === 'fail') failed++;
          total++;
          const testName = parseTestName(line) ?? undefined;
          if (onProgress) onProgress({ passed, failed, total, currentTest: testName });
        });

        es.addEventListener('exit', () => {
          es.close();
          _currentAgentId = null;
          const duration = Date.now() - startedAt;
          const fullOutput = output.join('\n');
          const jsonResult = parseVitestJson(fullOutput);

          const run: TestRun = {
            id: `run-${Date.now()}`,
            config,
            startedAt: new Date(startedAt).toISOString(),
            duration,
            total: jsonResult?.total ?? total,
            passed: jsonResult?.passed ?? passed,
            failed: jsonResult?.failed ?? failed,
            skipped: jsonResult?.skipped ?? 0,
            failures: jsonResult?.failures ?? failures,
          };

          _runs.unshift(run);
          if (_runs.length > 50) _runs = _runs.slice(0, 50);
          saveTestLog(_runs);

          resolve(run);
        });

        es.onerror = () => {
          es.close();
          reject(new Error('Stream connection lost'));
        };
      })
      .catch(reject);
  });
}

// ── View 2: Live Run ─────────────────────────────────────────────────────────

function renderLiveRun(): void {
  if (!_container) return;
  const config = (_view as { type: 'live-run'; config: string }).config;

  _container.innerHTML = `
    <div class="tc-live-header">
      <div class="tc-live-title">
        <span class="tc-pulse-dot"></span>
        Running ${escapeHtml(CONFIG_LABELS[config] ?? config)} Tests...
      </div>
      <div class="tc-live-actions">
        <span class="tc-elapsed" id="tc-elapsed">0s</span>
        <button class="tc-cancel-btn" id="tc-cancel-btn">Cancel</button>
      </div>
    </div>

    <div class="tc-live-stats" id="tc-live-stats">
      <span style="color:var(--green);">&#10003; Passed: <strong id="tc-stat-passed">0</strong></span>
      <span style="color:var(--red);">&#10007; Failed: <strong id="tc-stat-failed">0</strong></span>
      <span style="color:var(--text-dim);">Total: <strong id="tc-stat-total">0</strong></span>
    </div>

    <div class="tc-output-panel" id="tc-output-panel"></div>

    <div id="tc-completion" style="display:none;"></div>
  `;

  // Cancel
  _container.querySelector('#tc-cancel-btn')?.addEventListener('click', async () => {
    const agent = _currentAgentId;
    try { await fetch(`/__admin_exec/cancel${agent ? '?agent=' + encodeURIComponent(agent) : ''}`, { method: 'POST' }); } catch (err) { console.warn('[testCenter] Cancel request failed:', err); }
  });
}

function appendOutput(text: string, color: string): void {
  const panel = _container?.querySelector<HTMLElement>('#tc-output-panel');
  if (!panel) return;
  const div = document.createElement('div');
  div.style.color = color;
  div.textContent = text;
  panel.appendChild(div);
  panel.scrollTop = panel.scrollHeight;
}

function updateLiveStats(): void {
  const p = _container?.querySelector('#tc-stat-passed');
  const f = _container?.querySelector('#tc-stat-failed');
  const t = _container?.querySelector('#tc-stat-total');
  if (p) p.textContent = String(_runPassed);
  if (f) f.textContent = String(_runFailed);
  if (t) t.textContent = String(_runTotal);
}

async function startRun(config: string): Promise<void> {
  _busy = true;
  _runStartedAt = Date.now();
  _runPassed = 0;
  _runFailed = 0;
  _runTotal = 0;
  _runFailures = [];
  _accumulatedOutput = [];
  _runDone = false;
  _lastRunResult = null;

  render();

  // Elapsed timer
  if (_elapsedTimer) clearInterval(_elapsedTimer);
  _elapsedTimer = setInterval(() => {
    const el = _container?.querySelector('#tc-elapsed');
    if (el) el.textContent = formatDuration(Date.now() - _runStartedAt);
  }, 1000);

  // Kick off run
  try {
    const res = await fetch(`/__admin_exec/test?config=${encodeURIComponent(config)}`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    const body = await res.json() as { ok: boolean; agentId: string };
    _currentAgentId = body.agentId;
  } catch (e) {
    appendOutput(`Failed to start run: ${String(e)}`, 'var(--red)');
    _busy = false;
    if (_elapsedTimer) { clearInterval(_elapsedTimer); _elapsedTimer = null; }
    return;
  }

  // Open SSE
  if (_eventSource) { _eventSource.close(); _eventSource = null; }
  const es = new EventSource('/__admin_exec/stream?agent=' + encodeURIComponent(_currentAgentId!));
  _eventSource = es;

  es.addEventListener('stdout', (ev: MessageEvent) => {
    let line: string;
    try {
      const payload = JSON.parse((ev as MessageEvent<string>).data) as { line: string };
      line = payload.line;
    } catch { line = (ev as MessageEvent<string>).data; }
    _accumulatedOutput.push(line);
    const parsed = parseOutputLine(line);
    if (parsed.type === 'pass') _runPassed++;
    if (parsed.type === 'fail') _runFailed++;
    _runTotal++;
    appendOutput(parsed.text, colorForType(parsed.type));
    updateLiveStats();
  });

  es.addEventListener('stderr', (ev: MessageEvent) => {
    const line = (ev as MessageEvent<string>).data;
    appendOutput(line, 'rgba(255, 220, 100, 0.7)');
  });

  es.addEventListener('exit', async () => {
    es.close();
    if (_eventSource === es) _eventSource = null;
    _currentAgentId = null;
    if (_elapsedTimer) { clearInterval(_elapsedTimer); _elapsedTimer = null; }

    const duration = Date.now() - _runStartedAt;
    const fullOutput = _accumulatedOutput.join('\n');
    const jsonResult = parseVitestJson(fullOutput);

    const run: TestRun = {
      id: `run-${Date.now()}`,
      config,
      startedAt: new Date(_runStartedAt).toISOString(),
      duration,
      total: jsonResult?.total ?? _runTotal,
      passed: jsonResult?.passed ?? _runPassed,
      failed: jsonResult?.failed ?? _runFailed,
      skipped: jsonResult?.skipped ?? 0,
      failures: jsonResult?.failures ?? _runFailures,
    };

    _runs.unshift(run);
    if (_runs.length > 50) _runs = _runs.slice(0, 50);
    await saveTestLog(_runs);

    _busy = false;
    _runDone = true;
    _lastRunResult = run;

    showCompletion(run, config);
  });

  es.onerror = () => {
    es.close();
    if (_eventSource === es) _eventSource = null;
    _currentAgentId = null;
    if (_elapsedTimer) { clearInterval(_elapsedTimer); _elapsedTimer = null; }
    if (_busy) {
      appendOutput('Stream connection lost.', 'var(--red)');
      _busy = false;
    }
  };
}

async function showCompletion(run: TestRun, config: string): Promise<void> {
  appendOutput(`\nDone in ${formatDuration(run.duration)} -- ${run.passed} passed, ${run.failed} failed, ${run.skipped} skipped.`, 'var(--text-dim)');

  // Hide pulsing header, show summary
  const header = _container?.querySelector<HTMLElement>('.tc-live-header');
  if (header) {
    header.innerHTML = `
      <div class="tc-live-title" style="animation:none;">
        <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${run.failed > 0 ? 'var(--red)' : 'var(--green)'};"></span>
        ${escapeHtml(CONFIG_LABELS[config] ?? config)} Tests Complete
      </div>
    `;
  }

  const comp = _container?.querySelector<HTMLElement>('#tc-completion');
  if (!comp) return;

  // Dispatch logic for auto-investigating failures (uses DRY helper)
  const failList = run.failures.map(f => `- ${f.test}: ${f.error}`).join('\n');
  const investigatePrompt = `${run.failed} test failure${run.failed > 1 ? 's' : ''} in ${config} config:\n\n${failList}\n\nInvestigate each failure. Read the test files and source. Diagnose root causes and apply fixes where straightforward.`;
  const target = getDispatchTarget();

  let dispatchHtml = '';
  let manualInvestigateBtn = '';

  if (run.failed > 0 && target === 'claude') {
    dispatchHtml = `<div class="tc-dispatch-investigating" id="tc-dispatch-spinner">
      <span class="tc-spinner"></span> Claude is investigating ${run.failed} failure${run.failed > 1 ? 's' : ''}...
    </div>`;
  } else if (run.failed > 0 && target === 'qwen') {
    dispatchHtml = `<div class="tc-dispatch-investigating" id="tc-dispatch-spinner">
      <span class="tc-spinner"></span> Qwen is investigating ${run.failed} failure${run.failed > 1 ? 's' : ''}...
    </div>`;
  } else if (run.failed > 0 && target === 'manual') {
    manualInvestigateBtn = '<button class="tc-action-btn tc-action-btn--accent" id="tc-investigate-cc">Investigate in CC</button>';
  }

  comp.style.display = 'block';
  comp.innerHTML = `
    <div class="tc-summary-card ${run.failed > 0 ? 'tc-summary--fail' : 'tc-summary--pass'}">
      Done in ${formatDuration(run.duration)} &mdash; <strong>${run.passed}</strong> passed, <strong>${run.failed}</strong> failed
    </div>
    ${dispatchHtml}
    <div class="tc-completion-actions">
      <button class="tc-action-btn" id="tc-view-results">View Results</button>
      <button class="tc-action-btn" id="tc-run-again">Run Again</button>
      <button class="tc-action-btn" id="tc-back-dashboard">Dashboard</button>
      ${manualInvestigateBtn}
    </div>
  `;

  // Auto-dispatch for failures
  if (run.failed > 0 && failList && (target === 'claude' || target === 'qwen')) {
    await dispatchInvestigation('Test Investigation', investigatePrompt);
    const spinner = _container?.querySelector('#tc-dispatch-spinner');
    const label = target === 'claude' ? 'Claude' : 'Qwen';
    if (spinner) spinner.innerHTML = `<span style="color:var(--green);">&#10003;</span> ${label} dispatched for ${run.failed} failure${run.failed > 1 ? 's' : ''}.`;
  }

  // Wire completion buttons
  _container?.querySelector('#tc-view-results')?.addEventListener('click', () => {
    _view = { type: 'run-detail', run };
    render();
  });

  _container?.querySelector('#tc-run-again')?.addEventListener('click', () => {
    _view = { type: 'live-run', config };
    startRun(config);
  });

  _container?.querySelector('#tc-back-dashboard')?.addEventListener('click', () => {
    _view = { type: 'dashboard' };
    render();
  });

  _container?.querySelector('#tc-investigate-cc')?.addEventListener('click', async () => {
    const btn = _container?.querySelector<HTMLButtonElement>('#tc-investigate-cc');
    if (btn) { btn.textContent = 'Dispatching...'; btn.disabled = true; }
    if (failList) {
      await dispatchCC('Test Investigation', `Investigate failures:\n\n${failList}`);
    }
    if (btn) btn.textContent = 'Dispatched';
  });
}

// ── View 3: Run Detail ───────────────────────────────────────────────────────

async function renderRunDetail(run: TestRun): Promise<void> {
  if (!_container) return;
  const passed = run.passed;
  const failed = run.failed;
  const skipped = run.skipped;

  // Fetch linked bugs in time window
  const startMs = new Date(run.startedAt).getTime();
  const endMs = startMs + run.duration + 60_000; // +60s buffer
  const linkedBugs = await fetchBugsInRange(startMs, endMs);

  _container.innerHTML = `
    <div style="margin-bottom:16px;">
      <button class="tc-back-btn" id="tc-back-btn">&larr; Dashboard</button>
    </div>

    <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
      ${configBadge(run.config)}
      <span style="font-size:14px; font-weight:600;">${escapeHtml(new Date(run.startedAt).toLocaleString())}</span>
      <span class="tc-pip ${run.failed > 0 ? 'tc-pip--fail' : 'tc-pip--pass'}" style="width:10px; height:10px;"></span>
    </div>

    <div class="stat-grid">
      ${statCard(`<span style="color:var(--green);">${passed}</span>`, 'Passed')}
      ${statCard(`<span style="color:var(--red);">${failed}</span>`, 'Failed')}
      ${statCard(skipped, 'Skipped')}
    </div>

    <div style="font-size:12px; color:var(--text-dim); margin-bottom:16px;">
      Duration: ${formatDuration(run.duration)}
    </div>

    <!-- Test table -->
    ${run.failures.length > 0 ? `
      <div class="tc-section">
        <div class="tc-section-title">Failed Tests (${run.failures.length})</div>
        <div id="tc-fail-list">
          ${run.failures.map((f, i) => {
            const prompt = buildInvestigatePrompt(f.file, f.test, f.error, run.config);
            return `
              <div class="tc-fail-item">
                <div class="tc-fail-name">${escapeHtml(f.test)}</div>
                <div class="tc-fail-file">${escapeHtml(f.file)}</div>
                <pre class="tc-fail-error">${escapeHtml(f.error)}</pre>
                <div class="tc-followup-bar">
                  <span class="tc-followup-label">Request Followup</span>
                  <button class="tc-action-btn tc-copy-btn" data-fail-idx="${i}" data-prompt="${escapeHtml(prompt)}">Copy</button>
                  <button class="tc-action-btn tc-agent-toggle-btn" data-fail-idx="${i}">Agent</button>
                </div>
                <div class="tc-agent-panel" id="tc-agent-panel-${i}" style="display:none;">
                  <textarea class="tc-agent-guidance" id="tc-agent-guidance-${i}" placeholder="Optional guidance for the agent..." rows="3"></textarea>
                  <button class="tc-action-btn tc-action-btn--accent tc-agent-submit" data-fail-idx="${i}" data-prompt="${escapeHtml(prompt)}">Submit</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    ` : ''}

    <!-- All tests summary -->
    <div class="tc-section">
      <div class="tc-section-title">Summary</div>
      <div style="font-size:12px; color:var(--text-dim);">
        ${run.total} total tests &middot; ${run.passed} passed &middot; ${run.failed} failed &middot; ${run.skipped} skipped
      </div>
    </div>

    <!-- Linked Bugs -->
    ${linkedBugs.length > 0 ? `
      <div class="tc-section">
        <div class="tc-section-title">Linked E2E Bugs (${linkedBugs.length})</div>
        ${linkedBugs.map(bug => {
          const { expected, actual } = parseExpectedActual(bug.stack ?? '');
          const testName = bug.url ? new URL(bug.url, 'http://localhost').pathname : 'unknown';
          return `
            <div class="tc-bug-row" style="cursor:default;">
              <div style="font-size:12px; color:var(--red); margin-bottom:2px;">${escapeHtml(truncate(bug.error, 100))}</div>
              <div style="font-size:10px; color:var(--text-dim); margin-bottom:4px;">${escapeHtml(testName)} &middot; ${ago(bug.ts)}</div>
              ${expected ? `<div style="font-size:11px;"><span style="color:var(--green);">Expected:</span> ${escapeHtml(expected)}</div>` : ''}
              ${actual ? `<div style="font-size:11px;"><span style="color:var(--red);">Actual:</span> ${escapeHtml(actual)}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    ` : ''}
  `;

  // Wire events
  _container.querySelector('#tc-back-btn')?.addEventListener('click', () => {
    _view = { type: 'dashboard' };
    render();
  });

  // Copy buttons — copy investigate prompt to clipboard
  _container.querySelectorAll<HTMLButtonElement>('.tc-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt ?? '';
      navigator.clipboard.writeText(prompt).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      });
    });
  });

  // Agent toggle — slide open the guidance panel
  _container.querySelectorAll<HTMLButtonElement>('.tc-agent-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = btn.dataset.failIdx ?? '';
      const panel = _container?.querySelector<HTMLElement>(`#tc-agent-panel-${idx}`);
      if (!panel) return;
      const isOpen = panel.style.display !== 'none';
      panel.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) {
        panel.querySelector<HTMLTextAreaElement>('.tc-agent-guidance')?.focus();
      }
    });
  });

  // Agent submit — dispatch with optional guidance
  _container.querySelectorAll<HTMLButtonElement>('.tc-agent-submit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = btn.dataset.failIdx ?? '';
      const basePrompt = btn.dataset.prompt ?? '';
      const guidance = _container?.querySelector<HTMLTextAreaElement>(`#tc-agent-guidance-${idx}`)?.value.trim() ?? '';
      const fullPrompt = guidance ? `${basePrompt}\n\nAdditional guidance:\n${guidance}` : basePrompt;
      btn.textContent = 'Dispatching...';
      btn.disabled = true;
      await dispatchCC('Test Fix', fullPrompt);
      btn.textContent = 'Dispatched';
      setTimeout(() => { btn.textContent = 'Submit'; btn.disabled = false; }, 2000);
    });
  });
}
