// admin/src/middleware/routes/__tests__/deployRoutes.test.ts
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

// ── Mock child_process: stub execSync (git check) ──────────
const { execSyncMock } = vi.hoisted(() => {
  return { execSyncMock: vi.fn<(cmd: string, opts?: unknown) => string>() };
});
vi.mock('child_process', async () => {
  // Return a shallow stub — the module under test only uses execSync.
  const execSync = (...args: unknown[]): string =>
    execSyncMock(args[0] as string, args[1]);
  const spawn = (): never => { throw new Error('spawn should be mocked at processManager level'); };
  return {
    execSync,
    spawn,
    default: { execSync, spawn },
  };
});

// ── Mock processManager.spawnLongRunning ──────────────────
const { spawnedRecords, agentsMap, killCounter } = vi.hoisted(() => {
  return {
    spawnedRecords: [] as { type: string; command: string; label?: string }[],
    agentsMap: new Map<string, {
      id: string;
      output: string[];
      proc: import('events').EventEmitter;
      done: boolean;
      sseClients: Set<unknown>;
    }>(),
    killCounter: { count: 0 },
  };
});

vi.mock('../../processManager', async () => {
  const { EventEmitter } = await import('events');
  return {
    agents: agentsMap,
    spawnLongRunning: vi.fn((type: string, command: string, _timeoutMs: number, _root: string, opts?: { label?: string }) => {
      spawnedRecords.push({ type, command, label: opts?.label });
      const proc = new EventEmitter();
      const state = {
        id: `agent-${spawnedRecords.length}`,
        output: [`[mock] ${command}`],
        proc,
        done: false,
        sseClients: new Set(),
      };
      agentsMap.set(state.id, state);
      // Simulate synchronous completion so runningIds doesn't leak across tests.
      // The route attaches a 'close' listener in attachLifecycle(); emit it
      // on the next microtask so the caller has time to register.
      queueMicrotask(() => {
        state.done = true;
        proc.emit('close', 0, null);
      });
      return state;
    }),
    killProcess: vi.fn(() => { killCounter.count++; }),
  };
});

// ── Module under test ─────────────────────────────────────
import { deployRoutes, isAllowedTarget, buildDeployCommand } from '../../routes/deployRoutes';
import { DATA_DIR } from '../../processPlugin';
import { resolve } from 'path';
import type { DeployRecord } from '../../../types';

// ── Helpers ───────────────────────────────────────────────

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

function readHistory(): DeployRecord[] {
  const filepath = norm(resolve(DATA_DIR, 'deploy-pipeline-history.json'));
  const raw = fileStore[filepath];
  return raw ? JSON.parse(raw) as DeployRecord[] : [];
}

beforeEach(() => {
  for (const key of Object.keys(fileStore)) delete fileStore[key];
  agentsMap.clear();
  spawnedRecords.length = 0;
  killCounter.count = 0;
  execSyncMock.mockReset();
  // Default: clean git tree
  execSyncMock.mockReturnValue('');
});

// ── Pure helpers ──────────────────────────────────────────

describe('deployRoutes — pure helpers', () => {
  it('isAllowedTarget accepts known targets', () => {
    expect(isAllowedTarget('live')).toBe(true);
    expect(isAllowedTarget('test')).toBe(true);
    expect(isAllowedTarget('rules')).toBe(true);
    expect(isAllowedTarget('functions')).toBe(true);
    expect(isAllowedTarget('hosting')).toBe(true);
  });

  it('isAllowedTarget rejects garbage and unknown targets', () => {
    expect(isAllowedTarget('prod')).toBe(false);
    expect(isAllowedTarget('; rm -rf')).toBe(false);
    expect(isAllowedTarget(42)).toBe(false);
    expect(isAllowedTarget(null)).toBe(false);
    expect(isAllowedTarget(undefined)).toBe(false);
  });

  it('buildDeployCommand never includes --force', () => {
    for (const t of ['live', 'test', 'rules', 'functions', 'hosting'] as const) {
      const cmd = buildDeployCommand(t, false);
      expect(cmd).not.toContain('--force');
      expect(cmd.startsWith('firebase deploy --only ')).toBe(true);
    }
  });

  it('buildDeployCommand appends --dry-run when requested', () => {
    const cmd = buildDeployCommand('live', true);
    expect(cmd).toContain('--dry-run');
  });
});

