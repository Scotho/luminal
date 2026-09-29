import { escapeHtml, sectionHeader, statCard } from '../ui/render';
import { dispatchCC } from '../ui/ccPanel';
import { renderSparkline, renderTimeSeriesChart } from '../ui/charts';

// ── Types ────────────────────────────────────────────────────────────────────

interface IndexRun {
  id: string;
  type: 'e2e' | 'ui';
  timestamp: string;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

interface IndexData {
  lastUpdated: string | null;
  runs: IndexRun[];
}

interface RunTest {
  id: string;
  name: string;
  status: string;
  durationMs: number;
  group: string;
  error?: string | null;
}

interface RunData {
  id: string;
  type: string;
  timestamp: string;
  durationMs: number;
  platform: string;
  gitBranch: string;
  gitCommit: string;
  tests: RunTest[];
  summary: { total: number; passed: number; failed: number; skipped: number };
}

interface UiTestResult {
  id: string;
  name: string;
  status: string;
  durationMs: number;
  group: string;
  type: string;        // 'simple' | 'flow'
  viewport: string;
  screenshots: string[];
  consoleLog: string | null;
  error: string | null;
}

interface E2eTestResult {
  id: string;
  name: string;
  status: string;
  durationMs: number;
  group: string;
  matchType: string;
  seed: number;
  maxTicks: number;
  actualTicks: number;
  playerCount: number;
  humanCount: number;
  aiCount: number;
  network: { latencyMs: number; packetLossRate: number };
  deaths: Array<{ playerIndex: number; tick: number; clients: number[] }>;
  hashChecks: { total: number; mismatches: number; details: Array<{ tick: number; hashes: number[] }> };
  error: string | null;
  replayFile?: string | null;
  perf?: {
    tier: 'T1' | 'T2';
    timing: {
      totalMs: number;
      tickSamples: [number, number][];
      tickStats: { avg: number; p50: number; p95: number; p99: number; max: number; count: number };
      budgetViolations: number;
    };
    network: {
      configured: { latencyMs: number; packetLossRate: number; jitterMs?: number };
      observed: {
        messagesRelayed: number; messagesDropped: number; actualLossRate: number;
        avgDeliveryMs: number; p95DeliveryMs: number; maxDeliveryMs: number;
        bandwidthSamples: [number, number][] | null;
      };
    };
    browser?: {
      longTasks: { startTime: number; duration: number }[];
      layoutShifts: { startTime: number; value: number }[];
      lcp?: number; jsHeapUsedMb?: number; jsHeapTotalMb?: number;
    };
    grade?: {
      overall: string;
      breakdown: { category: string; grade: string; reason: string; value: number; threshold: number }[];
      summary: string;
    };
  };
}

type TestResult = UiTestResult | E2eTestResult;

type View =
  | { type: 'list' }
  | { type: 'run'; runType: string; runId: string }
  | { type: 'test'; runType: string; runId: string; testId: string };

// ── State ────────────────────────────────────────────────────────────────────

let _container: HTMLElement | null = null;
let _currentView: View = { type: 'list' };
let _indexCache: IndexData | null = null;
const _activePerfCharts = new Set<string>();

// ── Flaky test detection ────────────────────────────────────────────────────

interface FlakyTest {
  name: string;
  config: string;
  passCount: number;
  failCount: number;
}

async function detectFlakyTests(): Promise<FlakyTest[]> {
  try {
    const index = await fetchIndex();
    const recentRuns = (index.runs || []).slice(0, 10);
    const testResults = new Map<string, { passes: number; fails: number; config: string }>();

    for (const run of recentRuns) {
      try {
        const runData = await fetchJson<{ tests: { name: string; status: string }[] }>(
          `/__test_results/${run.type}/${run.id}/run.json`
        );
        if (!runData.tests) continue;
        for (const t of runData.tests) {
          const key = `${run.type}::${t.name}`;
          const existing = testResults.get(key) ?? { passes: 0, fails: 0, config: run.type };
          if (t.status === 'pass') existing.passes++;
          else if (t.status === 'fail') existing.fails++;
          testResults.set(key, existing);
        }
      } catch { /* skip unreadable runs */ }
    }

    const flaky: FlakyTest[] = [];
    for (const [key, stats] of testResults) {
      if (stats.passes > 0 && stats.fails > 0) {
        const name = key.split('::').slice(1).join('::');
        flaky.push({ name, config: stats.config, passCount: stats.passes, failCount: stats.fails });
      }
    }

    return flaky.sort((a, b) => b.failCount - a.failCount);
  } catch {
    return [];
  }
}

function renderFlakyPanel(flakyTests: FlakyTest[]): string {
  return `<div style="margin-bottom:20px;">
    <h3 style="font-size:14px; color:var(--yellow); margin-bottom:8px;">Flaky Tests</h3>
    ${flakyTests.length === 0
      ? '<p style="color:var(--text-dim); font-size:12px;">No flaky tests detected</p>'
      : flakyTests.map(f => `
        <div style="padding:6px 10px; border-bottom:1px solid var(--border); font-size:12px; display:flex; justify-content:space-between;">
          <span style="font-family:var(--font-mono); color:var(--yellow);">${escapeHtml(f.name)}</span>
          <span style="color:var(--text-dim);">${f.passCount}P/${f.failCount}F (${f.config})</span>
        </div>
      `).join('')
    }
  </div>`;
}

// ── Public entry point ───────────────────────────────────────────────────────

export function renderTests(container: HTMLElement): void {
  _container = container;
  _currentView = { type: 'list' };
  _indexCache = null;
  showList();
}

// ── Navigation ───────────────────────────────────────────────────────────────

function unmountPerfSparklines(): void {
  for (const id of _activePerfCharts) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  }
  _activePerfCharts.clear();
}

