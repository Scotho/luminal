import { escapeHtml } from '../../ui/render';
import type { TaskEntry, TaskGroupSuggestion } from '../../types';

// ── Tag colors ────────────────────────────────────────────────────────────────

export const TAG_COLORS: Record<string, string> = {
  'code-hygiene': 'var(--accent)',
  'mobile-ui': 'var(--purple, #aa64ff)',
  'gamepad': 'var(--purple, #aa64ff)',
  'as-any': 'var(--yellow)',
  'test-coverage': 'var(--green)',
  'test-fix': 'var(--red)',
  'docs': 'var(--text-dim)',
};

function tagColor(tag: string): string {
  return TAG_COLORS[tag] ?? 'var(--accent)';
}

// ── Date formatting ─────────────────────────────────────────────────────────

/** Format ISO string as relative time, e.g. "5m ago", "3h ago", "2d ago". */
export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Format ISO string as short date+time, e.g. "Apr 3 14:32" or "Apr 3, 2025 14:32". */
export function shortDateLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const time = `${hh}:${mm}`;
  if (d.getFullYear() !== now.getFullYear()) return `${month} ${day}, ${d.getFullYear()} ${time}`;
  return `${month} ${day} ${time}`;
}

// ── Priority helpers ─────────────────────────────────────────────────────────

const PRIORITY_LABELS: Record<number, string> = {
  1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4', 5: 'P5',
};

const PRIORITY_COLORS: Record<number, string> = {
  1: 'var(--red, #ff4444)',
  2: 'var(--orange, #ff8c00)',
  3: 'var(--text-dim)',
  4: 'var(--text-dim)',
  5: 'var(--text-dim)',
};

function priorityBadge(priority: number): string {
  const p = priority >= 1 && priority <= 5 ? priority : 3;
  const color = PRIORITY_COLORS[p];
  const label = PRIORITY_LABELS[p];
  const weight = p <= 2 ? '700' : '600';
  const opacity = p >= 4 ? '0.5' : '1';
  return `<span class="task-priority-badge" style="color:${color}; font-size:11px; font-weight:${weight}; opacity:${opacity}; min-width:24px; text-align:center;">${label}</span>`;
}

export function priorityDropdown(taskId: string, current: number): string {
  const options = [1, 2, 3, 4, 5].map(p => {
    const sel = p === current ? ' selected' : '';
    return `<option value="${p}"${sel}>${PRIORITY_LABELS[p]}</option>`;
  }).join('');
  return `<select class="task-priority-select" data-task-id="${escapeHtml(taskId)}" style="background:var(--bg); border:1px solid var(--border); border-radius:3px; color:inherit; font-size:11px; padding:1px 4px; cursor:pointer;">${options}</select>`;
}

// ── Pure render helpers ───────────────────────────────────────────────────────

/** Render a single task card as an HTML string. */
export function renderTaskCard(task: TaskEntry, tasks?: TaskEntry[]): string {
  const color = tagColor(task.tag);
  const priority = task.priority ?? 3;
  const opacity = task.status === 'done' ? '0.4' : '1';
  const isChild = !!task.parentId;
  const isMaster = task.children && task.children.length > 0;
  const doneBtn = task.status === 'pending'
    ? `<button class="task-btn task-btn--done task-done-btn" data-task-id="${escapeHtml(task.id)}" title="Mark done">Done</button>`
    : '';

  const parentLabel = isChild && tasks ? tasks.find(t => t.id === task.parentId)?.tag ?? '' : '';
  const childBadge = isChild
    ? `<span style="color:var(--text-dim); font-size:11px;">&#8627; sub-task${parentLabel ? ` of <span style="color:${tagColor(parentLabel)}; font-weight:600; text-transform:uppercase;">${escapeHtml(parentLabel)}</span>` : ''}</span>`
    : '';
  const childCount = task.children?.length ?? 0;
  const masterBadge = isMaster
    ? `<span style="color:var(--accent); font-size:11px; font-weight:600;">MASTER</span>`
    : '';
  const childCountBadge = childCount > 0
    ? `<span style="font-size:10px; color:var(--text-dim); margin-left:6px;">(${childCount} sub-tasks)</span>`
    : '';

  return `
    <div class="task-card" data-task-id="${escapeHtml(task.id)}" style="opacity:${opacity}; border:1px solid var(--border); border-radius:6px; padding:12px 14px; margin-bottom:10px;${isChild ? ' margin-left:20px; border-left:3px solid var(--accent);' : ''}">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; flex-wrap:wrap;">
        <input type="checkbox" class="task-select" data-task-id="${escapeHtml(task.id)}" style="margin-right:8px; flex-shrink:0; accent-color:var(--accent);" />
        ${priorityBadge(priority)}
        ${task.status === 'pending' ? priorityDropdown(task.id, priority) : ''}
        <span class="task-tag" style="color:${color}; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em;">${escapeHtml(task.tag)}</span>${childCountBadge}
        ${task.source ? `<span style="color:var(--text-dim); font-size:12px;">${escapeHtml(task.source)}</span>` : ''}
        ${masterBadge}${childBadge}
        ${task.status === 'done' ? `<span style="color:var(--green); font-size:11px; margin-left:auto;">DONE</span>` : ''}
      </div>
      <div class="task-prompt" style="font-size:13px; line-height:1.5; margin-bottom:10px;">${escapeHtml(task.prompt)}</div>
      <div class="task-dates" style="display:flex; gap:12px; margin-bottom:8px; font-size:11px; color:var(--text-dim);">
        <span title="${escapeHtml(task.created)}">Added ${relativeTime(task.created)}</span>
        ${task.modified ? `<span title="${escapeHtml(task.modified)}">Modified ${relativeTime(task.modified)}</span>` : ''}
        ${task.completed ? `<span title="${escapeHtml(task.completed)}" style="color:var(--green);">Completed ${relativeTime(task.completed)}</span>` : ''}
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
        <button class="task-btn task-copy-btn" data-task-id="${escapeHtml(task.id)}" title="Copy prompt to clipboard">Copy</button>
        <button class="task-btn task-btn--accent task-run-btn" data-task-id="${escapeHtml(task.id)}" title="Dispatch to Claude Code">Run in CC</button>
        ${doneBtn}
        <span style="flex:1;"></span>
        <button class="task-btn task-btn--danger task-delete-btn" data-task-id="${escapeHtml(task.id)}" title="Delete task">Delete</button>
      </div>
    </div>
  `;
}

