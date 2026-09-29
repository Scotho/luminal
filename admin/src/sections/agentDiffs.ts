// admin/src/sections/agentDiffs.ts — Agent Diffs page
// Shows file changes made by agents: file tree (left) + shared diff renderer (right).

import { parseDiff, renderDiff } from '../ui/diffRenderer';
import { sessionManager } from '../ui/ccSessionManager';
import { createFileTree } from '../ui/fileTreeComponent';
import type { FileEntry } from '../ui/fileTreeComponent';
import type { CCSession } from '../types';

// ── File extraction helpers ────────────────────────────────────────────────────

const FILE_PATH_RE = /(?:^|\s)([\w./\\-]+\.(?:ts|tsx|js|jsx|json|css|html|md|py|sh|yml|yaml|env|txt|go|rs|c|cpp|h|lock|toml|config))/gm;

function extractFilePath(title: string, body: string): string | null {
  const titleMatch = /(?:Edit|Write|Read|Bash|bash)\s+([\S]+)/.exec(title);
  if (titleMatch) {
    const p = titleMatch[1].trim().replace(/['"]/g, '');
    if (p.includes('.') || p.includes('/')) return p;
  }
  FILE_PATH_RE.lastIndex = 0;
  const bodyMatch = FILE_PATH_RE.exec(body);
  if (bodyMatch) return bodyMatch[1].trim();
  return null;
}

function guessChangeType(title: string): 'new' | 'modified' | 'deleted' {
  const t = title.toLowerCase();
  if (t.includes('write') || t.includes('create')) return 'new';
  if (t.includes('delete') || t.includes('remove')) return 'deleted';
  return 'modified';
}

function buildFileList(sessions: CCSession[], filterSessionId: string | null): FileEntry[] {
  const seen = new Map<string, FileEntry>();

  for (const session of sessions) {
    if (filterSessionId && session.id !== filterSessionId) continue;

    for (const card of session.cards) {
      if (card.type !== 'tool') continue;
      const t = card.title;
      if (!/edit|write/i.test(t)) continue;

      const path = extractFilePath(t, card.body);
      if (!path) continue;

      const key = `${session.id}::${path}`;
      if (!seen.has(key)) {
        seen.set(key, {
          path,
          sessionId: session.id,
          sessionLabel: session.label,
          changeType: guessChangeType(t),
          changeCount: 1,
        });
      } else {
        seen.get(key)!.changeCount++;
      }
    }
  }

  return Array.from(seen.values());
}

// ── Diff fetching ──────────────────────────────────────────────────────────────

async function fetchDiff(filePath: string): Promise<string> {
  try {
    const res = await fetch(`/__admin_exec/diff?file=${encodeURIComponent(filePath)}`);
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

// ── Top bar ────────────────────────────────────────────────────────────────────

function buildTopBar(
  sessions: CCSession[],
  viewMode: { value: 'unified' | 'split' },
  filterSessionId: { value: string | null },
  onFilterChange: () => void,
  onModeChange: () => void,
): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'agent-diffs-topbar';
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0;';

  const label = document.createElement('label');
  label.style.cssText = 'font-size:11px;color:var(--text-dim);margin-right:4px;';
  label.textContent = 'Session:';

  const select = document.createElement('select');
  select.className = 'agent-diffs-session-select';
  select.style.cssText = 'font-size:11px;padding:2px 6px;border:1px solid var(--border);border-radius:3px;background:var(--bg-panel);color:var(--text-primary);';

  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = 'All Sessions';
  select.appendChild(allOpt);

  for (const s of sessions) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.label.length > 32 ? s.label.slice(0, 32) + '…' : s.label;
    if (s.id === filterSessionId.value) opt.selected = true;
    select.appendChild(opt);
  }

  select.addEventListener('change', () => {
    filterSessionId.value = select.value || null;
    onFilterChange();
  });

  const spacer = document.createElement('span');
  spacer.style.flex = '1';

  const modeGroup = document.createElement('div');
  modeGroup.style.cssText = 'display:flex;gap:2px;';

  const unifiedBtn = document.createElement('button');
  unifiedBtn.className = 'agent-diffs-mode-btn';
  unifiedBtn.textContent = 'Unified';
  unifiedBtn.dataset['mode'] = 'unified';
  unifiedBtn.style.cssText = 'font-size:10px;padding:2px 8px;border:1px solid var(--border);cursor:pointer;border-radius:3px 0 0 3px;';
  if (viewMode.value === 'unified') unifiedBtn.style.background = 'var(--accent)';

  const splitBtn = document.createElement('button');
  splitBtn.className = 'agent-diffs-mode-btn';
  splitBtn.textContent = 'Split';
  splitBtn.dataset['mode'] = 'split';
  splitBtn.style.cssText = 'font-size:10px;padding:2px 8px;border:1px solid var(--border);border-left:none;cursor:pointer;border-radius:0 3px 3px 0;';
  if (viewMode.value === 'split') splitBtn.style.background = 'var(--accent)';

  unifiedBtn.addEventListener('click', () => {
    viewMode.value = 'unified';
    unifiedBtn.style.background = 'var(--accent)';
    splitBtn.style.background = '';
    onModeChange();
  });

  splitBtn.addEventListener('click', () => {
    viewMode.value = 'split';
    splitBtn.style.background = 'var(--accent)';
    unifiedBtn.style.background = '';
    onModeChange();
  });

  modeGroup.appendChild(unifiedBtn);
  modeGroup.appendChild(splitBtn);

  bar.appendChild(label);
  bar.appendChild(select);
  bar.appendChild(spacer);
  bar.appendChild(modeGroup);

  return bar;
}

// ── Viewer panel ───────────────────────────────────────────────────────────────

function buildViewer(): { viewer: HTMLElement; pathBar: HTMLElement; content: HTMLElement } {
  const viewer = document.createElement('div');
  viewer.className = 'agent-diffs-viewer';
  viewer.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';

  const pathBar = document.createElement('div');
  pathBar.style.cssText = [
    'padding:6px 12px;',
    'font-size:11px;font-family:var(--font-mono,monospace);',
    'color:var(--text-dim);',
    'border-bottom:1px solid var(--border);',
    'flex-shrink:0;',
    'min-height:28px;',
  ].join('');
  pathBar.textContent = '';

  const content = document.createElement('div');
  content.style.cssText = 'flex:1;overflow:auto;padding:0;';

  const emptyState = document.createElement('div');
  emptyState.className = 'agent-diffs-empty';
  emptyState.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;font-size:13px;color:var(--text-dim);';
  emptyState.textContent = 'Select a file to view changes';
  content.appendChild(emptyState);

  viewer.appendChild(pathBar);
  viewer.appendChild(content);

  return { viewer, pathBar, content };
}

// ── Main init ──────────────────────────────────────────────────────────────────

export function initAgentDiffs(): void {
  const section = document.getElementById('section-agent-diffs');
  if (!section) return;

  const viewMode: { value: 'unified' | 'split' } = { value: 'unified' };
  const filterSessionId: { value: string | null } = { value: null };
  let currentEntry: FileEntry | null = null;

  section.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

  const sessions = sessionManager.getAllSessions();
  const files = buildFileList(sessions, filterSessionId.value);

  const topBar = buildTopBar(
    sessions,
    viewMode,
    filterSessionId,
    () => rebuildTree(),
    () => reRenderDiff(),
  );
  section.appendChild(topBar);

  const panels = document.createElement('div');
  panels.style.cssText = 'display:flex;flex:1;overflow:hidden;';
  section.appendChild(panels);

  const { viewer, pathBar, content } = buildViewer();
  panels.appendChild(viewer);

  async function onFileSelect(entry: FileEntry): Promise<void> {
    currentEntry = entry;
    pathBar.textContent = entry.path;
    content.innerHTML = '<div style="padding:16px;font-size:11px;color:var(--text-dim);">Loading diff…</div>';

    const diffText = await fetchDiff(entry.path);
    const hunks = parseDiff(diffText);
    renderDiff(hunks, content, { mode: viewMode.value });
  }

  async function reRenderDiff(): Promise<void> {
    if (!currentEntry) return;
    await onFileSelect(currentEntry);
  }

  function rebuildTree(): void {
    const existing = panels.querySelector('.agent-diffs-tree');
    if (existing) panels.removeChild(existing);

    const updatedSessions = sessionManager.getAllSessions();
    const updatedFiles = buildFileList(updatedSessions, filterSessionId.value);
    const { el } = createFileTree({
      sessions: updatedSessions,
      files: updatedFiles,
      filterSessionId: filterSessionId.value,
      onFileSelect,
    });
    panels.insertBefore(el, viewer);
  }

  const { el: treeEl } = createFileTree({
    sessions,
    files,
    filterSessionId: filterSessionId.value,
    onFileSelect,
  });
  panels.insertBefore(treeEl, viewer);

  sessionManager.onChange(() => {
    const newSessions = sessionManager.getAllSessions();
    const select = topBar.querySelector<HTMLSelectElement>('.agent-diffs-session-select');
    if (select) {
      while (select.options.length > 1) select.remove(1);
      for (const s of newSessions) {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.label.length > 32 ? s.label.slice(0, 32) + '…' : s.label;
        if (s.id === filterSessionId.value) opt.selected = true;
        select.appendChild(opt);
      }
    }
    rebuildTree();
  });
}
