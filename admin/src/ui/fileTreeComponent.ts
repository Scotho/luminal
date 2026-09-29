// admin/src/ui/fileTreeComponent.ts — Reusable file tree component
// Extracted from agentDiffs.ts. Handles session grouping, file entries,
// collapsible headers, and click-to-select behaviour.

import type { CCSession } from '../types';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FileEntry {
  path: string;
  sessionId: string;
  sessionLabel: string;
  changeType: 'new' | 'modified' | 'deleted';
  changeCount: number;
}

export interface FileTreeOptions {
  sessions: CCSession[];
  files: FileEntry[];
  filterSessionId: string | null;
  onFileSelect: (entry: FileEntry) => void;
}

export interface FileTreeController {
  /** Root element — insert into your layout. */
  el: HTMLElement;
  /** Highlight the given entry as selected (deselects others). */
  setSelected(entry: FileEntry | null): void;
}

// ── Private helpers ────────────────────────────────────────────────────────────

function basename(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

function changeIcon(changeType: 'new' | 'modified' | 'deleted'): string {
  if (changeType === 'new') {
    return '<span style="color:var(--green);font-size:11px;font-weight:700;" title="New file">+</span>';
  }
  if (changeType === 'deleted') {
    return '<span style="color:var(--red,#f55);font-size:11px;font-weight:700;" title="Deleted">-</span>';
  }
  return '<span style="color:var(--orange,#e8a449);font-size:11px;font-weight:700;" title="Modified">~</span>';
}

// ── File entry row builder ─────────────────────────────────────────────────────

function buildFileRow(
  entry: FileEntry,
  tree: HTMLElement,
  onFileSelect: (entry: FileEntry) => void,
): HTMLElement {
  const fileRow = document.createElement('div');
  fileRow.className = 'diffs-file-entry';
  fileRow.dataset['path'] = entry.path;
  fileRow.dataset['sessionId'] = entry.sessionId;
  fileRow.style.cssText = [
    'display:flex;align-items:center;gap:6px;',
    'padding:5px 12px 5px 24px;cursor:pointer;',
    'font-size:11px;',
    'border-bottom:1px solid transparent;',
  ].join('');
  fileRow.title = entry.path;

  const iconSpan = document.createElement('span');
  iconSpan.innerHTML = changeIcon(entry.changeType);

  const nameSpan = document.createElement('span');
  nameSpan.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary);';
  nameSpan.textContent = basename(entry.path);

  const badge = document.createElement('span');
  badge.style.cssText = 'font-size:9px;padding:1px 5px;border-radius:8px;background:var(--bg-hover,rgba(255,255,255,0.08));color:var(--text-dim);flex-shrink:0;';
  badge.textContent = String(entry.changeCount);

  fileRow.appendChild(iconSpan);
  fileRow.appendChild(nameSpan);
  fileRow.appendChild(badge);

  fileRow.addEventListener('mouseenter', () => {
    fileRow.style.background = 'var(--bg-hover,rgba(255,255,255,0.06))';
  });
  fileRow.addEventListener('mouseleave', () => {
    fileRow.style.background = '';
  });

  fileRow.addEventListener('click', () => {
    // Deselect all
    tree.querySelectorAll<HTMLElement>('.diffs-file-entry').forEach(el => {
      el.style.background = '';
      el.style.borderColor = 'transparent';
    });
    fileRow.style.background = 'var(--bg-selected,rgba(100,210,255,0.08))';
    fileRow.style.borderColor = 'var(--accent,#64d2ff)';
    onFileSelect(entry);
  });

  return fileRow;
}

// ── Session group builder ──────────────────────────────────────────────────────

