import { db } from '../firebase';
import { collection, getDocs, doc, deleteDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { icon } from '../ui/icons';
import { escapeHtml } from '../ui/render';
import { confirmAction } from '../ui/confirm';
import type { LeaderboardDoc } from '../types';

interface LeaderboardEntry extends LeaderboardDoc {
  docId: string;
  fraudFlags: string[];
}

type SortKey = 'rank' | 'username' | 'wins' | 'losses' | 'wlRatio' | 'bestStreak' | 'matchCount';

let _container: HTMLElement | null = null;
let _entries: LeaderboardEntry[] = [];
let _filtered: LeaderboardEntry[] = [];
let _sortKey: SortKey = 'wins';
let _sortAsc = false;
let _searchQuery = '';
let _seriesFilter = 'all';
let _typeFilter = 'all';
let _editingDocId: string | null = null;

const S_INPUT = 'background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:var(--r-sm);padding:4px 6px;font-family:var(--font-mono);font-size:12px;';
const S_MONO_R = 'font-family:var(--font-mono);text-align:right;';
const S_TH = 'cursor:pointer;padding:6px 8px;color:var(--text-dim);';
const RED = 'var(--red,#ff4444)';

const COLORS = ['#ff4444','#44aaff','#44ff44','#ffaa00','#ff44ff','#00ffff','#ff8844','#aa44ff','#44ffaa','#ffff44'];
function pColor(i?: number): string { return i !== undefined && i >= 0 ? COLORS[i % COLORS.length] : 'var(--text)'; }

function detectFraud(e: LeaderboardDoc): string[] {
  const flags: string[] = [];
  const wr = e.matchCount > 0 ? e.wins / e.matchCount : 0;
  if (wr > 0.95 && e.matchCount >= 50) flags.push('Suspicious win rate (>95% with 50+ matches)');
  if (e.fastestWin !== undefined && e.fastestWin > 0 && e.fastestWin < 3) flags.push(`Impossibly fast win (${e.fastestWin.toFixed(1)}s)`);
  if (e.bestStreak !== undefined && e.bestStreak > 50 && e.matchCount < 200) flags.push(`Unusual streak (${e.bestStreak}) relative to match count`);
  return flags;
}

async function loadEntries(): Promise<LeaderboardEntry[]> {
  const snap = await getDocs(collection(db, 'leaderboard'));
  const entries: LeaderboardEntry[] = [];
  snap.forEach(d => {
    const data = d.data() as LeaderboardDoc;
    const parts = d.id.split('_');
    if (!data.series && parts.length >= 2) data.series = parseInt(parts[parts.length - 2], 10) || 0;
    if (!data.matchType && parts.length >= 3) data.matchType = parts[parts.length - 1];
    entries.push({ ...data, docId: d.id, fraudFlags: detectFraud(data) });
  });
  return entries;
}

function applyFilters(): void {
  let result = [..._entries];
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    result = result.filter(e => e.username?.toLowerCase().includes(q) || e.uid?.toLowerCase().includes(q));
  }
  if (_seriesFilter !== 'all') { const s = parseInt(_seriesFilter, 10); result = result.filter(e => e.series === s); }
  if (_typeFilter !== 'all') result = result.filter(e => e.matchType === _typeFilter);

  result.sort((a, b) => {
    let cmp = 0;
    switch (_sortKey) {
      case 'rank': case 'wins': cmp = a.wins - b.wins; break;
      case 'losses': cmp = a.losses - b.losses; break;
      case 'username': cmp = (a.username || '').localeCompare(b.username || ''); break;
      case 'wlRatio': cmp = (a.matchCount > 0 ? a.wins / a.matchCount : 0) - (b.matchCount > 0 ? b.wins / b.matchCount : 0); break;
      case 'bestStreak': cmp = (a.bestStreak ?? 0) - (b.bestStreak ?? 0); break;
      case 'matchCount': cmp = a.matchCount - b.matchCount; break;
    }
    return _sortAsc ? cmp : -cmp;
  });
  _filtered = result;
}