function navigate(view: View): void {
  unmountPerfSparklines();
  _currentView = view;
  switch (view.type) {
    case 'list': showList(); break;
    case 'run': showRun(view.runType, view.runId); break;
    case 'test': showTest(view.runType, view.runId, view.testId); break;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function typeBadge(type: string): string {
  const label = type.toUpperCase();
  return `<span style="background:var(--accent); color:var(--bg); padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600;">${label}</span>`;
}

function statusDot(passed: number, total: number): string {
  const color = passed === total ? 'var(--green)' : 'var(--red)';
  return `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${color};"></span>`;
}

function statusBadge(status: string): string {
  const isPass = status === 'pass';
  const color = isPass ? 'var(--green)' : 'var(--red)';
  const label = isPass ? 'PASS' : 'FAIL';
  return `<span style="color:${color}; font-weight:600; font-size:12px;">${label}</span>`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function backButton(label: string, view: View): string {
  const id = `back-btn-${Date.now()}`;
  setTimeout(() => {
    document.getElementById(id)?.addEventListener('click', () => navigate(view));
  }, 0);
  return `<button id="${id}" class="refresh-btn" style="margin-bottom:16px;">&larr; ${escapeHtml(label)}</button>`;
}

function loading(): string {
  return '<p style="color:var(--text-dim);">Loading...</p>';
}

function errorMsg(msg: string): string {
  return `<p style="color:var(--red);">${escapeHtml(msg)}</p>`;
}

// ── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.text();
}

async function fetchIndex(): Promise<IndexData> {
  const data = await fetchJson<IndexData>('/__test_results/index.json');
  _indexCache = data;
  return data;
}

// ── View 1: Run List ─────────────────────────────────────────────────────────

async function showList(): Promise<void> {
  if (!_container) return;
  _container.innerHTML = sectionHeader('Test Portal', null, () => {
    _indexCache = null;
    showList();
  }) + loading();

  let index: IndexData;
  try {
    index = await fetchIndex();
  } catch {
    _container.innerHTML = sectionHeader('Test Portal', null, () => {
      _indexCache = null;
      showList();
    }) +
      '<p style="color:var(--text-dim);">No test results found. Run <code>npm run test:e2e</code> or <code>npm run test:ui</code> to generate results.</p>';
    return;
  }

  const runs = index.runs || [];
  const e2eRuns = runs.filter(r => r.type === 'e2e');
  const uiRuns = runs.filter(r => r.type === 'ui');
  const latestE2e = e2eRuns[0];
  const latestUi = uiRuns[0];

  const tableId = `test-runs-table-${Date.now()}`;

  // Detect flaky tests from recent runs
  const flakyTests = await detectFlakyTests();

  _container.innerHTML = sectionHeader('Test Portal', index.lastUpdated, () => {
    _indexCache = null;
    showList();
  }) + `
    <div class="stat-grid">
      ${statCard(runs.length, 'Total Runs')}
      ${statCard(latestE2e ? `${latestE2e.passed}/${latestE2e.total}` : '—', 'Latest E2E')}
      ${statCard(latestUi ? `${latestUi.passed}/${latestUi.total}` : '—', 'Latest UI')}
    </div>
    ${renderFlakyPanel(flakyTests)}
    <table class="data-table" id="${tableId}">
      <thead>
        <tr>
          <th>Type</th>
          <th>Timestamp</th>
          <th>Result</th>
          <th>Duration</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${runs.map((r, i) => `
          <tr data-idx="${i}" style="cursor:pointer;">
            <td>${typeBadge(r.type)}</td>
            <td>${escapeHtml(formatTime(r.timestamp))}</td>
            <td>${r.passed}/${r.total} passed</td>
            <td style="color:var(--text-dim);">${formatDuration(r.durationMs)}</td>
            <td>${statusDot(r.passed, r.total)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // Attach click handlers
  setTimeout(() => {
    const table = document.getElementById(tableId);
    if (!table) return;
    table.querySelectorAll<HTMLElement>('tbody tr').forEach(row => {
      row.addEventListener('click', () => {
        const idx = Number(row.dataset.idx);
        const run = runs[idx];
        if (run) navigate({ type: 'run', runType: run.type, runId: run.id });
      });
    });
  }, 0);
}

// ── View 2: Run Detail ──────────────────────────────────────────────────────

async function showRun(runType: string, runId: string): Promise<void> {
  if (!_container) return;
  _container.innerHTML = backButton('All Runs', { type: 'list' }) + loading();

  let run: RunData;
  try {
    run = await fetchJson<RunData>(`/__test_results/${runType}/${runId}/run.json`);
  } catch (err) {
    _container.innerHTML = backButton('All Runs', { type: 'list' }) +
      errorMsg(`Failed to load run: ${(err as Error).message}`);
    return;
  }

  const tests = run.tests || [];
  const tableId = `run-tests-table-${Date.now()}`;

  _container.innerHTML = backButton('All Runs', { type: 'list' }) + `
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
      ${typeBadge(run.type)}
      <h2 style="margin:0;">${escapeHtml(formatTime(run.timestamp))}</h2>
    </div>
    <div style="font-size:12px; color:var(--text-dim); margin-bottom:16px;">
      Duration: ${formatDuration(run.durationMs)}
      &nbsp;&middot;&nbsp; Branch: <strong>${escapeHtml(run.gitBranch)}</strong>
      &nbsp;&middot;&nbsp; Commit: <code>${escapeHtml(run.gitCommit)}</code>
      &nbsp;&middot;&nbsp; Platform: ${escapeHtml(run.platform)}
    </div>
    <div class="stat-grid">
      ${statCard(`<span style="color:var(--green);">${run.summary.passed}</span>`, 'Passed')}
      ${statCard(`<span style="color:var(--red);">${run.summary.failed}</span>`, 'Failed')}
      ${statCard(run.summary.skipped, 'Skipped')}
    </div>
    <table class="data-table" id="${tableId}">
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>Status</th>
          <th>Duration</th>
          <th>Group</th>
        </tr>
      </thead>
      <tbody>
        ${tests.map((t, i) => `
          <tr data-idx="${i}" style="cursor:pointer;">
            <td style="font-family:var(--font-mono); font-size:12px;">${escapeHtml(t.id)}</td>
            <td>${escapeHtml(t.name)}</td>
            <td>${statusBadge(t.status)}</td>
            <td style="color:var(--text-dim);">${formatDuration(t.durationMs)}</td>
            <td style="color:var(--text-dim);">${escapeHtml(t.group)}</td>
          </tr>
          ${t.status === 'fail' && t.error ? `
            <tr>
              <td colspan="5" style="padding:4px 10px 12px; border-bottom:1px solid var(--border);">
                <pre style="color:var(--red); font-size:11px; white-space:pre-wrap; margin:0;">${escapeHtml(t.error)}</pre>
                <button class="test-fix-btn refresh-btn" data-test-name="${escapeHtml(t.name)}" data-test-error="${escapeHtml(t.error ?? '')}" data-config="${escapeHtml(run.type)}" style="font-size:10px; padding:2px 8px; margin-top:6px;">Fix in CC</button>
              </td>
            </tr>
          ` : ''}
        `).join('')}
      </tbody>
    </table>
  `;

  // Attach click handlers
  setTimeout(() => {
    const table = document.getElementById(tableId);
    if (!table) return;
    table.querySelectorAll<HTMLElement>('tbody tr[data-idx]').forEach(row => {
      row.addEventListener('click', () => {
        const idx = Number(row.dataset.idx);
        const t = tests[idx];
        if (t) navigate({ type: 'test', runType, runId, testId: t.id });
      });
    });

    // "Fix in CC" buttons for failed tests
    table.querySelectorAll<HTMLElement>('.test-fix-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const testName = btn.dataset.testName ?? '';
        const testError = btn.dataset.testError ?? '';
        const config = btn.dataset.config ?? '';

        const prompt = `Fix this failing test:\n\nTest: ${testName}\nConfig: ${config}\nError: ${testError}\n\n1. Read the test file and the source it tests\n2. Identify why the test fails\n3. Fix the root cause (prefer fixing source over modifying the test)\n4. Run the test to verify the fix`;

        await dispatchCC('Test Fix', prompt);
      });
    });
  }, 0);
}

