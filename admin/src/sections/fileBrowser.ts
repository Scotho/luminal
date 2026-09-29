// ── File Browser Section ──────────────────────────────────────────────────────
// TASK-53: Windows Explorer-style file browser with tree, preview, drag support

import { icon } from '../ui/icons';
import { DirectoryTree, fetchEntries, fileIcon, escapeText, renderBreadcrumb, showContextMenu } from './fileBrowserTree';
import { renderPreview } from './fileBrowserPreview';
import type { FsEntry } from './fileBrowserTree';

type SortKey = 'name' | 'size' | 'mtime' | 'extension';
type SortDir = 'asc' | 'desc';

interface FileBrowserState {
  currentPath: string;
  entries: FsEntry[];
  selected: Set<string>;
  lastSelectedIdx: number;
  sortKey: SortKey;
  sortDir: SortDir;
  clipboard: { paths: string[]; op: 'copy' } | null;
  previewFile: FsEntry | null;
}

const state: FileBrowserState = {
  currentPath: '.',
  entries: [],
  selected: new Set(),
  lastSelectedIdx: -1,
  sortKey: 'name',
  sortDir: 'asc',
  clipboard: null,
  previewFile: null,
};

// ── Sorting ────────────────────────────────────────────────────────────────

function sortEntries(entries: FsEntry[], key: SortKey, dir: SortDir): FsEntry[] {
  const sorted = [...entries].sort((a, b) => {
    // Directories always first
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    let cmp = 0;
    switch (key) {
      case 'name': cmp = a.name.localeCompare(b.name); break;
      case 'size': cmp = a.size - b.size; break;
      case 'mtime': cmp = a.mtime - b.mtime; break;
      case 'extension': cmp = a.extension.localeCompare(b.extension); break;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number): string {
  if (!ts) return '--';
  const d = new Date(ts);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Toolbar Buttons ────────────────────────────────────────────────────────

function toolBtn(label: string, iconName: string, onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.innerHTML = `${icon(iconName, 13)} ${escapeText(label)}`;
  btn.style.cssText = 'display:flex;align-items:center;gap:4px;background:transparent;border:1px solid var(--border);border-radius:4px;color:var(--text);cursor:pointer;font-size:11px;padding:4px 8px;transition:border-color 0.15s,background 0.15s;white-space:nowrap;';
  btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'var(--accent)'; btn.style.background = 'var(--surface)'; });
  btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'var(--border)'; btn.style.background = 'transparent'; });
  btn.addEventListener('click', onClick);
  return btn;
}

// ── Main Render ────────────────────────────────────────────────────────────

