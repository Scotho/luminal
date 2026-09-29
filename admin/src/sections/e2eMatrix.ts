import { escapeHtml, statCard } from '../ui/render';
import { dispatchCC } from '../ui/ccPanel';
import { icon } from '../ui/icons';

// ── Types ────────────────────────────────────────────────────────────────────

export interface E2eMatrixEntry {
  id: string;
  name: string;
  tier: 'T1' | 'T2' | 'T3';
  category: string;
  file: string;
  status: 'planned' | 'infra-needed' | 'implemented' | 'passing' | 'failing' | 'flaky';
  priority: 'A' | 'B' | 'C' | 'D';
  lastRun?: string;
  lastResult?: 'pass' | 'fail' | 'skip';
  notes?: string;
}

interface E2eMatrixData {
  tests: E2eMatrixEntry[];
  lastUpdated: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type FilterMode = 'all' | 'T1' | 'T2' | 'T3' | 'planned' | 'failing' | 'flaky';

const STATUS_COLORS: Record<string, string> = {
  planned: 'var(--text-dim)',
  'infra-needed': 'var(--yellow, #e6b422)',
  implemented: 'var(--accent, #1a7a8a)',
  passing: 'var(--green, #4caf50)',
  failing: 'var(--red, #d45234)',
  flaky: 'var(--yellow, #e6b422)',
};

const STATUS_ICONS: Record<string, string> = {
  planned: '&#9744;',    // empty checkbox
  'infra-needed': '&#9881;', // gear
  implemented: '&#9654;', // play
  passing: '&#10003;',   // check
  failing: '&#10007;',   // x
  flaky: '&#9888;',      // warning
};

const TIER_LABELS: Record<string, string> = { T1: 'Headless', T2: 'Browser', T3: 'Layout' };

export function filterTests(tests: E2eMatrixEntry[], filter: FilterMode): E2eMatrixEntry[] {
  if (filter === 'all') return tests;
  if (filter === 'T1' || filter === 'T2' || filter === 'T3') return tests.filter(t => t.tier === filter);
  return tests.filter(t => t.status === filter);
}

export function computeStats(tests: E2eMatrixEntry[]): { total: number; passing: number; failing: number; flaky: number; planned: number } {
  let passing = 0, failing = 0, flaky = 0, planned = 0;
  for (const t of tests) {
    if (t.status === 'passing') passing++;
    else if (t.status === 'failing') failing++;
    else if (t.status === 'flaky') flaky++;
    else if (t.status === 'planned' || t.status === 'infra-needed') planned++;
  }
  return { total: tests.length, passing, failing, flaky, planned };
}

/** Group tests by category, preserving insertion order. */
export function groupByCategory(tests: E2eMatrixEntry[]): Map<string, E2eMatrixEntry[]> {
  const groups = new Map<string, E2eMatrixEntry[]>();
  for (const t of tests) {
    if (!groups.has(t.category)) groups.set(t.category, []);
    groups.get(t.category)!.push(t);
  }
  return groups;
}

function renderTestRow(t: E2eMatrixEntry, expanded: boolean): string {
  const color = STATUS_COLORS[t.status] ?? 'var(--text-dim)';
  const icon = STATUS_ICONS[t.status] ?? '';
  return `
    <div class="e2e-row${expanded ? ' e2e-row--expanded' : ''}" data-test-id="${escapeHtml(t.id)}" style="display:flex; align-items:center; padding:6px 10px; border-bottom:1px solid var(--border); cursor:pointer; gap:8px;">
      <span style="color:${color}; font-size:14px; width:20px; text-align:center;">${icon}</span>
      <span style="font-weight:600; font-size:12px; width:28px; color:var(--text-dim);">${escapeHtml(t.id)}</span>
      <span style="flex:1; font-size:13px;">${escapeHtml(t.name)}</span>
      <span style="font-size:10px; padding:2px 6px; border-radius:3px; background:${color}22; color:${color}; font-weight:600;">${escapeHtml(t.status)}</span>
      <span style="font-size:10px; color:var(--text-dim); width:24px; text-align:center;">${escapeHtml(t.tier)}</span>
      <button class="e2e-run-btn refresh-btn" data-test-id="${escapeHtml(t.id)}" style="font-size:10px; padding:2px 8px;" title="Run this test">&#9654;</button>
    </div>
    ${expanded ? renderTestDetail(t) : ''}
  `;
}

function renderTestDetail(t: E2eMatrixEntry): string {
  return `
    <div class="e2e-detail" style="padding:8px 10px 12px 58px; background:var(--bg-hover, rgba(255,255,255,0.02)); border-bottom:1px solid var(--border); font-size:12px; color:var(--text-dim);">
      <div><strong>File:</strong> <code>${escapeHtml(t.file)}</code></div>
      <div><strong>Priority:</strong> Phase ${escapeHtml(t.priority)} &middot; <strong>Tier:</strong> ${escapeHtml(t.tier)} (${TIER_LABELS[t.tier] ?? ''})</div>
      ${t.lastRun ? `<div><strong>Last run:</strong> ${new Date(t.lastRun).toLocaleString()} &middot; <strong>Result:</strong> ${escapeHtml(t.lastResult ?? 'unknown')}</div>` : ''}
      ${t.notes ? `<div style="margin-top:4px;"><strong>Notes:</strong> ${escapeHtml(t.notes)}</div>` : ''}
      <div style="margin-top:6px; display:flex; gap:6px;">
        <button class="refresh-btn e2e-investigate-btn" data-test-id="${escapeHtml(t.id)}" style="font-size:10px;">Investigate in CC</button>
      </div>
    </div>
  `;
}

// ── CC Dispatch prompts ──────────────────────────────────────────────────────

function buildWriteNextPrompt(tests: E2eMatrixEntry[]): string {
  const planned = tests
    .filter(t => t.status === 'planned')
    .sort((a, b) => a.priority.localeCompare(b.priority));
  if (planned.length === 0) return 'All tests in the e2e matrix are implemented. Run /e2e-audit to check for gaps.';
  const next = planned[0];
  return `Write the next planned e2e test from the coverage matrix.

Test: ${next.id} — ${next.name}
Tier: ${next.tier} (${TIER_LABELS[next.tier] ?? ''})
Category: ${next.category}
Target file: ${next.file}
Notes: ${next.notes ?? 'none'}

Use /write-online-test for browser tests or follow existing patterns in src/e2e/__tests__/ for headless tests.
After writing, run the test to verify it passes. Then update the matrix:
curl -X PATCH http://localhost:5175/__admin_e2e_matrix -H 'Content-Type: application/json' -d '{"id":"${next.id}","status":"passing"}'`;
}

function buildTriagePrompt(tests: E2eMatrixEntry[]): string {
  const failing = tests.filter(t => t.status === 'failing' || t.status === 'flaky');
  if (failing.length === 0) return 'No failing or flaky tests in the matrix.';
  const list = failing.map(t => `- ${t.id}: ${t.name} (${t.status}) — ${t.file}`).join('\n');
  return `Triage these failing/flaky e2e tests:\n\n${list}\n\nFor each:\n1. Read the test file and the source it tests\n2. Identify root cause (flaky timing? real regression? infra issue?)\n3. Fix if straightforward, or create a session for complex fixes\n4. Update the matrix status after resolution`;
}

function buildAuditPrompt(): string {
  return `Run a full e2e coverage audit using /e2e-audit. Check recent git changes, identify untested flows, and recommend new tests to add to the matrix.`;
}

// ── Section entry point ──────────────────────────────────────────────────────

export async function renderE2eMatrix(container: HTMLElement): Promise<void> {
  let data: E2eMatrixData = { tests: [], lastUpdated: '' };
  let filter: FilterMode = 'all';
  let expandedId: string | null = null;

  async function fetchMatrix(): Promise<void> {
    try {
      const res = await fetch('/data/e2e-matrix.json');
      if (res.ok) data = await res.json() as E2eMatrixData;
    } catch {
      data = { tests: [], lastUpdated: '' };
    }
  }

  async function saveMatrix(): Promise<void> {
    data.lastUpdated = new Date().toISOString();
    try {
      await fetch('/__admin_save?file=e2e-matrix.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data, null, 2),
      });
    } catch (e) {
      console.warn('Failed to save e2e matrix:', e);
    }
  }

