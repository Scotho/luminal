// admin/src/__tests__/perfRoutes.test.ts — Perf tracker route tests

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';

// ── Mock fs (same pattern as pipelineRoutes.test.ts) ───────
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

import { perfRoutes, buildSampleFromBody, type PerfSample } from '../middleware/routes/perfRoutes';
import { DATA_DIR } from '../middleware/processPlugin';
import { resolve } from 'path';

// ── Helpers ─────────────────────────────────────────────────
function mockReq(method: string, url: string): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage;
  emitter.method = method;
  emitter.url = url;
  return emitter;
}

function mockReqWithBody(method: string, url: string, body: Record<string, unknown>): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage;
  emitter.method = method;
  emitter.url = url;
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

function seedData(filename: string, data: unknown): void {
  const filepath = norm(resolve(DATA_DIR, filename));
  fileStore[filepath] = JSON.stringify(data, null, 2);
}

function readData<T>(filename: string): T | null {
  const filepath = norm(resolve(DATA_DIR, filename));
  const raw = fileStore[filepath];
  if (raw === undefined) return null;
  return JSON.parse(raw) as T;
}

beforeEach(() => {
  for (const key of Object.keys(fileStore)) delete fileStore[key];
});

// ── buildSampleFromBody ─────────────────────────────────────
describe('buildSampleFromBody', () => {
  it('returns an error when version is missing', () => {
    const result = buildSampleFromBody({ commit: 'abc' });
    expect('error' in result && result.error).toBe('Missing version');
  });

  it('returns an error when commit is missing', () => {
    const result = buildSampleFromBody({ version: 'v1.0.0' });
    expect('error' in result && result.error).toBe('Missing commit');
  });

  it('strips undefined/invalid metric values', () => {
    const result = buildSampleFromBody({
      version: 'v1.0.0',
      commit: 'abc',
      metrics: { avgFrameTime: 16, loadTimeMs: 'nope', bundleSizeKb: -10, p95FrameTime: Infinity },
    });
    expect('error' in result).toBe(false);
    const sample = result as PerfSample;
    expect(sample.metrics.avgFrameTime).toBe(16);
    expect(sample.metrics.loadTimeMs).toBeUndefined();
    expect(sample.metrics.bundleSizeKb).toBeUndefined();
    expect(sample.metrics.p95FrameTime).toBeUndefined();
  });

  it('assigns auto id and timestamp', () => {
    const result = buildSampleFromBody({
      version: 'v1.0.0',
      commit: 'abc',
      metrics: { avgFrameTime: 16 },
    }) as PerfSample;
    expect(result.id).toMatch(/^perf_/);
    expect(typeof result.timestamp).toBe('number');
  });

  it('defaults source to "manual" and preserves notes', () => {
    const result = buildSampleFromBody({
      version: 'v1.0.0',
      commit: 'abc',
      notes: 'hello',
    }) as PerfSample;
    expect(result.source).toBe('manual');
    expect(result.notes).toBe('hello');
  });
});

