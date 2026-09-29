// ── DOM Rendering ─────────────────────────────────────────────────────────

import { escapeHtml } from '../../ui/render';
import { NoteNode, NotesTab, NotesState, findNode, findNodeById, isDescendant } from './noteModel';
import { handleKeydown, KeyboardContext } from './noteKeyboard';

// ── Search / Filter ────────────────────────────────────────────────────────

/** Walk tree, marking nodes whose text matches the query (or ancestors of matches) as visible. */
export function filterNotes(nodes: NoteNode[], query: string): Set<string> {
  const visible = new Set<string>();
  if (!query) {
    function markAll(list: NoteNode[]): void {
      for (const n of list) { visible.add(n.id); markAll(n.children); }
    }
    markAll(nodes);
    return visible;
  }
  const q = query.toLowerCase();
  function walk(list: NoteNode[]): boolean {
    let anyMatch = false;
    for (const n of list) {
      const textMatch = n.text.toLowerCase().includes(q);
      const childMatch = walk(n.children);
      if (textMatch || childMatch) {
        visible.add(n.id);
        anyMatch = true;
      }
    }
    return anyMatch;
  }
  walk(nodes);
  return visible;
}

// ── Text Rendering ─────────────────────────────────────────────────────────

export function highlightText(text: string, query: string): string {
  if (!query) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const q = escapeHtml(query);
  const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escaped.replace(regex, '<mark style="background:rgba(255,180,42,0.3);color:var(--text);padding:0 1px;border-radius:1px;">$1</mark>');
}

export function renderMarkdown(text: string): string {
  let html = escapeHtml(text);
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Inline code
  html = html.replace(/`(.+?)`/g, '<code style="background:var(--bg); padding:1px 4px; border-radius:2px; font-family:var(--font-mono); font-size:11px;">$1</code>');
  // Links
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--accent);">$1</a>');
  return html;
}

// ── Tab Bar Rendering ──────────────────────────────────────────────────────

export interface TabBarContext {
  state: NotesState;
  scheduleSave: () => void;
  fullRender: () => void;
  showTabContextMenu: (e: MouseEvent, tabId: string) => void;
}

export function renderTabBar(ctx: TabBarContext): void {
  const tabsEl = document.getElementById('notes-tabs');
  if (!tabsEl) return;

  tabsEl.innerHTML = ctx.state.tabs.map(t => {
    const active = t.id === ctx.state.activeTabId ? ' notes-tab--active' : '';
    return `<button class="notes-tab${active}" data-tab-id="${t.id}">${escapeHtml(t.label)}</button>`;
  }).join('');

  tabsEl.querySelectorAll<HTMLElement>('.notes-tab').forEach(btn => {
    const tid = btn.dataset.tabId!;

    btn.addEventListener('click', () => {
      ctx.state.activeTabId = tid;
      ctx.scheduleSave();
      ctx.fullRender();
    });

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      ctx.showTabContextMenu(e, tid);
    });
  });
}

// ── Tree Node Rendering ────────────────────────────────────────────────────

export interface RenderNodesContext {
  state: NotesState;
  searchQuery: string;
  visibleIds: Set<string>;
  previewMode: boolean;
  focusedId: string | null;
  dragId: string | null;
  dropTargetId: string | null;
  dropPosition: 'before' | 'after' | 'inside';
  setFocusedId: (id: string | null) => void;
  setDragId: (id: string | null) => void;
  setDropTargetId: (id: string | null) => void;
  setDropPosition: (pos: 'before' | 'after' | 'inside') => void;
  scheduleSave: () => void;
  renderTree: () => void;
  focusNode: (id: string) => void;
  showNoteContextMenu: (e: MouseEvent, node: NoteNode) => void;
  activeTab: () => NotesTab;
}

