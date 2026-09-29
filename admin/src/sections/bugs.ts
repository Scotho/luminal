import { rtdb, functions } from '../firebase';
import { ref, get, remove, query, orderByChild, limitToLast } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { escapeHtml, ago, statCard } from '../ui/render';
import { icon } from '../ui/icons';
import { confirmAction } from '../ui/confirm';
import type { BugReport } from '../types';
import { bus } from '../ui/eventBus';
import { dispatchCC } from '../ui/ccPanel';

const PAGE_SIZE = 25;
const purgeDebugReportsFn = httpsCallable<void, { success: boolean }>(functions, 'purgeDebugReports');

// ── Pure functions (exported for tests) ──────────────────

export function computeErrorRate(reports: BugReport[]): { last1h: number; last24h: number; total: number; e2e: number } {
  const now = Date.now();
  const h1 = now - 3600_000;
  const h24 = now - 86400_000;
  let last1h = 0, last24h = 0, e2e = 0;
  for (const r of reports) {
    const ts = r.ts;
    if (ts > h1) last1h++;
    if (ts > h24) last24h++;
    if (isE2E(r)) e2e++;
  }
  return { last1h, last24h, total: reports.length, e2e };
}

// ── Burst Detection ─────────────────────────────────────
// Groups reports into 5-min time windows and identifies spikes.

export interface ErrorBurst {
  windowStart: number;
  count: number;
  reports: BugReport[];
  topErrors: { message: string; count: number }[];
}

const BURST_WINDOW_MS = 5 * 60 * 1000;  // 5 minutes
const BURST_THRESHOLD = 3;               // 3+ reports = burst

export function detectBursts(reports: BugReport[]): ErrorBurst[] {
  if (reports.length === 0) return [];

  // Only look at the last hour
  const now = Date.now();
  const recent = reports.filter(r => r.ts > now - 3600_000);
  if (recent.length === 0) return [];

  // Bucket by 5-min windows
  const buckets = new Map<number, BugReport[]>();
  for (const r of recent) {
    const windowStart = Math.floor(r.ts / BURST_WINDOW_MS) * BURST_WINDOW_MS;
    const bucket = buckets.get(windowStart);
    if (bucket) bucket.push(r);
    else buckets.set(windowStart, [r]);
  }

  // Find bursts and cluster errors within each
  const bursts: ErrorBurst[] = [];
  for (const [windowStart, bucket] of buckets) {
    if (bucket.length < BURST_THRESHOLD) continue;

    // Cluster by error message (normalize whitespace, truncate to first 80 chars)
    const clusters = new Map<string, number>();
    for (const r of bucket) {
      const key = r.error.replace(/\s+/g, ' ').slice(0, 80);
      clusters.set(key, (clusters.get(key) || 0) + 1);
    }
    const topErrors = Array.from(clusters.entries())
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    bursts.push({ windowStart, count: bucket.length, reports: bucket, topErrors });
  }

  return bursts.sort((a, b) => b.windowStart - a.windowStart);
}