// ── perfRoutes ──────────────────────────────────────────────
describe('perfRoutes', () => {
  it('returns false for unrelated routes', async () => {
    const req = mockReq('GET', '/something-else');
    const res = mockRes();
    expect(await perfRoutes(req, res)).toBe(false);
  });

  describe('GET /__admin_perf/list', () => {
    it('returns empty array when no history', async () => {
      const req = mockReq('GET', '/__admin_perf/list');
      const res = mockRes();
      const handled = await perfRoutes(req, res);
      expect(handled).toBe(true);
      expect(res._status).toBe(200);
      expect(JSON.parse(res._body)).toEqual([]);
    });

    it('returns samples newest-first', async () => {
      const samples: PerfSample[] = [
        { id: 'a', version: 'v1', commit: 'aaa', timestamp: 1000, metrics: { avgFrameTime: 16 } },
        { id: 'b', version: 'v2', commit: 'bbb', timestamp: 3000, metrics: { avgFrameTime: 17 } },
        { id: 'c', version: 'v1.5', commit: 'ccc', timestamp: 2000, metrics: { avgFrameTime: 18 } },
      ];
      seedData('perf-history.json', samples);
      const req = mockReq('GET', '/__admin_perf/list');
      const res = mockRes();
      await perfRoutes(req, res);
      const body = JSON.parse(res._body) as PerfSample[];
      expect(body.map(s => s.id)).toEqual(['b', 'c', 'a']);
    });
  });

  describe('POST /__admin_perf/sample', () => {
    it('ingests a valid sample', async () => {
      const req = mockReqWithBody('POST', '/__admin_perf/sample', {
        version: 'v1.0.0',
        commit: 'abc1234',
        metrics: { avgFrameTime: 16, loadTimeMs: 800 },
        source: 'ci',
        notes: 'from test',
      });
      const res = mockRes();
      await perfRoutes(req, res);
      expect(res._status).toBe(200);
      const body = JSON.parse(res._body) as { ok: boolean; sample: PerfSample };
      expect(body.ok).toBe(true);
      expect(body.sample.version).toBe('v1.0.0');
      expect(body.sample.metrics.avgFrameTime).toBe(16);
      expect(body.sample.metrics.loadTimeMs).toBe(800);
      expect(body.sample.source).toBe('ci');
      expect(body.sample.notes).toBe('from test');

      // And the file was updated
      const stored = readData<PerfSample[]>('perf-history.json');
      expect(stored).toHaveLength(1);
    });

    it('appends to existing history', async () => {
      seedData('perf-history.json', [
        { id: 'old', version: 'v0.9', commit: 'old', timestamp: 100, metrics: {} },
      ]);
      const req = mockReqWithBody('POST', '/__admin_perf/sample', {
        version: 'v1',
        commit: 'new',
        metrics: { avgFrameTime: 20 },
      });
      const res = mockRes();
      await perfRoutes(req, res);
      expect(res._status).toBe(200);
      const stored = readData<PerfSample[]>('perf-history.json');
      expect(stored).toHaveLength(2);
    });

    it('rejects when version is missing', async () => {
      const req = mockReqWithBody('POST', '/__admin_perf/sample', { commit: 'abc' });
      const res = mockRes();
      await perfRoutes(req, res);
      expect(res._status).toBe(400);
      expect(JSON.parse(res._body).error).toContain('version');
    });

    it('rejects when commit is missing', async () => {
      const req = mockReqWithBody('POST', '/__admin_perf/sample', { version: 'v1' });
      const res = mockRes();
      await perfRoutes(req, res);
      expect(res._status).toBe(400);
      expect(JSON.parse(res._body).error).toContain('commit');
    });
  });

  describe('DELETE /__admin_perf/sample', () => {
    it('removes a sample by id', async () => {
      seedData('perf-history.json', [
        { id: 'a', version: 'v1', commit: 'a', timestamp: 1, metrics: {} },
        { id: 'b', version: 'v1', commit: 'b', timestamp: 2, metrics: {} },
      ]);
      const req = mockReq('DELETE', '/__admin_perf/sample?id=a');
      const res = mockRes();
      await perfRoutes(req, res);
      expect(res._status).toBe(200);
      const stored = readData<PerfSample[]>('perf-history.json');
      expect(stored).toHaveLength(1);
      expect(stored![0].id).toBe('b');
    });

    it('returns 400 when id is missing', async () => {
      const req = mockReq('DELETE', '/__admin_perf/sample');
      const res = mockRes();
      await perfRoutes(req, res);
      expect(res._status).toBe(400);
    });

    it('returns 404 when sample is not found', async () => {
      seedData('perf-history.json', []);
      const req = mockReq('DELETE', '/__admin_perf/sample?id=missing');
      const res = mockRes();
      await perfRoutes(req, res);
      expect(res._status).toBe(404);
    });
  });
});
