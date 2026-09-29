// admin/src/sections/functionLogs.ts — Cloud Functions log viewer
import { rtdb } from '../firebase';
import { ref, query, orderByChild, limitToLast, onValue } from 'firebase/database';
import { escapeHtml, ago } from '../ui/render';
import { icon } from '../ui/icons';

interface FnLogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  fn: string;
  message: string;
}

let _unsub: (() => void) | null = null;
let _filter: string = 'all';

export function renderFunctionLogs(container: HTMLElement): () => void {
  _unsub?.();

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <h2 style="margin:0;">${icon('server', 18)} Logs</h2>
      <div style="display:flex;gap:6px;">
        <select id="fn-log-filter" style="background:var(--bg-panel);border:1px solid var(--border);color:var(--text);border-radius:2px;font-size:11px;padding:4px 8px;">
          <option value="all" ${_filter === 'all' ? 'selected' : ''}>All Levels</option>
          <option value="error" ${_filter === 'error' ? 'selected' : ''}>Errors Only</option>
          <option value="warn" ${_filter === 'warn' ? 'selected' : ''}>Warnings</option>
          <option value="info" ${_filter === 'info' ? 'selected' : ''}>Info</option>
        </select>
        <button id="fn-log-clear" class="admin-btn admin-btn--small admin-btn--danger">Clear</button>
      </div>
    </div>
    <div id="fn-log-list" style="font-family:var(--font-mono);font-size:11px;max-height:600px;overflow-y:auto;background:var(--bg-surface);border:1px solid var(--border);border-radius:4px;padding:8px;">
      <p style="color:var(--text-dim);">Listening for logs at <code>logs/functions</code>...</p>
    </div>
  `;

  let _latestEntries: FnLogEntry[] = [];

  const logsRef = query(ref(rtdb, 'logs/functions'), orderByChild('ts'), limitToLast(200));
  _unsub = onValue(logsRef, (snap) => {
    const val = snap.val() as Record<string, FnLogEntry> | null;
    _latestEntries = val ? Object.values(val).sort((a, b) => b.ts - a.ts) : [];
    renderLogEntries(_latestEntries);
  });

  container.querySelector('#fn-log-filter')?.addEventListener('change', (e) => {
    _filter = (e.target as HTMLSelectElement).value;
    renderLogEntries(_latestEntries);
  });

  container.querySelector('#fn-log-clear')?.addEventListener('click', () => {
    _latestEntries = [];
    renderLogEntries(_latestEntries);
  });

  return () => { _unsub?.(); _unsub = null; };
}

function renderLogEntries(entries: FnLogEntry[]): void {
  const el = document.getElementById('fn-log-list');
  if (!el) return;

  const filtered = _filter === 'all' ? entries : entries.filter(e => e.level === _filter);

  if (filtered.length === 0) {
    el.innerHTML = '<p style="color:var(--text-dim);">No log entries</p>';
    return;
  }

  const LEVEL_COLORS: Record<string, string> = {
    info: 'var(--accent)',
    warn: 'var(--yellow)',
    error: 'var(--red-bright)',
  };

  el.innerHTML = filtered.map(entry => {
    const color = LEVEL_COLORS[entry.level] ?? 'var(--text-dim)';
    return `<div style="padding:3px 0;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:flex-start;">
      <span style="color:var(--text-quiet);font-size:10px;white-space:nowrap;min-width:50px;">${ago(entry.ts)}</span>
      <span style="color:${color};font-weight:700;font-size:9px;letter-spacing:1px;text-transform:uppercase;min-width:40px;">${entry.level}</span>
      <span style="color:var(--text-dim);min-width:80px;">${escapeHtml(entry.fn)}</span>
      <span style="color:var(--text);flex:1;">${escapeHtml(entry.message)}</span>
    </div>`;
  }).join('');
}