function renderBurstPanel(bursts: ErrorBurst[]): string {
  if (bursts.length === 0) return '';

  const totalBurstReports = bursts.reduce((s, b) => s + b.count, 0);
  const rows = bursts.map(b => {
    const time = new Date(b.windowStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const timeEnd = new Date(b.windowStart + BURST_WINDOW_MS).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const errSummary = b.topErrors.map(e =>
      `<span style="color:var(--text-dim);">${escapeHtml(e.message.slice(0, 50))}${e.message.length > 50 ? '…' : ''}</span> <strong>&times;${e.count}</strong>`
    ).join('<br/>');
    const severity = b.count >= 10 ? 'critical' : b.count >= 5 ? 'warning' : 'elevated';
    const barWidth = Math.min(100, (b.count / 15) * 100);
    const barColor = severity === 'critical' ? 'var(--red)' : severity === 'warning' ? 'var(--orange, #f0a030)' : 'var(--accent, #1a7a8a)';

    return `
      <div style="padding:8px 12px; border-bottom:1px solid var(--border);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span style="font-weight:600; font-size:12px;">${time} – ${timeEnd}</span>
          <span style="font-size:11px; font-weight:700; color:${barColor};">${b.count} reports</span>
        </div>
        <div style="height:4px; background:var(--bg-dim, #1a1a2e); border-radius:2px; margin-bottom:6px; overflow:hidden;">
          <div style="height:100%; width:${barWidth}%; background:${barColor}; border-radius:2px;"></div>
        </div>
        <div style="font-size:11px; line-height:1.5;">${errSummary}</div>
      </div>
    `;
  }).join('');

  return `
    <div style="margin-bottom:16px; border:1px solid var(--red); border-radius:6px; overflow:hidden;">
      <div style="padding:8px 12px; background:rgba(176,45,28,0.12); display:flex; justify-content:space-between; align-items:center;">
        <span style="font-weight:700; font-size:13px; color:var(--red-bright,#d45234);">&#9888; Error Bursts Detected</span>
        <span style="font-size:11px; color:var(--text-dim);">${bursts.length} burst${bursts.length > 1 ? 's' : ''} &middot; ${totalBurstReports} total reports in the last hour</span>
      </div>
      ${rows}
    </div>
  `;
}

/** Check if a report originated from E2E tests. */
function isE2E(r: BugReport): boolean {
  return r.gameMode === 'e2e-test' || r.username === 'E2E-Bot' || r.url?.startsWith('e2e://');
}

type SourceFilter = 'all' | 'player' | 'e2e';

export function filterReports(reports: BugReport[], search: string, mode: string, source: SourceFilter = 'all'): BugReport[] {
  let filtered = reports;
  if (source === 'e2e') {
    filtered = filtered.filter(isE2E);
  } else if (source === 'player') {
    filtered = filtered.filter(r => !isE2E(r));
  }
  if (mode !== 'all') {
    filtered = filtered.filter(r => r.gameMode === mode);
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(r =>
      r.error.toLowerCase().includes(q) ||
      r.username.toLowerCase().includes(q) ||
      (r.stack && r.stack.toLowerCase().includes(q)),
    );
  }
  return filtered;
}

export function paginateReports(
  reports: BugReport[],
  page: number,
  pageSize: number,
): { items: BugReport[]; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(reports.length / pageSize));
  const start = (page - 1) * pageSize;
  const items = reports.slice(start, start + pageSize);
  return { items, totalPages };
}

/** Parse structured diagnostics from E2E bug stack traces. */
function parseDiagnostics(stack: string): { expected?: string; actual?: string; winnersAgree?: string; extra: string[] } | null {
  if (!stack || stack === '(manual report)') return null;
  const lines = stack.split('\n').map(l => l.trim()).filter(Boolean);
  const expected = lines.find(l => l.startsWith('Expected:'))?.replace('Expected: ', '');
  const actual = lines.find(l => l.startsWith('Actual:'))?.replace('Actual: ', '');
  const winnersAgree = lines.find(l => l.startsWith('Winners agree:'))?.replace('Winners agree: ', '');
  const extra = lines.filter(l =>
    !l.startsWith('Expected:') && !l.startsWith('Actual:') && !l.startsWith('Winners agree:')
  );
  if (!expected && !actual) return null;
  return { expected, actual, winnersAgree, extra };
}

export function renderBugRow(report: BugReport, selected: boolean): string {
  const checkedAttr = selected ? ' checked' : '';
  const e2eBadge = isE2E(report)
    ? '<span style="display:inline-block; background:var(--accent, #1a7a8a); color:#fff; font-size:9px; font-weight:700; padding:1px 5px; border-radius:3px; margin-right:4px; vertical-align:middle; letter-spacing:0.5px;">E2E</span>'
    : '';
  const sourceIcon = isE2E(report) ? '🤖' : '';
  const errorColor = isE2E(report) ? 'color:var(--accent, #1a7a8a);' : 'color:var(--red);';

  // Clean up E2E prefix from error for display
  const displayError = report.error.replace(/^\[E2E\]\s*/, '');

  return `
    <tr data-report-id="${escapeHtml(report.id)}" ${isE2E(report) ? 'class="bug-row--e2e"' : ''}>
      <td style="padding:8px 10px; width:30px;"><input type="checkbox" class="bug-check"${checkedAttr} /></td>
      <td style="padding:8px 10px;">${sourceIcon} ${escapeHtml(report.username)}</td>
      <td style="padding:8px 10px; ${errorColor} max-width:350px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${e2eBadge}${escapeHtml(displayError)}</td>
      <td style="padding:8px 10px; color:var(--text-dim);">${escapeHtml(report.gameMode)}</td>
      <td style="padding:8px 10px; color:var(--text-dim);">${ago(report.ts)}</td>
      <td style="padding:8px 10px; width:30px;"><span class="report-delete" data-report-id="${escapeHtml(report.id)}" style="cursor:pointer; color:var(--text-dim);">&times;</span></td>
    </tr>
  `;
}

