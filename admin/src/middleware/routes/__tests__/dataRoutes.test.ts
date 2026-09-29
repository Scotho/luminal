// admin/src/middleware/routes/__tests__/dataRoutes.test.ts — SPEC-97
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';

// ── Mock fs ───────────────────────────────────────────────────
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
  const readdirSync = vi.fn((dirPath: string) => {
    const n = norm(dirPath);
    const files: string[] = [];
    for (const key of Object.keys(fileStore)) {
      const normKey = norm(key);
      // Only direct children, not nested
      if (normKey.startsWith(n + '/') && !normKey.slice(n.length + 1).includes('/')) {
        files.push(normKey.slice(n.length + 1));
      }
    }
    return files;
  });
  const copyFileSync = vi.fn((src: string, dest: string) => {
    const n = norm(src);
    const key = Object.keys(fileStore).find(k => norm(k) === n);
    if (key === undefined) throw new Error(`ENOENT: ${src}`);
    fileStore[norm(dest)] = fileStore[key];
  });
  const statSync = vi.fn((filepath: string) => {
    const n = norm(filepath);
    const key = Object.keys(fileStore).find(k => norm(k) === n);
    if (key === undefined) throw new Error(`ENOENT: ${filepath}`);
    return { size: Buffer.byteLength(fileStore[key], 'utf-8') };
  });
  const mock = {
    ...actual,
    readFileSync, writeFileSync, existsSync, mkdirSync,
    readdirSync, copyFileSync, statSync,
  };
  return { ...mock, default: mock };
});

import { dataRoutes } from '../dataRoutes';
import { DATA_DIR } from '../../processPlugin';
import { resolve } from 'path';

// ── Helpers ───────────────────────────────────────────────────

function mockReq(method: string, url: string): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage;
  emitter.method = method;
  emitter.url = url;
  emitter.headers = {};
  return emitter;
}

function mockReqWithBody(
  method: string,
  url: string,
  body: Record<string, unknown>,
): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage;
  emitter.method = method;
  emitter.url = url;
  emitter.headers = {};
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

function seedFile(filename: string, data: unknown): void {
  const filepath = norm(resolve(DATA_DIR, filename));
  fileStore[filepath] = JSON.stringify(data, null, 2);
}

beforeEach(() => {
  for (const key of Object.keys(fileStore)) delete fileStore[key];
});

// ── GET /__admin_agent_history/stats ──────────────────────────

describe('GET /__admin_agent_history/stats', () => {
  it('returns size and entry count', async () => {
    const entries = [
      { id: 'a', startedAt: 1000 },
      { id: 'b', startedAt: 2000 },
    ];
    seedFile('agent-history.json', entries);

    const req = mockReq('GET', '/__admin_agent_history/stats');
    const res = mockRes();
    const handled = await dataRoutes(req, res);

    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.entries).toBe(2);
    expect(body.sizeBytes).toBeGreaterThan(0);
    expect(body.sizeHuman).toMatch(/B|KB|MB/);
  });

  it('returns zero when file does not exist', async () => {
    const req = mockReq('GET', '/__admin_agent_history/stats');
    const res = mockRes();
    await dataRoutes(req, res);

    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.entries).toBe(0);
    expect(body.sizeBytes).toBe(0);
    expect(body.sizeHuman).toBe('0 B');
  });
});

// ── POST /__admin_agent_history/prune ─────────────────────────

describe('POST /__admin_agent_history/prune', () => {
  it('prunes entries older than maxAgeDays', async () => {
    const now = Date.now();
    const entries = [
      { id: 'old', startedAt: now - 10 * 24 * 60 * 60 * 1000 }, // 10 days ago
      { id: 'recent', startedAt: now - 1 * 24 * 60 * 60 * 1000 }, // 1 day ago
    ];
    seedFile('agent-history.json', entries);

    const req = mockReqWithBody('POST', '/__admin_agent_history/prune', { maxAgeDays: 7 });
    const res = mockRes();
    await dataRoutes(req, res);

    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.pruned).toBe(1);
    expect(body.remaining).toBe(1);

    // Verify the file was updated
    const filepath = norm(resolve(DATA_DIR, 'agent-history.json'));
    const saved = JSON.parse(fileStore[filepath]) as Array<{ id: string }>;
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe('recent');
  });

  it('defaults to 7 days when maxAgeDays not provided', async () => {
    const now = Date.now();
    const entries = [
      { id: 'old', startedAt: now - 8 * 24 * 60 * 60 * 1000 },
      { id: 'new', startedAt: now - 1000 },
    ];
    seedFile('agent-history.json', entries);

    const req = mockReqWithBody('POST', '/__admin_agent_history/prune', {});
    const res = mockRes();
    await dataRoutes(req, res);

    const body = JSON.parse(res._body);
    expect(body.pruned).toBe(1);
    expect(body.remaining).toBe(1);
  });

  it('rejects invalid maxAgeDays', async () => {
    const req = mockReqWithBody('POST', '/__admin_agent_history/prune', { maxAgeDays: -1 });
    const res = mockRes();
    await dataRoutes(req, res);

    expect(res._status).toBe(400);
    expect(JSON.parse(res._body).error).toContain('maxAgeDays');
  });

  it('keeps all entries when none are old enough', async () => {
    const now = Date.now();
    const entries = [
      { id: 'a', startedAt: now - 1000 },
      { id: 'b', startedAt: now - 2000 },
    ];
    seedFile('agent-history.json', entries);

    const req = mockReqWithBody('POST', '/__admin_agent_history/prune', { maxAgeDays: 7 });
    const res = mockRes();
    await dataRoutes(req, res);

    const body = JSON.parse(res._body);
    expect(body.pruned).toBe(0);
    expect(body.remaining).toBe(2);
  });
});

// ── POST /__admin_data/backup ─────────────────────────────────

describe('POST /__admin_data/backup', () => {
  it('copies all JSON files to a timestamped backup directory', async () => {
    seedFile('tasks.json', [{ id: 't1' }]);
    seedFile('counters.json', { TASK: 5 });

    const req = mockReqWithBody('POST', '/__admin_data/backup', {});
    const res = mockRes();
    await dataRoutes(req, res);

    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.message).toMatch(/^Backup created at backups\/backup-/);
    expect(body.files).toBe(2);

    // Verify files were copied into backup directory
    const backupKeys = Object.keys(fileStore).filter(k => norm(k).includes('/backups/backup-'));
    expect(backupKeys.length).toBe(2);
  });

  it('returns file count of 0 when no JSON files exist', async () => {
    const req = mockReqWithBody('POST', '/__admin_data/backup', {});
    const res = mockRes();
    await dataRoutes(req, res);

    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.files).toBe(0);
  });
});