// ── View 3: Test Detail ─────────────────────────────────────────────────────

async function showTest(runType: string, runId: string, testId: string): Promise<void> {
  if (!_container) return;
  const parentView: View = { type: 'run', runType, runId };
  _container.innerHTML = backButton('Back to Run', parentView) + loading();

  let result: TestResult;
  try {
    result = await fetchJson<TestResult>(`/__test_results/${runType}/${runId}/${testId}/result.json`);
  } catch (err) {
    _container.innerHTML = backButton('Back to Run', parentView) +
      errorMsg(`Failed to load test: ${(err as Error).message}`);
    return;
  }

  // Historical comparison — find previous run of same type and look for same test
  const comparisonHtml = await buildComparison(runType, runId, testId);

  // Build detail HTML based on test type
  let detailHtml: string;
  if (isUiResult(result)) {
    detailHtml = await buildUiDetail(result, runType, runId, testId);
  } else {
    detailHtml = buildE2eDetail(result as E2eTestResult, runType, runId, testId);
  }

  _container.innerHTML = backButton('Back to Run', parentView) + `
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
      ${typeBadge(runType)}
      ${statusBadge(result.status)}
      <h2 style="margin:0;">${escapeHtml(result.name)}</h2>
    </div>
    <div style="font-size:12px; color:var(--text-dim); margin-bottom:16px;">
      ID: <code>${escapeHtml(result.id)}</code>
      &nbsp;&middot;&nbsp; Group: ${escapeHtml(result.group)}
      &nbsp;&middot;&nbsp; Duration: ${formatDuration(result.durationMs)}
    </div>
    ${comparisonHtml}
    ${result.status === 'fail' && result.error ? `
      <div style="background:var(--bg-panel); border:1px solid var(--red); border-radius:6px; padding:12px; margin-bottom:16px;">
        <div style="font-size:11px; color:var(--red); text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">Error</div>
        <pre style="color:var(--red); font-size:12px; white-space:pre-wrap; margin:0;">${escapeHtml(result.error)}</pre>
      </div>
    ` : ''}
    ${detailHtml}
  `;
}