// ── HTTP routes ───────────────────────────────────────────

describe('deployRoutes — GET /__admin_deploy/history', () => {
  it('returns empty array when no history', async () => {
    const req = mockReq('GET', '/__admin_deploy/history');
    const res = mockRes();
    const handled = await deployRoutes(req, res);
    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(JSON.parse(res._body)).toEqual([]);
  });

  it('returns records newest first', async () => {
    const records: DeployRecord[] = [
      { id: 'a', target: 'test', startedAt: 1, status: 'success' },
      { id: 'b', target: 'rules', startedAt: 2, status: 'failure' },
    ];
    seedData('deploy-pipeline-history.json', records);

    const req = mockReq('GET', '/__admin_deploy/history');
    const res = mockRes();
    await deployRoutes(req, res);
    const body = JSON.parse(res._body) as DeployRecord[];
    expect(body[0].id).toBe('b');
    expect(body[1].id).toBe('a');
  });
});

describe('deployRoutes — POST /__admin_deploy/run', () => {
  it('rejects invalid target with 400', async () => {
    const req = mockReqWithBody('POST', '/__admin_deploy/run', { target: 'prod' });
    const res = mockRes();
    await deployRoutes(req, res);
    expect(res._status).toBe(400);
    expect(JSON.parse(res._body).error).toContain('Invalid target');
    expect(spawnedRecords).toHaveLength(0);
  });

  it('rejects missing target with 400', async () => {
    const req = mockReqWithBody('POST', '/__admin_deploy/run', {});
    const res = mockRes();
    await deployRoutes(req, res);
    expect(res._status).toBe(400);
    expect(spawnedRecords).toHaveLength(0);
  });

  it('rejects deploy when git working tree is dirty', async () => {
    execSyncMock.mockReturnValue(' M foo.ts\n'); // dirty
    const req = mockReqWithBody('POST', '/__admin_deploy/run', { target: 'test' });
    const res = mockRes();
    await deployRoutes(req, res);
    expect(res._status).toBe(409);
    expect(JSON.parse(res._body).error).toMatch(/dirty/i);
    expect(spawnedRecords).toHaveLength(0);
  });

  it('happy path: spawns firebase deploy and records history', async () => {
    execSyncMock.mockReturnValue('');
    const req = mockReqWithBody('POST', '/__admin_deploy/run', { target: 'test' });
    const res = mockRes();
    await deployRoutes(req, res);
    expect(res._status).toBe(200);
    const body = JSON.parse(res._body) as { ok: boolean; id: string; command: string };
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^deploy-/);
    expect(body.command).toContain('firebase deploy');
    expect(body.command).not.toContain('--force');

    expect(spawnedRecords).toHaveLength(1);
    expect(spawnedRecords[0].type).toBe('deploy');
    expect(spawnedRecords[0].command).toContain('firebase deploy');

    // History starts out as 'running' and — once the mocked close fires on
    // the microtask queue — is updated to 'success' with exit 0.
    await Promise.resolve();
    await Promise.resolve();
    const history = readHistory();
    expect(history).toHaveLength(1);
    expect(history[0].target).toBe('test');
    expect(history[0].status).toBe('success');
    expect(history[0].exitCode).toBe(0);
  });

  it('dry-run bypasses the git-clean check and spawns with --dry-run', async () => {
    execSyncMock.mockReturnValue(' M foo.ts\n'); // dirty tree
    const req = mockReqWithBody('POST', '/__admin_deploy/run', { target: 'live', dryRun: true });
    const res = mockRes();
    await deployRoutes(req, res);
    expect(res._status).toBe(200);
    expect(spawnedRecords).toHaveLength(1);
    expect(spawnedRecords[0].command).toContain('--dry-run');
  });
});

describe('deployRoutes — unmatched routes', () => {
  it('returns false for paths outside the namespace', async () => {
    const req = mockReq('GET', '/something-else');
    const res = mockRes();
    const handled = await deployRoutes(req, res);
    expect(handled).toBe(false);
  });
});