  function render(): void {
    const filtered = filterTests(data.tests, filter);
    const stats = computeStats(data.tests);
    const groups = groupByCategory(filtered);

    const filters: FilterMode[] = ['all', 'T1', 'T2', 'T3', 'planned', 'failing', 'flaky'];

    container.innerHTML = `
      <h2>${icon('grid-2x2', 18)} E2E Coverage Matrix</h2>
      <div class="stat-grid">
        ${statCard(stats.total, 'Total')}
        ${statCard(stats.passing, 'Passing')}
        ${statCard(stats.failing, 'Failing')}
        ${statCard(stats.flaky, 'Flaky')}
        ${statCard(stats.planned, 'TODO')}
      </div>

      <div style="display:flex; gap:6px; margin:12px 0; flex-wrap:wrap; align-items:center;">
        ${filters.map(f => `<button class="config-btn${filter === f ? ' active' : ''}" data-filter="${f}" style="font-size:10px; padding:4px 10px;">${f === 'all' ? 'All' : f}</button>`).join('')}
        <span style="margin-left:auto; color:var(--text-dim); font-size:12px;">${filtered.length} tests shown</span>
      </div>

      <div id="e2e-groups">
        ${Array.from(groups.entries()).map(([category, tests]) => `
          <div style="margin-bottom:16px;">
            <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-dim); padding:6px 10px; background:var(--bg-hover, rgba(255,255,255,0.02)); border-bottom:1px solid var(--border);">
              ${escapeHtml(category)} (${tests[0].tier})
            </div>
            ${tests.map(t => renderTestRow(t, expandedId === t.id)).join('')}
          </div>
        `).join('')}
      </div>

      ${filtered.length === 0 ? '<div style="color:var(--text-dim); padding:20px; text-align:center;">No tests match filter</div>' : ''}

      <div style="display:flex; gap:8px; margin:16px 0; flex-wrap:wrap;">
        <button class="refresh-btn" id="e2e-run-t1" style="font-size:11px;">Run All T1</button>
        <button class="refresh-btn" id="e2e-run-t2" style="font-size:11px;">Run All T2</button>
        <button class="refresh-btn" id="e2e-run-failing" style="font-size:11px;">Run Failing</button>
        <button class="refresh-btn" id="e2e-refresh" style="font-size:11px;">Refresh</button>
      </div>

      <div style="border-top:1px solid var(--border); padding-top:12px; margin-top:8px;">
        <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-dim); margin-bottom:8px;">Agent Actions</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="refresh-btn" id="e2e-write-next" style="font-size:11px;">Write Next Planned Test</button>
          <button class="refresh-btn" id="e2e-triage" style="font-size:11px;">Triage Failures</button>
          <button class="refresh-btn" id="e2e-audit" style="font-size:11px;">Full Audit Report</button>
          <button class="refresh-btn" id="e2e-scan" style="font-size:11px;">Scan &amp; Update Matrix</button>
        </div>
      </div>

      <div style="margin-top:8px; color:var(--text-dim); font-size:11px;">
        Last updated: ${data.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : 'never'}
      </div>
    `;

