// admin/src/middleware/routes/__tests__/flakinessRoutes.test.ts — TASK-13
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';
import type { TestFlakinessRecord, TestFlakinessHistoryEntry } from '../../../types';

// ── Mock fs (same pattern as pipelineRoutes.test.ts) ────────────
const { fileStore, norm } = vi.hoisted(() => {
  const fileStore: Record<string, string> = {};
  const norm = (p: string): string => p.replace(/\\/g, '/');
  return { fileStore, norm };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const readFileSync = vi.fn((filepath: string) => {
    const n = norm(filepath);
    const key = Object.keys(fileStore).find(k => norm(k) === n);
    if (key === undefined) throw new Error(`ENOENT: ${filepath}`);
    return fileStore[key];
  });
  const writeFileSync = vi.fn((filepath: string, data: string) => {
    fileStore[norm(filepath)] = data;
  });
  const existsSync = vi.fn((filepath: string) => {
    const n = norm(filepath);
    if (fileStore[n] !== undefined) return true;
    return Object.keys(fileStore).some(k => norm(k).startsWith(n + '/'));
  });
  const mkdirSync = vi.fn();
  const readdirSync = vi.fn(() => []);
  const mock = { ...actual, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync };
  return { ...mock, default: mock };
});

import { flakinessRoutes, computeFlakinessScore, upsertFlakinessRecord } from '../flakinessRoutes';
import { DATA_DIR } from '../../processPlugin';
import { resolve } from 'path';

// ── Helpers ─────────────────────────────────────────────────────

function mockReq(method: string, url: string, headers: Record<string, string> = {}): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage;
  emitter.method = method;
  emitter.url = url;
  emitter.headers = headers;
  return emitter;
}

function mockReqWithBody(
  method: string,
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage;
  emitter.method = method;
  emitter.url = url;
  emitter.headers = headers;
  process.nextTick(() => {
    emitter.emit('data', Buffer.from(JSON.stringify(body)));
    emitter.emit('end');
  });
  return emitter;
}

function mockRes(): ServerResponse & { _status: number; _body: string } {
  const res = {
    _status: 0,
    _body: '',
    writeHead(status: number) { res._status = status; return res; },
    end(body?: string) { if (body) res._body = body; return res; },
    write() { return true; },
    setHeader() { return res; },
  } as unknown as ServerResponse & { _status: number; _body: string };
  return res;
}

function seedRecords(records: TestFlakinessRecord[]): void {
  const filepath = norm(resolve(DATA_DIR, 'test-flakiness.json'));
  fileStore[filepath] = JSON.stringify(records, null, 2);
}

function readRecords(): TestFlakinessRecord[] {
  const filepath = norm(resolve(DATA_DIR, 'test-flakiness.json'));
  const raw = fileStore[filepath];
  return raw ? (JSON.parse(raw) as TestFlakinessRecord[]) : [];
}

function makeHistory(pattern: Array<'pass' | 'fail' | 'skip'>, startTs = 1): TestFlakinessHistoryEntry[] {
  return pattern.map((status, i) => ({ ts: startTs + i, status }));
}

beforeEach(() => {
  for (const key of Object.keys(fileStore)) delete fileStore[key];
});

// ── Pure helper tests ──────────────────────────────────────────

