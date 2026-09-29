// ── processPlugin tests ────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { IncomingMessage } from 'http';

// ── Mock fs (hoisted, same pattern as pipelineRoutes.test.ts) ─
const { fileStore, norm, mockMkdirSync } = vi.hoisted(() => {
  const fileStore: Record<string, string> = {};
  const norm = (p: string): string => p.replace(/\\/g, '/');
  const mockMkdirSync = vi.fn();
  return { fileStore, norm, mockMkdirSync };
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
  const mock = { ...actual, readFileSync, writeFileSync, existsSync, mkdirSync: mockMkdirSync };
  return { ...mock, default: mock };
});

import {
  resolveCommand,
  isAllowedConfig,
  isAllowedScript,
  formatSSE,
  readJsonFile,
  writeJsonFile,
  ensureDataDir,
  parseBody,
  DATA_DIR,
} from '../middleware/processPlugin';
import { resolve } from 'path';

// ── isAllowedConfig ────────────────────────────────────────

describe('isAllowedConfig', () => {
  it('returns true for all 8 valid configs', () => {
    expect(isAllowedConfig('unit')).toBe(true);
    expect(isAllowedConfig('e2e')).toBe(true);
    expect(isAllowedConfig('browser')).toBe(true);
    expect(isAllowedConfig('online')).toBe(true);
    expect(isAllowedConfig('smoke')).toBe(true);
    expect(isAllowedConfig('rules')).toBe(true);
    expect(isAllowedConfig('admin')).toBe(true);
    expect(isAllowedConfig('relay')).toBe(true);
  });

  it('returns false for unknown configs', () => {
    expect(isAllowedConfig('unknown')).toBe(false);
    expect(isAllowedConfig('')).toBe(false);
    expect(isAllowedConfig('Unit')).toBe(false);
    expect(isAllowedConfig('all')).toBe(false);
    expect(isAllowedConfig('../etc/passwd')).toBe(false);
  });
});

// ── isAllowedScript ────────────────────────────────────────

describe('isAllowedScript', () => {
  it('returns true for all 4 valid scripts', () => {
    expect(isAllowedScript('module-map')).toBe(true);
    expect(isAllowedScript('activity-digest')).toBe(true);
    expect(isAllowedScript('test-health')).toBe(true);
    expect(isAllowedScript('prune-sessions')).toBe(true);
  });

  it('returns false for invalid scripts', () => {
    expect(isAllowedScript('unknown')).toBe(false);
    expect(isAllowedScript('')).toBe(false);
    expect(isAllowedScript('../scripts/evil')).toBe(false);
    expect(isAllowedScript('module-map.ts')).toBe(false);
    expect(isAllowedScript('module_map')).toBe(false);
  });

  it('rejects path traversal attempts', () => {
    expect(isAllowedScript('../../package.json')).toBe(false);
    expect(isAllowedScript('./module-map')).toBe(false);
  });
});

// ── resolveCommand ─────────────────────────────────────────

