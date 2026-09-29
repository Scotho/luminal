import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockLocalStorage } from '../../__tests__/helpers';

// Install localStorage mock before module imports
const storage = mockLocalStorage();
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}), text: async () => '' })));

// Mock sessionDataService to avoid fetch-based polling in tests
vi.mock('../../ui/sessionDataService', () => ({
  getActiveSessions: () => [],
  onSessionsChanged: () => () => {},
}));

// Mock ccSessionManager to control the session list
const mockSessions: import('../../types').CCSession[] = [];
const mockListeners: Array<() => void> = [];

vi.mock('../../ui/ccSessionManager', () => ({
  sessionManager: {
    getAllSessions: () => [...mockSessions],
    onChange: (cb: () => void) => {
      mockListeners.push(cb);
      return () => {
        const idx = mockListeners.indexOf(cb);
        if (idx >= 0) mockListeners.splice(idx, 1);
      };
    },
    get selectedId() { return null; },
    set selectedId(_id: string | null) { /* no-op in tests */ },
  },
}));

import { initAgentTimeline } from '../agentTimeline';

beforeEach(() => {
  mockSessions.length = 0;
  mockListeners.length = 0;
  document.body.innerHTML = '';
  storage.clear();
  vi.clearAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function setupContainer(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'section-agent-timeline';
  document.body.appendChild(el);
  return el;
}

function makeSession(overrides?: Partial<import('../../types').CCSession>): import('../../types').CCSession {
  return {
    id: 'sess-1',
    label: 'Test Session',
    status: 'running',
    startedAt: Date.now(),
    duration: null,
    cards: [],
    result: null,
    usage: null,
    exitCode: null,
    prompt: null,
    backend: 'cc',
    agentIds: [],
    lastAgentId: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('initAgentTimeline', () => {
  it('renders timeline into #section-agent-timeline container', () => {
    const container = setupContainer();
    initAgentTimeline();
    expect(container.querySelector('.cc-timeline')).not.toBeNull();
  });

  it('shows empty state when no sessions exist', () => {
    const container = setupContainer();
    initAgentTimeline();
    expect(container.querySelector('.cc-timeline-empty')).not.toBeNull();
    expect(container.querySelector('.cc-timeline-empty')?.textContent).toContain('No agent sessions');
  });

  it('renders lanes for existing sessions', () => {
    mockSessions.push(
      makeSession({ id: 'sess-1', label: 'Task A' }),
      makeSession({ id: 'sess-2', label: 'Task B' }),
    );
    const container = setupContainer();
    initAgentTimeline();
    const lanes = container.querySelectorAll('.cc-timeline-lane');
    expect(lanes).toHaveLength(2);
  });

  it('subscribes to sessionManager.onChange and re-renders on change', () => {
    const container = setupContainer();
    initAgentTimeline();

    // Initially empty
    expect(container.querySelectorAll('.cc-timeline-lane')).toHaveLength(0);

    // Add a session then fire the listener
    mockSessions.push(makeSession({ id: 'sess-1', label: 'New Session' }));
    mockListeners.forEach(fn => fn());

    expect(container.querySelectorAll('.cc-timeline-lane')).toHaveLength(1);
  });

  it('does nothing when #section-agent-timeline container is absent', () => {
    // No container in DOM — should not throw
    expect(() => initAgentTimeline()).not.toThrow();
  });

  it('renders events from session cards', () => {
    const now = Date.now();
    mockSessions.push(
      makeSession({
        id: 'sess-1',
        startedAt: now - 5000,
        cards: [
          {
            id: 'card-1',
            type: 'tool',
            title: 'Bash',
            preview: 'ls -la',
            body: 'ls -la',
            ts: now - 4000,
            role: 'tool',
            depth: 0,
            toolStatus: 'done',
          },
          {
            id: 'card-2',
            type: 'text',
            title: 'Response',
            preview: 'Done',
            body: 'Done',
            ts: now - 2000,
            role: 'assistant',
            depth: 0,
          },
        ],
      }),
    );
    const container = setupContainer();
    initAgentTimeline();
    const events = container.querySelectorAll('.cc-timeline-event');
    expect(events).toHaveLength(2);
  });

  it('maps session status correctly to timeline status', () => {
    mockSessions.push(
      makeSession({ id: 'sess-done', status: 'done' }),
      makeSession({ id: 'sess-error', status: 'error' }),
      makeSession({ id: 'sess-running', status: 'running' }),
    );
    const container = setupContainer();
    initAgentTimeline();
    const lanes = container.querySelectorAll('.cc-timeline-lane');
    expect(lanes).toHaveLength(3);
  });
});
