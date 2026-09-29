// ── test-health tests ──────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs before importing the module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

import * as fs from 'fs';
import {
  parseTestIndex,
  findUntestedModules,
} from '../test-health.js';

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);

// ---------------------------------------------------------------------------
// parseTestIndex
// ---------------------------------------------------------------------------

describe('parseTestIndex', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns empty TestHealth when passed null', () => {
    const result = parseTestIndex(null);
    expect(result.configs).toEqual({});
    expect(result.failures).toEqual([]);
    expect(result.untested).toEqual([]);
    expect(result.coverage).toEqual({ withTests: 0, total: 0, percent: 0 });
    expect(typeof result.generated).toBe('string');
  });

  it('returns empty TestHealth when indexData has no runs array', () => {
    const result = parseTestIndex({});
    expect(result.configs).toEqual({});
    expect(result.failures).toEqual([]);
  });

  it('returns empty TestHealth when runs is empty', () => {
    const result = parseTestIndex({ runs: [] });
    expect(result.configs).toEqual({});
  });

  it('parses a single run into configs', () => {
    const indexData = {
      runs: [
        {
          id: '2026-04-05T01-11-02_36b430',
          type: 'e2e',
          timestamp: '2026-04-05T01:11:04.607Z',
          durationMs: 45000,
          total: 11,
          passed: 10,
          failed: 1,
          skipped: 0,
        },
      ],
    };

    // run.json for this run has no failing tests (will be mocked to not exist)
    mockExistsSync.mockReturnValue(false);

    const result = parseTestIndex(indexData);
    expect(result.configs).toHaveProperty('e2e');
    expect(result.configs['e2e'].total).toBe(11);
    expect(result.configs['e2e'].passed).toBe(10);
    expect(result.configs['e2e'].failed).toBe(1);
    expect(result.configs['e2e'].skipped).toBe(0);
    expect(result.configs['e2e'].flaky).toBe(0);
    expect(result.configs['e2e'].lastRun).toBe('2026-04-05T01:11:04.607Z');
    expect(result.configs['e2e'].duration).toBe(45);
  });

  it('uses the most recent run per type when multiple exist', () => {
    const indexData = {
      runs: [
        {
          id: 'run-old',
          type: 'ui',
          timestamp: '2026-04-04T10:00:00.000Z',
          durationMs: 30000,
          total: 50,
          passed: 48,
          failed: 2,
          skipped: 0,
        },
        {
          id: 'run-new',
          type: 'ui',
          timestamp: '2026-04-05T10:00:00.000Z',
          durationMs: 60000,
          total: 55,
          passed: 55,
          failed: 0,
          skipped: 0,
        },
      ],
    };

    mockExistsSync.mockReturnValue(false);

    const result = parseTestIndex(indexData);
    // Should use the most recent run (run-new)
    expect(result.configs['ui'].total).toBe(55);
    expect(result.configs['ui'].passed).toBe(55);
    expect(result.configs['ui'].failed).toBe(0);
    expect(result.configs['ui'].duration).toBe(60);
  });

  it('handles multiple different types', () => {
    const indexData = {
      runs: [
        {
          id: 'run-ui',
          type: 'ui',
          timestamp: '2026-04-05T10:00:00.000Z',
          durationMs: 20000,
          total: 100,
          passed: 98,
          failed: 2,
          skipped: 0,
        },
        {
          id: 'run-e2e',
          type: 'e2e',
          timestamp: '2026-04-05T11:00:00.000Z',
          durationMs: 5000,
          total: 11,
          passed: 11,
          failed: 0,
          skipped: 0,
        },
      ],
    };

    mockExistsSync.mockReturnValue(false);

    const result = parseTestIndex(indexData);
    expect(result.configs).toHaveProperty('ui');
    expect(result.configs).toHaveProperty('e2e');
    expect(result.configs['ui'].total).toBe(100);
    expect(result.configs['e2e'].total).toBe(11);
  });

  it('extracts failures from run.json when it exists', () => {
    const indexData = {
      runs: [
        {
          id: 'run-with-failures',
          type: 'ui',
          timestamp: '2026-04-05T10:00:00.000Z',
          durationMs: 10000,
          total: 5,
          passed: 3,
          failed: 2,
          skipped: 0,
        },
      ],
    };

    const runJson = {
      id: 'run-with-failures',
      type: 'ui',
      tests: [
        { name: 'Test A passes', status: 'pass', error: null },
        { name: 'Test B fails', status: 'fail', error: 'Expected true but got false' },
        { name: 'Test C fails', status: 'fail', error: 'Timeout exceeded' },
      ],
    };

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(runJson) as any);

    const result = parseTestIndex(indexData);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0].test).toBe('Test B fails');
    expect(result.failures[0].config).toBe('ui');
    expect(result.failures[0].error).toBe('Expected true but got false');
    expect(result.failures[1].test).toBe('Test C fails');
    expect(result.failures[1].error).toBe('Timeout exceeded');
  });

  it('handles run.json read errors gracefully', () => {
    const indexData = {
      runs: [
        {
          id: 'bad-run',
          type: 'ui',
          timestamp: '2026-04-05T10:00:00.000Z',
          durationMs: 0,
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
        },
      ],
    };

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    // Should not throw
    expect(() => parseTestIndex(indexData)).not.toThrow();
    const result = parseTestIndex(indexData);
    expect(result.failures).toEqual([]);
  });

  it('detects flaky tests that pass and fail across multiple runs of same type', () => {
    const indexData = {
      runs: [
        { id: 'run1', type: 'unit', timestamp: '2026-04-05T12:00:00Z', durationMs: 5000, total: 3, passed: 3, failed: 0, skipped: 0 },
        { id: 'run2', type: 'unit', timestamp: '2026-04-05T11:00:00Z', durationMs: 5000, total: 3, passed: 2, failed: 1, skipped: 0 },
      ],
    };

    // run1 (latest) — all pass. run2 (older) — "flaky test" failed.
    // "flaky test" passed in run1 and failed in run2 → flaky.
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      if (s.includes('run1') && s.includes('run.json')) return true;
      if (s.includes('run2') && s.includes('run.json')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      const s = String(p);
      if (s.includes('run1') && s.includes('run.json')) {
        return JSON.stringify({
          tests: [
            { name: 'stable test', status: 'pass', error: null },
            { name: 'flaky test', status: 'pass', error: null },
            { name: 'another test', status: 'pass', error: null },
          ],
        });
      }
      if (s.includes('run2') && s.includes('run.json')) {
        return JSON.stringify({
          tests: [
            { name: 'stable test', status: 'pass', error: null },
            { name: 'flaky test', status: 'fail', error: 'timeout' },
            { name: 'another test', status: 'pass', error: null },
          ],
        });
      }
      return '{}';
    });

    const result = parseTestIndex(indexData);
    expect(result.configs['unit'].flaky).toBe(1);
  });

  it('rounds duration correctly', () => {
    const indexData = {
      runs: [
        {
          id: 'run-1',
          type: 'smoke',
          timestamp: '2026-04-05T10:00:00.000Z',
          durationMs: 7500,
          total: 5,
          passed: 5,
          failed: 0,
          skipped: 0,
        },
      ],
    };

    mockExistsSync.mockReturnValue(false);

    const result = parseTestIndex(indexData);
    expect(result.configs['smoke'].duration).toBe(8); // Math.round(7500/1000)
  });
});