export function renderBugDetail(report: BugReport): string {
  const time = new Date(report.ts).toLocaleString();
  const diag = isE2E(report) ? parseDiagnostics(report.stack) : null;

  // E2E test name from URL (e2e://test-name)
  const testName = report.url?.startsWith('e2e://') ? report.url.replace('e2e://', '') : null;

  let diagHtml = '';
  if (diag) {
    diagHtml = `
      <div class="bug-diag-section">
        <div class="bug-diag-title">TEST DIAGNOSTICS</div>
        ${testName ? `<div class="bug-diag-row"><span class="bug-diag-label">Test:</span> <span class="bug-diag-value">${escapeHtml(testName)}</span></div>` : ''}
        ${diag.expected ? `<div class="bug-diag-row"><span class="bug-diag-label">Expected:</span> <span class="bug-diag-value bug-diag-expected">${escapeHtml(diag.expected)}</span></div>` : ''}
        ${diag.actual ? `<div class="bug-diag-row"><span class="bug-diag-label">Actual:</span> <span class="bug-diag-value bug-diag-actual">${escapeHtml(diag.actual)}</span></div>` : ''}
        ${diag.winnersAgree ? `<div class="bug-diag-row"><span class="bug-diag-label">Winners Agree:</span> <span class="bug-diag-value" style="color:${diag.winnersAgree === 'true' ? 'var(--green, #4caf50)' : 'var(--red)'};">${escapeHtml(diag.winnersAgree)}</span></div>` : ''}
        ${diag.extra.length > 0 ? `<pre class="bug-diag-extra">${escapeHtml(diag.extra.join('\n'))}</pre>` : ''}
      </div>
    `;
  }

  const stackHtml = !diag && report.stack && report.stack !== '(manual report)'
    ? `<pre>${escapeHtml(report.stack)}</pre>`
    : '';

  return `
    <tr class="bug-detail-active">
      <td colspan="6">
        <div class="bug-detail-row ${isE2E(report) ? 'bug-detail-row--e2e' : ''}">
          <div><strong>Error:</strong> ${escapeHtml(report.error)}</div>
          <div style="margin-top:4px; color:var(--text-dim);">
            <strong>UID:</strong> ${escapeHtml(report.uid)} &middot;
            <strong>Time:</strong> ${time} &middot;
            <strong>URL:</strong> ${escapeHtml(report.url)}
          </div>
          <div style="margin-top:2px; color:var(--text-dim);"><strong>UA:</strong> ${escapeHtml(report.userAgent)}</div>
          ${diagHtml}
          ${stackHtml}
          <div style="margin-top:8px; display:flex; gap:6px;">
            <button class="refresh-btn bug-copy-btn" data-report-id="${escapeHtml(report.id)}" style="font-size:11px;">Copy to Clipboard</button>
            <button class="refresh-btn bug-investigate-btn" data-report-id="${escapeHtml(report.id)}" style="font-size:11px;">Investigate in CC</button>
          </div>
        </div>
      </td>
    </tr>
  `;
}

// ── Section entry point ──────────────────────────────────

