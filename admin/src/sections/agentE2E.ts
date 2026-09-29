// admin/src/sections/agentE2E.ts — E2E visual testing dashboard (Qwen-VL + Playwright)

// ── Types ────────────────────────────────────────────────────────────────────

interface AssertionResult {
  question: string;
  expected: boolean;
  actual: boolean;
  confidence: number;
  pass: boolean;
}

type TestStatus = 'pending' | 'pass' | 'fail' | 'running' | 'stale';

interface E2ETestItem {
  id: string;
  name: string;
  file: string;
  status: TestStatus;
  pixelDiff?: number;
  assertionResults?: AssertionResult[];
  output?: string[];
  baselineUrl?: string;
  actualUrl?: string;
  diffUrl?: string;
  tier?: 'pixel' | 'semantic' | 'both';
}

type ScreenshotTab = 'baseline' | 'actual' | 'diff' | 'slide';

// ── State ────────────────────────────────────────────────────────────────────

let _container: HTMLElement | null = null;
let _tests: E2ETestItem[] = [];
let _selectedId: string | null = null;
const _selectedIds: Set<string> = new Set();
let _threshold = 0.2;
let _activeScreenTab: ScreenshotTab = 'baseline';

// ── Hardcoded known tests (until /__admin_exec/e2e-list is available) ─────────

