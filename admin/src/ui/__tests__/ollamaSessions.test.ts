// Unit tests: Ollama session persistence and tab behavior
// Tests that: sessions persist via sessionStorage, continueSession doesn't spawn
// new tabs, and Ollama backend is tracked correctly.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockLocalStorage } from '../../__tests__/helpers';

// Install localStorage mock before module imports
const lsStorage = mockLocalStorage();

// Install sessionStorage mock (SessionManager._persist uses sessionStorage)
const ssMap = new Map<string, string>();
const ssMock = {
  getItem: vi.fn((key: string) => ssMap.get(key) ?? null),
  setItem: vi.fn((key: string, val: string) => { ssMap.set(key, val); }),
  removeItem: vi.fn((key: string) => { ssMap.delete(key); }),
  clear: vi.fn(() => ssMap.clear()),
  get length() { return ssMap.size; },
  key: vi.fn(() => null),
};
Object.defineProperty(globalThis, 'sessionStorage', { value: ssMock, writable: true });

// Stub fetch for _tryLinkToSession
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}), text: async () => '' })));

import {
  SessionManager,
  _setDispatchCC,
  _setPersistUsage,
} from '../ccSessionManager';

_setDispatchCC(vi.fn(async () => 'test-id'));
_setPersistUsage(vi.fn(async () => {}));

const TAB_STORAGE_KEY = 'luminal-agent-tabs';

describe('Ollama Session Persistence', () => {
  let mgr: SessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new SessionManager();
    ssMap.clear();
    lsStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists sessions to sessionStorage on creation', () => {
    mgr.createSession('test-session', 'agent-1', 'ollama');

    const raw = ssMap.get(TAB_STORAGE_KEY);
    expect(raw).toBeTruthy();

    const state = JSON.parse(raw!) as { sessions: Array<{ id: string; backend: string }> };
    expect(state.sessions.length).toBe(1);
    expect(state.sessions[0].id).toBe('agent-1');
    expect(state.sessions[0].backend).toBe('ollama');
  });

  it('persists updated status after completeSession', () => {
    const s = mgr.createSession('test', 'agent-1', 'ollama');

    // Verify initial status
    let state = JSON.parse(ssMap.get(TAB_STORAGE_KEY)!) as { sessions: Array<{ status: string }> };
    expect(state.sessions[0].status).toBe('running');

    // Complete the session
    mgr.completeSession(s.id, 0);
    vi.advanceTimersByTime(100);

    state = JSON.parse(ssMap.get(TAB_STORAGE_KEY)!) as { sessions: Array<{ status: string }> };
    expect(state.sessions[0].status).toBe('done');
  });

  it('restores sessions from sessionStorage', () => {
    // Manually write session data to sessionStorage
    const fakeState = {
      sessions: [{
        id: 'restored-1',
        label: 'Restored Session',
        status: 'done',
        startedAt: Date.now() - 60000,
        duration: 5000,
        cards: [{ id: 'c1', type: 'text', title: 'Test', preview: 'hi', body: 'hi', ts: Date.now() }],
        result: 'ok',
        usage: null,
        exitCode: 0,
        prompt: 'hello',
        backend: 'ollama',
        agentIds: [],
        lastAgentId: null,
      }],
      selectedId: 'restored-1',
      pinned: [],
    };
    ssMap.set(TAB_STORAGE_KEY, JSON.stringify(fakeState));

    // Create fresh manager and restore
    const mgr2 = new SessionManager();
    mgr2._restoreFromStorage();

    expect(mgr2.all().length).toBe(1);
    expect(mgr2.all()[0].id).toBe('restored-1');
    expect(mgr2.all()[0].backend).toBe('ollama');
    expect(mgr2.all()[0].status).toBe('done');
    expect(mgr2.selectedId).toBe('restored-1');
  });

  it('preserves pinned sessions across persistence', () => {
    const s = mgr.createSession('pinned-test', 'agent-1', 'ollama');
    mgr.togglePin(s.id);

    const raw = ssMap.get(TAB_STORAGE_KEY);
    const state = JSON.parse(raw!) as { pinned: string[] };
    expect(state.pinned).toContain('agent-1');

    // Restore into new manager
    const mgr2 = new SessionManager();
    mgr2._restoreFromStorage();
    expect(mgr2.isPinned('agent-1')).toBe(true);
  });

  it('preserves selectedId across persistence', () => {
    mgr.createSession('s1', 'a1', 'ollama');
    mgr.createSession('s2', 'a2', 'ollama');

    // s2 should be selected (most recent)
    expect(mgr.selectedId).toBe('a2');

    const mgr2 = new SessionManager();
    mgr2._restoreFromStorage();
    expect(mgr2.selectedId).toBe('a2');
  });
});