function setSort(key: SortKey): void {
  if (_sortKey === key) _sortAsc = !_sortAsc; else { _sortKey = key; _sortAsc = false; }
  applyFilters();
  renderFull();
}

function sa(key: SortKey): string { return _sortKey !== key ? '' : _sortAsc ? ' \u25B2' : ' \u25BC'; }

function opt(val: string, label: string, cur: string): string {
  return `<option value="${val}"${cur === val ? ' selected' : ''}>${label}</option>`;
}

function renderHeader(): string {
  const flagged = _filtered.filter(e => e.fraudFlags.length > 0).length;
  return `
    <div class="section-header" style="flex-wrap:wrap;gap:10px;">
      <h2>${icon('trophy', 18)} Leaderboard Admin</h2>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input id="lb-search" type="text" placeholder="Search username or UID..." style="${S_INPUT}width:200px;padding:4px 10px;" value="${escapeHtml(_searchQuery)}">
        <button id="lb-reset-all" class="purge-btn" style="background:${RED};color:#fff;border:none;border-radius:var(--r-sm);padding:4px 12px;cursor:pointer;font-size:11px;font-weight:600;">Reset All</button>
        <button id="lb-refresh" class="refresh-btn">Refresh</button>
      </div>
    </div>
    <div style="display:flex;gap:12px;margin-bottom:12px;align-items:center;flex-wrap:wrap;">
      <label style="color:var(--text-dim);font-size:12px;">Series:
        <select id="lb-series" style="${S_INPUT}margin-left:4px;">${opt('all', 'All', _seriesFilter)}${opt('3', 'BO3', _seriesFilter)}${opt('5', 'BO5', _seriesFilter)}</select></label>
      <label style="color:var(--text-dim);font-size:12px;">Type:
        <select id="lb-type" style="${S_INPUT}margin-left:4px;">${opt('all', 'All', _typeFilter)}${opt('ai', 'AI', _typeFilter)}${opt('online', 'Online', _typeFilter)}</select></label>
      <span style="color:var(--text-quiet);font-size:11px;font-family:var(--font-mono);">${_filtered.length} entries${_entries.length !== _filtered.length ? ` / ${_entries.length} total` : ''}</span>
      ${flagged > 0 ? `<span style="color:${RED};font-size:11px;font-weight:600;">${icon('alert-triangle', 12)} ${flagged} flagged</span>` : ''}
    </div>
    <p style="color:var(--text-quiet);font-size:10px;margin:-6px 0 10px;">Note: Direct edits require admin Firestore rules or Cloud Function callable. Write operations may fail on production.</p>`;
}

function renderTable(): void {
  const tbody = _container?.querySelector('#lb-tbody');
  if (!tbody) return;
  const btnStyle = (color: string) => `background:none;border:1px solid var(--border);border-radius:var(--r-sm);color:${color};cursor:pointer;padding:2px 8px;font-size:11px;`;
  tbody.innerHTML = _filtered.map((e, i) => {
    const wr = e.matchCount > 0 ? (e.wins / e.matchCount * 100).toFixed(1) : '0.0';
    const fraud = e.fraudFlags.length > 0;
    const fs = fraud ? `background:rgba(255,68,68,0.08);border-left:3px solid ${RED};` : '';
    const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${pColor(e.color)};margin-right:6px;vertical-align:middle;"></span>`;
    const flag = fraud ? `<span style="color:${RED};margin-left:4px;" title="${escapeHtml(e.fraudFlags.join('; '))}">${icon('alert-triangle', 12)}</span>` : '';
    return `<tr style="${fs}" title="${fraud ? escapeHtml(e.fraudFlags.join('; ')) : ''}">
      <td style="${S_MONO_R}text-align:center;color:var(--text-dim);">${i + 1}</td>
      <td>${dot}<span style="color:${pColor(e.color)}">${escapeHtml(e.username || e.uid)}</span>${flag}</td>
      <td style="${S_MONO_R}">${e.wins}</td><td style="${S_MONO_R}">${e.losses}</td>
      <td style="${S_MONO_R}">${wr}%</td><td style="${S_MONO_R}">${e.bestStreak ?? '-'}</td>
      <td style="${S_MONO_R}">${e.matchCount}</td>
      <td style="white-space:nowrap;"><button class="lb-edit" data-id="${e.docId}" style="${btnStyle('var(--accent)')}margin-right:4px;">Edit</button><button class="lb-delete" data-id="${e.docId}" style="${btnStyle(RED)}">Del</button></td>
    </tr>`;
  }).join('');
  wireTableActions();
}