const KNOWN_TESTS: Omit<E2ETestItem, 'status'>[] = [
  { id: 'lobby-visual', name: 'Lobby Visual', file: 'tests/e2e/lobby.spec.ts' },
  { id: 'match-visual', name: 'Match Visual', file: 'tests/e2e/match.spec.ts' },
  { id: 'main-menu-visual', name: 'Main Menu Visual', file: 'tests/e2e/main-menu.spec.ts' },
  { id: 'lobby-responsive', name: 'Lobby Responsive', file: 'tests/e2e/lobby-responsive.spec.ts' },
  { id: 'hud-visual', name: 'HUD Visual', file: 'tests/e2e/hud.spec.ts' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function confidenceClass(confidence: number): string {
  if (confidence >= 80) return 'confidence-high';
  if (confidence >= 60) return 'confidence-mid';
  return 'confidence-low';
}

function statusBadge(status: TestStatus): string {
  if (status === 'pass') return '<span class="e2e-badge e2e-badge--pass">&#10003;</span>';
  if (status === 'fail') return '<span class="e2e-badge e2e-badge--fail">&#10007;</span>';
  if (status === 'running') return '<span class="e2e-badge e2e-badge--running">&#9654;</span>';
  if (status === 'stale') return '<span class="e2e-badge e2e-badge--stale">&#9680;</span>';
  return '<span class="e2e-badge e2e-badge--pending">&#9675;</span>';
}

function statusModifier(status: TestStatus): string {
  if (status === 'pass') return 'e2e-test-item--pass';
  if (status === 'fail') return 'e2e-test-item--fail';
  if (status === 'running') return 'e2e-test-item--running';
  if (status === 'stale') return 'e2e-test-item--stale';
  return 'e2e-test-item--pending';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Fetch test list ───────────────────────────────────────────────────────────

async function loadTestList(): Promise<E2ETestItem[]> {
  try {
    const res = await fetch('/__admin_exec/e2e-list');
    if (res.ok) {
      const data = await res.json() as Array<{ id: string; name: string; file: string }>;
      return data.map(t => ({ ...t, status: 'pending' as TestStatus }));
    }
  } catch {
    // Fall through to hardcoded list
  }
  return KNOWN_TESTS.map(t => ({ ...t, status: 'pending' as TestStatus }));
}

// ── Render helpers ────────────────────────────────────────────────────────────

function renderTestList(): string {
  if (_tests.length === 0) {
    return '<div class="e2e-empty">No tests loaded</div>';
  }
  return _tests.map(t => {
    const selected = _selectedId === t.id ? ' e2e-test-item--selected' : '';
    const checked = _selectedIds.has(t.id) ? ' checked' : '';
    return `
      <div class="e2e-test-item ${statusModifier(t.status)}${selected}" data-id="${escapeHtml(t.id)}">
        <input type="checkbox" class="e2e-test-checkbox"${checked} data-id="${escapeHtml(t.id)}" />
        ${statusBadge(t.status)}
        <span class="e2e-test-name">${escapeHtml(t.name)}</span>
      </div>
    `;
  }).join('');
}

function renderSlideCompare(test: E2ETestItem | null): string {
  const baselineSrc = escapeHtml(test?.baselineUrl ?? '');
  const actualSrc = escapeHtml(test?.actualUrl ?? '');
  return `
    <div class="e2e-slider-compare" style="position:relative;">
      <img class="e2e-slider-baseline" src="${baselineSrc}" style="width:100%;" />
      <div class="e2e-slider-overlay" style="position:absolute;top:0;left:0;overflow:hidden;width:50%;">
        <img class="e2e-slider-actual" src="${actualSrc}" style="width:100%;" />
      </div>
      <input class="e2e-slider-range" type="range" min="0" max="100" value="50" style="width:100%;" />
    </div>
  `;
}

function renderScreenshotTabs(test: E2ETestItem | null): string {
  const tabs: ScreenshotTab[] = ['baseline', 'actual', 'diff', 'slide'];
  const tabBar = tabs.map(tab => {
    const active = _activeScreenTab === tab ? ' e2e-tab--active' : '';
    const label = tab === 'slide' ? 'Slide' : tab.charAt(0).toUpperCase() + tab.slice(1);
    return `<button class="e2e-tab${active}" data-tab="${tab}">${label}</button>`;
  }).join('');

  const diffPct = test?.pixelDiff !== undefined
    ? `<span class="e2e-diff-pct">Pixel diff: ${test.pixelDiff.toFixed(2)}%</span>`
    : '';

  let screenshotView: string;
  if (_activeScreenTab === 'slide') {
    screenshotView = renderSlideCompare(test);
  } else {
    let imgSrc = '';
    if (test) {
      if (_activeScreenTab === 'baseline') imgSrc = test.baselineUrl ?? '';
      else if (_activeScreenTab === 'actual') imgSrc = test.actualUrl ?? '';
      else imgSrc = test.diffUrl ?? '';
    }
    screenshotView = imgSrc
      ? `<img class="e2e-screenshot-img" src="${escapeHtml(imgSrc)}" alt="${_activeScreenTab}" />`
      : `<div class="e2e-screenshot-placeholder">No ${_activeScreenTab} image</div>`;
  }

  const acceptBtn = _activeScreenTab === 'actual' && test?.status === 'fail'
    ? `<button class="e2e-accept-baseline" data-id="${escapeHtml(test?.id ?? '')}">Accept as Baseline</button>`
    : '';

  return `
    <div class="e2e-screenshots">
      <div class="e2e-tab-bar">${tabBar}${diffPct}</div>
      <div class="e2e-screenshot-view">${screenshotView}</div>
      ${acceptBtn}
    </div>
  `;
}

function renderAnalysis(test: E2ETestItem | null): string {
  if (!test?.assertionResults?.length) {
    return `
      <div class="e2e-analysis">
        <div class="e2e-analysis-empty">No semantic analysis available</div>
      </div>
    `;
  }

  const rows = test.assertionResults.map(a => {
    const icon = a.pass ? '&#10003;' : '&#10007;';
    const iconClass = a.pass ? 'e2e-assert-pass' : 'e2e-assert-fail';
    const confClass = confidenceClass(a.confidence);
    return `
      <div class="e2e-assert-row">
        <span class="${iconClass}">${icon}</span>
        <span class="e2e-assert-question">${escapeHtml(a.question)}</span>
        <span class="e2e-assert-conf ${confClass}">${a.confidence}%</span>
      </div>
    `;
  }).join('');

  const allPass = test.assertionResults.every(a => a.pass);
  const verdict = allPass ? 'SEMANTIC PASS' : 'SEMANTIC FAIL';
  const verdictClass = allPass ? 'e2e-verdict--pass' : 'e2e-verdict--fail';

  return `
    <div class="e2e-analysis">
      <div class="e2e-analysis-rows">${rows}</div>
      <div class="e2e-verdict ${verdictClass}">${verdict}</div>
    </div>
  `;
}

function renderOutput(test: E2ETestItem | null): string {
  const lines = test?.output ?? [];
  const content = lines.length > 0
    ? lines.map(l => `<div class="e2e-output-line">${escapeHtml(l)}</div>`).join('')
    : '<div class="e2e-output-empty">No output</div>';
  return `<div class="e2e-output">${content}</div>`;
}

function renderViewer(): string {
  const test = _tests.find(t => t.id === _selectedId) ?? null;
  return `
    <div class="e2e-viewer">
      ${renderScreenshotTabs(test)}
      ${renderAnalysis(test)}
      ${renderOutput(test)}
    </div>
  `;
}

function renderControls(): string {
  return `
    <div class="e2e-controls">
      <button class="e2e-run-all">&#9654; Run All</button>
      <button class="e2e-run-selected">&#9654; Run Selected</button>
      <label>Pixel threshold: <input class="e2e-threshold" type="number" value="${_threshold}" step="0.1" min="0" max="5" />%</label>
    </div>
  `;
}

function render(): void {
  if (!_container) return;
  _container.innerHTML = `
    <div class="agent-e2e">
      ${renderControls()}
      <div class="e2e-body">
        <div class="e2e-test-list">${renderTestList()}</div>
        ${renderViewer()}
      </div>
    </div>
  `;
  attachListeners();
}

// ── Event listeners ───────────────────────────────────────────────────────────

function attachListeners(): void {
  if (!_container) return;

  // Run all
  _container.querySelector('.e2e-run-all')?.addEventListener('click', () => {
    void runTests(_tests.map(t => t.id));
  });

  // Run selected
  _container.querySelector('.e2e-run-selected')?.addEventListener('click', () => {
    void runTests(Array.from(_selectedIds));
  });

  // Threshold
  _container.querySelector('.e2e-threshold')?.addEventListener('change', (e) => {
    const val = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(val)) _threshold = val;
  });

  // Test item click (select)
  _container.querySelectorAll('.e2e-test-item').forEach(el => {
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('e2e-test-checkbox')) return;
      const id = (el as HTMLElement).dataset['id'];
      if (id) {
        _selectedId = id;
        render();
      }
    });
  });

  // Checkboxes
  _container.querySelectorAll('.e2e-test-checkbox').forEach(el => {
    el.addEventListener('change', (e) => {
      const id = (e.target as HTMLInputElement).dataset['id'];
      if (!id) return;
      if ((e.target as HTMLInputElement).checked) {
        _selectedIds.add(id);
      } else {
        _selectedIds.delete(id);
      }
    });
  });

  // Screenshot tabs
  _container.querySelectorAll('.e2e-tab').forEach(el => {
    el.addEventListener('click', () => {
      const tab = (el as HTMLElement).dataset['tab'] as ScreenshotTab;
      if (tab) {
        _activeScreenTab = tab;
        render();
      }
    });
  });

  // Slide compare range input
  _container.querySelector('.e2e-slider-range')?.addEventListener('input', (e) => {
    const overlay = _container?.querySelector<HTMLElement>('.e2e-slider-overlay');
    if (overlay) {
      overlay.style.width = (e.target as HTMLInputElement).value + '%';
    }
  });

  // Accept as baseline
  _container.querySelector('.e2e-accept-baseline')?.addEventListener('click', async (e) => {
    const id = (e.target as HTMLElement).dataset['id'];
    if (!id) return;
    try {
      await fetch('/__admin_exec/e2e-accept-baseline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testId: id }),
      });
      const test = _tests.find(t => t.id === id);
      if (test) test.status = 'pass';
      render();
    } catch (err) {
      console.warn('[agentE2E] Failed to accept baseline:', err);
    }
  });
}