describe('Ollama Dumb Terminal — Tab Count', () => {
  let mgr: SessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new SessionManager();
    ssMap.clear();
    lsStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('continueSession reuses the existing session (no new tab)', () => {
    const s = mgr.createSession('first', 'agent-1', 'aider');
    expect(mgr.all().length).toBe(1);

    // Complete the session
    mgr.completeSession(s.id, 0);
    vi.advanceTimersByTime(100);
    expect(mgr.all().length).toBe(1);
    expect(mgr.all()[0].status).toBe('done');

    // Continue — should not increase session count
    const continued = mgr.continueSession(s.id, 'agent-2');
    expect(continued).not.toBeNull();
    expect(mgr.all().length).toBe(1); // Still 1 session
    expect(continued!.status).toBe('running');
    expect(continued!.agentIds).toContain('agent-2');
    expect(continued!.lastAgentId).toBe('agent-2');
  });

  it('multiple follow-ups all stay in the same session', () => {
    const s = mgr.createSession('chat', 'agent-1', 'aider');
    mgr.completeSession(s.id, 0);
    vi.advanceTimersByTime(100);

    // Follow-up 1
    mgr.continueSession(s.id, 'agent-2');
    mgr.completeSession(s.id, 0);
    vi.advanceTimersByTime(100);
    expect(mgr.all().length).toBe(1);

    // Follow-up 2
    mgr.continueSession(s.id, 'agent-3');
    mgr.completeSession(s.id, 0);
    vi.advanceTimersByTime(100);
    expect(mgr.all().length).toBe(1);

    // Follow-up 3
    mgr.continueSession(s.id, 'agent-4');
    mgr.completeSession(s.id, 0);
    vi.advanceTimersByTime(100);
    expect(mgr.all().length).toBe(1);

    // All agent IDs tracked
    expect(s.agentIds).toEqual(['agent-1', 'agent-2', 'agent-3', 'agent-4']);
    expect(s.lastAgentId).toBe('agent-4');
  });

  it('continueSession resets text accumulators', () => {
    const s = mgr.createSession('chat', 'agent-1', 'ollama');
    mgr.processLine(s.id, 'some text');
    vi.advanceTimersByTime(100);
    mgr.completeSession(s.id, 0);
    vi.advanceTimersByTime(100);

    const continued = mgr.continueSession(s.id, 'agent-2');
    expect(continued).not.toBeNull();
    // New text should start fresh, not append to old text
    mgr.processLine(s.id, 'new response');
    vi.advanceTimersByTime(100);

    // The latest card should contain only the new text
    const lastCard = s.cards[s.cards.length - 1];
    expect(lastCard.body).toContain('new response');
    expect(lastCard.body).not.toContain('some text');
  });

  it('continueSession selects the session', () => {
    const s1 = mgr.createSession('a', 'a-1', 'aider');
    const s2 = mgr.createSession('b', 'b-1', 'aider');
    mgr.completeSession(s1.id, 0);
    mgr.completeSession(s2.id, 0);
    vi.advanceTimersByTime(100);

    // Select s2
    mgr.selectedId = 'b-1';
    expect(mgr.selectedId).toBe('b-1');

    // Continue s1 — should select it
    mgr.continueSession('a-1', 'a-2');
    expect(mgr.selectedId).toBe('a-1');
  });

  it('user message is added to existing session on follow-up', () => {
    const s = mgr.createSession('chat', 'agent-1', 'ollama');
    mgr.completeSession(s.id, 0);
    vi.advanceTimersByTime(100);

    mgr.addUserMessage(s.id, 'my follow-up question');

    const userCards = s.cards.filter(c => c.role === 'user');
    expect(userCards.length).toBe(1);
    expect(userCards[0].body).toBe('my follow-up question');
  });
});

describe('Ollama Backend Tracking', () => {
  let mgr: SessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new SessionManager();
    ssMap.clear();
    lsStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks ollama backend separately from cc', () => {
    mgr.createSession('cc-session', 'cc-1', 'cc');
    mgr.createSession('ollama-session', 'ollama-1', 'ollama');

    const sessions = mgr.all();
    expect(sessions.find(s => s.id === 'cc-1')?.backend).toBe('cc');
    expect(sessions.find(s => s.id === 'ollama-1')?.backend).toBe('ollama');
  });

  it('tracks aider backend correctly', () => {
    const s = mgr.createSession('aider-session', 'aider-1', 'aider');
    expect(s.backend).toBe('aider');
  });

  it('persists backend type through completion cycle', () => {
    const s = mgr.createSession('test', 'agent-1', 'ollama');
    mgr.completeSession(s.id, 0);
    vi.advanceTimersByTime(100);

    // Backend should remain 'ollama' after completion
    expect(s.backend).toBe('ollama');

    // Check persistence
    const state = JSON.parse(ssMap.get(TAB_STORAGE_KEY)!) as {
      sessions: Array<{ backend: string }>;
    };
    expect(state.sessions[0].backend).toBe('ollama');
  });

  it('backend survives continue cycle', () => {
    const s = mgr.createSession('test', 'agent-1', 'aider');
    mgr.completeSession(s.id, 0);
    vi.advanceTimersByTime(100);

    mgr.continueSession(s.id, 'agent-2');
    expect(s.backend).toBe('aider');

    mgr.completeSession(s.id, 0);
    vi.advanceTimersByTime(100);
    expect(s.backend).toBe('aider');
  });
});
