// ── File Browser: Directory Tree (Left Pane) ──────────────────────────────────

export interface FsEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  mtime: number;
  extension: string;
}

interface TreeNode {
  entry: FsEntry;
  children: TreeNode[] | null; // null = not loaded yet
  expanded: boolean;
  el: HTMLElement | null;
}

const FILE_ICONS: Record<string, string> = {
  '.ts': 'TS', '.tsx': 'TX', '.js': 'JS', '.jsx': 'JX',
  '.json': 'JS', '.html': 'HT', '.css': 'CS', '.scss': 'SC',
  '.md': 'MD', '.txt': 'TX', '.yml': 'YM', '.yaml': 'YM',
  '.png': 'IM', '.jpg': 'IM', '.jpeg': 'IM', '.gif': 'IM', '.svg': 'SV',
  '.sh': 'SH', '.bat': 'BT', '.env': 'EN', '.lock': 'LK',
};

function fileIcon(ext: string): string {
  const label = FILE_ICONS[ext.toLowerCase()] ?? 'FL';
  const color = ext === '.ts' || ext === '.tsx' ? '#3178c6'
    : ext === '.js' || ext === '.jsx' ? '#f7df1e'
    : ext === '.json' ? '#6d8086'
    : ext === '.html' ? '#e34c26'
    : ext === '.css' || ext === '.scss' ? '#264de4'
    : ext === '.md' ? '#519aba'
    : 'var(--text-dim)';
  return `<span style="display:inline-block;width:18px;height:14px;font-size:8px;font-weight:700;font-family:var(--font-mono);color:${color};text-align:center;line-height:14px;border:1px solid ${color};border-radius:2px;flex-shrink:0;">${label}</span>`;
}

function dirIcon(expanded: boolean): string {
  const color = expanded ? 'var(--gold, #c8a84e)' : 'var(--text-dim)';
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:14px;font-size:10px;color:${color};flex-shrink:0;">${expanded ? '&#9660;' : '&#9654;'}</span>`;
}

async function fetchEntries(dirPath: string): Promise<FsEntry[]> {
  const res = await fetch(`/__admin_fs/list?path=${encodeURIComponent(dirPath)}`);
  if (!res.ok) throw new Error(`Failed to list ${dirPath}`);
  return (await res.json()) as FsEntry[];
}

export type TreeNavigateCallback = (dirPath: string) => void;

export class DirectoryTree {
  private root: TreeNode[] = [];
  private container: HTMLElement;
  private onNavigate: TreeNavigateCallback;
  private currentPath = '.';

  constructor(container: HTMLElement, onNavigate: TreeNavigateCallback) {
    this.container = container;
    this.onNavigate = onNavigate;
    this.container.style.cssText = 'width:250px;min-width:180px;overflow-y:auto;overflow-x:hidden;border-right:1px solid var(--border);padding:6px 0;font-size:12px;font-family:var(--font-mono);';
  }

  async load(): Promise<void> {
    const entries = await fetchEntries('.');
    this.root = entries
      .filter(e => e.type === 'directory')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(e => ({ entry: e, children: null, expanded: false, el: null }));
    this.render();
  }

  highlight(dirPath: string): void {
    this.currentPath = dirPath;
    this.container.querySelectorAll<HTMLElement>('.tree-row').forEach(el => {
      const isActive = el.dataset.path === dirPath;
      el.style.background = isActive ? 'var(--accent-dim, rgba(99,102,241,0.15))' : '';
      el.style.color = isActive ? 'var(--accent)' : '';
    });
  }

  private render(): void {
    this.container.innerHTML = '';
    // Add root entry
    const rootRow = this.createRow('.', '[ root ]', 0, true, true);
    this.container.appendChild(rootRow);
    for (const node of this.root) {
      this.renderNode(node, 1);
    }
    this.highlight(this.currentPath);
  }

