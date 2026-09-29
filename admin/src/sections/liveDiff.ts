// admin/src/sections/liveDiff.ts — TASK-46 Live Diff Preview
// Real-time file diff viewer that polls active CC sessions for Edit/Write tool cards.

import { parseDiff, renderDiff } from '../ui/diffRenderer';
import { sessionManager } from '../ui/ccSessionManager';
import { createFileTree } from '../ui/fileTreeComponent';
import type { FileEntry } from '../ui/fileTreeComponent';
import type { CCSession } from '../types';

// ── File extraction helpers ──────────────────────────────────────────────────

const FILE_PATH_RE = /(?:Edit|Write)\s+([\S]+)/;

function extractFilePath(title: string): string | null {
  const match = FILE_PATH_RE.exec(title);
  if (!match) return null;
  const p = match[1].trim().replace(/['"]/g, '');
  return (p.includes('.') || p.includes('/')) ? p : null;
}

function guessChangeType(title: string): 'new' | 'modified' | 'deleted' {
  const t = title.toLowerCase();
  if (t.includes('write') || t.includes('create')) return 'new';
  if (t.includes('delete') || t.includes('remove')) return 'deleted';
  return 'modified';
}

function buildFileList(sessions: CCSession[]): FileEntry[] {
  const seen = new Map<string, FileEntry>();

  for (const session of sessions) {
    for (const card of session.cards) {
      if (card.type !== 'tool') continue;
      if (!/edit|write/i.test(card.title)) continue;

      const path = extractFilePath(card.title);
      if (!path) continue;

      const key = `${session.id}::${path}`;
      if (!seen.has(key)) {
        seen.set(key, {
          path,
          sessionId: session.id,
          sessionLabel: session.label,
          changeType: guessChangeType(card.title),
          changeCount: 1,
        });
      } else {
        seen.get(key)!.changeCount++;
      }
    }
  }

  return Array.from(seen.values());
}

// ── Diff content extraction ──────────────────────────────────────────────────

function extractDiffContent(sessions: CCSession[], entry: FileEntry): string {
  const session = sessions.find(s => s.id === entry.sessionId);
  if (!session) return '';

  // Find the last Edit/Write card for this path
  let lastBody = '';
  for (const card of session.cards) {
    if (card.type !== 'tool') continue;
    if (!/edit|write/i.test(card.title)) continue;
    const path = extractFilePath(card.title);
    if (path === entry.path) {
      lastBody = card.body;
    }
  }

  return lastBody;
}

// ── Fetch diff from server (fallback) ────────────────────────────────────────

async function fetchDiff(filePath: string): Promise<string> {
  try {
    const res = await fetch(`/__admin_exec/diff?file=${encodeURIComponent(filePath)}`);
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

// ── Header bar ───────────────────────────────────────────────────────────────

function buildHeader(
  viewMode: { value: 'unified' | 'split' },
  onModeChange: () => void,
): HTMLElement {
  const bar = document.createElement('div');
  bar.style.cssText = [
    'display:flex;align-items:center;gap:12px;',
    'padding:10px 16px;',
    'border-bottom:1px solid var(--border);',
    'flex-shrink:0;',
  ].join('');

  const title = document.createElement('span');
  title.style.cssText = 'font-size:13px;font-weight:700;color:var(--text-primary);letter-spacing:0.5px;';
  title.textContent = 'Live Diff Preview';

  const dot = document.createElement('span');
  dot.className = 'live-diff-pulse';
  dot.style.cssText = [
    'width:6px;height:6px;border-radius:50%;',
    'background:var(--green,#34d058);',
    'display:inline-block;',
    'animation:live-diff-pulse 2s ease-in-out infinite;',
  ].join('');

  const spacer = document.createElement('span');
  spacer.style.flex = '1';

  const modeGroup = document.createElement('div');
  modeGroup.style.cssText = 'display:flex;gap:0;';

  const unifiedBtn = document.createElement('button');
  unifiedBtn.textContent = 'Unified';
  unifiedBtn.style.cssText = [
    'font-size:10px;padding:3px 10px;',
    'border:1px solid var(--border);cursor:pointer;',
    'border-radius:3px 0 0 3px;',
    'color:var(--text-primary);',
    'background:', viewMode.value === 'unified' ? 'var(--accent)' : 'transparent', ';',
  ].join('');

  const splitBtn = document.createElement('button');
  splitBtn.textContent = 'Side-by-Side';
  splitBtn.style.cssText = [
    'font-size:10px;padding:3px 10px;',
    'border:1px solid var(--border);border-left:none;cursor:pointer;',
    'border-radius:0 3px 3px 0;',
    'color:var(--text-primary);',
    'background:', viewMode.value === 'split' ? 'var(--accent)' : 'transparent', ';',
  ].join('');

  unifiedBtn.addEventListener('click', () => {
    viewMode.value = 'unified';
    unifiedBtn.style.background = 'var(--accent)';
    splitBtn.style.background = 'transparent';
    onModeChange();
  });

  splitBtn.addEventListener('click', () => {
    viewMode.value = 'split';
    splitBtn.style.background = 'var(--accent)';
    unifiedBtn.style.background = 'transparent';
    onModeChange();
  });

  modeGroup.appendChild(unifiedBtn);
  modeGroup.appendChild(splitBtn);

  bar.appendChild(title);
  bar.appendChild(dot);
  bar.appendChild(spacer);
  bar.appendChild(modeGroup);

  return bar;
}

// ── Viewer panel ─────────────────────────────────────────────────────────────

function buildViewer(): { viewer: HTMLElement; pathBar: HTMLElement; content: HTMLElement } {
  const viewer = document.createElement('div');
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

  const content = document.createElement('div');
  content.style.cssText = 'flex:1;overflow:auto;padding:0;';

  const emptyState = document.createElement('div');
  emptyState.style.cssText = [
    'display:flex;align-items:center;justify-content:center;',
    'height:100%;font-size:13px;color:var(--text-dim);',
    'flex-direction:column;gap:8px;',
  ].join('');
  emptyState.innerHTML = '<span style="font-size:24px;opacity:0.3;">&#x2194;</span>Select a file to view changes';
  content.appendChild(emptyState);

  viewer.appendChild(pathBar);
  viewer.appendChild(content);

  return { viewer, pathBar, content };
}

// ── Status indicator ─────────────────────────────────────────────────────────

function buildStatusBar(container: HTMLElement): HTMLElement {
  const status = document.createElement('div');
  status.style.cssText = [
    'padding:4px 12px;',
    'font-size:10px;color:var(--text-dim);',
    'border-top:1px solid var(--border);',
    'flex-shrink:0;',
    'display:flex;align-items:center;gap:8px;',
  ].join('');
  container.appendChild(status);
  return status;
}

// ── Pulse animation ──────────────────────────────────────────────────────────

function injectPulseAnimation(): void {
  if (document.getElementById('live-diff-pulse-style')) return;
  const style = document.createElement('style');
  style.id = 'live-diff-pulse-style';
  style.textContent = `
    @keyframes live-diff-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
  `;
  document.head.appendChild(style);
}

// ── Main init ────────────────────────────────────────────────────────────────

export function initLiveDiff(container: HTMLElement): () => void {
  container.innerHTML = '';
  container.classList.add('section--live-diff');

  injectPulseAnimation();

  const viewMode: { value: 'unified' | 'split' } = { value: 'unified' };
  let currentEntry: FileEntry | null = null;
  let treeEl: HTMLElement | null = null;

  // Header
  const header = buildHeader(viewMode, () => reRenderDiff());
  container.appendChild(header);

  // Two-pane layout
  const panels = document.createElement('div');
  panels.style.cssText = 'display:flex;flex:1;overflow:hidden;';
  container.appendChild(panels);

  // Viewer
  const { viewer, pathBar, content } = buildViewer();

  // Status bar
  const statusBar = buildStatusBar(container);

  function getActiveSessions(): CCSession[] {
    return sessionManager.getAllSessions().filter(s => s.status === 'running');
  }

  function getAllSessionsWithEdits(): CCSession[] {
    return sessionManager.getAllSessions().filter(s =>
      s.cards.some(c => c.type === 'tool' && /edit|write/i.test(c.title)),
    );
  }

  async function onFileSelect(entry: FileEntry): Promise<void> {
    currentEntry = entry;
    pathBar.textContent = entry.path;
    content.innerHTML = '<div style="padding:16px;font-size:11px;color:var(--text-dim);">Loading diff...</div>';

    // Try extracting diff from card body first
    const sessions = getAllSessionsWithEdits();
    const cardDiff = extractDiffContent(sessions, entry);

    const diffText = (cardDiff && (cardDiff.includes('@@') || cardDiff.includes('---')))
      ? cardDiff
      : await fetchDiff(entry.path);

    if (!diffText.trim()) {
      content.innerHTML = '<div style="padding:16px;font-size:11px;color:var(--text-dim);">No diff available for this file</div>';
      return;
    }

    const hunks = parseDiff(diffText);
    renderDiff(hunks, content, { mode: viewMode.value });
  }

  async function reRenderDiff(): Promise<void> {
    if (!currentEntry) return;
    await onFileSelect(currentEntry);
  }

  function rebuildTree(): void {
    if (treeEl) panels.removeChild(treeEl);

    const sessions = getAllSessionsWithEdits();
    const files = buildFileList(sessions);
    const activeSessions = getActiveSessions();

    // Update status bar
    const fileCount = files.length;
    const sessionCount = activeSessions.length;
    statusBar.innerHTML = sessionCount > 0
      ? `<span style="color:var(--green);">\u25CF</span> ${sessionCount} active session${sessionCount !== 1 ? 's' : ''} \u00B7 ${fileCount} file${fileCount !== 1 ? 's' : ''} changed`
      : `<span style="color:var(--text-dim);">\u25CB</span> No active sessions \u00B7 ${fileCount} file${fileCount !== 1 ? 's' : ''} from recent sessions`;

    const treeController = createFileTree({
      sessions,
      files,
      filterSessionId: null,
      onFileSelect,
    });

    // Override tree width for our layout
    treeController.el.style.cssText = [
      'width:260px;min-width:200px;max-width:360px;',
      'border-right:1px solid var(--border);',
      'overflow-y:auto;flex-shrink:0;',
    ].join('');

    treeEl = treeController.el;
    panels.insertBefore(treeEl, viewer);

    // Re-select current file if still present
    if (currentEntry) {
      const stillExists = files.some(
        f => f.path === currentEntry!.path && f.sessionId === currentEntry!.sessionId,
      );
      if (stillExists) {
        treeController.setSelected(currentEntry);
      } else {
        currentEntry = null;
        pathBar.textContent = '';
        content.innerHTML = '';
        const empty = document.createElement('div');
        empty.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;font-size:13px;color:var(--text-dim);';
        empty.textContent = 'Select a file to view changes';
        content.appendChild(empty);
      }
    }
  }

  // Initial build
  panels.appendChild(viewer);
  rebuildTree();

  // Poll every 2s for changes while agents are running
  const interval = setInterval(() => {
    rebuildTree();
    // Auto-refresh current diff if an agent is still running
    if (currentEntry && getActiveSessions().length > 0) {
      void reRenderDiff();
    }
  }, 2000);

  // Also listen for session manager changes
  const unsubscribe = sessionManager.onChange(() => {
    rebuildTree();
  });

  return () => {
    clearInterval(interval);
    unsubscribe();
    container.classList.remove('section--live-diff');
    container.innerHTML = '';
  };
}