export function renderFileBrowser(container: HTMLElement): void {
  container.innerHTML = '';

  // Wrap all content in a child div so the section's CSS display toggle works.
  // Setting display on the container directly overrides .section { display:none }.
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';
  container.appendChild(wrapper);

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 12px;background:var(--surface);border-bottom:1px solid var(--border);flex-wrap:wrap;';

  const breadcrumbSlot = document.createElement('div');
  breadcrumbSlot.style.cssText = 'flex:1;min-width:120px;overflow:hidden;';
  toolbar.appendChild(breadcrumbSlot);

  const navigate = async (dirPath: string) => {
    state.currentPath = dirPath;
    state.selected.clear();
    state.previewFile = null;
    tree.highlight(dirPath);
    await refreshFileList();
  };

  toolbar.appendChild(toolBtn('New File', 'file-plus', () => void newFile()));
  toolbar.appendChild(toolBtn('New Folder', 'folder-plus', () => void newFolder()));
  toolbar.appendChild(toolBtn('Copy', 'copy', () => copySelected()));
  toolbar.appendChild(toolBtn('Paste', 'clipboard', () => void pasteClipboard()));
  toolbar.appendChild(toolBtn('Rename', 'edit', () => void renameSelected()));
  toolbar.appendChild(toolBtn('Delete', 'trash-2', () => void deleteSelected()));
  toolbar.appendChild(toolBtn('Refresh', 'refresh-cw', () => void navigate(state.currentPath)));

  wrapper.appendChild(toolbar);

  // Two-pane layout
  const panes = document.createElement('div');
  panes.style.cssText = 'display:flex;flex:1;overflow:hidden;';

  const leftPane = document.createElement('div');
  const rightPane = document.createElement('div');
  rightPane.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';

  const tree = new DirectoryTree(leftPane, (dirPath) => void navigate(dirPath));

  panes.appendChild(leftPane);
  panes.appendChild(rightPane);
  wrapper.appendChild(panes);

  // File list table
  const tableWrap = document.createElement('div');
  tableWrap.style.cssText = 'flex:1;overflow:auto;';
  rightPane.appendChild(tableWrap);

  // Preview container (hidden initially)
  const previewContainer = document.createElement('div');
  previewContainer.style.cssText = 'display:none;flex-direction:column;height:100%;';
  rightPane.appendChild(previewContainer);

  // ── File list rendering ──
  async function refreshFileList(): Promise<void> {
    try {
      const entries = await fetchEntries(state.currentPath);
      state.entries = entries;
    } catch {
      state.entries = [];
    }
    renderFileTable();
    breadcrumbSlot.innerHTML = '';
    breadcrumbSlot.appendChild(renderBreadcrumb(state.currentPath, (p) => void navigate(p)));
  }

  function renderFileTable(): void {
    if (state.previewFile) {
      tableWrap.style.display = 'none';
      previewContainer.style.display = 'flex';
      renderPreview(previewContainer, state.previewFile.path, state.previewFile.name, state.previewFile.extension, () => {
        state.previewFile = null;
        renderFileTable();
      });
      return;
    }
    tableWrap.style.display = '';
    previewContainer.style.display = 'none';

    const sorted = sortEntries(state.entries, state.sortKey, state.sortDir);

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const columns: { key: SortKey; label: string; width: string }[] = [
      { key: 'name', label: 'Name', width: '' },
      { key: 'size', label: 'Size', width: '80px' },
      { key: 'mtime', label: 'Modified', width: '150px' },
      { key: 'extension', label: 'Type', width: '60px' },
    ];
    for (const col of columns) {
      const th = document.createElement('th');
      const arrow = state.sortKey === col.key ? (state.sortDir === 'asc' ? ' ^' : ' v') : '';
      th.textContent = col.label + arrow;
      th.style.cssText = `text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);cursor:pointer;user-select:none;font-weight:700;color:var(--text-heading);font-size:10px;text-transform:uppercase;letter-spacing:1px;${col.width ? 'width:' + col.width + ';' : ''}`;
      th.addEventListener('click', () => {
        if (state.sortKey === col.key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.sortKey = col.key; state.sortDir = 'asc'; }
        renderFileTable();
      });
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i];
      const tr = document.createElement('tr');
      tr.dataset.path = entry.path;
      const isSelected = state.selected.has(entry.path);
      const isEven = i % 2 === 0;
      tr.style.cssText = `cursor:pointer;transition:background 0.1s;background:${isSelected ? 'var(--accent-dim, rgba(99,102,241,0.18))' : isEven ? 'transparent' : 'rgba(255,255,255,0.02)'};`;

      // Name cell
      const tdName = document.createElement('td');
      tdName.style.cssText = 'padding:5px 8px;display:flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      const iconHtml = entry.type === 'directory'
        ? `<span style="color:var(--gold, #c8a84e);font-size:12px;">&#9654;</span>`
        : fileIcon(entry.extension);
      tdName.innerHTML = `${iconHtml}<span style="overflow:hidden;text-overflow:ellipsis;">${escapeText(entry.name)}</span>`;
      tr.appendChild(tdName);

      // Size cell
      const tdSize = document.createElement('td');
      tdSize.style.cssText = 'padding:5px 8px;color:var(--text-dim);font-family:var(--font-mono);font-size:11px;';
      tdSize.textContent = entry.type === 'directory' ? '--' : formatSize(entry.size);
      tr.appendChild(tdSize);

      // Modified cell
      const tdMtime = document.createElement('td');
      tdMtime.style.cssText = 'padding:5px 8px;color:var(--text-dim);font-size:11px;';
      tdMtime.textContent = formatDate(entry.mtime);
      tr.appendChild(tdMtime);

      // Type cell
      const tdType = document.createElement('td');
      tdType.style.cssText = 'padding:5px 8px;color:var(--text-dim);font-family:var(--font-mono);font-size:11px;';
      tdType.textContent = entry.type === 'directory' ? 'dir' : (entry.extension || '--');
      tr.appendChild(tdType);

      // Selection
      tr.addEventListener('click', (e) => {
        const idx = sorted.indexOf(entry);
        if (e.ctrlKey || e.metaKey) {
          if (state.selected.has(entry.path)) state.selected.delete(entry.path);
          else state.selected.add(entry.path);
        } else if (e.shiftKey && state.lastSelectedIdx >= 0) {
          const start = Math.min(state.lastSelectedIdx, idx);
          const end = Math.max(state.lastSelectedIdx, idx);
          for (let j = start; j <= end; j++) state.selected.add(sorted[j].path);
        } else {
          state.selected.clear();
          state.selected.add(entry.path);
        }
        state.lastSelectedIdx = idx;
        renderFileTable();
      });

      // Double-click: open dir or preview file
      tr.addEventListener('dblclick', () => {
        if (entry.type === 'directory') {
          void navigate(entry.path);
        } else {
          state.previewFile = entry;
          renderFileTable();
        }
      });

      // Drag support
      tr.draggable = true;
      tr.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', entry.path);
        e.dataTransfer?.setData('application/x-luminal-file', JSON.stringify({
          path: entry.path, name: entry.name, size: entry.size, type: entry.type,
        }));
      });

      // Context menu
      tr.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!state.selected.has(entry.path)) {
          state.selected.clear();
          state.selected.add(entry.path);
          renderFileTable();
        }
        showContextMenu(e.clientX, e.clientY, [
          { label: 'Open', action: () => { if (entry.type === 'directory') void navigate(entry.path); else { state.previewFile = entry; renderFileTable(); } } },
          { label: 'Copy Path', action: () => void navigator.clipboard.writeText(entry.path) },
          { label: 'Send to Agent', action: () => sendToAgent(entry) },
          { label: 'Copy', action: () => copySelected() },
          { label: 'Rename', action: () => void renameSelected() },
          { label: 'Delete', action: () => void deleteSelected() },
        ]);
      });

      // Hover
      tr.addEventListener('mouseenter', () => { if (!state.selected.has(entry.path)) tr.style.background = 'rgba(255,255,255,0.04)'; });
      tr.addEventListener('mouseleave', () => { tr.style.background = state.selected.has(entry.path) ? 'var(--accent-dim, rgba(99,102,241,0.18))' : (sorted.indexOf(entry) % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)'); });

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.innerHTML = '';
    tableWrap.appendChild(table);
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  function sendToAgent(entry: FsEntry): void {
    document.dispatchEvent(new CustomEvent('file-browser:attach', {
      detail: { path: entry.path, name: entry.name },
    }));
  }

  async function newFile(): Promise<void> {
    const name = prompt('New file name:');
    if (!name) return;
    const path = state.currentPath === '.' ? name : `${state.currentPath}/${name}`;
    await fetch('/__admin_fs/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content: '' }) });
    await refreshFileList();
  }

  async function newFolder(): Promise<void> {
    const name = prompt('New folder name:');
    if (!name) return;
    const path = state.currentPath === '.' ? name : `${state.currentPath}/${name}`;
    await fetch('/__admin_fs/mkdir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
    await refreshFileList();
    void tree.load();
  }

  function copySelected(): void {
    if (state.selected.size === 0) return;
    state.clipboard = { paths: [...state.selected], op: 'copy' };
  }

  async function pasteClipboard(): Promise<void> {
    if (!state.clipboard) return;
    for (const src of state.clipboard.paths) {
      const name = src.split('/').pop() ?? src;
      const dest = state.currentPath === '.' ? name : `${state.currentPath}/${name}`;
      await fetch('/__admin_fs/copy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: src, destination: dest }) });
    }
    await refreshFileList();
  }

  async function renameSelected(): Promise<void> {
    const path = [...state.selected][0];
    if (!path) return;
    const oldName = path.split('/').pop() ?? path;
    const newName = prompt('Rename to:', oldName);
    if (!newName || newName === oldName) return;
    const dir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '.';
    const newPath = dir === '.' ? newName : `${dir}/${newName}`;
    await fetch('/__admin_fs/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oldPath: path, newPath }) });
    state.selected.clear();
    await refreshFileList();
    void tree.load();
  }

  async function deleteSelected(): Promise<void> {
    if (state.selected.size === 0) return;
    const names = [...state.selected].map(p => p.split('/').pop()).join(', ');
    if (!confirm(`Delete ${state.selected.size} item(s)?\n${names}`)) return;
    for (const path of state.selected) {
      await fetch('/__admin_fs/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
    }
    state.selected.clear();
    await refreshFileList();
    void tree.load();
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  void tree.load();
  void refreshFileList();
}
