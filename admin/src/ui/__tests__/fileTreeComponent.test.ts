// admin/src/ui/__tests__/fileTreeComponent.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createFileTree } from '../fileTreeComponent';
import type { FileEntry, FileTreeOptions } from '../fileTreeComponent';
import type { CCSession } from '../../types';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeSession(id: string, label: string): CCSession {
  return {
    id,
    label,
    status: 'done',
    startedAt: Date.now(),
    duration: 1000,
    cards: [],
    result: null,
    usage: null,
    exitCode: 0,
    prompt: null,
    backend: 'cc',
    agentIds: [],
    lastAgentId: null,
  };
}

function makeEntry(path: string, sessionId: string, sessionLabel: string): FileEntry {
  return {
    path,
    sessionId,
    sessionLabel,
    changeType: 'modified',
    changeCount: 1,
  };
}

function makeOptions(overrides: Partial<FileTreeOptions> = {}): FileTreeOptions {
  return {
    sessions: [],
    files: [],
    filterSessionId: null,
    onFileSelect: vi.fn(),
    ...overrides,
  };
}

// ── Tests: renders ─────────────────────────────────────────────────────────────

describe('createFileTree', () => {
  it('returns an element with class agent-diffs-tree', () => {
    const { el } = createFileTree(makeOptions());
    expect(el.classList.contains('agent-diffs-tree')).toBe(true);
  });

  it('shows CHANGED FILES header', () => {
    const { el } = createFileTree(makeOptions());
    expect(el.textContent).toContain('CHANGED FILES');
  });

  it('shows "No sessions found" when sessions array is empty', () => {
    const { el } = createFileTree(makeOptions({ sessions: [] }));
    expect(el.textContent).toContain('No sessions found');
  });

  it('renders a session header for each session', () => {
    const sessions = [makeSession('s1', 'Alpha'), makeSession('s2', 'Beta')];
    const { el } = createFileTree(makeOptions({ sessions }));
    const headers = el.querySelectorAll('.diffs-session-header');
    expect(headers.length).toBe(2);
    expect(el.textContent).toContain('Alpha');
    expect(el.textContent).toContain('Beta');
  });

  it('renders "No file changes" when session has no matching files', () => {
    const sessions = [makeSession('s1', 'Empty')];
    const { el } = createFileTree(makeOptions({ sessions, files: [] }));
    expect(el.textContent).toContain('No file changes');
  });

  it('renders file entries for matching files', () => {
    const sessions = [makeSession('s1', 'Session A')];
    const files = [
      makeEntry('src/foo.ts', 's1', 'Session A'),
      makeEntry('src/bar.ts', 's1', 'Session A'),
    ];
    const { el } = createFileTree(makeOptions({ sessions, files }));
    const entries = el.querySelectorAll('.diffs-file-entry');
    expect(entries.length).toBe(2);
  });

  it('displays file basenames (not full paths) in entries', () => {
    const sessions = [makeSession('s1', 'S')];
    const files = [makeEntry('admin/src/sections/myFile.ts', 's1', 'S')];
    const { el } = createFileTree(makeOptions({ sessions, files }));
    expect(el.textContent).toContain('myFile.ts');
  });

  it('filters to a single session when filterSessionId is set', () => {
    const sessions = [makeSession('s1', 'Alpha'), makeSession('s2', 'Beta')];
    const { el } = createFileTree(makeOptions({ sessions, filterSessionId: 's1' }));
    const headers = el.querySelectorAll('.diffs-session-header');
    expect(headers.length).toBe(1);
    expect(el.textContent).toContain('Alpha');
    expect(el.textContent).not.toContain('Beta');
  });

  // ── Click selects file ─────────────────────────────────────────────────────

  it('calls onFileSelect when a file entry is clicked', () => {
    const onFileSelect = vi.fn();
    const sessions = [makeSession('s1', 'S')];
    const entry = makeEntry('src/game.ts', 's1', 'S');
    const { el } = createFileTree(makeOptions({ sessions, files: [entry], onFileSelect }));

    const row = el.querySelector<HTMLElement>('.diffs-file-entry');
    expect(row).not.toBeNull();
    row!.click();

    expect(onFileSelect).toHaveBeenCalledOnce();
    expect(onFileSelect).toHaveBeenCalledWith(entry);
  });

  it('applies selected styles to clicked entry', () => {
    const sessions = [makeSession('s1', 'S')];
    const files = [makeEntry('src/a.ts', 's1', 'S'), makeEntry('src/b.ts', 's1', 'S')];
    const { el } = createFileTree(makeOptions({ sessions, files }));

    const rows = el.querySelectorAll<HTMLElement>('.diffs-file-entry');
    rows[0].click();

    expect(rows[0].style.background).toContain('bg-selected');
    expect(rows[1].style.background).toBe('');
  });

  // ── Empty state ────────────────────────────────────────────────────────────

  it('empty state element not present when sessions exist', () => {
    const sessions = [makeSession('s1', 'S')];
    const { el } = createFileTree(makeOptions({ sessions }));
    // When sessions exist, the "No sessions found" div should not appear
    const divs = Array.from(el.querySelectorAll('div'));
    const emptyDiv = divs.find(d => d.textContent?.trim() === 'No sessions found');
    expect(emptyDiv).toBeUndefined();
  });

  // ── setSelected ────────────────────────────────────────────────────────────

  it('setSelected clears all highlights when called with null', () => {
    const sessions = [makeSession('s1', 'S')];
    const files = [makeEntry('src/a.ts', 's1', 'S')];
    const { el, setSelected } = createFileTree(makeOptions({ sessions, files }));

    // Click to select first
    const row = el.querySelector<HTMLElement>('.diffs-file-entry')!;
    row.click();
    expect(row.style.background).toBeTruthy();

    // setSelected(null) should clear
    setSelected(null);
    expect(row.style.background).toBe('');
  });

  // ── Change type icons ──────────────────────────────────────────────────────

  it('new file shows "+" icon', () => {
    const sessions = [makeSession('s1', 'S')];
    const entry: FileEntry = { ...makeEntry('src/new.ts', 's1', 'S'), changeType: 'new' };
    const { el } = createFileTree(makeOptions({ sessions, files: [entry] }));
    expect(el.innerHTML).toContain('>+<');
  });

  it('deleted file shows "-" icon', () => {
    const sessions = [makeSession('s1', 'S')];
    const entry: FileEntry = { ...makeEntry('src/old.ts', 's1', 'S'), changeType: 'deleted' };
    const { el } = createFileTree(makeOptions({ sessions, files: [entry] }));
    expect(el.innerHTML).toContain('>-<');
  });

  it('modified file shows "~" icon', () => {
    const sessions = [makeSession('s1', 'S')];
    const entry: FileEntry = { ...makeEntry('src/mod.ts', 's1', 'S'), changeType: 'modified' };
    const { el } = createFileTree(makeOptions({ sessions, files: [entry] }));
    expect(el.innerHTML).toContain('>~<');
  });
});
