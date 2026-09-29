import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockLocalStorage } from '../../__tests__/helpers';

const storage = mockLocalStorage();

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}), text: async () => '' })));

vi.mock('../../ui/sessionDataService', () => ({
  getActiveSessions: () => [],
  onSessionsChanged: () => () => {},
}));

// Mock sessionManager — provide controlled sessions
vi.mock('../../ui/ccSessionManager', () => {
  const listeners: Array<() => void> = [];
  return {
    sessionManager: {
      getAllSessions: vi.fn(() => []),
      onChange: vi.fn((cb: () => void) => {
        listeners.push(cb);
        return () => {
          const idx = listeners.indexOf(cb);
          if (idx >= 0) listeners.splice(idx, 1);
        };
      }),
    },
  };
});

// Mock diffRenderer to keep tests simple
vi.mock('../../ui/diffRenderer', () => ({
  parseDiff: vi.fn(() => []),
  renderDiff: vi.fn((hunks: unknown[], container: HTMLElement) => {
    container.innerHTML = '<div class="cc-diff-mock">mock diff</div>';
  }),
}));

vi.mock('../../ui/render', () => ({
  escapeHtml: (s: string) => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
}));

import { initAgentDiffs } from '../agentDiffs';
import { sessionManager } from '../../ui/ccSessionManager';

// ── Helpers ────────────────────────────────────────────────────────────────────

function setupSection(): HTMLElement {
  document.body.innerHTML = '<div id="section-agent-diffs"></div>';
  return document.getElementById('section-agent-diffs')!;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('initAgentDiffs', () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    // Reset sessions to empty by default
    vi.mocked(sessionManager.getAllSessions).mockReturnValue([]);
  });

  it('does nothing when section element is missing', () => {
    document.body.innerHTML = '';
    expect(() => initAgentDiffs()).not.toThrow();
  });

  it('renders split layout with .agent-diffs-tree and .agent-diffs-viewer', () => {
    setupSection();
    initAgentDiffs();

    const section = document.getElementById('section-agent-diffs')!;
    expect(section.querySelector('.agent-diffs-tree')).not.toBeNull();
    expect(section.querySelector('.agent-diffs-viewer')).not.toBeNull();
  });

  it('shows "Select a file" empty state in viewer', () => {
    setupSection();
    initAgentDiffs();

    const section = document.getElementById('section-agent-diffs')!;
    expect(section.querySelector('.agent-diffs-empty')?.textContent).toContain('Select a file');
  });

  it('renders session headers for available sessions', () => {
    setupSection();
    vi.mocked(sessionManager.getAllSessions).mockReturnValue([
      {
        id: 'sess-1',
        label: 'Test Session A',
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
      },
      {
        id: 'sess-2',
        label: 'Test Session B',
        status: 'done',
        startedAt: Date.now(),
        duration: 2000,
        cards: [],
        result: null,
        usage: null,
        exitCode: 0,
        prompt: null,
        backend: 'cc',
        agentIds: [],
        lastAgentId: null,
      },
    ]);

    initAgentDiffs();

    const section = document.getElementById('section-agent-diffs')!;
    const headers = section.querySelectorAll('.diffs-session-header');
    expect(headers.length).toBe(2);
    expect(section.innerHTML).toContain('Test Session A');
    expect(section.innerHTML).toContain('Test Session B');
  });

  it('shows "No file changes" when session has no Edit/Write tool cards', () => {
    setupSection();
    vi.mocked(sessionManager.getAllSessions).mockReturnValue([
      {
        id: 'sess-no-files',
        label: 'Empty Session',
        status: 'done',
        startedAt: Date.now(),
        duration: 500,
        cards: [
          {
            id: 'card-1',
            type: 'text',
            title: 'Response',
            preview: 'hello',
            body: 'hello world',
            ts: Date.now(),
            role: 'assistant',
            depth: 0,
          },
        ],
        result: null,
        usage: null,
        exitCode: 0,
        prompt: null,
        backend: 'cc',
        agentIds: [],
        lastAgentId: null,
      },
    ]);

    initAgentDiffs();

    const section = document.getElementById('section-agent-diffs')!;
    expect(section.innerHTML).toContain('No file changes');
  });

  it('renders file entries for Edit tool cards', () => {
    setupSection();
    vi.mocked(sessionManager.getAllSessions).mockReturnValue([
      {
        id: 'sess-edit',
        label: 'Edit Session',
        status: 'done',
        startedAt: Date.now(),
        duration: 800,
        cards: [
          {
            id: 'card-edit-1',
            type: 'tool',
            title: 'Edit src/game.ts',
            preview: 'editing game.ts',
            body: 'old content\nnew content',
            ts: Date.now(),
            role: 'tool',
            depth: 0,
            toolStatus: 'done',
          },
        ],
        result: null,
        usage: null,
        exitCode: 0,
        prompt: null,
        backend: 'cc',
        agentIds: [],
        lastAgentId: null,
      },
    ]);

    initAgentDiffs();

    const section = document.getElementById('section-agent-diffs')!;
    const entries = section.querySelectorAll('.diffs-file-entry');
    expect(entries.length).toBeGreaterThan(0);
  });

  it('renders top bar with session selector dropdown', () => {
    setupSection();
    initAgentDiffs();

    const section = document.getElementById('section-agent-diffs')!;
    expect(section.querySelector('.agent-diffs-session-select')).not.toBeNull();
  });

  it('renders Unified and Split toggle buttons', () => {
    setupSection();
    initAgentDiffs();

    const section = document.getElementById('section-agent-diffs')!;
    const modeBtns = section.querySelectorAll<HTMLButtonElement>('.agent-diffs-mode-btn');
    const labels = Array.from(modeBtns).map(b => b.textContent?.trim());
    expect(labels).toContain('Unified');
    expect(labels).toContain('Split');
  });

  it('renders CHANGED FILES header in tree', () => {
    setupSection();
    initAgentDiffs();

    const section = document.getElementById('section-agent-diffs')!;
    expect(section.innerHTML).toContain('CHANGED FILES');
  });
});