function renderFull(): void {
  if (!_container) return;
  applyFilters();
  const th = (key: SortKey, label: string, extra = '') => `<th class="lb-sort" data-key="${key}" style="${S_TH}${extra}">${label}${sa(key)}</th>`;
  _container.innerHTML = `${renderHeader()}
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="border-bottom:2px solid var(--border);text-align:left;">
          ${th('rank', '#', 'width:40px;')}${th('username', 'Player')}${th('wins', 'W', 'text-align:right;')}
          ${th('losses', 'L', 'text-align:right;')}${th('wlRatio', 'W/L', 'text-align:right;')}
          ${th('bestStreak', 'Streak', 'text-align:right;')}${th('matchCount', 'Games', 'text-align:right;')}
          <th style="padding:6px 8px;color:var(--text-dim);">Actions</th>
        </tr></thead>
        <tbody id="lb-tbody"></tbody>
      </table>
    </div>
    <div id="lb-edit-modal" style="display:none;"></div>`;
  renderTable();
  wireControls();
}

function wireControls(): void {
  if (!_container) return;
  const search = _container.querySelector<HTMLInputElement>('#lb-search');
  search?.addEventListener('input', () => { _searchQuery = search.value; applyFilters(); renderTable(); });
  const series = _container.querySelector<HTMLSelectElement>('#lb-series');
  series?.addEventListener('change', () => { _seriesFilter = series.value; applyFilters(); renderTable(); });
  const type = _container.querySelector<HTMLSelectElement>('#lb-type');
  type?.addEventListener('change', () => { _typeFilter = type.value; applyFilters(); renderTable(); });
  _container.querySelectorAll<HTMLElement>('.lb-sort').forEach(h => {
    h.addEventListener('click', () => { const k = h.dataset.key as SortKey | undefined; if (k) setSort(k); });
  });
  _container.querySelector('#lb-refresh')?.addEventListener('click', () => void refresh());
  const resetBtn = _container.querySelector<HTMLElement>('#lb-reset-all');
  if (resetBtn) confirmAction(resetBtn, 'Reset All', () => resetAll());
}

function wireTableActions(): void {
  if (!_container) return;
  _container.querySelectorAll<HTMLElement>('.lb-edit').forEach(b => {
    b.addEventListener('click', () => { if (b.dataset.id) showEditModal(b.dataset.id); });
  });
  _container.querySelectorAll<HTMLElement>('.lb-delete').forEach(b => {
    if (b.dataset.id) { const id = b.dataset.id; confirmAction(b, 'Del', () => deleteEntry(id)); }
  });
}