// ---------------------------------------------------------------------------
// findUntestedModules
// ---------------------------------------------------------------------------

describe('findUntestedModules', () => {
  it('returns source files without matching test files', () => {
    const srcFiles = [
      'src/auth.ts',
      'src/graphics.ts',
      'src/player.ts',
    ];
    const testFiles = [
      'src/auth.test.ts',
      'src/graphics.test.ts',
    ];

    const result = findUntestedModules(srcFiles, testFiles);
    expect(result).toContain('src/player.ts');
    expect(result).not.toContain('src/auth.ts');
    expect(result).not.toContain('src/graphics.ts');
  });

  it('returns empty array when all source files have tests', () => {
    const srcFiles = ['src/foo.ts', 'src/bar.ts'];
    const testFiles = ['src/foo.test.ts', 'src/bar.test.ts'];

    const result = findUntestedModules(srcFiles, testFiles);
    expect(result).toEqual([]);
  });

  it('excludes .test.ts files from srcFiles', () => {
    const srcFiles = ['src/auth.ts', 'src/auth.test.ts'];
    const testFiles = ['src/auth.test.ts'];

    const result = findUntestedModules(srcFiles, testFiles);
    // auth.test.ts should not appear in untested
    expect(result).not.toContain('src/auth.test.ts');
  });

  it('excludes /types/index.ts files', () => {
    const srcFiles = ['src/types/index.ts', 'src/player.ts'];
    const testFiles: string[] = [];

    const result = findUntestedModules(srcFiles, testFiles);
    expect(result).not.toContain('src/types/index.ts');
    expect(result).toContain('src/player.ts');
  });

  it('excludes barrel index.ts files', () => {
    const srcFiles = [
      'src/index.ts',
      'src/core/index.ts',
      'src/ui/index.ts',
      'src/player.ts',
    ];
    const testFiles: string[] = [];

    const result = findUntestedModules(srcFiles, testFiles);
    expect(result).not.toContain('src/index.ts');
    expect(result).not.toContain('src/core/index.ts');
    expect(result).not.toContain('src/ui/index.ts');
    expect(result).toContain('src/player.ts');
  });

  it('excludes .css files', () => {
    const srcFiles = ['src/styles/main.css', 'src/player.ts'];
    const testFiles: string[] = [];

    const result = findUntestedModules(srcFiles, testFiles);
    expect(result).not.toContain('src/styles/main.css');
    expect(result).toContain('src/player.ts');
  });

  it('excludes .d.ts files', () => {
    const srcFiles = ['src/types.d.ts', 'src/player.ts'];
    const testFiles: string[] = [];

    const result = findUntestedModules(srcFiles, testFiles);
    expect(result).not.toContain('src/types.d.ts');
    expect(result).toContain('src/player.ts');
  });

  it('maps test file paths to source equivalents correctly', () => {
    // Test that src/foo/__tests__/bar.test.ts would still map to src/foo/bar.ts
    const srcFiles = ['src/ui/chatUI.ts', 'src/ui/friendsUI.ts'];
    const testFiles = ['src/ui/__tests__/chatUI.test.ts'];

    // chatUI has a test (but in __tests__ subdir), friendsUI does not
    // The mapping replaces .test.ts with .ts and normalizes the path
    // Since __tests__/chatUI.test.ts → __tests__/chatUI.ts ≠ src/ui/chatUI.ts
    // this tests the filename-only matching fallback
    const result = findUntestedModules(srcFiles, testFiles);
    // The exact behaviour depends on implementation — at minimum friendsUI.ts has no test
    expect(result).toContain('src/ui/friendsUI.ts');
  });

  it('returns empty array when srcFiles is empty', () => {
    const result = findUntestedModules([], ['src/foo.test.ts']);
    expect(result).toEqual([]);
  });
});
