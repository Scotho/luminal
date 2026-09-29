import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  startSessionDataService,
  stopSessionDataService,
  getSessionCache,
  getActiveSessions,
  onSessionsChanged,
  _resetForTesting,
} from '../ui/sessionDataService';

function makeSessions(overrides: Array<{ status: string; source?: string }>) {
  return overrides.map((o, i) => ({
    id: `sess_${i}`,
    summary: `Session ${i}`,
    type: 'feature',
    status: o.status,
    section: 'current-stack',
    phases: [],
    plan: '',
    source: o.source,
    notes: [],
    created: new Date().toISOString(),
  }));
}

describe('sessionDataService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetForTesting();
    mockFetch.mockReset();
  });

  afterEach(() => {
    stopSessionDataService();
    vi.useRealTimers();
  });

  it('fetches sessions on start and populates cache', async () => {
    const sessions = makeSessions([{ status: 'active' }, { status: 'todo' }]);
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(JSON.stringify(sessions)) });

    startSessionDataService();
    await vi.advanceTimersByTimeAsync(0);

    expect(getSessionCache()).toHaveLength(2);
  });

  it('getActiveSessions returns only active/blocked/needs-attention', async () => {
    const sessions = makeSessions([
      { status: 'active' },
      { status: 'todo' },
      { status: 'blocked' },
      { status: 'done' },
      { status: 'needs-attention' },
    ]);
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(JSON.stringify(sessions)) });

    startSessionDataService();
    await vi.advanceTimersByTimeAsync(0);

    const active = getActiveSessions();
    expect(active).toHaveLength(3);
    expect(active.map(s => s.status).sort()).toEqual(['active', 'blocked', 'needs-attention']);
  });

  it('calls onChange listeners when data changes', async () => {
    const sessions1 = makeSessions([{ status: 'active' }]);
    const sessions2 = makeSessions([{ status: 'active' }, { status: 'active', source: 'admin' }]);

    mockFetch
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(JSON.stringify(sessions1)) })
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(JSON.stringify(sessions2)) });

    const listener = vi.fn();
    onSessionsChanged(listener);

    startSessionDataService();
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledTimes(1);

    // Advance past poll interval
    await vi.advanceTimersByTimeAsync(5000);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not call listener when data is unchanged', async () => {
    const sessions = makeSessions([{ status: 'active' }]);
    const json = JSON.stringify(sessions);
    mockFetch
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(json) })
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(json) });

    const listener = vi.fn();
    onSessionsChanged(listener);

    startSessionDataService();
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    // Same data — no second call
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stopSessionDataService clears timer', async () => {
    mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('[]') });

    startSessionDataService();
    await vi.advanceTimersByTimeAsync(0);
    stopSessionDataService();

    mockFetch.mockClear();
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