// ── Type detection ───────────────────────────────────────────────────────────

function isUiResult(result: TestResult): result is UiTestResult {
  return 'screenshots' in result || 'viewport' in result;
}

// ── UI test detail ───────────────────────────────────────────────────────────

async function buildUiDetail(result: UiTestResult, runType: string, runId: string, testId: string): Promise<string> {
  const parts: string[] = [];

  // Metadata
  parts.push(`
    <div style="font-size:13px; margin-bottom:16px;">
      <span style="color:var(--text-dim);">Viewport:</span> <strong>${escapeHtml(result.viewport)}</strong>
      &nbsp;&middot;&nbsp;
      <span style="color:var(--text-dim);">Type:</span> <strong>${escapeHtml(result.type)}</strong>
    </div>
  `);

  // Screenshots
  if (result.screenshots.length > 0) {
    parts.push('<div style="margin-bottom:16px;">');
    parts.push('<div style="font-size:11px; color:var(--text-dim); text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Screenshots</div>');
    for (const filename of result.screenshots) {
      const src = `/__test_results/${runType}/${runId}/${testId}/${filename}`;
      parts.push(`
        <div style="margin-bottom:12px;">
          <div style="font-size:11px; color:var(--text-dim); margin-bottom:4px;">${escapeHtml(filename)}</div>
          <img src="${escapeHtml(src)}" style="max-width:100%; border:1px solid var(--border); border-radius:6px; margin:8px 0;">
        </div>
      `);
    }
    parts.push('</div>');
  }

  // Console log
  if (result.consoleLog) {
    try {
      const logUrl = `/__test_results/${runType}/${runId}/${testId}/${result.consoleLog}`;
      const logText = await fetchText(logUrl);
      parts.push(`
        <div style="margin-bottom:16px;">
          <div style="font-size:11px; color:var(--text-dim); text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Console Output</div>
          <pre style="background:var(--bg-panel); border:1px solid var(--border); border-radius:6px; padding:12px; font-size:11px; white-space:pre-wrap; overflow-x:auto; max-height:400px; overflow-y:auto;">${escapeHtml(logText)}</pre>
        </div>
      `);
    } catch {
      // Skip console log if fetch fails
    }
  }

  return parts.join('');
}