describe('computeFlakinessScore', () => {
  it('returns 0 for 10 passes in a row', () => {
    const history = makeHistory(Array.from({ length: 10 }, () => 'pass' as const));
    expect(computeFlakinessScore(history)).toBe(0);
  });

  it('returns 0 for 10 fails in a row', () => {
    const history = makeHistory(Array.from({ length: 10 }, () => 'fail' as const));
    expect(computeFlakinessScore(history)).toBe(0);
  });

  it('returns 1.0 for strictly alternating pass/fail (last 10)', () => {
    const history = makeHistory(['pass', 'fail', 'pass', 'fail', 'pass', 'fail', 'pass', 'fail', 'pass', 'fail']);
    expect(computeFlakinessScore(history)).toBe(1);
  });

  it('returns a low non-zero score for 8 passes + 2 fails clustered at the end', () => {
    const history = makeHistory(['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'fail', 'fail']);
    // one transition (pass→fail) in the window → 1/9 ≈ 0.11
    const score = computeFlakinessScore(history);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.2);
    expect(score).toBe(0.11);
  });

  it('returns 0 for an empty history', () => {
    expect(computeFlakinessScore([])).toBe(0);
  });

  it('ignores skip entries when counting transitions', () => {
    const history = makeHistory(['pass', 'skip', 'pass', 'skip', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
    expect(computeFlakinessScore(history)).toBe(0);
  });

  it('only considers the most recent 10 entries for the score window', () => {
    // Old stable fails, then recent alternating → score reflects recent window only
    const old: TestFlakinessHistoryEntry[] = makeHistory(['fail', 'fail', 'fail', 'fail', 'fail'], 1);
    const recent: TestFlakinessHistoryEntry[] = makeHistory(['pass', 'fail', 'pass', 'fail', 'pass', 'fail', 'pass', 'fail', 'pass', 'fail'], 100);
    expect(computeFlakinessScore([...old, ...recent])).toBe(1);
  });
});

describe('upsertFlakinessRecord', () => {
  it('creates a new record on first ingest', () => {
    const records: TestFlakinessRecord[] = [];
    upsertFlakinessRecord(records, { testName: 'foo > bar', file: 'foo.test.ts', status: 'pass', durationMs: 12 }, 1000);
    expect(records).toHaveLength(1);
    expect(records[0].runs).toBe(1);
    expect(records[0].passes).toBe(1);
    expect(records[0].fails).toBe(0);
    expect(records[0].lastStatus).toBe('pass');
    expect(records[0].recentHistory).toHaveLength(1);
    expect(records[0].recentHistory[0].durationMs).toBe(12);
  });

  it('updates an existing record on subsequent ingest', () => {
    const records: TestFlakinessRecord[] = [];
    upsertFlakinessRecord(records, { testName: 'foo > bar', file: 'foo.test.ts', status: 'pass' }, 1);
    upsertFlakinessRecord(records, { testName: 'foo > bar', file: 'foo.test.ts', status: 'fail' }, 2);
    expect(records).toHaveLength(1);
    expect(records[0].runs).toBe(2);
    expect(records[0].passes).toBe(1);
    expect(records[0].fails).toBe(1);
    expect(records[0].lastStatus).toBe('fail');
    expect(records[0].recentHistory.map(h => h.status)).toEqual(['pass', 'fail']);
  });

  it('caps recentHistory at 20 entries', () => {
    const records: TestFlakinessRecord[] = [];
    for (let i = 0; i < 25; i++) {
      upsertFlakinessRecord(records, { testName: 't', file: 'f', status: 'pass' }, i);
    }
    expect(records[0].recentHistory).toHaveLength(20);
    // The oldest 5 should have been dropped.
    expect(records[0].recentHistory[0].ts).toBe(5);
    expect(records[0].recentHistory[19].ts).toBe(24);
  });

  it('recomputes flakinessScore on every upsert', () => {
    const records: TestFlakinessRecord[] = [];
    upsertFlakinessRecord(records, { testName: 't', file: 'f', status: 'pass' }, 1);
    upsertFlakinessRecord(records, { testName: 't', file: 'f', status: 'fail' }, 2);
    upsertFlakinessRecord(records, { testName: 't', file: 'f', status: 'pass' }, 3);
    upsertFlakinessRecord(records, { testName: 't', file: 'f', status: 'fail' }, 4);
    expect(records[0].flakinessScore).toBeGreaterThan(0);
  });
});

// ── Route handler tests ────────────────────────────────────────

describe('flakinessRoutes GET /list', () => {
  it('returns empty array when no data', async () => {
    const req = mockReq('GET', '/__admin_flakiness/list');
    const res = mockRes();
    const handled = await flakinessRoutes(req, res);
    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(JSON.parse(res._body)).toEqual([]);
  });

  it('returns records sorted by flakiness score descending', async () => {
    const recs: TestFlakinessRecord[] = [
      { testName: 'a', file: 'f', runs: 10, passes: 10, fails: 0, lastRunAt: 1, lastStatus: 'pass', recentHistory: [], flakinessScore: 0, quarantined: false },
      { testName: 'b', file: 'f', runs: 10, passes: 5, fails: 5, lastRunAt: 2, lastStatus: 'fail', recentHistory: [], flakinessScore: 0.5, quarantined: false },
      { testName: 'c', file: 'f', runs: 10, passes: 5, fails: 5, lastRunAt: 3, lastStatus: 'fail', recentHistory: [], flakinessScore: 1.0, quarantined: false },
    ];
    seedRecords(recs);
    const req = mockReq('GET', '/__admin_flakiness/list');
    const res = mockRes();
    await flakinessRoutes(req, res);
    const body = JSON.parse(res._body) as TestFlakinessRecord[];
    expect(body.map(r => r.testName)).toEqual(['c', 'b', 'a']);
  });
});

describe('flakinessRoutes POST /ingest', () => {
  it('upserts records and recomputes scores', async () => {
    const req = mockReqWithBody('POST', '/__admin_flakiness/ingest', {
      results: [
        { testName: 't1', file: 'a.test.ts', status: 'pass', durationMs: 10 },
        { testName: 't2', file: 'b.test.ts', status: 'fail', durationMs: 20 },
      ],
    });
    const res = mockRes();
    await flakinessRoutes(req, res);
    expect(res._status).toBe(200);
    const body = JSON.parse(res._body) as { ingested: number; total: number };
    expect(body.ingested).toBe(2);
    expect(body.total).toBe(2);

    const stored = readRecords();
    expect(stored).toHaveLength(2);
    expect(stored.find(r => r.testName === 't1')?.passes).toBe(1);
    expect(stored.find(r => r.testName === 't2')?.fails).toBe(1);
  });

  it('rejects missing results array', async () => {
    const req = mockReqWithBody('POST', '/__admin_flakiness/ingest', { notResults: [] });
    const res = mockRes();
    await flakinessRoutes(req, res);
    expect(res._status).toBe(400);
    expect(JSON.parse(res._body).error).toContain('results');
  });

  it('skips invalid rows but accepts valid ones', async () => {
    const req = mockReqWithBody('POST', '/__admin_flakiness/ingest', {
      results: [
        { testName: 't1', file: 'a.test.ts', status: 'pass' },
        { testName: '', file: 'b', status: 'pass' },           // missing name
        { testName: 't3', file: 'c', status: 'bogus' },        // invalid status
      ],
    });
    const res = mockRes();
    await flakinessRoutes(req, res);
    expect(res._status).toBe(200);
    const body = JSON.parse(res._body) as { ingested: number };
    expect(body.ingested).toBe(1);
    expect(readRecords()).toHaveLength(1);
  });

  it('accumulates history over multiple ingests', async () => {
    for (const status of ['pass', 'fail', 'pass', 'fail'] as const) {
      const req = mockReqWithBody('POST', '/__admin_flakiness/ingest', {
        results: [{ testName: 't1', file: 'a.test.ts', status }],
      });
      const res = mockRes();
      await flakinessRoutes(req, res);
    }
    const stored = readRecords();
    expect(stored).toHaveLength(1);
    expect(stored[0].runs).toBe(4);
    expect(stored[0].recentHistory).toHaveLength(4);
    expect(stored[0].flakinessScore).toBeGreaterThan(0);
  });
});

describe('flakinessRoutes POST /quarantine', () => {
  it('sets quarantined and persists reason', async () => {
    seedRecords([
      { testName: 't1', file: 'f', runs: 1, passes: 1, fails: 0, lastRunAt: 1, lastStatus: 'pass', recentHistory: [], flakinessScore: 0, quarantined: false },
    ]);
    const req = mockReqWithBody('POST', '/__admin_flakiness/quarantine', {
      testName: 't1', quarantined: true, reason: 'flaky on CI',
    });
    const res = mockRes();
    await flakinessRoutes(req, res);
    expect(res._status).toBe(200);
    const stored = readRecords();
    expect(stored[0].quarantined).toBe(true);
    expect(stored[0].quarantineReason).toBe('flaky on CI');
  });

  it('clears reason when unquarantining', async () => {
    seedRecords([
      { testName: 't1', file: 'f', runs: 1, passes: 1, fails: 0, lastRunAt: 1, lastStatus: 'pass', recentHistory: [], flakinessScore: 0, quarantined: true, quarantineReason: 'old reason' },
    ]);
    const req = mockReqWithBody('POST', '/__admin_flakiness/quarantine', {
      testName: 't1', quarantined: false,
    });
    const res = mockRes();
    await flakinessRoutes(req, res);
    const stored = readRecords();
    expect(stored[0].quarantined).toBe(false);
    expect(stored[0].quarantineReason).toBeUndefined();
  });

  it('404s when testName not found', async () => {
    const req = mockReqWithBody('POST', '/__admin_flakiness/quarantine', { testName: 'nope', quarantined: true });
    const res = mockRes();
    await flakinessRoutes(req, res);
    expect(res._status).toBe(404);
  });
});

describe('flakinessRoutes DELETE /record', () => {
  it('removes the named record', async () => {
    seedRecords([
      { testName: 't1', file: 'f', runs: 1, passes: 1, fails: 0, lastRunAt: 1, lastStatus: 'pass', recentHistory: [], flakinessScore: 0, quarantined: false },
      { testName: 't2', file: 'f', runs: 1, passes: 1, fails: 0, lastRunAt: 1, lastStatus: 'pass', recentHistory: [], flakinessScore: 0, quarantined: false },
    ]);
    const req = mockReq('DELETE', '/__admin_flakiness/record?testName=t1');
    const res = mockRes();
    await flakinessRoutes(req, res);
    expect(res._status).toBe(200);
    const stored = readRecords();
    expect(stored).toHaveLength(1);
    expect(stored[0].testName).toBe('t2');
  });

  it('404s when record missing', async () => {
    const req = mockReq('DELETE', '/__admin_flakiness/record?testName=nope');
    const res = mockRes();
    await flakinessRoutes(req, res);
    expect(res._status).toBe(404);
  });
});

describe('flakinessRoutes POST /clear', () => {
  it('requires confirmation header', async () => {
    seedRecords([
      { testName: 't1', file: 'f', runs: 1, passes: 1, fails: 0, lastRunAt: 1, lastStatus: 'pass', recentHistory: [], flakinessScore: 0, quarantined: false },
    ]);
    const req = mockReq('POST', '/__admin_flakiness/clear');
    const res = mockRes();
    await flakinessRoutes(req, res);
    expect(res._status).toBe(400);
    expect(readRecords()).toHaveLength(1);
  });

  it('clears all records when confirmation header present', async () => {
    seedRecords([
      { testName: 't1', file: 'f', runs: 1, passes: 1, fails: 0, lastRunAt: 1, lastStatus: 'pass', recentHistory: [], flakinessScore: 0, quarantined: false },
    ]);
    const req = mockReq('POST', '/__admin_flakiness/clear', { 'x-admin-confirm': 'yes' });
    const res = mockRes();
    await flakinessRoutes(req, res);
    expect(res._status).toBe(200);
    expect(readRecords()).toEqual([]);
  });
});

describe('flakinessRoutes unmatched', () => {
  it('returns false for unrelated routes', async () => {
    const req = mockReq('GET', '/some-other-route');
    const res = mockRes();
    const handled = await flakinessRoutes(req, res);
    expect(handled).toBe(false);
  });
});