    wireEvents();
  }

  function wireEvents(): void {
    // Filter buttons
    container.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        filter = btn.dataset.filter as FilterMode;
        render();
      });
    });

    // Row click to expand
    container.querySelectorAll<HTMLElement>('.e2e-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.e2e-run-btn')) return;
        const id = row.dataset.testId;
        if (!id) return;
        expandedId = expandedId === id ? null : id;
        render();
      });
    });

    // Per-test run button
    container.querySelectorAll<HTMLButtonElement>('.e2e-run-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.testId;
        const test = data.tests.find(t => t.id === id);
        if (!test) return;
        btn.textContent = '...';
        btn.disabled = true;
        await dispatchCC(`Run ${test.id}`, `Run this specific e2e test and report the result:\nFile: ${test.file}\nTest: ${test.id} — ${test.name}\n\nRun the appropriate command:\n- T1: npx vitest run ${test.file}\n- T2/T3: npx playwright test ${test.file}\n\nReport pass/fail and update the matrix.`);
        btn.textContent = '\u2714';
        setTimeout(() => { btn.textContent = '\u25B6'; btn.disabled = false; }, 2000);
      });
    });

    // Investigate button
    container.querySelectorAll<HTMLButtonElement>('.e2e-investigate-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.testId;
        const test = data.tests.find(t => t.id === id);
        if (!test) return;
        btn.textContent = 'Dispatching...';
        btn.disabled = true;
        await dispatchCC(`Investigate ${test.id}`, `Investigate why e2e test ${test.id} (${test.name}) is ${test.status}.\nFile: ${test.file}\nNotes: ${test.notes ?? 'none'}\n\nRead the test and source code. Identify root cause. Fix if straightforward.`);
        btn.textContent = 'Dispatched';
        setTimeout(() => { btn.textContent = 'Investigate in CC'; btn.disabled = false; }, 2000);
      });
    });

    // Bulk run buttons
    document.getElementById('e2e-run-t1')?.addEventListener('click', async () => {
      await dispatchCC('Run T1 E2E', 'Run all T1 (headless) e2e tests:\nnpx vitest run --config vitest.e2e.config.ts\n\nReport results and update the e2e matrix.');
    });
    document.getElementById('e2e-run-t2')?.addEventListener('click', async () => {
      await dispatchCC('Run T2 E2E', 'Run all T2 (browser) e2e tests:\nnpx playwright test --project=emulator\n\nReport results and update the e2e matrix.');
    });
    document.getElementById('e2e-run-failing')?.addEventListener('click', async () => {
      const failing = data.tests.filter(t => t.status === 'failing');
      if (failing.length === 0) return;
      const files = [...new Set(failing.map(t => t.file))].join(' ');
      await dispatchCC('Run Failing E2E', `Re-run failing e2e tests:\n${files}\n\nReport results and update the matrix.`);
    });

    // Refresh
    document.getElementById('e2e-refresh')?.addEventListener('click', async () => {
      await fetchMatrix();
      render();
    });

    // Agent action buttons
    document.getElementById('e2e-write-next')?.addEventListener('click', async () => {
      await dispatchCC('Write Next E2E', buildWriteNextPrompt(data.tests));
    });
    document.getElementById('e2e-triage')?.addEventListener('click', async () => {
      await dispatchCC('Triage E2E Failures', buildTriagePrompt(data.tests));
    });
    document.getElementById('e2e-audit')?.addEventListener('click', async () => {
      await dispatchCC('E2E Audit', buildAuditPrompt());
    });
    document.getElementById('e2e-scan')?.addEventListener('click', async () => {
      try {
        const res = await fetch('/__admin_e2e_matrix/scan', { method: 'POST' });
        if (res.ok) {
          await fetchMatrix();
          render();
        }
      } catch (e) {
        console.warn('Matrix scan failed:', e);
      }
    });
  }

  await fetchMatrix();
  render();
}