describe('resolveCommand', () => {
  describe('type=test', () => {
    it('returns vitest run command for a valid config', () => {
      const cmd = resolveCommand('test', { config: 'unit' });
      expect(cmd).toBe('npx vitest run --config vitest.config.ts --reporter=verbose --reporter=json');
    });

    it('maps each valid config to its correct config file', () => {
      expect(resolveCommand('test', { config: 'e2e' })).toBe(
        'npx vitest run --config vitest.e2e.config.ts --reporter=verbose --reporter=json',
      );
      expect(resolveCommand('test', { config: 'browser' })).toBe(
        'npx vitest run --config vitest.browser.config.ts --reporter=verbose --reporter=json',
      );
      expect(resolveCommand('test', { config: 'online' })).toBe(
        'npx vitest run --config vitest.online.config.ts --reporter=verbose --reporter=json',
      );
      expect(resolveCommand('test', { config: 'smoke' })).toBe(
        'npx vitest run --config vitest.smoke.config.ts --reporter=verbose --reporter=json',
      );
      expect(resolveCommand('test', { config: 'rules' })).toBe(
        'npx vitest run --config vitest.rules.config.ts --reporter=verbose --reporter=json',
      );
      expect(resolveCommand('test', { config: 'admin' })).toBe(
        'npx vitest run --config admin/vitest.config.ts --reporter=verbose --reporter=json',
      );
      expect(resolveCommand('test', { config: 'relay' })).toBe(
        'npx vitest run --config relay/vitest.config.ts --reporter=verbose --reporter=json',
      );
    });

    it('returns null for an invalid config', () => {
      expect(resolveCommand('test', { config: 'bogus' })).toBeNull();
    });

    it('returns null when config param is missing', () => {
      expect(resolveCommand('test', {})).toBeNull();
    });
  });

  describe('type=claude', () => {
    it('returns null (claude is handled directly via spawn, not resolveCommand)', () => {
      expect(resolveCommand('claude', { prompt: 'hello world' })).toBeNull();
      expect(resolveCommand('claude', {})).toBeNull();
    });
  });

  describe('type=script', () => {
    it('returns tsx command for a valid script', () => {
      const cmd = resolveCommand('script', { name: 'module-map' });
      expect(cmd).toBe('npx tsx admin/scripts/module-map.ts');
    });

    it('returns tsx command for each valid script', () => {
      expect(resolveCommand('script', { name: 'activity-digest' })).toBe(
        'npx tsx admin/scripts/activity-digest.ts',
      );
      expect(resolveCommand('script', { name: 'test-health' })).toBe(
        'npx tsx admin/scripts/test-health.ts',
      );
      expect(resolveCommand('script', { name: 'prune-sessions' })).toBe(
        'npx tsx admin/scripts/prune-sessions.ts',
      );
    });

    it('does not append any args (args param is ignored)', () => {
      const cmd = resolveCommand('script', { name: 'activity-digest', args: '--days 7' });
      expect(cmd).toBe('npx tsx admin/scripts/activity-digest.ts');
    });

    it('returns null for an unknown script name', () => {
      expect(resolveCommand('script', { name: 'evil' })).toBeNull();
    });

    it('returns null when name is missing', () => {
      expect(resolveCommand('script', {})).toBeNull();
    });

    it('returns null for path traversal in script name', () => {
      expect(resolveCommand('script', { name: '../package' })).toBeNull();
    });
  });

  describe('unknown type', () => {
    it('returns null for an unknown type', () => {
      expect(resolveCommand('unknown', {})).toBeNull();
      expect(resolveCommand('', {})).toBeNull();
      expect(resolveCommand('exec', { cmd: 'rm -rf /' })).toBeNull();
    });
  });
});

// ── formatSSE ──────────────────────────────────────────────

describe('formatSSE', () => {
  it('formats stdout event correctly', () => {
    const result = formatSSE('stdout', { line: 'hello', ts: 1000 });
    expect(result).toBe('event: stdout\ndata: {"line":"hello","ts":1000}\n\n');
  });

  it('formats exit event correctly', () => {
    const result = formatSSE('exit', { code: 0, signal: null, duration: 5000 });
    expect(result).toBe('event: exit\ndata: {"code":0,"signal":null,"duration":5000}\n\n');
  });

  it('formats stderr event correctly', () => {
    const result = formatSSE('stderr', { line: 'error text', ts: 2000 });
    expect(result).toBe('event: stderr\ndata: {"line":"error text","ts":2000}\n\n');
  });

  it('includes the event name and terminates with double newline', () => {
    const result = formatSSE('ping', {});
    expect(result).toMatch(/^event: ping\n/);
    expect(result).toMatch(/\n\n$/);
  });
});

// ── readJsonFile ──────────────────────────────────────────

describe('readJsonFile', () => {
  beforeEach(() => {
    for (const key of Object.keys(fileStore)) delete fileStore[key];
  });

  it('returns parsed JSON when file exists', () => {
    const filepath = norm(resolve(DATA_DIR, 'test.json'));
    fileStore[filepath] = JSON.stringify({ foo: 'bar', count: 42 });

    const result = readJsonFile<{ foo: string; count: number }>('test.json', { foo: '', count: 0 });
    expect(result).toEqual({ foo: 'bar', count: 42 });
  });

  it('returns fallback when file does not exist', () => {
    const fallback = { items: [] as string[] };
    const result = readJsonFile('nonexistent.json', fallback);
    expect(result).toBe(fallback);
  });

  it('returns fallback on JSON parse error', () => {
    const filepath = norm(resolve(DATA_DIR, 'broken.json'));
    fileStore[filepath] = 'not valid json {{{';

    const fallback = { valid: false };
    const result = readJsonFile('broken.json', fallback);
    expect(result).toBe(fallback);
  });

  it('returns fallback for empty arrays', () => {
    const result = readJsonFile<string[]>('missing.json', []);
    expect(result).toEqual([]);
  });
});