// ── E2E test detail ──────────────────────────────────────────────────────────

const GRADE_COLORS: Record<string, string> = {
  A: 'var(--green)', B: 'var(--accent)', C: 'var(--yellow)', D: '#e8882a', F: 'var(--red)',
};

function gradeBadge(grade: string): string {
  const color = GRADE_COLORS[grade] ?? 'var(--text-dim)';
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:${color};color:var(--bg);font-weight:700;font-size:14px;font-family:var(--font-display);">${escapeHtml(grade)}</span>`;
}

function miniGradeBadge(grade: string): string {
  const color = GRADE_COLORS[grade] ?? 'var(--text-dim)';
  return `<span style="color:${color};font-weight:700;font-size:12px;">${grade}</span>`;
}

function buildPerfPanel(perf: NonNullable<E2eTestResult['perf']>, uid: string): string {
  const grade = perf.grade;
  const ts = perf.timing.tickStats;

  const sparkTickId = `perf-spark-tick-${uid}`;
  const sparkNetId = `perf-spark-net-${uid}`;
  const sparkBwId = `perf-spark-bw-${uid}`;
  _activePerfCharts.add(sparkTickId);
  _activePerfCharts.add(sparkNetId);
  _activePerfCharts.add(sparkBwId);

  const violationPct = ts.count > 0 ? ((perf.timing.budgetViolations / ts.count) * 100).toFixed(1) : '0.0';
  const fidelityRatio = perf.network.configured.packetLossRate > 0
    ? (perf.network.observed.actualLossRate / perf.network.configured.packetLossRate).toFixed(2)
    : perf.network.observed.actualLossRate > 0 ? '>1' : '1.00';

  const breakdownRows = (grade?.breakdown ?? []).map(b => `
    <tr>
      <td style="font-size:12px;">${escapeHtml(b.category)}</td>
      <td>${miniGradeBadge(b.grade)}</td>
      <td style="font-size:12px; color:var(--text-dim);">${escapeHtml(b.reason)}</td>
      <td style="font-size:11px; color:var(--text-quiet); font-family:var(--font-mono);">thresh: ${b.threshold}</td>
    </tr>
  `).join('');

  const breakdownId = `perf-breakdown-${uid}`;
  const toggleId = `perf-toggle-${uid}`;
  const hasBandwidth = perf.network.observed.bandwidthSamples && perf.network.observed.bandwidthSamples.length > 1;

  return `
    <div style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;">Performance</div>
        ${grade ? gradeBadge(grade.overall) : ''}
      </div>
      <div class="stat-grid" style="margin-bottom:12px;">
        ${statCard(`${ts.p95}μs`, `p95 Tick ${grade ? miniGradeBadge(grade.breakdown.find(b => b.category === 'Tick Cost')?.grade ?? '') : ''}`)}
        ${statCard(`${violationPct}%`, `Budget Viol ${grade ? miniGradeBadge(grade.breakdown.find(b => b.category === 'Frame Budget')?.grade ?? '') : ''}`)}
        ${statCard(`${fidelityRatio}x`, `Net Fidelity ${grade ? miniGradeBadge(grade.breakdown.find(b => b.category === 'Network Fidelity')?.grade ?? '') : ''}`)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr ${hasBandwidth ? '1fr' : ''};gap:12px;margin-bottom:12px;">
        <div>
          <div style="font-size:10px;color:var(--text-quiet);margin-bottom:4px;">Tick Time (μs)</div>
          <div id="${sparkTickId}" style="background:var(--bg-surface);border:1px solid var(--border);border-radius:4px;padding:4px;"></div>
        </div>
        <div>
          <div style="font-size:10px;color:var(--text-quiet);margin-bottom:4px;">Network Delivery (ms)</div>
          <div id="${sparkNetId}" style="background:var(--bg-surface);border:1px solid var(--border);border-radius:4px;padding:4px;"></div>
        </div>
        ${hasBandwidth ? `
        <div>
          <div style="font-size:10px;color:var(--text-quiet);margin-bottom:4px;">Bandwidth (bytes/s)</div>
          <div id="${sparkBwId}" style="background:var(--bg-surface);border:1px solid var(--border);border-radius:4px;padding:4px;"></div>
        </div>` : ''}
      </div>
      <div style="margin-bottom:8px;">
        <button id="${toggleId}" style="background:none;border:1px solid var(--border);color:var(--text-dim);padding:4px 10px;font-size:11px;cursor:pointer;border-radius:4px;font-family:var(--font-display);letter-spacing:1px;">GRADING BREAKDOWN</button>
      </div>
      <div id="${breakdownId}" style="display:none;margin-bottom:12px;">
        <table class="data-table">
          <thead><tr><th>Category</th><th>Grade</th><th>Detail</th><th>Threshold</th></tr></thead>
          <tbody>${breakdownRows}</tbody>
        </table>
      </div>
      ${grade?.summary ? `<div style="font-size:12px;color:var(--text-dim);font-style:italic;padding:8px 0;border-top:1px solid var(--border);">${escapeHtml(grade.summary)}</div>` : ''}
    </div>
  `;
}

