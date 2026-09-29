// admin/src/sections/memoryEconomy.ts — Memory Manager + Token Economy Dashboard
// TASK-47

import { icon } from '../ui/icons';
import { escapeHtml } from '../ui/render';
import {
  loadUsageRecords, aggregateUsage, estimateCost, formatDuration,
} from '../ui/ccUsage';
import type { CCUsageRecord } from '../types';

type Tab = 'memory' | 'economy';
let _activeTab: Tab = 'economy';
let _container: HTMLElement | null = null;

export function initMemoryEconomy(container?: HTMLElement): void {
  const mount = container ?? document.getElementById('section-memory-economy');
  if (!mount) return;
  _container = mount;
  render();
}

function render(): void {
  if (!_container) return;
  _container.innerHTML = `
    <div class="me-tabs">
      <button class="me-tab${_activeTab === 'economy' ? ' active' : ''}" data-tab="economy">${icon('bar-chart-3', 14)} Token Economy</button>
      <button class="me-tab${_activeTab === 'memory' ? ' active' : ''}" data-tab="memory">${icon('brain', 14)} Memory Files</button>
    </div>
    <div class="me-content"></div><style>${STYLES}</style>`;
  _container.querySelectorAll<HTMLButtonElement>('.me-tab').forEach(btn => {
    btn.addEventListener('click', () => { _activeTab = btn.dataset.tab as Tab; render(); });
  });
  const content = _container.querySelector<HTMLElement>('.me-content')!;
  if (_activeTab === 'economy') void renderEconomyTab(content);
  else void renderMemoryTab(content);
}

interface MemoryEntry { file: string; name: string; description: string; type: string; }

function parseMemoryIndex(md: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  const lines = md.split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)\s*[—–-]\s*(.+)/);
    if (m) {
      const file = m[2].trim();
      const description = m[3].trim();
      // Infer type from filename prefix
      let type = 'unknown';
      if (file.startsWith('feedback_')) type = 'feedback';
      else if (file.startsWith('project_')) type = 'project';
      else if (file.startsWith('reference_')) type = 'reference';
      entries.push({ file, name: m[1].trim(), description, type });
    }
  }
  return entries;
}

const TYPE_COLORS: Record<string, string> = { feedback: '#f59e0b', project: '#3b82f6', reference: '#10b981', unknown: '#6b7280' };