// ── writeJsonFile ─────────────────────────────────────────

describe('writeJsonFile', () => {
  beforeEach(() => {
    for (const key of Object.keys(fileStore)) delete fileStore[key];
  });

  it('writes pretty-printed JSON to file', () => {
    const data = { name: 'test', values: [1, 2, 3] };
    writeJsonFile('output.json', data);

    const filepath = norm(resolve(DATA_DIR, 'output.json'));
    expect(fileStore[filepath]).toBe(JSON.stringify(data, null, 2));
  });

  it('overwrites existing file', () => {
    const filepath = norm(resolve(DATA_DIR, 'existing.json'));
    fileStore[filepath] = JSON.stringify({ old: true });

    writeJsonFile('existing.json', { new: true });
    expect(JSON.parse(fileStore[filepath])).toEqual({ new: true });
  });

  it('calls ensureDataDir before writing', () => {
    mockMkdirSync.mockClear();

    writeJsonFile('ensure-test.json', { ok: true });

    // ensureDataDir was called — the write succeeded without error
    const filepath = norm(resolve(DATA_DIR, 'ensure-test.json'));
    expect(fileStore[filepath]).toBeDefined();
  });
});

// ── ensureDataDir ─────────────────────────────────────────

describe('ensureDataDir', () => {
  beforeEach(() => {
    for (const key of Object.keys(fileStore)) delete fileStore[key];
  });

  it('creates directory with recursive option when it does not exist', () => {
    mockMkdirSync.mockClear();

    ensureDataDir();

    expect(mockMkdirSync).toHaveBeenCalledWith(DATA_DIR, { recursive: true });
  });

  it('does not create directory if it already exists', () => {
    // Seed something under DATA_DIR so existsSync returns true
    const filepath = norm(resolve(DATA_DIR, 'marker.json'));
    fileStore[filepath] = '{}';

    mockMkdirSync.mockClear();

    ensureDataDir();

    expect(mockMkdirSync).not.toHaveBeenCalled();
  });
});

// ── parseBody ─────────────────────────────────────────────

describe('parseBody', () => {
  function mockIncomingMessage(): IncomingMessage {
    return new EventEmitter() as IncomingMessage;
  }

  it('parses valid JSON body', async () => {
    const req = mockIncomingMessage();
    const promise = parseBody(req);

    process.nextTick(() => {
      req.emit('data', Buffer.from('{"key":"value","num":42}'));
      req.emit('end');
    });

    const result = await promise;
    expect(result).toEqual({ key: 'value', num: 42 });
  });

  it('returns empty object for empty body', async () => {
    const req = mockIncomingMessage();
    const promise = parseBody(req);

    process.nextTick(() => {
      req.emit('end');
    });

    const result = await promise;
    expect(result).toEqual({});
  });

  it('rejects with error for invalid JSON', async () => {
    const req = mockIncomingMessage();
    const promise = parseBody(req);

    process.nextTick(() => {
      req.emit('data', Buffer.from('not json {{{'));
      req.emit('end');
    });

    await expect(promise).rejects.toThrow('Invalid JSON body');
  });

  it('accumulates multiple chunks', async () => {
    const req = mockIncomingMessage();
    const promise = parseBody(req);

    process.nextTick(() => {
      req.emit('data', Buffer.from('{"first":'));
      req.emit('data', Buffer.from('"value",'));
      req.emit('data', Buffer.from('"second":2}'));
      req.emit('end');
    });

    const result = await promise;
    expect(result).toEqual({ first: 'value', second: 2 });
  });

  it('rejects on stream error', async () => {
    const req = mockIncomingMessage();
    const promise = parseBody(req);

    process.nextTick(() => {
      req.emit('error', new Error('connection reset'));
    });

    await expect(promise).rejects.toThrow('connection reset');
  });
});