function mountPerfSparklines(perf: NonNullable<E2eTestResult['perf']>, uid: string): void {
  const tickData = perf.timing.tickSamples.map(s => s[1]);
  if (tickData.length >= 2) {
    renderSparkline(`perf-spark-tick-${uid}`, tickData, {
      color: 'rgba(110,224,240,0.6)',
      threshold: 16600,
      thresholdColor: 'var(--red)',
    });
  }

  const netSamples = perf.network.observed.avgDeliveryMs > 0
    ? [perf.network.observed.avgDeliveryMs, perf.network.observed.p95DeliveryMs, perf.network.observed.maxDeliveryMs]
    : [];
  if (netSamples.length >= 2) {
    renderSparkline(`perf-spark-net-${uid}`, netSamples, {
      color: 'rgba(255,180,42,0.6)',
    });
  }

  const bwSamples = perf.network.observed.bandwidthSamples;
  if (bwSamples && bwSamples.length >= 2) {
    const bwData = bwSamples.map(s => ({ ts: s[0] * 1000, value: s[1] }));
    renderTimeSeriesChart(`perf-spark-bw-${uid}`, bwData, {
      color: 'rgba(60,255,60,0.6)',
      height: 50,
    });
  }

  const toggleBtn = document.getElementById(`perf-toggle-${uid}`);
  const breakdownDiv = document.getElementById(`perf-breakdown-${uid}`);
  if (toggleBtn && breakdownDiv) {
    toggleBtn.addEventListener('click', () => {
      const visible = breakdownDiv.style.display !== 'none';
      breakdownDiv.style.display = visible ? 'none' : 'block';
      toggleBtn.textContent = visible ? 'GRADING BREAKDOWN' : 'HIDE BREAKDOWN';
    });
  }
}