function buildSessionGroup(
  session: CCSession,
  sessionFiles: FileEntry[],
  tree: HTMLElement,
  onFileSelect: (entry: FileEntry) => void,
): void {
  // Session header (collapsible)
  const sessionHeader = document.createElement('div');
  sessionHeader.className = 'diffs-session-header';
  sessionHeader.style.cssText = [
    'display:flex;align-items:center;gap:6px;',
    'padding:6px 12px;cursor:pointer;',
    'font-size:11px;font-weight:600;',
    'color:var(--text-primary);',
    'background:var(--bg-hover,rgba(255,255,255,0.04));',
    'border-bottom:1px solid var(--border);',
    'user-select:none;',
  ].join('');

  let collapsed = false;
  const chevron = document.createElement('span');
  chevron.textContent = '▾';
  chevron.style.cssText = 'font-size:9px;transition:transform 0.15s;';

  const sessionName = document.createElement('span');
  sessionName.style.overflow = 'hidden';
  sessionName.style.textOverflow = 'ellipsis';
  sessionName.style.whiteSpace = 'nowrap';
  sessionName.title = session.label;
  sessionName.textContent = session.label.length > 28 ? session.label.slice(0, 28) + '…' : session.label;

  sessionHeader.appendChild(chevron);
  sessionHeader.appendChild(sessionName);
  tree.appendChild(sessionHeader);

  // File entries container
  const fileList = document.createElement('div');
  fileList.className = 'diffs-file-list';

  if (sessionFiles.length === 0) {
    const noFiles = document.createElement('div');
    noFiles.style.cssText = 'padding:8px 20px;font-size:10px;color:var(--text-dim);';
    noFiles.textContent = 'No file changes';
    fileList.appendChild(noFiles);
  } else {
    for (const entry of sessionFiles) {
      fileList.appendChild(buildFileRow(entry, tree, onFileSelect));
    }
  }

  tree.appendChild(fileList);

  // Toggle collapse
  sessionHeader.addEventListener('click', () => {
    collapsed = !collapsed;
    fileList.style.display = collapsed ? 'none' : '';
    chevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
  });
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Create a file tree widget.
 * Returns a controller whose `.el` you insert into your layout.
 */
export function createFileTree(options: FileTreeOptions): FileTreeController {
  const { sessions, files, filterSessionId, onFileSelect } = options;

  const tree = document.createElement('div');
  tree.className = 'agent-diffs-tree';
  tree.style.cssText = 'width:30%;min-width:180px;max-width:320px;border-right:1px solid var(--border);overflow-y:auto;flex-shrink:0;';

  const header = document.createElement('div');
  header.style.cssText = 'padding:8px 12px;font-size:10px;font-family:var(--font-display);font-weight:700;letter-spacing:1.5px;color:var(--text-heading);border-bottom:1px solid var(--border);';
  header.textContent = 'CHANGED FILES';
  tree.appendChild(header);

  // Determine which sessions to show
  const sessionIds = filterSessionId
    ? sessions.filter(s => s.id === filterSessionId).map(s => s.id)
    : sessions.map(s => s.id);

  if (sessionIds.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:16px 12px;font-size:11px;color:var(--text-dim);';
    empty.textContent = 'No sessions found';
    tree.appendChild(empty);
  } else {
    for (const sessionId of sessionIds) {
      const session = sessions.find(s => s.id === sessionId);
      if (!session) continue;
      const sessionFiles = files.filter(f => f.sessionId === sessionId);
      buildSessionGroup(session, sessionFiles, tree, onFileSelect);
    }
  }

  const controller: FileTreeController = {
    el: tree,
    setSelected(entry: FileEntry | null): void {
      tree.querySelectorAll<HTMLElement>('.diffs-file-entry').forEach(el => {
        el.style.background = '';
        el.style.borderColor = 'transparent';
      });
      if (!entry) return;
      const row = tree.querySelector<HTMLElement>(
        `.diffs-file-entry[data-path="${CSS.escape(entry.path)}"][data-session-id="${CSS.escape(entry.sessionId)}"]`,
      );
      if (row) {
        row.style.background = 'var(--bg-selected,rgba(100,210,255,0.08))';
        row.style.borderColor = 'var(--accent,#64d2ff)';
      }
    },
  };

  return controller;
}