// ── Test runner ───────────────────────────────────────────────────────────────

async function runTests(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  for (const id of ids) {
    const test = _tests.find(t => t.id === id);
    if (!test) continue;

    test.status = 'running';
    test.output = [];
    render();

    try {
      const res = await fetch('/__admin_exec/e2e-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testId: id, threshold: _threshold }),
      });

      if (res.ok) {
        const result = await res.json() as {
          status: 'pass' | 'fail';
          pixelDiff?: number;
          assertionResults?: AssertionResult[];
          output?: string[];
          baselineUrl?: string;
          actualUrl?: string;
          diffUrl?: string;
        };
        test.status = result.status;
        test.pixelDiff = result.pixelDiff;
        test.assertionResults = result.assertionResults;
        test.output = result.output ?? [];
        test.baselineUrl = result.baselineUrl;
        test.actualUrl = result.actualUrl;
        test.diffUrl = result.diffUrl;
      } else {
        test.status = 'fail';
        test.output = [`Error: HTTP ${res.status}`];
      }
    } catch (err) {
      test.status = 'fail';
      test.output = [`Error: ${String(err)}`];
    }

    if (_selectedId === id) render();
    else render();
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

export async function initAgentE2E(): Promise<void> {
  _container = document.getElementById('section-agent-e2e');
  if (!_container) return;

  _tests = await loadTestList();
  if (_tests.length > 0) _selectedId = _tests[0].id;

  render();
}