function buildE2eDetail(result: E2eTestResult, runType: string, runId: string, testId: string): string {
  const parts: string[] = [];

  // Watch Replay button (when replay data is available)
  if (result.replayFile) {
    const replayUrl = `/__test_results/${runType}/${runId}/${testId}/${result.replayFile}`;
    // Opens the game dev server with the replay data URL so the game can fetch and play it
    const gameUrl = `http://localhost:5173?testReplay=${encodeURIComponent(location.origin + replayUrl)}`;
    parts.push(`
      <div style="margin-bottom:16px;">
        <a href="${escapeHtml(gameUrl)}" target="_blank" rel="noopener"
           style="display:inline-flex; align-items:center; gap:8px; padding:10px 20px;
                  background:var(--accent); color:var(--bg); border-radius:6px;
                  text-decoration:none; font-size:13px; font-weight:600;
                  transition:opacity 0.15s;"
           onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
          &#9654; Watch Replay
        </a>
        <span style="font-size:11px; color:var(--text-dim); margin-left:12px;">Opens in game (requires dev server on :5173)</span>
      </div>
    `);
  }

  // Performance panel (only when perf data present)
  if (result.perf) {
    const uid = String(Date.now());
    parts.push(buildPerfPanel(result.perf, uid));
    setTimeout(() => mountPerfSparklines(result.perf!, uid), 0);
  }

  // Config section
  parts.push(`
    <div style="margin-bottom:16px;">
      <div style="font-size:11px; color:var(--text-dim); text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Configuration</div>
      <div style="background:var(--bg-panel); border:1px solid var(--border); border-radius:6px; padding:12px; font-size:13px; display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:8px;">
        <div><span style="color:var(--text-dim);">Match Type:</span> ${escapeHtml(result.matchType)}</div>
        <div><span style="color:var(--text-dim);">Seed:</span> ${result.seed}</div>
        <div><span style="color:var(--text-dim);">Players:</span> ${result.playerCount} (${result.humanCount} human, ${result.aiCount} AI)</div>
        <div><span style="color:var(--text-dim);">Latency:</span> ${result.network.latencyMs}ms</div>
        <div><span style="color:var(--text-dim);">Packet Loss:</span> ${(result.network.packetLossRate * 100).toFixed(1)}%</div>
      </div>
    </div>
  `);

  // Ticks
  parts.push(`
    <div style="margin-bottom:16px;">
      <div style="font-size:11px; color:var(--text-dim); text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Ticks</div>
      <div style="font-size:13px;">
        Actual: <strong>${result.actualTicks}</strong> / Max: <strong>${result.maxTicks}</strong>
      </div>
    </div>
  `);

  // Deaths table
  if (result.deaths.length > 0) {
    parts.push(`
      <div style="margin-bottom:16px;">
        <div style="font-size:11px; color:var(--text-dim); text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Deaths (${result.deaths.length})</div>
        <table class="data-table">
          <thead>
            <tr>
              <th>Player Index</th>
              <th>Tick</th>
              <th>Agreed by Clients</th>
            </tr>
          </thead>
          <tbody>
            ${result.deaths.map(d => `
              <tr>
                <td>${d.playerIndex}</td>
                <td>${d.tick}</td>
                <td style="color:var(--text-dim);">[${d.clients.join(', ')}]</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `);
  }

  // Hash checks
  parts.push(`
    <div style="margin-bottom:16px;">
      <div style="font-size:11px; color:var(--text-dim); text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Hash Checks</div>
      <div style="font-size:13px; margin-bottom:8px;">
        Total: <strong>${result.hashChecks.total}</strong>
        &nbsp;&middot;&nbsp;
        Mismatches: <strong style="color:${result.hashChecks.mismatches > 0 ? 'var(--red)' : 'var(--green)'};">${result.hashChecks.mismatches}</strong>
      </div>
      ${result.hashChecks.mismatches > 0 ? `
        <table class="data-table">
          <thead>
            <tr>
              <th>Tick</th>
              <th>Hashes</th>
            </tr>
          </thead>
          <tbody>
            ${result.hashChecks.details.map(d => `
              <tr>
                <td>${d.tick}</td>
                <td style="color:var(--red); font-family:var(--font-mono); font-size:12px;">${d.hashes.map(h => '0x' + (h >>> 0).toString(16).padStart(8, '0')).join(' vs ')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : ''}
    </div>
  `);

  return parts.join('');
}

// ── Historical comparison ────────────────────────────────────────────────────

async function buildComparison(runType: string, runId: string, testId: string): Promise<string> {
  try {
    // Use cached index or fetch it
    const index = _indexCache || await fetchIndex();
    const runsOfType = (index.runs || []).filter(r => r.type === runType);

    // Find current run index and get the previous one
    const currentIdx = runsOfType.findIndex(r => r.id === runId);
    if (currentIdx < 0 || currentIdx >= runsOfType.length - 1) return '';
    const prevRun = runsOfType[currentIdx + 1]; // sorted newest first, so +1 = previous

    // Fetch previous run
    const prevRunData = await fetchJson<RunData>(
      `/__test_results/${runType}/${prevRun.id}/run.json`
    );
    const prevTest = prevRunData.tests.find(t => t.id === testId);
    if (!prevTest) return '';

    // Fetch current test status from result (already loaded but we receive the full result)
    // We need to determine current status — re-fetch the parent run to get it
    const currentRunData = await fetchJson<RunData>(
      `/__test_results/${runType}/${runId}/run.json`
    );
    const currentTest = currentRunData.tests.find(t => t.id === testId);
    if (!currentTest) return '';

    const prev = prevTest.status;
    const curr = currentTest.status;

    if (prev === 'fail' && curr === 'pass') {
      return `<div style="background:var(--bg-panel); border:1px solid var(--green); border-radius:6px; padding:8px 12px; margin-bottom:16px; font-size:13px;">
        <span style="color:var(--green); font-weight:600;">Previously FAIL &rarr; now PASS</span>
      </div>`;
    }
    if (prev === 'pass' && curr === 'fail') {
      return `<div style="background:var(--bg-panel); border:1px solid var(--red); border-radius:6px; padding:8px 12px; margin-bottom:16px; font-size:13px;">
        <span style="color:var(--red); font-weight:600;">Previously PASS &rarr; now FAIL</span>
      </div>`;
    }
    return `<div style="background:var(--bg-panel); border:1px solid var(--border); border-radius:6px; padding:8px 12px; margin-bottom:16px; font-size:13px;">
      <span style="color:var(--text-dim);">Consistent (${prev === 'pass' ? 'PASS' : 'FAIL'})</span>
    </div>`;
  } catch {
    // If comparison fails, just skip it
    return '';
  }
}
