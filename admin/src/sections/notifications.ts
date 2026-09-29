import { bus } from '../ui/eventBus';
import type { EventName } from '../ui/eventBus';
import { escapeHtml } from '../ui/render';
import { icon } from '../ui/icons';
import type { NotificationEntry } from '../types';

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_ENTRIES = 200;

const TYPE_LABELS: Record<EventName, { badge: string; color: string }> = {
  'task:done': { badge: 'Task',  color: 'var(--green)' },
  'bug:new':   { badge: 'Bug',   color: 'var(--red)' },
  'cc:done':   { badge: 'CC',    color: 'var(--accent)' },
};

// ── In-memory buffer (captures events before section is visited) ─────────────

let _entries: NotificationEntry[] = [];
let _busWired = false;

function makeEntry(type: EventName, title: string, message: string): NotificationEntry {
  return {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    title,
    message,
    ts: new Date().toISOString(),
  };
}

function pushEntry(entry: NotificationEntry): void {
  _entries.unshift(entry);
  if (_entries.length > MAX_ENTRIES) _entries = _entries.slice(0, MAX_ENTRIES);
  // Fire save in background (best-effort)
  saveNotifications(_entries).catch(() => {});
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

/** Wire bus listeners once. Called from initNotifications or renderNotifications. */
export function initNotificationBus(): void {
  if (_busWired) return;
  _busWired = true;

  bus.on('task:done', (p) => {
    pushEntry(makeEntry('task:done', 'Task completed', `${truncate(p.prompt, 80)} \u2014 ${p.tag}`));
  });

  bus.on('bug:new', (p) => {
    pushEntry(makeEntry('bug:new', 'New bug report', `${p.username}: ${truncate(p.error, 60)}`));
  });

  bus.on('cc:done', (p) => {
    const status = p.exitCode === 0 ? 'success' : `exit ${p.exitCode}`;
    pushEntry(makeEntry('cc:done', 'CC finished', `${p.label} \u2014 ${status}`));
  });
}

// ── Persistence ──────────────────────────────────────────────────────────────

async function loadNotifications(): Promise<NotificationEntry[]> {
  try {
    const res = await fetch('/data/notifications.json');
    if (!res.ok) return [];
    return await res.json() as NotificationEntry[];
  } catch {
    return [];
  }
}

async function saveNotifications(entries: NotificationEntry[]): Promise<void> {
  try {
    await fetch('/__admin_save?file=notifications.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entries, null, 2),
    });
  } catch {
    // best-effort
  }
}

// ── Time formatting ──────────────────────────────────────────────────────────

export function relativeTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ── Render helpers (exported for tests) ──────────────────────────────────────

export function renderNotificationCard(entry: NotificationEntry): string {
  const style = TYPE_LABELS[entry.type] ?? { badge: entry.type, color: 'var(--text-dim)' };
  return `
    <div class="notif-card" style="border:1px solid var(--border); border-left:3px solid ${style.color}; border-radius:6px; padding:10px 14px; margin-bottom:8px;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
        <span style="background:${style.color}; color:var(--bg); font-size:10px; font-weight:700; padding:1px 6px; border-radius:4px; text-transform:uppercase;">${escapeHtml(style.badge)}</span>
        <span style="color:var(--text-dim); font-size:11px; margin-left:auto;" title="${escapeHtml(entry.ts)}">${relativeTime(entry.ts)}</span>
      </div>
      <div style="font-size:13px; color:var(--text);">${escapeHtml(entry.message)}</div>
    </div>
  `;
}

export function renderNotificationFilter(types: EventName[], active: string): string {
  const allBtn = `<button class="filter-btn${active === 'all' ? ' active' : ''}" data-notif-filter="all">All</button>`;
  const typeBtns = types.map(t => {
    const label = TYPE_LABELS[t]?.badge ?? t;
    return `<button class="filter-btn${active === t ? ' active' : ''}" data-notif-filter="${escapeHtml(t)}">${escapeHtml(label)}</button>`;
  }).join('');
  return `<div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:16px;">${allBtn}${typeBtns}</div>`;
}

// ── Section entry point ──────────────────────────────────────────────────────

export async function renderNotifications(container: HTMLElement): Promise<void> {
  initNotificationBus();

  // Merge persisted entries with in-memory
  const stored = await loadNotifications();
  const knownIds = new Set(_entries.map(e => e.id));
  for (const s of stored) {
    if (!knownIds.has(s.id)) _entries.push(s);
  }
  // Sort newest first and cap
  _entries.sort((a, b) => b.ts.localeCompare(a.ts));
  if (_entries.length > MAX_ENTRIES) _entries = _entries.slice(0, MAX_ENTRIES);

  let activeFilter = 'all';

  function render(): void {
    const filtered = activeFilter === 'all'
      ? _entries
      : _entries.filter(e => e.type === activeFilter);

    container.innerHTML = `
      <h2>${icon('bell', 18)} Activity <span style="color:var(--text-dim); font-size:14px; font-weight:400;">(${_entries.length})</span>
        <button id="notif-clear-all" class="refresh-btn" style="margin-left:auto;" ${_entries.length === 0 ? 'disabled style="opacity:0.4"' : ''}>Clear All</button>
      </h2>

      ${renderNotificationFilter(['task:done', 'bug:new', 'cc:done'], activeFilter)}

      <div id="notif-list">
        ${filtered.length > 0
          ? filtered.map(e => renderNotificationCard(e)).join('')
          : '<p style="color:var(--text-dim); font-size:13px;">No notifications yet.</p>'}
      </div>
    `;

    wireEvents();
  }

  function wireEvents(): void {
    // Filter buttons
    container.querySelectorAll<HTMLButtonElement>('[data-notif-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.notifFilter ?? 'all';
        render();
      });
    });

    // Clear all
    document.getElementById('notif-clear-all')?.addEventListener('click', async () => {
      _entries = [];
      await saveNotifications([]);
      render();
    });
  }

  render();
}
