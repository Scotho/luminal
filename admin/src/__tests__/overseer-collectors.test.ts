import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockFetch } from './helpers';
import {
  collectBugs,
  collectTests,
  collectStaleTasks,
} from '../middleware/overseer/collectors';

const ctx = { adminBase: 'http://localhost:5175' };

afterEach(() => {
  vi.restoreAllMocks();
});

// ── collectBugs ──────────────────────────────────────────────────────────────

describe('collectBugs', () => {
  it('returns correct metrics with 4 recent reports (burstDetected=1)', async () => {
    const now = Date.now();
    const recentTs = now - 2 * 60 * 1000; // 2 min ago — within 10 min window

    // r1 and r2 share same 80-char prefix (error string < 80 chars, so full string is the key)
    // Make them identical so they cluster into 1 unique error prefix
    const sharedError = 'TypeError: cannot read properties of undefined';
    const reports = [
      { id: 'r1', error: sharedError, ts: recentTs },
      { id: 'r2', error: sharedError, ts: recentTs },
      { id: 'r3', error: 'ReferenceError: someVar is not defined', ts: recentTs },
      { id: 'r4', error: 'RangeError: maximum call stack size exceeded', ts: recentTs },
    ];

    mockFetch([{ ok: true, json: reports }]);

    const snap = await collectBugs(ctx);

    expect(snap.domain).toBe('bugs');
    expect(snap.metrics.totalRecent).toBe(4);
    expect(snap.metrics.burstDetected).toBe(1); // 4 >= 3 triggers burst
    // r1 and r2 share the same error string (1 prefix), r3 and r4 are distinct
    expect(snap.metrics.uniqueErrors).toBe(3);
  });

  it('returns zero metrics on empty reports', async () => {
    mockFetch([{ ok: true, json: [] }]);

    const snap = await collectBugs(ctx);

    expect(snap.domain).toBe('bugs');
    expect(snap.metrics.totalRecent).toBe(0);
    expect(snap.metrics.burstDetected).toBe(0);
    expect(snap.metrics.uniqueErrors).toBe(0);
  });

  it('ignores reports outside the 10 minute window', async () => {
    const now = Date.now();
    const oldTs = now - 15 * 60 * 1000; // 15 min ago — outside window

    const reports = [
      { id: 'r1', error: 'OldError: something', ts: oldTs },
      { id: 'r2', error: 'OldError: something else', ts: oldTs },
      { id: 'r3', error: 'OldError: third', ts: oldTs },
    ];

    mockFetch([{ ok: true, json: reports }]);

    const snap = await collectBugs(ctx);

    expect(snap.metrics.totalRecent).toBe(0);
    expect(snap.metrics.burstDetected).toBe(0);
  });

  it('handles fetch failure gracefully', async () => {
    mockFetch([{ ok: false }]);

    const snap = await collectBugs(ctx);

    expect(snap.domain).toBe('bugs');
    expect(snap.metrics.totalRecent).toBe(0);
    expect(snap.metrics.burstDetected).toBe(0);
  });
});

// ── collectTests ─────────────────────────────────────────────────────────────

describe('collectTests', () => {
  it('aggregates pass/fail counts from last 5 test log runs', async () => {
    const testLog = {
      runs: [
        { id: 'run-1', passed: 100, failed: 2 },
        { id: 'run-2', passed: 98,  failed: 0 },
        { id: 'run-3', passed: 95,  failed: 5 },
      ],
    };
    const ciRuns: unknown[] = [];

    // collectTests fetches test-log first, then CI runs in parallel
    mockFetch([
      { ok: true, json: testLog },
      { ok: true, json: ciRuns },
    ]);

    const snap = await collectTests(ctx);

    expect(snap.domain).toBe('tests');
    expect(snap.metrics.recentPasses).toBe(293);   // 100+98+95
    expect(snap.metrics.recentFailures).toBe(7);   // 2+0+5
    expect(snap.metrics.totalRuns).toBe(3);
    expect(snap.metrics.ciFailures).toBe(0);
    expect(snap.metrics.ciInProgress).toBe(0);
  });

  it('counts CI failures and in-progress runs', async () => {
    const testLog = { runs: [] };
    const ciRuns = [
      { id: 'ci-1', status: 'failed' },
      { id: 'ci-2', status: 'running' },
      { id: 'ci-3', status: 'passed' },
      { id: 'ci-4', status: 'failed' },
    ];

    mockFetch([
      { ok: true, json: testLog },
      { ok: true, json: ciRuns },
    ]);

    const snap = await collectTests(ctx);

    expect(snap.metrics.ciFailures).toBe(2);
    expect(snap.metrics.ciInProgress).toBe(1);
    expect(snap.metrics.totalRuns).toBe(0);
  });

  it('handles missing runs array in test log', async () => {
    mockFetch([
      { ok: true, json: {} },   // test-log with no runs key
      { ok: true, json: [] },   // CI runs
    ]);

    const snap = await collectTests(ctx);

    expect(snap.metrics.recentPasses).toBe(0);
    expect(snap.metrics.recentFailures).toBe(0);
    expect(snap.metrics.totalRuns).toBe(0);
  });
});

// ── collectStaleTasks ─────────────────────────────────────────────────────────

describe('collectStaleTasks', () => {
  it('correctly identifies tasks stale >7 days', async () => {
    const now = new Date();
    const recentDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
    const staleDate  = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago

    const tasks = [
      { id: 't1', status: 'pending', modified: staleDate  },  // stale
      { id: 't2', status: 'pending', modified: recentDate  }, // not stale
      { id: 't3', status: 'pending', modified: staleDate  },  // stale
      { id: 't4', status: 'done',    modified: staleDate  },  // skip — done
    ];

    mockFetch([{ ok: true, json: tasks }]);

    const snap = await collectStaleTasks(ctx);

    expect(snap.domain).toBe('stale-tasks');
    expect(snap.metrics.staleCount).toBe(2);
    expect(snap.metrics.pendingCount).toBe(3); // t1, t2, t3 (not t4)
    expect(snap.metrics.totalCount).toBe(4);
  });

  it('skips done tasks entirely', async () => {
    const staleDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();

    const tasks = [
      { id: 't1', status: 'done', modified: staleDate },
      { id: 't2', status: 'done', modified: staleDate },
    ];

    mockFetch([{ ok: true, json: tasks }]);

    const snap = await collectStaleTasks(ctx);

    expect(snap.metrics.staleCount).toBe(0);
    expect(snap.metrics.pendingCount).toBe(0);
    expect(snap.metrics.totalCount).toBe(2);
  });

  it('falls back to created date when modified is absent', async () => {
    const staleDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    const tasks = [
      { id: 't1', status: 'pending', created: staleDate }, // no modified — use created
    ];

    mockFetch([{ ok: true, json: tasks }]);

    const snap = await collectStaleTasks(ctx);

    expect(snap.metrics.staleCount).toBe(1);
  });

  it('returns zero metrics on empty task list', async () => {
    mockFetch([{ ok: true, json: [] }]);

    const snap = await collectStaleTasks(ctx);

    expect(snap.metrics.staleCount).toBe(0);
    expect(snap.metrics.pendingCount).toBe(0);
    expect(snap.metrics.totalCount).toBe(0);
  });
});