async function renderMemoryTab(el: HTMLElement): Promise<void> {
  el.innerHTML = '<p style="color:var(--text-dim)">Loading memory index...</p>';

  let indexContent = '';
  try {
    const res = await fetch('/__admin_exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'cat', args: [getMemoryPath('MEMORY.md')] }),
    });
    if (res.ok) {
      const data = await res.json() as { stdout?: string };
      indexContent = data.stdout ?? '';
    }
  } catch { /* fallback below */ }

  if (!indexContent) {
    el.innerHTML = `
      <div class="me-empty">
        <p>${icon('brain', 24)}</p>
        <p>Could not read memory index.</p>
        <p style="color:var(--text-dim); font-size:12px;">
          Ensure the admin server is running with exec support.<br>
          Memory path: <code>${escapeHtml(getMemoryPath('MEMORY.md'))}</code>
        </p>
      </div>`;
    return;
  }

  const entries = parseMemoryIndex(indexContent);
  if (entries.length === 0) {
    el.innerHTML = '<div class="me-empty"><p>No memory files found in index.</p></div>';
    return;
  }

  // Group by type
  const groups = new Map<string, MemoryEntry[]>();
  for (const e of entries) {
    const arr = groups.get(e.type) ?? [];
    arr.push(e);
    groups.set(e.type, arr);
  }

  const order = ['project', 'reference', 'feedback', 'unknown'];
  let html = '<div class="me-mem-grid">';
  for (const type of order) {
    const items = groups.get(type);
    if (!items) continue;
    const color = TYPE_COLORS[type] ?? '#6b7280';
    html += `<div class="me-mem-group">
      <h3 style="color:${color}; text-transform:capitalize;">${escapeHtml(type)} <span style="color:var(--text-dim); font-weight:400;">(${items.length})</span></h3>`;
    for (const item of items) {
      html += `
        <div class="me-mem-card" data-file="${escapeHtml(item.file)}">
          <div class="me-mem-header">
            <span class="me-type-badge" style="background:${color}20; color:${color}; border:1px solid ${color}40;">${escapeHtml(type)}</span>
            <span class="me-mem-name">${escapeHtml(item.name)}</span>
          </div>
          <p class="me-mem-desc">${escapeHtml(item.description)}</p>
          <button class="me-mem-expand" data-file="${escapeHtml(item.file)}">${icon('eye', 12)} View</button>
          <div class="me-mem-body" style="display:none;"></div>
        </div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  el.innerHTML = html;

  // Wire expand buttons
  el.querySelectorAll<HTMLButtonElement>('.me-mem-expand').forEach(btn => {
    btn.addEventListener('click', () => void expandMemoryCard(btn));
  });
}

async function expandMemoryCard(btn: HTMLButtonElement): Promise<void> {
  const card = btn.closest('.me-mem-card') as HTMLElement;
  const body = card.querySelector<HTMLElement>('.me-mem-body')!;
  if (body.style.display !== 'none') {
    body.style.display = 'none';
    btn.innerHTML = `${icon('eye', 12)} View`;
    return;
  }
  btn.innerHTML = `${icon('eye', 12)} Loading...`;
  const file = btn.dataset.file!;
  try {
    const res = await fetch('/__admin_exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'cat', args: [getMemoryPath(file)] }),
    });
    if (res.ok) {
      const data = await res.json() as { stdout?: string };
      body.innerHTML = `<pre class="me-mem-pre">${escapeHtml(data.stdout ?? '(empty)')}</pre>`;
    } else {
      body.innerHTML = '<p style="color:var(--red)">Failed to read file.</p>';
    }
  } catch {
    body.innerHTML = '<p style="color:var(--red)">Exec endpoint unavailable.</p>';
  }
  body.style.display = 'block';
  btn.innerHTML = `${icon('eye', 12)} Hide`;
}

function getMemoryPath(file: string): string {
  // Windows path for this project's memory directory
  const home = 'C:/Users/Utilisateur';
  return `${home}/.claude/projects/C--Projects-tron/memory/${file}`;
}

// ── Economy Tab ──────────────────────────────────────────

async function renderEconomyTab(el: HTMLElement): Promise<void> {
  el.innerHTML = '<p style="color:var(--text-dim)">Loading usage data...</p>';

  const records = await loadUsageRecords();
  if (records.length === 0) {
    el.innerHTML = `
      <div class="me-empty">
        <p>${icon('bar-chart-3', 24)}</p>
        <p>No token usage records yet.</p>
        <p style="color:var(--text-dim); font-size:12px;">Usage is recorded when Claude Code sessions complete.</p>
      </div>`;
    return;
  }

  const agg = aggregateUsage(records);
  const cost = estimateCost(records);
  const cacheHitRate = agg.totalInput + agg.totalCacheRead > 0
    ? (agg.totalCacheRead / (agg.totalInput + agg.totalCacheRead)) * 100
    : 0;

  let html = '';

  // Summary cards
  html += '<div class="me-summary">';
  html += summaryCard('Input Tokens', fmtTokens(agg.totalInput), 'var(--accent)');
  html += summaryCard('Output Tokens', fmtTokens(agg.totalOutput), 'var(--accent)');
  html += summaryCard('Cache Hit Rate', `${cacheHitRate.toFixed(1)}%`, '#3b82f6');
  html += summaryCard('Estimated Cost', `$${cost.toFixed(2)}`, '#10b981');
  html += summaryCard('Sessions', String(agg.totalSessions), 'var(--text-dim)');
  html += summaryCard('Total Duration', formatDuration(agg.totalDurationMs), 'var(--text-dim)');
  html += '</div>';

  // Daily chart (last 30 days)
  html += '<h3 class="me-h3">Daily Usage (Last 30 Days)</h3>';
  html += renderDailyChart(records);

  // Cost per ref
  html += '<h3 class="me-h3">Cost Per Reference</h3>';
  html += renderCostPerRef(records);

  // Session table
  html += '<h3 class="me-h3">Session Breakdown</h3>';
  html += renderSessionTable(records);

  el.innerHTML = html;
}

function summaryCard(label: string, value: string, color: string): string {
  return `<div class="me-card"><div class="me-card-value" style="color:${color}">${value}</div><div class="me-card-label">${label}</div></div>`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function renderDailyChart(records: CCUsageRecord[]): string {
  const now = new Date();
  const days = 30;
  const buckets = new Map<string, { input: number; output: number }>();

  // Initialize buckets
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { input: 0, output: 0 });
  }

  for (const r of records) {
    const key = r.ts.slice(0, 10);
    const b = buckets.get(key);
    if (b) {
      b.input += r.usage.inputTokens;
      b.output += r.usage.outputTokens;
    }
  }

  const entries = [...buckets.entries()];
  const maxVal = Math.max(1, ...entries.map(([, v]) => v.input + v.output));
  let html = '<div class="me-chart">';
  for (const [date, val] of entries) {
    const total = val.input + val.output;
    const pct = (total / maxVal) * 100;
    const inPct = total > 0 ? (val.input / total) * pct : 0;
    const outPct = pct - inPct;
    html += `<div class="me-chart-col" title="${date}: ${fmtTokens(total)} tokens"><div class="me-chart-bar" style="height:${pct}%"><div class="me-chart-seg me-chart-input" style="height:${total > 0 ? (inPct / pct) * 100 : 0}%"></div><div class="me-chart-seg me-chart-output" style="height:${total > 0 ? (outPct / pct) * 100 : 0}%"></div></div><div class="me-chart-label">${date.slice(5)}</div></div>`;
  }
  html += '</div><div class="me-chart-legend"><span><span class="me-dot" style="background:var(--accent)"></span> Input</span><span><span class="me-dot" style="background:#f59e0b"></span> Output</span></div>';
  return html;
}

function renderCostPerRef(records: CCUsageRecord[]): string {
  const refPattern = /\b(TASK|BUG|QA|SPEC)-(\d+)\b/g;
  const refCosts = new Map<string, { records: CCUsageRecord[]; cost: number }>();

  for (const r of records) {
    const matches = r.label.matchAll(refPattern);
    for (const m of matches) {
      const ref = m[0];
      const entry = refCosts.get(ref) ?? { records: [], cost: 0 };
      entry.records.push(r);
      refCosts.set(ref, entry);
    }
  }

  // Calculate costs
  for (const [, entry] of refCosts) {
    entry.cost = estimateCost(entry.records);
  }

  if (refCosts.size === 0) {
    return '<p style="color:var(--text-dim); font-size:13px;">No refs found in session labels. Include TASK-N, BUG-N etc. in prompts for tracking.</p>';
  }

  const sorted = [...refCosts.entries()].sort((a, b) => b[1].cost - a[1].cost);

  let html = '<div class="me-ref-grid">';
  for (const [ref, data] of sorted.slice(0, 20)) {
    const a = aggregateUsage(data.records);
    html += `<div class="me-ref-row"><span class="me-ref-name">${escapeHtml(ref)}</span><span class="me-ref-sessions">${data.records.length} session${data.records.length !== 1 ? 's' : ''}</span><span class="me-ref-tokens">${fmtTokens(a.totalInput + a.totalOutput)}</span><span class="me-ref-cost">$${data.cost.toFixed(2)}</span></div>`;
  }
  html += '</div>';
  return html;
}

function renderSessionTable(records: CCUsageRecord[]): string {
  const sorted = [...records].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  const display = sorted.slice(0, 50);
  let html = '<div class="me-table-wrap"><table class="me-table"><thead><tr><th>Date</th><th>Label</th><th>Input</th><th>Output</th><th>Cache</th><th>Cost</th><th>Duration</th><th>Exit</th></tr></thead><tbody>';
  for (const r of display) {
    const d = new Date(r.ts);
    const ds = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const c = estimateCost([r]);
    const cr = r.usage.cacheRead ?? 0;
    const ec = r.exitCode === 0 ? 'me-exit-ok' : r.exitCode !== null ? 'me-exit-err' : '';
    html += `<tr><td class="me-td-date">${escapeHtml(ds)}</td><td class="me-td-label" title="${escapeHtml(r.label)}">${escapeHtml(trunc(r.label, 40))}</td><td>${fmtTokens(r.usage.inputTokens)}</td><td>${fmtTokens(r.usage.outputTokens)}</td><td style="color:#3b82f6">${fmtTokens(cr)}</td><td style="color:#10b981">$${c.toFixed(2)}</td><td>${r.duration ? formatDuration(r.duration) : '-'}</td><td class="${ec}">${r.exitCode ?? '-'}</td></tr>`;
  }
  html += '</tbody></table></div>';
  if (sorted.length > 50) html += `<p style="color:var(--text-dim);font-size:12px;margin-top:8px;">Showing 50 of ${sorted.length} sessions.</p>`;
  return html;
}

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}

// ── Styles ───────────────────────────────────────────────

const STYLES = /* css */`
.me-tabs { display:flex; gap:4px; margin-bottom:16px; border-bottom:1px solid var(--border); }
.me-tab { display:flex; align-items:center; gap:6px; padding:8px 16px; border:none; background:none; color:var(--text-dim); cursor:pointer; font-family:var(--font-mono); font-size:13px; border-bottom:2px solid transparent; transition:color .15s,border-color .15s; }
.me-tab:hover { color:var(--text); }
.me-tab.active { color:var(--accent); border-bottom-color:var(--accent); }
.me-content { min-height:200px; }
.me-empty { text-align:center; padding:48px 16px; color:var(--text-dim); }
.me-empty p { margin:8px 0; }
.me-summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-bottom:24px; }
.me-card { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:16px; text-align:center; }
.me-card-value { font-family:var(--font-mono); font-size:22px; font-weight:700; }
.me-card-label { font-size:11px; color:var(--text-dim); margin-top:4px; text-transform:uppercase; letter-spacing:1px; }
.me-h3 { font-family:var(--font-display,var(--font-mono)); font-size:14px; color:var(--text); margin:24px 0 12px; text-transform:uppercase; letter-spacing:1px; }
.me-chart { display:flex; align-items:flex-end; gap:2px; height:120px; padding:0 4px; background:var(--surface); border:1px solid var(--border); border-radius:8px; overflow:hidden; }
.me-chart-col { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; min-width:0; }
.me-chart-bar { width:100%; display:flex; flex-direction:column; justify-content:flex-end; min-height:1px; }
.me-chart-seg { width:100%; min-height:0; }
.me-chart-input { background:var(--accent); }
.me-chart-output { background:#f59e0b; }
.me-chart-label { font-size:8px; color:var(--text-dim); margin-top:2px; writing-mode:vertical-rl; text-orientation:mixed; max-height:28px; overflow:hidden; }
.me-chart-legend { display:flex; gap:16px; margin-top:8px; font-size:11px; color:var(--text-dim); }
.me-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px; vertical-align:middle; }
.me-ref-grid { display:flex; flex-direction:column; gap:4px; }
.me-ref-row { display:grid; grid-template-columns:100px 100px 1fr 80px; gap:8px; padding:6px 12px; font-size:13px; background:var(--surface); border:1px solid var(--border); border-radius:6px; align-items:center; }
.me-ref-name { font-family:var(--font-mono); font-weight:600; color:var(--accent); }
.me-ref-sessions { color:var(--text-dim); font-size:11px; }
.me-ref-tokens { color:var(--text-dim); text-align:right; }
.me-ref-cost { color:#10b981; font-family:var(--font-mono); font-weight:600; text-align:right; }
.me-table-wrap { overflow-x:auto; }
.me-table { width:100%; border-collapse:collapse; font-size:12px; font-family:var(--font-mono); }
.me-table th { text-align:left; padding:8px 10px; font-size:10px; text-transform:uppercase; letter-spacing:1px; color:var(--text-dim); border-bottom:1px solid var(--border); }
.me-table td { padding:6px 10px; border-bottom:1px solid var(--border); color:var(--text); }
.me-table tr:hover td { background:var(--surface); }
.me-td-date { white-space:nowrap; color:var(--text-dim); }
.me-td-label { max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.me-exit-ok { color:#10b981; }
.me-exit-err { color:var(--red,#d45234); }
.me-mem-grid { display:flex; flex-direction:column; gap:24px; }
.me-mem-group h3 { font-size:14px; margin:0 0 8px; font-family:var(--font-display,var(--font-mono)); }
.me-mem-card { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:12px 16px; margin-bottom:8px; }
.me-mem-header { display:flex; align-items:center; gap:8px; margin-bottom:4px; }
.me-type-badge { font-size:10px; padding:1px 8px; border-radius:10px; font-family:var(--font-mono); text-transform:uppercase; letter-spacing:.5px; }
.me-mem-name { font-weight:600; font-size:13px; }
.me-mem-desc { font-size:12px; color:var(--text-dim); margin:4px 0 8px; }
.me-mem-expand { display:inline-flex; align-items:center; gap:4px; background:none; border:1px solid var(--border); color:var(--text-dim); padding:3px 10px; border-radius:4px; cursor:pointer; font-size:11px; font-family:var(--font-mono); transition:color .15s,border-color .15s; }
.me-mem-expand:hover { color:var(--accent); border-color:var(--accent); }
.me-mem-pre { font-size:11px; line-height:1.5; margin-top:8px; padding:12px; background:var(--bg,#111); border-radius:6px; overflow-x:auto; white-space:pre-wrap; word-break:break-word; color:var(--text-dim); max-height:300px; overflow-y:auto; }
`;
