// ── Notes Section — Slim Orchestrator ─────────────────────────────────────

import { escapeHtml } from '../ui/render';
import { icon } from '../ui/icons';
import { NoteNode, NotesTab, NotesState, genId, makeNode } from './notes/noteModel';
import { loadNotes, scheduleSave as _scheduleSave } from './notes/notePersistence';
import { filterNotes, renderTabBar, renderNodes, notesCSS, RenderNodesContext } from './notes/noteRenderer';
import type { ReminderEntry } from '../types';

// ── State ──────────────────────────────────────────────────────────────────

let _state: NotesState = { tabs: [], activeTabId: '' };
let _container: HTMLElement | null = null;
let _focusedId: string | null = null;
let _dragId: string | null = null;
let _dropTargetId: string | null = null;
let _dropPosition: 'before' | 'after' | 'inside' = 'before';
let _previewMode = false;
let _searchQuery = '';
let _visibleIds = new Set<string>();

// ── Reminders State & Helpers ──────────────────────────────────────────────

let _reminders: ReminderEntry[] = [];

async function loadReminders(): Promise<ReminderEntry[]> {
  try {
    const res = await fetch('/data/reminders.json');
    if (!res.ok) return [];
    return await res.json() as ReminderEntry[];
  } catch { return []; }
}

async function saveReminders(): Promise<void> {
  try {
    await fetch('/__admin_save?file=reminders.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_reminders, null, 2),
    });
  } catch (e) { console.warn('Failed to save reminders:', e); }
}

function ensureRemindersTab(): void {
  if (!_state.tabs.some(t => t.type === 'reminders')) {
    _state.tabs.push({ id: genId(), label: 'Reminders', root: [], type: 'reminders' });
    _scheduleSave(_state);
  }
}

