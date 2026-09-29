import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockLocalStorage, makeCCSession, makeCCCard } from '../../__tests__/helpers';

const storage = mockLocalStorage();

// Mock sessionStorage alongside localStorage
const sessionStore = new Map<string, string>();
const sessionStorageMock = {
  getItem: vi.fn((key: string) => sessionStore.get(key) ?? null),
  setItem: vi.fn((key: string, val: string) => { sessionStore.set(key, val); }),
  removeItem: vi.fn((key: string) => { sessionStore.delete(key); }),
  clear: vi.fn(() => sessionStore.clear()),
  get length() { return sessionStore.size; },
  key: vi.fn(() => null),
};
Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStorageMock, writable: true });

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}), text: async () => '' })));
vi.mock('../sessionDataService', () => ({
  getActiveSessions: () => [],
  onSessionsChanged: () => () => {},
}));

import { sessionManager } from '../ccSessionManager';

beforeEach(() => {
  storage.clear();
  sessionStore.clear();
  sessionManager._resetForTesting();
});

describe('persistentTabs', () => {
  // ── Completed session remains in list ────────────────────────────────────
  describe('completed session stays in list', () => {
    it('session with status done remains in session list after completion', () => {
      const s = sessionManager.createSession('my-task');
      sessionManager.completeSession(s.id, 0);

      const all = sessionManager.getAllSessions();
      const found = all.find(sess => sess.id === s.id);
      expect(found).toBeDefined();
      expect(found!.status).toBe('done');
    });

    it('session with status error remains in session list after completion', () => {
      const s = sessionManager.createSession('my-failing-task');
      sessionManager.completeSession(s.id, 1);

      const all = sessionManager.getAllSessions();
      const found = all.find(sess => sess.id === s.id);
      expect(found).toBeDefined();
      expect(found!.status).toBe('error');
    });
  });

  // ── closeSession ──────────────────────────────────────────────────────────
  describe('closeSession', () => {
    it('removes session from list', () => {
      const s = sessionManager.createSession('task-a');
      sessionManager.completeSession(s.id, 0);

      sessionManager.closeSession(s.id);

      const all = sessionManager.getAllSessions();
      expect(all.find(sess => sess.id === s.id)).toBeUndefined();
    });

    it('does nothing for unknown id', () => {
      sessionManager.createSession('task-x');
      const before = sessionManager.getAllSessions().length;
      sessionManager.closeSession('nonexistent-id');
      expect(sessionManager.getAllSessions().length).toBe(before);
    });

    it('selects the next session when closing the selected one', () => {
      const s1 = sessionManager.createSession('first');
      const s2 = sessionManager.createSession('second');
      // s2 is now selected (added last)
      expect(sessionManager.selectedId).toBe(s2.id);

      sessionManager.closeSession(s2.id);
      expect(sessionManager.selectedId).toBe(s1.id);
    });

    it('sets selectedId to null when closing the only session', () => {
      const s = sessionManager.createSession('only');
      sessionManager.closeSession(s.id);
      expect(sessionManager.selectedId).toBeNull();
    });

    it('persists open tabs to localStorage after close', () => {
      const s1 = sessionManager.createSession('first');
      const s2 = sessionManager.createSession('second');
      sessionManager.closeSession(s2.id);

      const raw = storage.get('luminal-open-tabs');
      expect(raw).toBeDefined();
      const ids = JSON.parse(raw!) as string[];
      expect(ids).toContain(s1.id);
      expect(ids).not.toContain(s2.id);
    });
  });

  // ── closeAllDone ──────────────────────────────────────────────────────────
  describe('closeAllDone', () => {
    it('removes done sessions, keeps running ones', () => {
      const running = sessionManager.createSession('running-task');
      const done = sessionManager.createSession('done-task');
      sessionManager.completeSession(done.id, 0);

      sessionManager.closeAllDone();

      const all = sessionManager.getAllSessions();
      expect(all.find(s => s.id === running.id)).toBeDefined();
      expect(all.find(s => s.id === done.id)).toBeUndefined();
    });

    it('removes error sessions', () => {
      const running = sessionManager.createSession('running-task');
      const errored = sessionManager.createSession('errored-task');
      sessionManager.completeSession(errored.id, 1);

      sessionManager.closeAllDone();

      const all = sessionManager.getAllSessions();
      expect(all.find(s => s.id === running.id)).toBeDefined();
      expect(all.find(s => s.id === errored.id)).toBeUndefined();
    });

    it('keeps running sessions intact', () => {
      const s1 = sessionManager.createSession('running-1');
      const s2 = sessionManager.createSession('running-2');

      sessionManager.closeAllDone();

      const all = sessionManager.getAllSessions();
      expect(all).toHaveLength(2);
      expect(all.find(s => s.id === s1.id)).toBeDefined();
      expect(all.find(s => s.id === s2.id)).toBeDefined();
    });

    it('persists open tabs after clearing done sessions', () => {
      const running = sessionManager.createSession('running-task');
      const done = sessionManager.createSession('done-task');
      sessionManager.completeSession(done.id, 0);

      sessionManager.closeAllDone();

      const raw = storage.get('luminal-open-tabs');
      const ids = JSON.parse(raw!) as string[];
      expect(ids).toContain(running.id);
      expect(ids).not.toContain(done.id);
    });
  });

  // ── persistOpenTabs ───────────────────────────────────────────────────────
  describe('persistOpenTabs', () => {
    it('saves current session IDs to luminal-open-tabs in localStorage', () => {
      const s1 = sessionManager.createSession('tab-one');
      const s2 = sessionManager.createSession('tab-two');

      sessionManager.persistOpenTabs();

      const raw = storage.get('luminal-open-tabs');
      expect(raw).toBeDefined();
      const ids = JSON.parse(raw!) as string[];
      expect(ids).toContain(s1.id);
      expect(ids).toContain(s2.id);
    });

    it('saves an empty array when no sessions', () => {
      sessionManager.persistOpenTabs();

      const raw = storage.get('luminal-open-tabs');
      expect(raw).toBeDefined();
      const ids = JSON.parse(raw!) as string[];
      expect(ids).toEqual([]);
    });
  });

  // ── getAllSessions ────────────────────────────────────────────────────────
  describe('getAllSessions', () => {
    it('returns full session list including completed ones', () => {
      const s1 = sessionManager.createSession('first');
      const s2 = sessionManager.createSession('second');
      sessionManager.completeSession(s1.id, 0);

      const all = sessionManager.getAllSessions();
      expect(all).toHaveLength(2);
      expect(all.find(s => s.id === s1.id)).toBeDefined();
      expect(all.find(s => s.id === s2.id)).toBeDefined();
    });

    it('returns a copy — mutations do not affect internal state', () => {
      sessionManager.createSession('my-session');
      const all = sessionManager.getAllSessions();
      all.length = 0; // mutate the returned array

      expect(sessionManager.getAllSessions()).toHaveLength(1);
    });

    it('returns empty array when no sessions', () => {
      expect(sessionManager.getAllSessions()).toEqual([]);
    });

    it('uses makeCCSession fixture shape correctly', () => {
      const fixture = makeCCSession({ id: 'fixture-id', label: 'Fixture Session' });
      expect(fixture.id).toBe('fixture-id');
      expect(fixture.label).toBe('Fixture Session');
      expect(fixture.status).toBe('running');
    });
  });

  // ── sessionStorage persistence ────────────────────────────────────────────
  describe('sessionStorage persistence', () => {
    it('restores sessions from sessionStorage on construction', () => {
      const s = sessionManager.createSession('persisted-task');
      s.cards.push(makeCCCard({ id: 'c1', body: 'hello world' }));
      sessionManager.completeSession(s.id, 0);

      // Grab what was persisted
      const raw = sessionStorage.getItem('luminal-agent-tabs');
      expect(raw).not.toBeNull();

      // Reset and reconstruct
      sessionManager._resetForTesting();
      expect(sessionManager.getAllSessions()).toHaveLength(0);

      // Restore
      sessionManager._restoreFromStorage();
      const restored = sessionManager.getAllSessions();
      expect(restored).toHaveLength(1);
      expect(restored[0].label).toBe('persisted-task');
      // original card + summary card from completeSession
      expect(restored[0].cards.length).toBeGreaterThanOrEqual(2);
    });

    it('does not restore if sessionStorage is empty', () => {
      sessionStorage.clear();
      sessionManager._resetForTesting();
      sessionManager._restoreFromStorage();
      expect(sessionManager.getAllSessions()).toHaveLength(0);
    });

    it('persists pinned state', () => {
      const s = sessionManager.createSession('pinned-task');
      sessionManager.togglePin(s.id);

      sessionManager._resetForTesting();
      sessionManager._restoreFromStorage();
      expect(sessionManager.isPinned(s.id)).toBe(true);
    });

    it('persists selectedId', () => {
      const s1 = sessionManager.createSession('first');
      sessionManager.createSession('second');
      sessionManager.selectedId = s1.id;

      sessionManager._resetForTesting();
      sessionManager._restoreFromStorage();
      expect(sessionManager.selectedId).toBe(s1.id);
    });
  });

  // ── agent history archival ─────────────────────────────────────────────────
  describe('agent history archival', () => {
    it('POSTs session data to /__admin_agent_history on closeSession', async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}), text: async () => '' }));
      vi.stubGlobal('fetch', fetchMock);

      const s = sessionManager.createSession('archive-me');
      s.cards.push(makeCCCard({ id: 'c1', body: 'test output' }));
      sessionManager.completeSession(s.id, 0);

      sessionManager.closeSession(s.id);

      // Allow microtask to flush
      await new Promise(r => setTimeout(r, 0));

      const archiveCall = fetchMock.mock.calls.find(
        (c: unknown[]) => c[0] === '/__admin_agent_history' && (c[1] as RequestInit)?.method === 'POST'
      );
      expect(archiveCall).toBeDefined();
      const args = archiveCall as unknown as [string, RequestInit];
      const body = JSON.parse(args[1].body as string);
      expect(body.id).toBe(s.id);
      expect(body.label).toBe('archive-me');
      expect(body.cards.length).toBeGreaterThan(0);
    });

    it('POSTs session data on removeSession too', async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}), text: async () => '' }));
      vi.stubGlobal('fetch', fetchMock);

      const s = sessionManager.createSession('remove-me');
      sessionManager.completeSession(s.id, 0);
      sessionManager.removeSession(s.id);

      await new Promise(r => setTimeout(r, 0));

      const archiveCall = fetchMock.mock.calls.find(
        (c: unknown[]) => c[0] === '/__admin_agent_history' && (c[1] as RequestInit)?.method === 'POST'
      );
      expect(archiveCall).toBeDefined();
    });

    it('archives all done sessions on closeAllDone', async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}), text: async () => '' }));
      vi.stubGlobal('fetch', fetchMock);

      sessionManager.createSession('running-one');
      const d1 = sessionManager.createSession('done-one');
      const d2 = sessionManager.createSession('done-two');
      sessionManager.completeSession(d1.id, 0);
      sessionManager.completeSession(d2.id, 0);

      sessionManager.closeAllDone();

      await new Promise(r => setTimeout(r, 0));

      const archiveCalls = fetchMock.mock.calls.filter(
        (c: unknown[]) => c[0] === '/__admin_agent_history' && (c[1] as RequestInit)?.method === 'POST'
      );
      expect(archiveCalls).toHaveLength(2);
    });
  });
});
