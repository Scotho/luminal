import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';

// ── Mock fs (same pattern as sessions-api.test.ts) ─────────
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

// Mock githubHelper to avoid real API calls
vi.mock('../middleware/routes/githubHelper', () => ({
  GITHUB_REPO: 'Scotho/luminal',
  ghFetchJSON: vi.fn().mockResolvedValue(null),
  _clearCache: vi.fn(),
}));

import { pipelineRoutes } from '../middleware/routes/pipelineRoutes';
import { DATA_DIR } from '../middleware/processPlugin';
import { resolve } from 'path';
import type { DeployEntry, CoverageEntry } from '../types';

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
  // Use the same path that readJsonFile resolves: resolve(DATA_DIR, filename)
  const filepath = norm(resolve(DATA_DIR, filename));
  fileStore[filepath] = JSON.stringify(data, null, 2);
}

beforeEach(() => {
  for (const key of Object.keys(fileStore)) delete fileStore[key];
});

describe('pipelineRoutes', () => {
  describe('GET /__admin_pipeline/deploys', () => {
    it('returns empty array when no deploy history', async () => {
      const req = mockReq('GET', '/__admin_pipeline/deploys');
      const res = mockRes();
      const handled = await pipelineRoutes(req, res);
      expect(handled).toBe(true);
      expect(res._status).toBe(200);
      expect(JSON.parse(res._body)).toEqual([]);
    });

    it('returns deploy entries newest first', async () => {
      const deploys: DeployEntry[] = [
        { version: 'v1.0.5', timestamp: '2026-04-01T00:00:00Z', target: 'live+test', commit: 'aaa', branch: 'main', notes: ['a'], duration: 30 },
        { version: 'v1.0.6', timestamp: '2026-04-03T00:00:00Z', target: 'live+test', commit: 'bbb', branch: 'main', notes: ['b'], duration: 40 },
      ];
      seedData('deploy-history.json', deploys);

      const req = mockReq('GET', '/__admin_pipeline/deploys');
      const res = mockRes();
      await pipelineRoutes(req, res);
      const body = JSON.parse(res._body) as DeployEntry[];
      expect(body[0].version).toBe('v1.0.6');
      expect(body[1].version).toBe('v1.0.5');
    });

    it('respects limit param', async () => {
      const deploys: DeployEntry[] = Array.from({ length: 10 }, (_, i) => ({
        version: `v1.0.${i}`, timestamp: `2026-04-0${Math.min(i + 1, 9)}T00:00:00Z`, target: 'live+test',
        commit: `sha${i}`, branch: 'main', notes: [], duration: 10,
      }));
      seedData('deploy-history.json', deploys);

      const req = mockReq('GET', '/__admin_pipeline/deploys?limit=3');
      const res = mockRes();
      await pipelineRoutes(req, res);
      const body = JSON.parse(res._body) as DeployEntry[];
      expect(body).toHaveLength(3);
    });
  });

  describe('GET /__admin_pipeline/coverage', () => {
    it('returns empty array when no coverage history', async () => {
      const req = mockReq('GET', '/__admin_pipeline/coverage');
      const res = mockRes();
      const handled = await pipelineRoutes(req, res);
      expect(handled).toBe(true);
      expect(JSON.parse(res._body)).toEqual([]);
    });

    it('returns coverage entries', async () => {
      const entries: CoverageEntry[] = [
        { timestamp: '2026-04-01T00:00:00Z', commit: 'aaa', branch: 'main', coverage: 75.2, testCount: 70, passed: 70, failed: 0, duration: 9 },
        { timestamp: '2026-04-03T00:00:00Z', commit: 'bbb', branch: 'main', coverage: 78.5, testCount: 76, passed: 76, failed: 0, duration: 10 },
      ];
      seedData('coverage-history.json', entries);

      const req = mockReq('GET', '/__admin_pipeline/coverage');
      const res = mockRes();
      await pipelineRoutes(req, res);
      const body = JSON.parse(res._body) as CoverageEntry[];
      expect(body).toHaveLength(2);
      expect(body[1].coverage).toBe(78.5);
    });
  });

  it('returns false for unmatched routes', async () => {
    const req = mockReq('GET', '/some-other-route');
    const res = mockRes();
    const handled = await pipelineRoutes(req, res);
    expect(handled).toBe(false);
  });

  describe('POST /__admin_pipeline/rollback', () => {
    it('rejects when confirm is not true', async () => {
      const req = mockReqWithBody('POST', '/__admin_pipeline/rollback', {
        version: 'v1.0.6', commit: 'abc1234', site: 'luminal-game', confirm: false,
      });
      const res = mockRes();
      await pipelineRoutes(req, res);
      expect(res._status).toBe(400);
      expect(JSON.parse(res._body).error).toContain('confirm');
    });

    it('rejects when commit is missing', async () => {
      const req = mockReqWithBody('POST', '/__admin_pipeline/rollback', {
        version: 'v1.0.6', site: 'luminal-game', confirm: true,
      });
      const res = mockRes();
      await pipelineRoutes(req, res);
      expect(res._status).toBe(400);
      expect(JSON.parse(res._body).error).toContain('commit');
    });

    it('rejects short commit hashes', async () => {
      const req = mockReqWithBody('POST', '/__admin_pipeline/rollback', {
        version: 'v1.0.6', commit: 'ab', site: 'luminal-game', confirm: true,
      });
      const res = mockRes();
      await pipelineRoutes(req, res);
      expect(res._status).toBe(400);
    });
  });
});