export async function renderBugs(container: HTMLElement): Promise<void> {
  let allReports: BugReport[] = [];
  let search = '';
  let mode = 'all';
  let source: SourceFilter = 'all';
  let page = 1;
  let selectedIds = new Set<string>();
  let expandedId: string | null = null;
  const _knownBugIds = new Set<string>();

  async function fetchReports(): Promise<void> {
    const reportsQuery = query(ref(rtdb, 'debugReports'), orderByChild('ts'), limitToLast(200));
    const snap = await get(reportsQuery);
    const val: Record<string, Omit<BugReport, 'id'>> | null = snap.val();
    const fresh = val
      ? Object.entries(val).map(([id, r]) => ({ id, ...r })).sort((a, b) => b.ts - a.ts)
      : [];

    // Emit bus events for newly seen bug reports
    for (const r of fresh) {
      if (!_knownBugIds.has(r.id)) {
        if (_knownBugIds.size > 0) {
          bus.emit('bug:new', { id: r.id, error: r.error, username: r.username });
        }
        _knownBugIds.add(r.id);
      }
    }

    allReports = fresh;
    selectedIds.clear();
    expandedId = null;
    page = 1;
  }

  function getUniqueModes(): string[] {
    const modes = new Set(allReports.map(r => r.gameMode));
    return Array.from(modes).sort();
  }

  function render(): void {
    const filtered = filterReports(allReports, search, mode, source);
    const { items, totalPages } = paginateReports(filtered, page, PAGE_SIZE);
    const modes = getUniqueModes();

    const deleteCount = selectedIds.size;
    const deleteLabel = deleteCount > 0 ? `Delete Selected (${deleteCount})` : 'Delete Selected';

    const rate = computeErrorRate(allReports);
    const bursts = detectBursts(allReports);
    const burstPanel = renderBurstPanel(bursts);
    const alertBanner = rate.last1h > 5 && bursts.length === 0
      ? `<div style="padding:8px 12px; background:rgba(176,45,28,0.1); border:1px solid var(--red); border-radius:4px; margin-bottom:12px; font-size:12px; color:var(--red-bright,#d45234);">&#9888; High error rate: ${rate.last1h} errors in the last hour</div>`
      : '';

    container.innerHTML = `
      <h2>${icon('bug', 18)} Bug Reports</h2>
      <div class="stat-grid">
        ${statCard(rate.last1h, 'Last Hour')}
        ${statCard(rate.last24h, 'Last 24h')}
        ${statCard(rate.total, 'Total')}
        ${statCard(rate.e2e, 'E2E Failures')}
      </div>
      ${burstPanel}
      ${alertBanner}
      <div id="bugs-toolbar">
        <input id="bug-search" type="text" placeholder="Search errors, users, stacks..." value="${escapeHtml(search)}" style="width:220px;" />
        <select id="bug-source-filter">
          <option value="all"${source === 'all' ? ' selected' : ''}>All Sources</option>
          <option value="player"${source === 'player' ? ' selected' : ''}>Player Reports</option>
          <option value="e2e"${source === 'e2e' ? ' selected' : ''}>E2E Tests</option>
        </select>
        <select id="bug-mode-filter">
          <option value="all"${mode === 'all' ? ' selected' : ''}>All Modes</option>
          ${modes.map(m => `<option value="${escapeHtml(m)}"${mode === m ? ' selected' : ''}>${escapeHtml(m)}</option>`).join('')}
        </select>
        <button class="danger-btn" id="bug-delete-selected" ${deleteCount === 0 ? 'disabled style="opacity:0.4;"' : ''}>${deleteLabel}</button>
        <button class="danger-btn" id="bug-purge-all">Purge All</button>
        <span style="margin-left:auto; color:var(--text-dim);">${filtered.length} reports</span>
        <button class="refresh-btn" id="bug-refresh">Refresh</button>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:30px;"><input type="checkbox" id="bug-select-all" /></th>
            <th>User</th>
            <th>Error</th>
            <th>Mode</th>
            <th>Time</th>
            <th style="width:30px;"></th>
          </tr>
        </thead>
        <tbody id="bug-tbody">
          ${items.map(r => {
            let row = renderBugRow(r, selectedIds.has(r.id));
            if (expandedId === r.id) row += renderBugDetail(r);
            return row;
          }).join('')}
        </tbody>
      </table>
      ${filtered.length === 0 ? '<div style="color:var(--text-dim); padding:20px; text-align:center;">No bug reports</div>' : ''}
      <div class="bug-pagination">
        <span>Page ${page} of ${totalPages}</span>
        <div style="display:flex; gap:4px;">
          <button id="bug-prev" ${page <= 1 ? 'disabled' : ''}>&laquo; Prev</button>
          <button id="bug-next" ${page >= totalPages ? 'disabled' : ''}>Next &raquo;</button>
        </div>
      </div>
    `;

    wireEvents();
  }

  let _searchTimeout: ReturnType<typeof setTimeout> | null = null;

  function wireEvents(): void {
    document.getElementById('bug-search')?.addEventListener('input', (e) => {
      if (_searchTimeout) clearTimeout(_searchTimeout);
      _searchTimeout = setTimeout(() => {
        search = (e.target as HTMLInputElement).value;
        page = 1;
        render();
      }, 200);
    });

    document.getElementById('bug-source-filter')?.addEventListener('change', (e) => {
      source = (e.target as HTMLSelectElement).value as SourceFilter;
      page = 1;
      render();
    });

    document.getElementById('bug-mode-filter')?.addEventListener('change', (e) => {
      mode = (e.target as HTMLSelectElement).value;
      page = 1;
      render();
    });

    document.getElementById('bug-select-all')?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      const filtered = filterReports(allReports, search, mode, source);
      const { items } = paginateReports(filtered, page, PAGE_SIZE);
      if (checked) {
        for (const r of items) selectedIds.add(r.id);
      } else {
        for (const r of items) selectedIds.delete(r.id);
      }
      render();
    });

    container.querySelectorAll<HTMLInputElement>('.bug-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const row = cb.closest<HTMLElement>('tr');
        const id = row?.dataset.reportId;
        if (!id) return;
        if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
        const delBtn = document.getElementById('bug-delete-selected');
        if (delBtn) {
          const count = selectedIds.size;
          delBtn.textContent = count > 0 ? `Delete Selected (${count})` : 'Delete Selected';
          (delBtn as HTMLButtonElement).disabled = count === 0;
          delBtn.style.opacity = count === 0 ? '0.4' : '1';
        }
      });
    });

    container.querySelectorAll<HTMLElement>('#bug-tbody tr[data-report-id]').forEach(row => {
      row.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.classList.contains('report-delete')) return;
        const id = row.dataset.reportId;
        if (!id) return;
        expandedId = expandedId === id ? null : id;
        render();
      });
    });

    container.querySelectorAll<HTMLElement>('.report-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.reportId;
        if (!id) return;
        remove(ref(rtdb, `debugReports/${id}`));
        allReports = allReports.filter(r => r.id !== id);
        selectedIds.delete(id);
        if (expandedId === id) expandedId = null;
        render();
      });
    });

    document.getElementById('bug-delete-selected')?.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      const ids = Array.from(selectedIds);
      await Promise.all(ids.map(id => remove(ref(rtdb, `debugReports/${id}`))));
      allReports = allReports.filter(r => !selectedIds.has(r.id));
      selectedIds.clear();
      expandedId = null;
      render();
    });

    const purgeBtn = document.getElementById('bug-purge-all');
    if (purgeBtn) {
      confirmAction(purgeBtn, 'Purge All', async () => {
        await purgeDebugReportsFn();
        allReports = [];
        selectedIds.clear();
        expandedId = null;
        page = 1;
        render();
      });
    }

    container.querySelectorAll<HTMLElement>('.bug-copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.reportId;
        const r = allReports.find(r => r.id === id);
        if (!r) return;
        const text = [
          `**Bug Report**`,
          `User: ${r.username} (${r.uid})`,
          `Mode: ${r.gameMode}`,
          `Time: ${new Date(r.ts).toLocaleString()}`,
          `URL: ${r.url}`,
          `UA: ${r.userAgent}`,
          `Error: ${r.error}`,
          r.stack && r.stack !== '(manual report)' ? `Stack:\n\`\`\`\n${r.stack}\n\`\`\`` : '',
        ].filter(Boolean).join('\n');
        navigator.clipboard.writeText(text).catch(() => {});
        btn.textContent = '✓ Copied';
        setTimeout(() => { btn.textContent = 'Copy to Clipboard'; }, 1000);
      });
    });

    container.querySelectorAll<HTMLElement>('.bug-investigate-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLButtonElement).dataset.reportId;
        const r = allReports.find(r => r.id === id);
        if (!r) return;
        const prompt = `Investigate this bug report:\nUser: ${r.username}\nMode: ${r.gameMode}\nError: ${r.error}\nStack: ${r.stack ?? '(none)'}\nURL: ${r.url}\n\n1. Read the relevant source files\n2. Identify root cause\n3. Propose a fix`;
        btn.textContent = 'Dispatching...';
        (btn as HTMLButtonElement).disabled = true;
        await dispatchCC('Bug Investigation', prompt);
        btn.textContent = 'Dispatched';
        setTimeout(() => { btn.textContent = 'Investigate in CC'; (btn as HTMLButtonElement).disabled = false; }, 2000);
      });
    });

    document.getElementById('bug-refresh')?.addEventListener('click', async () => {
      await fetchReports();
      render();
    });

    document.getElementById('bug-prev')?.addEventListener('click', () => {
      if (page > 1) { page--; render(); }
    });
    document.getElementById('bug-next')?.addEventListener('click', () => {
      const filtered = filterReports(allReports, search, mode, source);
      const { totalPages } = paginateReports(filtered, page, PAGE_SIZE);
      if (page < totalPages) { page++; render(); }
    });
  }

  await fetchReports();
  render();
}