function showEditModal(docId: string): void {
  _editingDocId = docId;
  const entry = _entries.find(e => e.docId === docId);
  if (!entry || !_container) return;
  const modal = _container.querySelector<HTMLElement>('#lb-edit-modal');
  if (!modal) return;
  const inp = (id: string, label: string, val: number) =>
    `<label style="font-size:11px;color:var(--text-dim);">${label}<input id="${id}" type="number" value="${val}" min="0" style="width:100%;${S_INPUT}"></label>`;
  modal.style.display = 'block';
  modal.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;display:flex;align-items:center;justify-content:center;" id="lb-modal-backdrop">
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md,8px);padding:20px;min-width:320px;max-width:400px;">
        <h3 style="margin:0 0 12px;color:var(--text);">${icon('trophy', 14)} Edit: ${escapeHtml(entry.username || entry.uid)}</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          ${inp('lb-edit-wins', 'Wins', entry.wins)}${inp('lb-edit-losses', 'Losses', entry.losses)}
          ${inp('lb-edit-draws', 'Draws', entry.draws)}${inp('lb-edit-streak', 'Best Streak', entry.bestStreak ?? 0)}
        </div>
        <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;">
          <button id="lb-edit-cancel" style="background:none;border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-dim);cursor:pointer;padding:4px 14px;font-size:12px;">Cancel</button>
          <button id="lb-edit-save" style="background:var(--accent);border:none;border-radius:var(--r-sm);color:#000;cursor:pointer;padding:4px 14px;font-size:12px;font-weight:600;">Save</button>
        </div>
        <p id="lb-edit-error" style="color:${RED};font-size:11px;margin:8px 0 0;display:none;"></p>
      </div>
    </div>`;
  const backdrop = modal.querySelector('#lb-modal-backdrop');
  backdrop?.addEventListener('click', (e) => { if (e.target === backdrop) closeEditModal(); });
  modal.querySelector('#lb-edit-cancel')?.addEventListener('click', closeEditModal);
  modal.querySelector('#lb-edit-save')?.addEventListener('click', () => void saveEdit());
}

function closeEditModal(): void {
  _editingDocId = null;
  const modal = _container?.querySelector<HTMLElement>('#lb-edit-modal');
  if (modal) { modal.style.display = 'none'; modal.innerHTML = ''; }
}

async function saveEdit(): Promise<void> {
  if (!_editingDocId) return;
  const v = (id: string) => parseInt(_container?.querySelector<HTMLInputElement>(id)?.value ?? '0', 10);
  const wins = v('#lb-edit-wins'), losses = v('#lb-edit-losses'), draws = v('#lb-edit-draws'), bestStreak = v('#lb-edit-streak');
  const matchCount = wins + losses + draws;
  try {
    await updateDoc(doc(db, 'leaderboard', _editingDocId), { wins, losses, draws, bestStreak, matchCount, winRate: matchCount > 0 ? wins / matchCount : 0 });
    const entry = _entries.find(e => e.docId === _editingDocId);
    if (entry) { Object.assign(entry, { wins, losses, draws, bestStreak, matchCount }); entry.fraudFlags = detectFraud(entry); }
    closeEditModal();
    applyFilters();
    renderTable();
  } catch (err) {
    const el = _container?.querySelector<HTMLElement>('#lb-edit-error');
    if (el) { el.style.display = 'block'; el.textContent = `Write failed: ${String(err)}. Admin Firestore rules or Cloud Function may be needed.`; }
  }
}

async function deleteEntry(docId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'leaderboard', docId));
    _entries = _entries.filter(e => e.docId !== docId);
    applyFilters();
    renderTable();
  } catch (err) { alert(`Delete failed: ${String(err)}. Admin Firestore rules or Cloud Function may be needed.`); }
}

async function resetAll(): Promise<void> {
  const typed = prompt('Type RESET to confirm deleting all leaderboard data:');
  if (typed !== 'RESET') return;
  try {
    const batch = writeBatch(db);
    for (const e of _entries) batch.delete(doc(db, 'leaderboard', e.docId));
    await batch.commit();
    _entries = [];
    applyFilters();
    renderFull();
  } catch (err) { alert(`Reset failed: ${String(err)}. Admin Firestore rules or Cloud Function may be needed.`); }
}

async function refresh(): Promise<void> {
  if (!_container) return;
  _container.innerHTML = '<div style="padding:20px;color:var(--text-dim);">Loading leaderboard data...</div>';
  try {
    _entries = await loadEntries();
    renderFull();
  } catch (err) {
    _container.innerHTML = `<div style="color:${RED};padding:20px;"><h3>Failed to load leaderboard</h3><pre style="font-size:12px;white-space:pre-wrap;">${escapeHtml(String(err))}</pre><button id="lb-retry" class="refresh-btn" style="margin-top:10px;">Retry</button></div>`;
    _container.querySelector('#lb-retry')?.addEventListener('click', () => void refresh());
  }
}

export async function renderLeaderboard(container: HTMLElement): Promise<void> {
  _container = container;
  await refresh();
}