/** Render the filter bar with All + per-tag pill chips with counts. */
export function renderFilterBar(tags: string[], active: string, tasks?: TaskEntry[]): string {
  const totalPending = tasks ? tasks.filter(t => t.status === 'pending').length : 0;
  const allCount = tasks ? `<span class="filter-count">${totalPending}</span>` : '';
  const allBtn = `<button class="filter-btn${active === 'all' ? ' active' : ''}" data-filter="all">All${allCount}</button>`;
  const tagBtns = tags.map(tag => {
    const isActive = active === tag ? ' active' : '';
    const count = tasks ? tasks.filter(t => t.tag === tag && t.status === 'pending').length : 0;
    const color = tagColor(tag);
    const colorStyle = isActive ? ` style="border-color:${color}; color:${color};"` : ` style="--chip-color:${color};"`;
    return `<button class="filter-btn${isActive}"${colorStyle} data-filter="${escapeHtml(tag)}">${escapeHtml(tag)}<span class="filter-count">${count}</span></button>`;
  }).join('');
  return `<div class="task-filter-bar">${allBtn}${tagBtns}</div>`;
}

/** Extract unique tags from the task list, sorted alphabetically. */
export function getUniqueTags(tasks: TaskEntry[]): string[] {
  const seen = new Set<string>();
  for (const t of tasks) {
    if (t.tag) seen.add(t.tag);
  }
  return [...seen].sort();
}

// ── Grouping suggestions panel ───────────────────────────────────────────────

export function renderGroupingPanel(groups: TaskGroupSuggestion[], tasks: TaskEntry[]): string {
  if (groups.length === 0) return '';
  const cards = groups.map((g, i) => {
    const memberLines = g.taskIds.map(id => {
      const t = tasks.find(t => t.id === id);
      return t ? `<li style="font-size:12px; margin-bottom:2px;">${escapeHtml(t.prompt.slice(0, 80))}${t.prompt.length > 80 ? '...' : ''}</li>` : '';
    }).join('');
    return `
      <div class="grouping-card" style="border:1px solid var(--accent); border-radius:6px; padding:12px 14px; margin-bottom:10px; background:rgba(100,200,255,0.04);">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
          <span style="font-weight:700; font-size:14px; color:var(--accent);">${escapeHtml(g.name)}</span>
          <span style="color:var(--text-dim); font-size:12px;">(${g.taskIds.length} tasks)</span>
        </div>
        <p style="font-size:13px; margin:0 0 8px; color:var(--text-dim);">${escapeHtml(g.rationale)}</p>
        <ul style="margin:0 0 10px; padding-left:18px;">${memberLines}</ul>
        <div style="display:flex; gap:6px;">
          <button class="task-btn grouping-accept-btn" data-group-index="${i}" title="Create master task from this group">Accept Group</button>
          <button class="task-btn grouping-dismiss-btn" data-group-index="${i}" title="Dismiss suggestion">Dismiss</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div id="grouping-panel" style="margin-bottom:20px; padding:14px; border:1px solid var(--accent); border-radius:8px; background:rgba(100,200,255,0.02);">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
        <h3 style="margin:0; font-size:15px;">Suggested Groupings</h3>
        <button id="grouping-dismiss-all" class="task-btn" style="font-size:11px;">Dismiss All</button>
      </div>
      ${cards}
    </div>
  `;
}