export function renderNodes(
  parent: HTMLElement,
  nodes: NoteNode[],
  depth: number,
  ctx: RenderNodesContext,
): void {
  const tab = ctx.activeTab();
  for (const node of nodes) {
    // Skip nodes hidden by search filter
    if (ctx.searchQuery && !ctx.visibleIds.has(node.id)) continue;

    const row = document.createElement('div');
    row.className = 'notes-row';
    if (node.id === ctx.focusedId) row.classList.add('notes-row--focused');
    row.dataset.nodeId = node.id;
    row.style.paddingLeft = `${depth * 24}px`;

    const hasChildren = node.children.length > 0;
    const collapseChar = hasChildren ? (node.collapsed ? '\u25B8' : '\u25BE') : '';

    const textContent = ctx.searchQuery
      ? highlightText(node.text, ctx.searchQuery)
      : (ctx.previewMode ? renderMarkdown(node.text) : escapeHtml(node.text));
    row.innerHTML = `
      <span class="notes-drag-handle" draggable="true" title="Drag to reorder">\u2847</span>
      <span class="notes-collapse${hasChildren ? '' : ' notes-collapse--empty'}">${collapseChar}</span>
      <span class="notes-bullet">\u2022</span>
      <div class="notes-text${ctx.previewMode ? ' notes-text--preview' : ''}" ${ctx.previewMode ? '' : 'contenteditable="true"'} data-node-id="${node.id}">${textContent}</div>
    `;

    parent.appendChild(row);

    // Wire events
    const textEl = row.querySelector<HTMLElement>('.notes-text')!;
    const collapseEl = row.querySelector<HTMLElement>('.notes-collapse')!;
    const dragHandle = row.querySelector<HTMLElement>('.notes-drag-handle')!;

    // Right-click context menu on row
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ctx.showNoteContextMenu(e, node);
    });

    if (!ctx.previewMode) {
      // Text input
      textEl.addEventListener('input', () => {
        node.text = textEl.textContent ?? '';
        node.modified = new Date().toISOString();
        ctx.scheduleSave();
      });

      textEl.addEventListener('focus', () => {
        ctx.setFocusedId(node.id);
        document.querySelectorAll('.notes-row--focused').forEach(el => el.classList.remove('notes-row--focused'));
        row.classList.add('notes-row--focused');
      });

      // Keyboard shortcuts
      const kbCtx: KeyboardContext = {
        scheduleSave: ctx.scheduleSave,
        renderTree: ctx.renderTree,
        focusNode: ctx.focusNode,
        setFocusedId: ctx.setFocusedId,
      };
      textEl.addEventListener('keydown', (e) => {
        handleKeydown(e, node, tab, kbCtx);
      });
    }

    // Collapse toggle
    if (hasChildren) {
      collapseEl.addEventListener('click', () => {
        node.collapsed = !node.collapsed;
        ctx.scheduleSave();
        ctx.renderTree();
        ctx.focusNode(node.id);
      });
    }

    // Drag-and-drop
    dragHandle.addEventListener('dragstart', (e) => {
      ctx.setDragId(node.id);
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/plain', node.id);
      row.classList.add('notes-row--dragging');
    });

    dragHandle.addEventListener('dragend', () => {
      ctx.setDragId(null);
      row.classList.remove('notes-row--dragging');
      document.querySelectorAll('.notes-drop-indicator').forEach(el => el.classList.remove('notes-drop-indicator'));
      document.querySelectorAll('.notes-drop-inside').forEach(el => el.classList.remove('notes-drop-inside'));
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!ctx.dragId || ctx.dragId === node.id) return;
      e.dataTransfer!.dropEffect = 'move';

      // Clear previous indicators
      document.querySelectorAll('.notes-drop-indicator').forEach(el => el.classList.remove('notes-drop-indicator'));
      document.querySelectorAll('.notes-drop-inside').forEach(el => el.classList.remove('notes-drop-inside'));

      const rect = row.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const third = rect.height / 3;

      if (y < third) {
        ctx.setDropTargetId(node.id);
        ctx.setDropPosition('before');
        row.classList.add('notes-drop-indicator');
        row.style.setProperty('--drop-border', 'top');
      } else if (y > third * 2) {
        ctx.setDropTargetId(node.id);
        ctx.setDropPosition('after');
        row.classList.add('notes-drop-indicator');
        row.style.setProperty('--drop-border', 'bottom');
      } else {
        ctx.setDropTargetId(node.id);
        ctx.setDropPosition('inside');
        row.classList.add('notes-drop-inside');
      }
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('notes-drop-indicator');
      row.classList.remove('notes-drop-inside');
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!ctx.dragId || !ctx.dropTargetId || ctx.dragId === ctx.dropTargetId) return;

      performDrop(tab.root, ctx.dragId, ctx.dropTargetId, ctx.dropPosition);
      ctx.setDragId(null);
      ctx.setDropTargetId(null);
      ctx.scheduleSave();
      ctx.renderTree();
    });

    // Recurse into children
    if (!node.collapsed && node.children.length > 0) {
      renderNodes(parent, node.children, depth + 1, ctx);
    }
  }
}

function performDrop(
  roots: NoteNode[],
  dragId: string,
  targetId: string,
  position: 'before' | 'after' | 'inside',
): void {
  const dragLoc = findNode(roots, dragId);
  const targetLoc = findNode(roots, targetId);
  if (!dragLoc || !targetLoc) return;

  // Check: don't drop a node into its own subtree
  const dragNode = dragLoc.parent[dragLoc.index];
  if (isDescendant(dragNode, targetId)) return;

  // Remove from old position
  dragLoc.parent.splice(dragLoc.index, 1);

  if (position === 'inside') {
    const targetNode = findNodeById(roots, targetId);
    if (targetNode) {
      targetNode.children.push(dragNode);
      targetNode.collapsed = false;
    }
  } else {
    // Re-find target after removal (indices may have shifted)
    const newTargetLoc = findNode(roots, targetId);
    if (!newTargetLoc) return;
    const insertIdx = position === 'before' ? newTargetLoc.index : newTargetLoc.index + 1;
    newTargetLoc.parent.splice(insertIdx, 0, dragNode);
  }
}

// ── CSS ────────────────────────────────────────────────────────────────────