function renderRemindersContent(container: HTMLElement): void {
  const active = _reminders.filter(r => !r.done);
  const completed = _reminders.filter(r => r.done);

  container.innerHTML = `
    <div style="padding:4px 0;">
      <input id="reminder-input" type="text" placeholder="Add a reminder..."
        style="width:100%; box-sizing:border-box; background:var(--bg); border:1px solid var(--border); border-radius:2px; padding:8px 10px; color:inherit; font-size:12px; font-family:var(--font-body); margin-bottom:12px;" />
      <div id="reminders-active-list">
        ${active.length > 0
          ? active.map(r => renderReminderItem(r)).join('')
          : '<p style="color:var(--text-dim); font-size:12px;">No active reminders.</p>'}
      </div>
      ${completed.length > 0 ? `
        <details style="margin-top:12px;">
          <summary style="cursor:pointer; font-size:12px; color:var(--text-dim); margin-bottom:8px;">
            Completed (${completed.length})
          </summary>
          <div>${completed.map(r => renderReminderItem(r)).join('')}</div>
        </details>
      ` : ''}
    </div>
  `;

  // Wire add
  const input = container.querySelector<HTMLInputElement>('#reminder-input');
  input?.addEventListener('keydown', async (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    const text = input.value.trim();
    if (!text) return;
    _reminders.unshift({
      id: `reminder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text, done: false, created: new Date().toISOString(),
    });
    await saveReminders();
    renderRemindersContent(container);
  });

  // Wire checkboxes
  container.querySelectorAll<HTMLInputElement>('.reminder-check').forEach(cb => {
    cb.addEventListener('change', async () => {
      const r = _reminders.find(x => x.id === cb.dataset.reminderId);
      if (!r) return;
      r.done = cb.checked;
      if (r.done) r.completed = new Date().toISOString();
      else delete r.completed;
      await saveReminders();
      renderRemindersContent(container);
    });
  });

  // Wire copy
  container.querySelectorAll<HTMLButtonElement>('.reminder-copy').forEach(btn => {
    btn.addEventListener('click', async (e: Event) => {
      e.preventDefault();
      const r = _reminders.find(x => x.id === btn.dataset.reminderId);
      if (r) try { await navigator.clipboard.writeText(r.text); } catch {}
      btn.style.borderColor = 'var(--green)';
      setTimeout(() => { btn.style.borderColor = ''; }, 600);
    });
  });
}

function renderReminderItem(r: ReminderEntry): string {
  const opacity = r.done ? '0.4' : '1';
  const textDecoration = r.done ? 'text-decoration:line-through;' : '';
  const dateLabel = r.done && r.completed
    ? `done ${new Date(r.completed).toLocaleDateString()}`
    : `added ${new Date(r.created).toLocaleDateString()}`;
  return `
    <div style="display:flex; align-items:flex-start; gap:10px; padding:8px 0; border-bottom:1px solid var(--border); opacity:${opacity};">
      <input type="checkbox" class="reminder-check" data-reminder-id="${escapeHtml(r.id)}"${r.done ? ' checked' : ''} style="margin-top:3px; flex-shrink:0;" />
      <div style="flex:1; min-width:0;">
        <div style="font-size:12px; ${textDecoration}">${escapeHtml(r.text)}</div>
        <div style="font-size:10px; color:var(--text-dim); margin-top:2px;">${escapeHtml(dateLabel)}</div>
      </div>
      <button class="reminder-copy" data-reminder-id="${escapeHtml(r.id)}" title="Copy text" style="flex-shrink:0; font-size:10px; padding:2px 6px; background:transparent; border:1px solid var(--border); border-radius:4px; color:var(--text-dim); cursor:pointer;">Copy</button>
    </div>
  `;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function activeTab(): NotesTab {
  return _state.tabs.find(t => t.id === _state.activeTabId) ?? _state.tabs[0];
}

function scheduleSave(): void {
  _scheduleSave(_state);
}

function focusNode(id: string): void {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`.notes-text[data-node-id="${id}"]`);
    if (el) {
      el.focus();
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  });
}

// ── Entry Point ────────────────────────────────────────────────────────────

export function renderNotes(container: HTMLElement): void {
  _container = container;
  container.innerHTML = '<div style="padding:20px;color:var(--text-dim);">Loading notes...</div>';

  Promise.all([loadNotes(), loadReminders()]).then(([state, reminders]) => {
    _state = state;
    _reminders = reminders;
    ensureRemindersTab();
    fullRender();
  });
}

// ── Full Render ────────────────────────────────────────────────────────────

function fullRender(): void {
  if (!_container) return;

  _container.innerHTML = `
    <style>${notesCSS()}</style>
    <div class="notes-root">
      <div class="notes-tab-bar">
        <div class="notes-tabs" id="notes-tabs"></div>
        <button class="notes-preview-toggle" id="notes-preview-toggle">${_previewMode ? 'Edit' : 'Preview'}</button>
        <button class="notes-tab-add" id="notes-tab-add" title="New tab">+</button>
      </div>
      <input type="text" id="notes-search" placeholder="Search notes..." style="width:100%; padding:6px 10px; background:var(--bg); border:1px solid var(--border); border-radius:2px; color:var(--text); font-family:var(--font-body); font-size:12px; margin-bottom:8px;" />
      <div class="notes-tree" id="notes-tree"></div>
    </div>
  `;

  // Wire search
  const searchEl = _container.querySelector<HTMLInputElement>('#notes-search')!;
  searchEl.value = _searchQuery;
  searchEl.addEventListener('input', () => {
    _searchQuery = searchEl.value;
    const tab = activeTab();
    _visibleIds = filterNotes(tab.root, _searchQuery);
    renderTree();
  });

  renderTabBar({
    state: _state,
    scheduleSave,
    fullRender,
    showTabContextMenu,
  });

  // Compute initial visibility
  _visibleIds = filterNotes(activeTab().root, _searchQuery);
  renderTree();

  _container.querySelector('#notes-tab-add')!.addEventListener('click', () => {
    const t: NotesTab = { id: genId(), label: 'Untitled', root: [] };
    _state.tabs.push(t);
    _state.activeTabId = t.id;
    scheduleSave();
    fullRender();
  });

  _container.querySelector('#notes-preview-toggle')!.addEventListener('click', () => {
    _previewMode = !_previewMode;
    fullRender();
  });
}

// ── Tree Render ────────────────────────────────────────────────────────────

function renderTree(): void {
  const treeEl = document.getElementById('notes-tree');
  if (!treeEl) return;
  const tab = activeTab();

  // Reminders tab: render checklist instead of tree
  if (tab.type === 'reminders') {
    renderRemindersContent(treeEl);
    return;
  }

  if (tab.root.length === 0) {
    treeEl.innerHTML = `<div class="notes-empty" id="notes-empty-prompt">Press Enter to start writing...</div>`;
    treeEl.querySelector('#notes-empty-prompt')!.addEventListener('click', () => {
      const node = makeNode();
      tab.root.push(node);
      _focusedId = node.id;
      scheduleSave();
      renderTree();
      focusNode(node.id);
    });
    treeEl.tabIndex = 0;
    treeEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && tab.root.length === 0) {
        e.preventDefault();
        const node = makeNode();
        tab.root.push(node);
        _focusedId = node.id;
        scheduleSave();
        renderTree();
        focusNode(node.id);
      }
    });
    return;
  }

  treeEl.innerHTML = '';

  const ctx: RenderNodesContext = {
    state: _state,
    searchQuery: _searchQuery,
    visibleIds: _visibleIds,
    previewMode: _previewMode,
    get focusedId() { return _focusedId; },
    get dragId() { return _dragId; },
    get dropTargetId() { return _dropTargetId; },
    get dropPosition() { return _dropPosition; },
    setFocusedId: (id) => { _focusedId = id; },
    setDragId: (id) => { _dragId = id; },
    setDropTargetId: (id) => { _dropTargetId = id; },
    setDropPosition: (pos) => { _dropPosition = pos; },
    scheduleSave,
    renderTree,
    focusNode,
    showNoteContextMenu,
    activeTab,
  };

  renderNodes(treeEl, tab.root, 0, ctx);
}

// ── Context Menus ──────────────────────────────────────────────────────────

function showTabContextMenu(e: MouseEvent, tabId: string): void {
  document.querySelectorAll('.notes-ctx-menu').forEach(el => el.remove());

  const tab = _state.tabs.find(t => t.id === tabId);
  if (!tab) return;

  const menu = document.createElement('div');
  menu.className = 'notes-ctx-menu';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.innerHTML = `
    <div class="notes-ctx-item" data-action="rename">Rename</div>
    <div class="notes-ctx-item notes-ctx-item--danger" data-action="delete">Delete</div>
  `;
  document.body.appendChild(menu);

  const close = () => { menu.remove(); document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close), 0);

  menu.querySelector('[data-action="rename"]')!.addEventListener('click', () => {
    const name = prompt('Tab name:', tab.label);
    if (name !== null && name.trim()) {
      tab.label = name.trim();
      scheduleSave();
      fullRender();
    }
  });

  menu.querySelector('[data-action="delete"]')!.addEventListener('click', () => {
    if (_state.tabs.length <= 1) return;
    if (!confirm(`Delete tab "${tab.label}"?`)) return;
    _state.tabs = _state.tabs.filter(t => t.id !== tabId);
    if (_state.activeTabId === tabId) _state.activeTabId = _state.tabs[0].id;
    scheduleSave();
    fullRender();
  });
}

function showNoteContextMenu(e: MouseEvent, node: NoteNode): void {
  document.querySelectorAll('.note-ctx-menu').forEach(el => el.remove());

  const menu = document.createElement('div');
  menu.className = 'note-ctx-menu';
  menu.style.cssText = `position:fixed; left:${e.clientX}px; top:${e.clientY}px; background:rgb(10,22,26); border:1px solid var(--border); border-radius:4px; z-index:50; padding:4px 0; min-width:160px; box-shadow:0 8px 24px rgba(2,3,5,0.5);`;

  menu.innerHTML = `
    <div class="note-ctx-item" data-action="task" style="padding:6px 14px; cursor:pointer; font-size:12px; color:var(--text-dim); transition:all 0.1s;">Convert to Task</div>
    <div class="note-ctx-item" data-action="copy" style="padding:6px 14px; cursor:pointer; font-size:12px; color:var(--text-dim); transition:all 0.1s;">Copy Text</div>
  `;

  document.body.appendChild(menu);

  menu.addEventListener('click', async (ev) => {
    const action = (ev.target as HTMLElement).dataset.action;
    if (action === 'task') {
      await fetch('/__admin_task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag: 'notes',
          prompt: node.text,
          source: 'notes',
          priority: 3,
        }),
      });
    } else if (action === 'copy') {
      await navigator.clipboard.writeText(node.text);
    }
    menu.remove();
  });

  const closeMenu = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}