  private renderNode(node: TreeNode, depth: number): void {
    const row = this.createRow(node.entry.path, node.entry.name, depth, true, node.expanded);
    node.el = row;
    this.container.appendChild(row);

    row.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!node.expanded) {
        await this.expandNode(node, depth);
      } else {
        this.collapseNode(node);
      }
    });

    row.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.onNavigate(node.entry.path);
    });

    // Single click also navigates to show contents
    row.addEventListener('click', () => {
      this.onNavigate(node.entry.path);
    });

    if (node.expanded && node.children) {
      for (const child of node.children) {
        this.renderNode(child, depth + 1);
      }
    }
  }

  private async expandNode(node: TreeNode, _depth: number): Promise<void> {
    if (!node.children) {
      try {
        const entries = await fetchEntries(node.entry.path);
        node.children = entries
          .filter(e => e.type === 'directory')
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(e => ({ entry: e, children: null, expanded: false, el: null }));
      } catch {
        node.children = [];
      }
    }
    node.expanded = true;
    this.render();
    this.highlight(this.currentPath);
  }

  private collapseNode(node: TreeNode): void {
    node.expanded = false;
    this.render();
    this.highlight(this.currentPath);
  }

  private createRow(path: string, label: string, depth: number, isDir: boolean, expanded: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.dataset.path = path;
    const indent = depth * 16;
    row.style.cssText = `display:flex;align-items:center;gap:4px;padding:3px 8px 3px ${indent + 8}px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-radius:3px;transition:background 0.1s;`;
    row.innerHTML = `${isDir ? dirIcon(expanded) : fileIcon('')}<span style="overflow:hidden;text-overflow:ellipsis;">${escapeText(label)}</span>`;

    row.addEventListener('mouseenter', () => {
      if (row.dataset.path !== this.currentPath) {
        row.style.background = 'var(--surface-hover, rgba(255,255,255,0.04))';
      }
    });
    row.addEventListener('mouseleave', () => {
      if (row.dataset.path !== this.currentPath) {
        row.style.background = '';
      }
    });
    return row;
  }
}

function escapeText(text: string): string {
  const el = document.createElement('span');
  el.textContent = text;
  return el.innerHTML;
}

// ── Breadcrumb ─────────────────────────────────────────────────────────────

function renderBreadcrumb(path: string, onNavigate: (p: string) => void): HTMLElement {
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;gap:2px;font-family:var(--font-mono);font-size:12px;overflow-x:auto;white-space:nowrap;flex:1;';
  const parts = path === '.' ? [] : path.replace(/\\/g, '/').split('/').filter(Boolean);
  const mkBtn = (label: string, cb: () => void) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = 'background:transparent;border:none;color:var(--accent);cursor:pointer;font-family:var(--font-mono);font-size:12px;padding:2px 4px;border-radius:3px;';
    btn.addEventListener('click', cb);
    btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--surface)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
    return btn;
  };
  bar.appendChild(mkBtn('root', () => onNavigate('.')));
  let accumulated = '';
  for (const part of parts) {
    accumulated += (accumulated ? '/' : '') + part;
    const sep = document.createElement('span');
    sep.textContent = ' / ';
    sep.style.color = 'var(--text-dim)';
    bar.appendChild(sep);
    const segPath = accumulated;
    bar.appendChild(mkBtn(part, () => onNavigate(segPath)));
  }
  return bar;
}

// ── Context Menu ───────────────────────────────────────────────────────────

export interface ContextMenuItem { label: string; action: () => void }

function showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.id = 'fb-context-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--surface);border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.4);padding:4px 0;z-index:9999;min-width:160px;font-size:12px;`;
  for (const item of items) {
    const row = document.createElement('div');
    row.textContent = item.label;
    row.style.cssText = 'padding:6px 14px;cursor:pointer;color:var(--text);transition:background 0.1s;';
    row.addEventListener('mouseenter', () => { row.style.background = 'var(--accent-dim, rgba(99,102,241,0.15))'; });
    row.addEventListener('mouseleave', () => { row.style.background = ''; });
    row.addEventListener('click', () => { closeContextMenu(); item.action(); });
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  const dismiss = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) { closeContextMenu(); document.removeEventListener('mousedown', dismiss); }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

function closeContextMenu(): void {
  document.getElementById('fb-context-menu')?.remove();
}

export { fetchEntries, fileIcon, escapeText, renderBreadcrumb, showContextMenu };