export function notesCSS(): string {
  return `
    .notes-root {
      height: 100%;
      display: flex;
      flex-direction: column;
      font-family: var(--font-body);
    }

    /* Tab bar */
    .notes-tab-bar {
      display: flex;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding: 0 8px;
      gap: 0;
      flex-shrink: 0;
      background: var(--bg);
    }
    .notes-tabs {
      display: flex;
      gap: 0;
      overflow-x: auto;
      flex: 1;
    }
    .notes-tab {
      padding: 8px 16px;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--text-dim);
      font-family: var(--font-body);
      font-size: 13px;
      cursor: pointer;
      white-space: nowrap;
      transition: color 0.15s, border-color 0.15s;
    }
    .notes-tab:hover {
      color: var(--text);
    }
    .notes-tab--active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }
    .notes-tab-add {
      padding: 6px 12px;
      background: none;
      border: none;
      color: var(--text-dim);
      font-size: 16px;
      cursor: pointer;
      flex-shrink: 0;
      transition: color 0.15s;
    }
    .notes-tab-add:hover {
      color: var(--accent);
    }

    /* Tree area */
    .notes-tree {
      flex: 1;
      overflow-y: auto;
      padding: 12px 8px 40px 8px;
    }

    .notes-empty {
      padding: 40px 24px;
      color: var(--text-dim);
      font-size: 14px;
      cursor: pointer;
      user-select: none;
    }
    .notes-empty:hover {
      color: var(--text);
    }

    /* Bullet row */
    .notes-row {
      display: flex;
      align-items: flex-start;
      min-height: 28px;
      padding-right: 8px;
      border-left: 2px solid transparent;
      transition: border-color 0.1s;
    }
    .notes-row--focused {
      border-left-color: var(--accent);
    }
    .notes-row--dragging {
      opacity: 0.4;
    }

    /* Drag handle */
    .notes-drag-handle {
      width: 18px;
      text-align: center;
      color: var(--text-dim);
      cursor: grab;
      opacity: 0;
      transition: opacity 0.15s;
      font-size: 14px;
      line-height: 28px;
      flex-shrink: 0;
      user-select: none;
    }
    .notes-row:hover .notes-drag-handle {
      opacity: 0.6;
    }
    .notes-drag-handle:hover {
      opacity: 1 !important;
      color: var(--text);
    }

    /* Collapse toggle */
    .notes-collapse {
      width: 16px;
      text-align: center;
      font-size: 10px;
      line-height: 28px;
      color: var(--text-dim);
      cursor: pointer;
      flex-shrink: 0;
      user-select: none;
    }
    .notes-collapse:hover {
      color: var(--text);
    }
    .notes-collapse--empty {
      cursor: default;
    }

    /* Bullet dot */
    .notes-bullet {
      width: 14px;
      text-align: center;
      color: var(--text-dim);
      font-size: 8px;
      line-height: 28px;
      flex-shrink: 0;
      user-select: none;
    }

    /* Editable text */
    .notes-text {
      flex: 1;
      min-height: 28px;
      line-height: 28px;
      font-size: 14px;
      color: var(--text);
      outline: none;
      word-break: break-word;
      padding: 0 4px;
      font-family: var(--font-body);
    }
    .notes-text:empty::before {
      content: '';
    }

    /* Drop indicators */
    .notes-drop-indicator {
      position: relative;
    }
    .notes-drop-indicator[style*="--drop-border: top"]::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--accent);
    }
    .notes-drop-indicator[style*="--drop-border: bottom"]::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--accent);
    }
    .notes-drop-inside {
      background: rgba(0, 255, 255, 0.06);
      border-radius: 3px;
    }

    /* Context menu */
    .notes-ctx-menu {
      position: fixed;
      z-index: 10000;
      background: var(--bg-panel);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 4px 0;
      min-width: 120px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }
    .notes-ctx-item {
      padding: 6px 14px;
      font-size: 13px;
      color: var(--text);
      cursor: pointer;
      font-family: var(--font-body);
    }
    .notes-ctx-item:hover {
      background: rgba(255,255,255,0.06);
    }
    .notes-ctx-item--danger {
      color: var(--red, #ff5555);
    }

    /* Preview toggle */
    .notes-preview-toggle {
      padding: 4px 12px;
      background: none;
      border: 1px solid var(--border);
      border-radius: 3px;
      color: var(--text-dim);
      font-family: var(--font-body);
      font-size: 11px;
      cursor: pointer;
      flex-shrink: 0;
      margin-right: 4px;
      transition: color 0.15s, border-color 0.15s;
    }
    .notes-preview-toggle:hover {
      color: var(--text);
      border-color: var(--text-dim);
    }

    /* Preview mode text */
    .notes-text--preview {
      user-select: text;
      cursor: default;
    }
    .notes-text--preview strong {
      color: var(--text);
      font-weight: 600;
    }
    .notes-text--preview a {
      color: var(--accent);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .notes-text--preview a:hover {
      opacity: 0.8;
    }

    /* Note bullet context menu item hover */
    .note-ctx-item:hover {
      background: rgba(255,255,255,0.06);
      color: var(--text);
    }
  `;
}
