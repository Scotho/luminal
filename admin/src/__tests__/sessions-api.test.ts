// ── Session API endpoint tests ──────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Session, AgentTask } from '../types';

// ── Mock fs ─────────────────────────────────────────────────

const { fileStore, norm } = vi.hoisted(() => {
  const fileStore: Record<string, string> = {};
  const norm = (p: string): string => p.replace(/\\/g, '/');
  return { fileStore, norm };
});

function findKey(suffix: string): string | undefined {
  return Object.keys(fileStore).find(k => norm(k).endsWith(suffix));
}

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
  const mock = { ...actual, readFileSync, writeFileSync, existsSync, mkdirSync };
  return { ...mock, default: mock };
});

vi.mock('fs/promises', () => {
  const readFile = vi.fn(async (filepath: string) => {
    const n = norm(filepath);
    const key = Object.keys(fileStore).find(k => norm(k) === n);
    if (key === undefined) throw new Error(`ENOENT: ${filepath}`);
    return fileStore[key];
  });
  const writeFile = vi.fn(async (filepath: string, data: string) => {
    fileStore[norm(filepath)] = data;
  });
  const rename = vi.fn(async (src: string, dest: string) => {
    const ns = norm(src);
    const nd = norm(dest);
    if (fileStore[ns] !== undefined) {
      fileStore[nd] = fileStore[ns];
      delete fileStore[ns];
    }
  });
  const copyFile = vi.fn(async (src: string, dest: string) => {
    const ns = norm(src);
    const nd = norm(dest);
    if (fileStore[ns] !== undefined) {
      fileStore[nd] = fileStore[ns];
    }
  });
  const mock = { readFile, writeFile, rename, copyFile };
  return { ...mock, default: mock };
});

// ── Import middleware after mocking ─────────────────────────

import { processPlugin } from '../middleware/processPlugin';

// ── Helpers ─────────────────────────────────────────────────

function mockReq(method: string, url: string, body?: Record<string, unknown>): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage;
  emitter.method = method;
  emitter.url = url;
  if (body !== undefined) {
    process.nextTick(() => {
      emitter.emit('data', Buffer.from(JSON.stringify(body)));
      emitter.emit('end');
    });
  }
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

function parseResBody(res: { _body: string }): Record<string, unknown> {
  return JSON.parse(res._body) as Record<string, unknown>;
}

function getMiddleware(): (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void> {
  const plugin = processPlugin();
  const mockServer = { middlewares: { use: vi.fn() } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (plugin as any).configureServer(mockServer);
  return mockServer.middlewares.use.mock.calls[0][0] as (
    req: IncomingMessage, res: ServerResponse, next: () => void,
  ) => Promise<void>;
}

function readPersistedFile(filename: string): unknown {
  const key = findKey(`/data/${filename}`);
  if (!key) return undefined;
  return JSON.parse(fileStore[key]);
}

async function seedViaEndpoint(
  h: typeof handler, url: string, body: Record<string, unknown>,
  dataFilename: string, seedData: unknown,
): Promise<void> {
  const req = mockReq('POST', url, body);
  const res = mockRes();
  await h(req, res, () => {});
  const key = findKey(`/data/${dataFilename}`);
  if (key) {
    fileStore[key] = JSON.stringify(seedData, null, 2);
  }
}

// ── Test setup ──────────────────────────────────────────────

let handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>;

async function seedSessions(sessions: Session[]): Promise<void> {
  await seedViaEndpoint(handler, '/__admin_session', { summary: 'seed' }, 'sessions.json', sessions);
}

async function seedAgentTasks(tasks: AgentTask[]): Promise<void> {
  await seedViaEndpoint(handler, '/__admin_session/agent-task', { sessionId: 's', prompt: 'x' }, 'agent-tasks.json', tasks);
}

beforeEach(() => {
  for (const key of Object.keys(fileStore)) delete fileStore[key];
  handler = getMiddleware();
});

// ── Fixtures ────────────────────────────────────────────────

function makeSeedSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess_test_001',
    summary: 'Test session',
    type: 'feature',
    status: 'todo',
    section: 'current-stack',
    phases: [
      { label: 'Phase 1', done: false },
      { label: 'Phase 2', done: false },
    ],
    plan: 'Do the thing',
    notes: [],
    created: '2026-04-01T10:00:00Z',
    ...overrides,
  };
}

function makeSeedAgentTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'atask_test_001',
    sessionId: 'sess_test_001',
    prompt: 'Do something',
    agentStatus: 'pending',
    ...overrides,
  };
}

// ── 1. POST /__admin_session (create) ───────────────────────

describe('POST /__admin_session', () => {
  it('creates a session with correct fields and returns {ok, id}', async () => {
    const req = mockReq('POST', '/__admin_session', {
      summary: 'Implement feature X',
      type: 'feature',
      status: 'todo',
      section: 'current-stack',
      phases: [{ label: 'Design', done: false }],
      plan: 'Build it',
      specPath: 'docs/spec.md',
      branch: 'feat/x',
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(200);
    const body = parseResBody(res);
    expect(body['ok']).toBe(true);
    expect(typeof body['id']).toBe('string');
    expect((body['id'] as string).startsWith('sess_')).toBe(true);

    const sessions = readPersistedFile('sessions.json') as Session[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0].summary).toBe('Implement feature X');
    expect(sessions[0].type).toBe('feature');
    expect(sessions[0].status).toBe('todo');
    expect(sessions[0].section).toBe('current-stack');
    expect(sessions[0].phases).toEqual([{ label: 'Design', done: false }]);
    expect(sessions[0].plan).toBe('Build it');
    expect(sessions[0].specPath).toBe('docs/spec.md');
    expect(sessions[0].branch).toBe('feat/x');
    expect(sessions[0].notes).toEqual([]);
    expect(sessions[0].created).toBeDefined();
  });

  it('defaults type to feature and status to todo', async () => {
    const req = mockReq('POST', '/__admin_session', { summary: 'Minimal' });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(200);
    const sessions = readPersistedFile('sessions.json') as Session[];
    expect(sessions[0].type).toBe('feature');
    expect(sessions[0].status).toBe('todo');
    expect(sessions[0].section).toBe('backlog');
  });

  it('omits specPath and branch when not provided', async () => {
    const req = mockReq('POST', '/__admin_session', { summary: 'No branch' });
    const res = mockRes();
    await handler(req, res, () => {});

    const sessions = readPersistedFile('sessions.json') as Session[];
    expect(sessions[0]).not.toHaveProperty('specPath');
    expect(sessions[0]).not.toHaveProperty('branch');
  });

  it('sets source to admin', async () => {
    const req = mockReq('POST', '/__admin_session', {
      summary: 'Source test',
      type: 'chore',
      status: 'active',
      section: 'current-stack',
      phases: ['implement'],
      plan: 'test',
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(200);
    const sessions = readPersistedFile('sessions.json') as Session[];
    const created = sessions.find((s) => s.summary === 'Source test');
    expect(created?.source).toBe('admin');
  });
});

// ── 2. GET /__admin_session?id=X ────────────────────────────

describe('GET /__admin_session', () => {
  it('returns a session by id', async () => {
    await seedSessions([makeSeedSession()]);

    const req = mockReq('GET', '/__admin_session?id=sess_test_001');
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(200);
    const body = parseResBody(res);
    expect(body['id']).toBe('sess_test_001');
    expect(body['summary']).toBe('Test session');
  });

  it('returns 404 for missing session', async () => {
    await seedSessions([]);

    const req = mockReq('GET', '/__admin_session?id=nonexistent');
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(404);
    expect(parseResBody(res)['error']).toBe('Session not found');
  });
});

// ── 3. PATCH /__admin_session/phase ─────────────────────────

describe('PATCH /__admin_session/phase', () => {
  it('toggles a phase done status', async () => {
    await seedSessions([makeSeedSession()]);

    const req = mockReq('PATCH', '/__admin_session/phase', {
      id: 'sess_test_001', index: 0, done: true,
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(200);
    expect(parseResBody(res)['ok']).toBe(true);

    const sessions = readPersistedFile('sessions.json') as Session[];
    expect(sessions[0].phases[0].done).toBe(true);
    expect(sessions[0].phases[1].done).toBe(false);
  });

  it('returns 404 for missing session', async () => {
    await seedSessions([]);

    const req = mockReq('PATCH', '/__admin_session/phase', {
      id: 'nonexistent', index: 0, done: true,
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(404);
  });

  it('returns 400 for out-of-bounds index', async () => {
    await seedSessions([makeSeedSession()]);

    const req = mockReq('PATCH', '/__admin_session/phase', {
      id: 'sess_test_001', index: 99, done: true,
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(400);
    expect(parseResBody(res)['error']).toBe('Invalid phase index');
  });

  it('returns 400 for negative index', async () => {
    await seedSessions([makeSeedSession()]);

    const req = mockReq('PATCH', '/__admin_session/phase', {
      id: 'sess_test_001', index: -1, done: true,
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(400);
    expect(parseResBody(res)['error']).toBe('Invalid phase index');
  });

  it('returns 400 for non-integer index', async () => {
    await seedSessions([makeSeedSession()]);

    const req = mockReq('PATCH', '/__admin_session/phase', {
      id: 'sess_test_001', index: 1.5, done: true,
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(400);
  });
});

// ── 4. PATCH /__admin_session/status ────────────────────────

describe('PATCH /__admin_session/status', () => {
  it('updates status to active', async () => {
    await seedSessions([makeSeedSession()]);

    const req = mockReq('PATCH', '/__admin_session/status', {
      id: 'sess_test_001', status: 'active',
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(200);
    const sessions = readPersistedFile('sessions.json') as Session[];
    expect(sessions[0].status).toBe('active');
    expect(sessions[0].completed).toBeUndefined();
  });

  it('sets completed timestamp when status is done', async () => {
    await seedSessions([makeSeedSession()]);

    const req = mockReq('PATCH', '/__admin_session/status', {
      id: 'sess_test_001', status: 'done',
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(200);
    const sessions = readPersistedFile('sessions.json') as Session[];
    expect(sessions[0].status).toBe('done');
    expect(sessions[0].completed).toBeDefined();
  });

  it('sets completed timestamp when status is done-followup', async () => {
    await seedSessions([makeSeedSession()]);

    const req = mockReq('PATCH', '/__admin_session/status', {
      id: 'sess_test_001', status: 'done-followup',
    });
    const res = mockRes();
    await handler(req, res, () => {});

    const sessions = readPersistedFile('sessions.json') as Session[];
    expect(sessions[0].completed).toBeDefined();
  });

  it('clears completed when transitioning away from done', async () => {
    const doneSession = makeSeedSession({ status: 'done', completed: '2026-04-01T12:00:00Z' });
    await seedSessions([doneSession]);

    const req = mockReq('PATCH', '/__admin_session/status', {
      id: 'sess_test_001', status: 'active',
    });
    const res = mockRes();
    await handler(req, res, () => {});

    const sessions = readPersistedFile('sessions.json') as Session[];
    expect(sessions[0].status).toBe('active');
    expect(sessions[0]).not.toHaveProperty('completed');
  });

  it('returns 400 for invalid status value', async () => {
    await seedSessions([makeSeedSession()]);

    const req = mockReq('PATCH', '/__admin_session/status', {
      id: 'sess_test_001', status: 'invalid-status',
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(400);
    expect(parseResBody(res)['error']).toBe('Invalid session status');
  });

  it('returns 404 for missing session', async () => {
    await seedSessions([]);

    const req = mockReq('PATCH', '/__admin_session/status', {
      id: 'nonexistent', status: 'active',
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(404);
  });

  it('validates all allowed statuses', async () => {
    const validStatuses = ['todo', 'active', 'blocked', 'done', 'done-followup', 'needs-attention'];
    for (const status of validStatuses) {
      await seedSessions([makeSeedSession()]);
      const req = mockReq('PATCH', '/__admin_session/status', {
        id: 'sess_test_001', status,
      });
      const res = mockRes();
      await handler(req, res, () => {});
      expect(res._status).toBe(200);
    }
  });
});

// ── 5. POST /__admin_session/note ───────────────────────────

describe('POST /__admin_session/note', () => {
  it('appends a timestamped note', async () => {
    await seedSessions([makeSeedSession()]);

    const req = mockReq('POST', '/__admin_session/note', {
      id: 'sess_test_001', text: 'This is a note',
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(200);
    expect(parseResBody(res)['ok']).toBe(true);

    const sessions = readPersistedFile('sessions.json') as Session[];
    expect(sessions[0].notes).toHaveLength(1);
    expect(sessions[0].notes[0].text).toBe('This is a note');
    expect(sessions[0].notes[0].ts).toBeDefined();
  });

  it('appends multiple notes preserving order', async () => {
    const session = makeSeedSession({
      notes: [{ ts: '2026-04-01T10:00:00Z', text: 'First note' }],
    });
    await seedSessions([session]);

    const req = mockReq('POST', '/__admin_session/note', {
      id: 'sess_test_001', text: 'Second note',
    });
    const res = mockRes();
    await handler(req, res, () => {});

    const sessions = readPersistedFile('sessions.json') as Session[];
    expect(sessions[0].notes).toHaveLength(2);
    expect(sessions[0].notes[0].text).toBe('First note');
    expect(sessions[0].notes[1].text).toBe('Second note');
  });

  it('returns 404 for missing session', async () => {
    await seedSessions([]);

    const req = mockReq('POST', '/__admin_session/note', {
      id: 'nonexistent', text: 'orphan note',
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(404);
  });
});

// ── 6. POST /__admin_session/agent-task (create) ────────────

describe('POST /__admin_session/agent-task', () => {
  it('creates an agent task with correct fields', async () => {
    const req = mockReq('POST', '/__admin_session/agent-task', {
      sessionId: 'sess_test_001', prompt: 'Run the linter',
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(200);
    const body = parseResBody(res);
    expect(body['ok']).toBe(true);
    expect(typeof body['id']).toBe('string');
    expect((body['id'] as string).startsWith('atask_')).toBe(true);

    const tasks = readPersistedFile('agent-tasks.json') as AgentTask[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0].sessionId).toBe('sess_test_001');
    expect(tasks[0].prompt).toBe('Run the linter');
    expect(tasks[0].agentStatus).toBe('pending');
  });
});

// ── 7. PATCH /__admin_session/agent-task (update) ───────────

describe('PATCH /__admin_session/agent-task', () => {
  it('updates agentStatus', async () => {
    await seedAgentTasks([makeSeedAgentTask()]);

    const req = mockReq('PATCH', '/__admin_session/agent-task', {
      id: 'atask_test_001', agentStatus: 'running',
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(200);
    const tasks = readPersistedFile('agent-tasks.json') as AgentTask[];
    expect(tasks[0].agentStatus).toBe('running');
  });

  it('updates output when provided', async () => {
    await seedAgentTasks([makeSeedAgentTask()]);

    const req = mockReq('PATCH', '/__admin_session/agent-task', {
      id: 'atask_test_001', agentStatus: 'done', output: 'All tests passed',
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(200);
    const tasks = readPersistedFile('agent-tasks.json') as AgentTask[];
    expect(tasks[0].output).toBe('All tests passed');
    expect(tasks[0].agentStatus).toBe('done');
  });

  it('returns 400 for invalid agentStatus', async () => {
    await seedAgentTasks([makeSeedAgentTask()]);

    const req = mockReq('PATCH', '/__admin_session/agent-task', {
      id: 'atask_test_001', agentStatus: 'bogus',
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(400);
    expect(parseResBody(res)['error']).toBe('Invalid agentStatus');
  });

  it('returns 404 for missing agent task', async () => {
    await seedAgentTasks([]);

    const req = mockReq('PATCH', '/__admin_session/agent-task', {
      id: 'nonexistent', agentStatus: 'done',
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(404);
    expect(parseResBody(res)['error']).toBe('Agent task not found');
  });

  it('validates all allowed agentStatus values', async () => {
    const validStatuses = ['pending', 'running', 'done', 'error'];
    for (const agentStatus of validStatuses) {
      await seedAgentTasks([makeSeedAgentTask()]);
      const req = mockReq('PATCH', '/__admin_session/agent-task', {
        id: 'atask_test_001', agentStatus,
      });
      const res = mockRes();
      await handler(req, res, () => {});
      expect(res._status).toBe(200);
    }
  });
});

// ── 8. GET /__admin_session/agent-task?id=X ─────────────────

describe('GET /__admin_session/agent-task', () => {
  it('returns an agent task by id', async () => {
    await seedAgentTasks([makeSeedAgentTask()]);

    const req = mockReq('GET', '/__admin_session/agent-task?id=atask_test_001');
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(200);
    const body = parseResBody(res);
    expect(body['id']).toBe('atask_test_001');
    expect(body['prompt']).toBe('Do something');
  });

  it('returns 404 for missing agent task', async () => {
    await seedAgentTasks([]);

    const req = mockReq('GET', '/__admin_session/agent-task?id=nonexistent');
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(404);
    expect(parseResBody(res)['error']).toBe('Agent task not found');
  });
});

// ── 9. PATCH /__admin_session/reorder ───────────────────────

describe('PATCH /__admin_session/reorder', () => {
  it('reorders current-stack sessions and logs', async () => {
    const sessions = [
      makeSeedSession({ id: 'sess_a', section: 'current-stack' }),
      makeSeedSession({ id: 'sess_b', section: 'current-stack' }),
      makeSeedSession({ id: 'sess_c', section: 'backlog' }),
    ];
    await seedSessions(sessions);

    const req = mockReq('PATCH', '/__admin_session/reorder', {
      ids: ['sess_b', 'sess_a'], reason: 'Priority change',
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(200);
    expect(parseResBody(res)['ok']).toBe(true);

    const persisted = readPersistedFile('sessions.json') as Session[];
    const stackIds = persisted.filter(s => s.section === 'current-stack').map(s => s.id);
    expect(stackIds).toEqual(['sess_b', 'sess_a']);

    expect(persisted.find(s => s.id === 'sess_c')).toBeDefined();

    const log = readPersistedFile('reorder-log.json') as Array<{
      previousOrder: string[]; newOrder: string[]; reason: string; ts: string;
    }>;
    expect(log).toHaveLength(1);
    expect(log[0].previousOrder).toEqual(['sess_a', 'sess_b']);
    expect(log[0].newOrder).toEqual(['sess_b', 'sess_a']);
    expect(log[0].reason).toBe('Priority change');
    expect(log[0].ts).toBeDefined();
  });

  it('appends unlisted current-stack sessions at end', async () => {
    const sessions = [
      makeSeedSession({ id: 'sess_a', section: 'current-stack' }),
      makeSeedSession({ id: 'sess_b', section: 'current-stack' }),
      makeSeedSession({ id: 'sess_c', section: 'current-stack' }),
    ];
    await seedSessions(sessions);

    const req = mockReq('PATCH', '/__admin_session/reorder', {
      ids: ['sess_b'], reason: 'Partial reorder',
    });
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res._status).toBe(200);
    const persisted = readPersistedFile('sessions.json') as Session[];
    const stackIds = persisted.filter(s => s.section === 'current-stack').map(s => s.id);
    expect(stackIds[0]).toBe('sess_b');
    expect(stackIds).toContain('sess_a');
    expect(stackIds).toContain('sess_c');
  });
});
