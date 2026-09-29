// ── Test Center unit tests ────────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  TEST_CATALOG,
  parseOutputLine,
  parseVitestJson,
  buildInvestigatePrompt,
  CONFIGS,
} from '../sections/testRunnerHelpers';
import type { TestRun } from '../types';

// ── TEST_CATALOG ──────────────────────────────────────────────

describe('TEST_CATALOG', () => {
  it('has entries for all expected groups', () => {
    const groups = new Set(TEST_CATALOG.map(t => t.group));
    expect(groups.has('Unit Tests')).toBe(true);
    expect(groups.has('Integration')).toBe(true);
    expect(groups.has('Browser Tests')).toBe(true);
    expect(groups.has('Online Multiplayer')).toBe(true);
    expect(groups.has('Smoke Tests')).toBe(true);
    expect(groups.has('Cloud Functions')).toBe(true);
  });

  it('has at least one entry per expected group', () => {
    const groups = ['Unit Tests', 'Integration', 'Browser Tests', 'Online Multiplayer', 'Smoke Tests', 'Cloud Functions'];
    for (const group of groups) {
      const entries = TEST_CATALOG.filter(t => t.group === group);
      expect(entries.length, `group "${group}" should have at least one entry`).toBeGreaterThan(0);
    }
  });

  it('all entries have required fields', () => {
    for (const entry of TEST_CATALOG) {
      expect(typeof entry.id, `id missing on ${JSON.stringify(entry)}`).toBe('string');
      expect(entry.id.length, `id is empty on entry`).toBeGreaterThan(0);

      expect(typeof entry.config, `config missing on ${entry.id}`).toBe('string');
      expect(entry.config.length, `config is empty on ${entry.id}`).toBeGreaterThan(0);

      expect(typeof entry.name, `name missing on ${entry.id}`).toBe('string');
      expect(entry.name.length, `name is empty on ${entry.id}`).toBeGreaterThan(0);

      expect(typeof entry.description, `description missing on ${entry.id}`).toBe('string');
      expect(entry.description.length, `description is empty on ${entry.id}`).toBeGreaterThan(0);

      expect(typeof entry.file, `file missing on ${entry.id}`).toBe('string');
      expect(entry.file.length, `file is empty on ${entry.id}`).toBeGreaterThan(0);

      expect(typeof entry.group, `group missing on ${entry.id}`).toBe('string');
      expect(entry.group.length, `group is empty on ${entry.id}`).toBeGreaterThan(0);
    }
  });

  it('all entry ids are unique', () => {
    const ids = TEST_CATALOG.map(t => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('all entry configs are valid CONFIGS values', () => {
    const validConfigs = new Set<string>(CONFIGS);
    for (const entry of TEST_CATALOG) {
      expect(validConfigs.has(entry.config), `entry ${entry.id} has unknown config "${entry.config}"`).toBe(true);
    }
  });

  it('has the unit-all entry for running the full unit suite', () => {
    const entry = TEST_CATALOG.find(t => t.id === 'unit-all');
    expect(entry).toBeDefined();
    expect(entry?.config).toBe('unit');
  });

  it('has the smoke-critical entry', () => {
    const entry = TEST_CATALOG.find(t => t.id === 'smoke-critical');
    expect(entry).toBeDefined();
    expect(entry?.group).toBe('Smoke Tests');
  });

  it('has the functions entry in Cloud Functions group', () => {
    const entry = TEST_CATALOG.find(t => t.id === 'functions');
    expect(entry).toBeDefined();
    expect(entry?.group).toBe('Cloud Functions');
  });
});

// ── parseOutputLine ──────────────────────────────────────────

describe('parseOutputLine', () => {
  it('classifies ✓ lines as pass', () => {
    expect(parseOutputLine('  ✓ should do something (5ms)').type).toBe('pass');
  });

  it('classifies PASS keyword lines as pass', () => {
    expect(parseOutputLine('PASS src/foo.test.ts').type).toBe('pass');
  });

  it('classifies ✗ lines as fail', () => {
    expect(parseOutputLine('  ✗ should not throw').type).toBe('fail');
  });

  it('classifies FAIL keyword lines as fail', () => {
    expect(parseOutputLine('FAIL src/bar.test.ts').type).toBe('fail');
  });

  it('classifies lines containing "failed" as fail', () => {
    expect(parseOutputLine('3 tests failed').type).toBe('fail');
  });

  it('classifies anything else as info', () => {
    expect(parseOutputLine('Running test suite...').type).toBe('info');
    expect(parseOutputLine('').type).toBe('info');
    expect(parseOutputLine('vitest v2.0.0').type).toBe('info');
  });

  it('trims whitespace from the text field', () => {
    const result = parseOutputLine('   ✓ my test   ');
    expect(result.text).toBe('✓ my test');
  });

  it('returns the trimmed text for all classification types', () => {
    expect(parseOutputLine('  PASS  ').text).toBe('PASS');
    expect(parseOutputLine('  FAIL  ').text).toBe('FAIL');
    expect(parseOutputLine('  some info  ').text).toBe('some info');
  });
});

// ── parseVitestJson ──────────────────────────────────────────

describe('parseVitestJson', () => {
  const makeJson = (overrides: Record<string, unknown> = {}) => JSON.stringify({
    numTotalTests: 10,
    numPassedTests: 8,
    numFailedTests: 1,
    numPendingTests: 1,
    testResults: [],
    ...overrides,
  });

  it('parses valid vitest JSON and returns totals', () => {
    const result = parseVitestJson(makeJson());
    expect(result).not.toBeNull();
    expect(result!.total).toBe(10);
    expect(result!.passed).toBe(8);
    expect(result!.failed).toBe(1);
    expect(result!.skipped).toBe(1);
  });

  it('extracts failure details from assertionResults', () => {
    const json = makeJson({
      testResults: [
        {
          name: 'src/auth.test.ts',
          assertionResults: [
            { fullName: 'auth > login fails', status: 'failed', failureMessages: ['Expected true got false'] },
            { fullName: 'auth > login passes', status: 'passed', failureMessages: [] },
          ],
        },
      ],
    });
    const result = parseVitestJson(json);
    expect(result).not.toBeNull();
    expect(result!.failures).toHaveLength(1);
    expect(result!.failures[0].file).toBe('src/auth.test.ts');
    expect(result!.failures[0].test).toBe('auth > login fails');
    expect(result!.failures[0].error).toBe('Expected true got false');
  });

  it('collects failures across multiple files', () => {
    const json = makeJson({
      numTotalTests: 20,
      numPassedTests: 18,
      numFailedTests: 2,
      testResults: [
        {
          name: 'src/a.test.ts',
          assertionResults: [
            { fullName: 'a > fails', status: 'failed', failureMessages: ['err A'] },
          ],
        },
        {
          name: 'src/b.test.ts',
          assertionResults: [
            { fullName: 'b > fails', status: 'failed', failureMessages: ['err B'] },
          ],
        },
      ],
    });
    const result = parseVitestJson(json);
    expect(result!.failures).toHaveLength(2);
    expect(result!.failures[0].file).toBe('src/a.test.ts');
    expect(result!.failures[1].file).toBe('src/b.test.ts');
  });

  it('uses "Unknown error" when failureMessages is absent', () => {
    const json = makeJson({
      testResults: [
        {
          name: 'src/x.test.ts',
          assertionResults: [
            { fullName: 'x > fails', status: 'failed' },
          ],
        },
      ],
    });
    const result = parseVitestJson(json);
    expect(result!.failures[0].error).toBe('Unknown error');
  });

  it('returns null for non-JSON input', () => {
    expect(parseVitestJson('not json')).toBeNull();
    expect(parseVitestJson('')).toBeNull();
  });

  it('returns null when numTotalTests is missing', () => {
    expect(parseVitestJson('{"numPassedTests": 5}')).toBeNull();
  });

  it('returns null when numPassedTests is missing', () => {
    expect(parseVitestJson('{"numTotalTests": 5}')).toBeNull();
  });

  it('returns null for an empty object', () => {
    expect(parseVitestJson('{}')).toBeNull();
  });

  it('returns empty failures array when all tests pass', () => {
    const json = makeJson({
      numFailedTests: 0,
      testResults: [
        {
          name: 'src/ok.test.ts',
          assertionResults: [
            { fullName: 'ok > passes', status: 'passed', failureMessages: [] },
          ],
        },
      ],
    });
    const result = parseVitestJson(json);
    expect(result!.failures).toHaveLength(0);
  });
});

// ── buildInvestigatePrompt ───────────────────────────────────

describe('buildInvestigatePrompt', () => {
  const file = 'src/net/protocol.test.ts';
  const testName = 'negotiation > rejects on version mismatch';
  const error = 'AssertionError: expected "error" to equal "ok"';
  const config = 'unit';

  it('includes the file path', () => {
    const prompt = buildInvestigatePrompt(file, testName, error, config);
    expect(prompt).toContain(`File: ${file}`);
  });

  it('includes the test name', () => {
    const prompt = buildInvestigatePrompt(file, testName, error, config);
    expect(prompt).toContain(`Test: ${testName}`);
  });

  it('includes the error message', () => {
    const prompt = buildInvestigatePrompt(file, testName, error, config);
    expect(prompt).toContain(`Error: ${error}`);
  });

  it('includes the config name', () => {
    const prompt = buildInvestigatePrompt(file, testName, error, config);
    expect(prompt).toContain(`Config: ${config}`);
  });

  it('references the __admin_task endpoint', () => {
    const prompt = buildInvestigatePrompt(file, testName, error, config);
    expect(prompt).toContain('http://localhost:5175/__admin_task');
  });

  it('includes the "test-fix" tag', () => {
    const prompt = buildInvestigatePrompt(file, testName, error, config);
    expect(prompt).toContain('test-fix');
  });

  it('instructs to read the test file and source', () => {
    const prompt = buildInvestigatePrompt(file, testName, error, config);
    expect(prompt).toContain('Read the test file and the source it tests');
  });

  it('instructs to diagnose root cause', () => {
    const prompt = buildInvestigatePrompt(file, testName, error, config);
    expect(prompt).toContain('Diagnose the root cause');
  });

  it('opens with the investigation header', () => {
    const prompt = buildInvestigatePrompt(file, testName, error, config);
    expect(prompt).toContain('Investigate why this test is failing in Luminal');
  });

  it('all four arguments appear in distinct labelled lines', () => {
    const prompt = buildInvestigatePrompt(file, testName, error, config);
    const lines = prompt.split('\n');
    expect(lines.some(l => l.startsWith('File:'))).toBe(true);
    expect(lines.some(l => l.startsWith('Test:'))).toBe(true);
    expect(lines.some(l => l.startsWith('Error:'))).toBe(true);
    expect(lines.some(l => l.startsWith('Config:'))).toBe(true);
  });
});

// ── TestRun type with followup field ─────────────────────────

describe('TestRun type', () => {
  it('accepts a TestRun without followup (optional field)', () => {
    const run: TestRun = {
      id: 'run-1',
      config: 'unit',
      startedAt: '2026-04-05T12:00:00.000Z',
      duration: 5000,
      total: 100,
      passed: 98,
      failed: 2,
      skipped: 0,
      failures: [],
    };
    expect(run.followup).toBeUndefined();
  });

  it('accepts a TestRun with followup: true', () => {
    const run: TestRun = {
      id: 'run-2',
      config: 'smoke',
      startedAt: '2026-04-05T13:00:00.000Z',
      duration: 12000,
      total: 5,
      passed: 5,
      failed: 0,
      skipped: 0,
      failures: [],
      followup: true,
    };
    expect(run.followup).toBe(true);
  });

  it('accepts a TestRun with followup: false', () => {
    const run: TestRun = {
      id: 'run-3',
      config: 'e2e',
      startedAt: '2026-04-05T14:00:00.000Z',
      duration: 30000,
      total: 20,
      passed: 18,
      failed: 1,
      skipped: 1,
      failures: [{ file: 'src/e2e/match.test.ts', test: 'match > ends', error: 'timeout' }],
      followup: false,
    };
    expect(run.followup).toBe(false);
  });

  it('failures array holds correct shape', () => {
    const run: TestRun = {
      id: 'run-4',
      config: 'unit',
      startedAt: '2026-04-05T15:00:00.000Z',
      duration: 2000,
      total: 3,
      passed: 2,
      failed: 1,
      skipped: 0,
      failures: [{ file: 'src/sim.test.ts', test: 'sim > collides', error: 'AssertionError' }],
    };
    expect(run.failures[0].file).toBe('src/sim.test.ts');
    expect(run.failures[0].test).toBe('sim > collides');
    expect(run.failures[0].error).toBe('AssertionError');
  });
});

// ── History sort logic (inline port of testCenter.ts getFilteredHistory) ──────
// These tests verify the sort comparator logic extracted from getFilteredHistory.

function sortRuns(
  runs: TestRun[],
  column: string,
  direction: 'asc' | 'desc',
): TestRun[] {
  const dir = direction === 'asc' ? 1 : -1;
  return [...runs].sort((a, b) => {
    switch (column) {
      case 'status': {
        const sa = a.failed > 0 ? 2 : a.skipped > 0 ? 1 : 0;
        const sb = b.failed > 0 ? 2 : b.skipped > 0 ? 1 : 0;
        return (sa - sb) * dir;
      }
      case 'config': return a.config.localeCompare(b.config) * dir;
      case 'date': return (new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()) * dir;
      case 'duration': return (a.duration - b.duration) * dir;
      case 'result': {
        const ra = a.total > 0 ? a.passed / a.total : 0;
        const rb = b.total > 0 ? b.passed / b.total : 0;
        return (ra - rb) * dir;
      }
      case 'followup': {
        const fa = a.followup ? 1 : 0;
        const fb = b.followup ? 1 : 0;
        return (fa - fb) * dir;
      }
      default: return 0;
    }
  });
}

function makeRun(overrides: Partial<TestRun> & Pick<TestRun, 'id'>): TestRun {
  return {
    config: 'unit',
    startedAt: '2026-04-05T12:00:00.000Z',
    duration: 1000,
    total: 10,
    passed: 10,
    failed: 0,
    skipped: 0,
    failures: [],
    ...overrides,
  };
}

describe('History sort logic', () => {
  describe('sort by date', () => {
    it('sorts desc (newest first) by default', () => {
      const runs = [
        makeRun({ id: 'old', startedAt: '2026-04-01T00:00:00.000Z' }),
        makeRun({ id: 'new', startedAt: '2026-04-05T00:00:00.000Z' }),
      ];
      const sorted = sortRuns(runs, 'date', 'desc');
      expect(sorted[0].id).toBe('new');
      expect(sorted[1].id).toBe('old');
    });

    it('sorts asc (oldest first)', () => {
      const runs = [
        makeRun({ id: 'new', startedAt: '2026-04-05T00:00:00.000Z' }),
        makeRun({ id: 'old', startedAt: '2026-04-01T00:00:00.000Z' }),
      ];
      const sorted = sortRuns(runs, 'date', 'asc');
      expect(sorted[0].id).toBe('old');
    });
  });

  describe('sort by duration', () => {
    it('sorts asc (shortest first)', () => {
      const runs = [
        makeRun({ id: 'slow', duration: 9000 }),
        makeRun({ id: 'fast', duration: 500 }),
      ];
      const sorted = sortRuns(runs, 'duration', 'asc');
      expect(sorted[0].id).toBe('fast');
    });

    it('sorts desc (longest first)', () => {
      const runs = [
        makeRun({ id: 'fast', duration: 500 }),
        makeRun({ id: 'slow', duration: 9000 }),
      ];
      const sorted = sortRuns(runs, 'duration', 'desc');
      expect(sorted[0].id).toBe('slow');
    });
  });

  describe('sort by status', () => {
    it('sorts failing runs after passing runs in asc order', () => {
      const runs = [
        makeRun({ id: 'fail', failed: 3, skipped: 0 }),
        makeRun({ id: 'pass', failed: 0, skipped: 0 }),
      ];
      const sorted = sortRuns(runs, 'status', 'asc');
      expect(sorted[0].id).toBe('pass');
      expect(sorted[1].id).toBe('fail');
    });

    it('sorts failing runs before passing runs in desc order', () => {
      const runs = [
        makeRun({ id: 'pass', failed: 0, skipped: 0 }),
        makeRun({ id: 'fail', failed: 3, skipped: 0 }),
      ];
      const sorted = sortRuns(runs, 'status', 'desc');
      expect(sorted[0].id).toBe('fail');
    });

    it('ranks skipped runs between passing and failing', () => {
      const runs = [
        makeRun({ id: 'fail', failed: 1, skipped: 0 }),
        makeRun({ id: 'warn', failed: 0, skipped: 2 }),
        makeRun({ id: 'pass', failed: 0, skipped: 0 }),
      ];
      const sorted = sortRuns(runs, 'status', 'asc');
      expect(sorted[0].id).toBe('pass');
      expect(sorted[1].id).toBe('warn');
      expect(sorted[2].id).toBe('fail');
    });
  });

  describe('sort by result (pass rate)', () => {
    it('sorts lower pass rate first in asc order', () => {
      const runs = [
        makeRun({ id: 'low', total: 10, passed: 5, failed: 5 }),
        makeRun({ id: 'high', total: 10, passed: 9, failed: 1 }),
      ];
      const sorted = sortRuns(runs, 'result', 'asc');
      expect(sorted[0].id).toBe('low');
    });

    it('sorts higher pass rate first in desc order', () => {
      const runs = [
        makeRun({ id: 'low', total: 10, passed: 3, failed: 7 }),
        makeRun({ id: 'high', total: 10, passed: 10, failed: 0 }),
      ];
      const sorted = sortRuns(runs, 'result', 'desc');
      expect(sorted[0].id).toBe('high');
    });

    it('treats zero-total runs as 0% pass rate', () => {
      const runs = [
        makeRun({ id: 'zero', total: 0, passed: 0 }),
        makeRun({ id: 'full', total: 10, passed: 10 }),
      ];
      const sorted = sortRuns(runs, 'result', 'asc');
      expect(sorted[0].id).toBe('zero');
    });
  });

  describe('sort by config', () => {
    it('sorts alphabetically by config name', () => {
      const runs = [
        makeRun({ id: 'unit-run', config: 'unit' }),
        makeRun({ id: 'e2e-run', config: 'e2e' }),
      ];
      const sorted = sortRuns(runs, 'config', 'asc');
      expect(sorted[0].id).toBe('e2e-run');
      expect(sorted[1].id).toBe('unit-run');
    });
  });

  describe('sort by followup', () => {
    it('sorts non-followup runs first in asc order', () => {
      const runs = [
        makeRun({ id: 'follow', followup: true }),
        makeRun({ id: 'normal', followup: false }),
      ];
      const sorted = sortRuns(runs, 'followup', 'asc');
      expect(sorted[0].id).toBe('normal');
    });

    it('sorts followup runs first in desc order', () => {
      const runs = [
        makeRun({ id: 'normal', followup: false }),
        makeRun({ id: 'follow', followup: true }),
      ];
      const sorted = sortRuns(runs, 'followup', 'desc');
      expect(sorted[0].id).toBe('follow');
    });

    it('treats undefined followup as false (non-followup)', () => {
      const runs = [
        makeRun({ id: 'undefined-follow' }),  // followup not set
        makeRun({ id: 'follow', followup: true }),
      ];
      const sorted = sortRuns(runs, 'followup', 'desc');
      expect(sorted[0].id).toBe('follow');
    });
  });

  describe('sort by unknown column', () => {
    it('leaves order unchanged for unknown column', () => {
      const runs = [
        makeRun({ id: 'a' }),
        makeRun({ id: 'b' }),
      ];
      const sorted = sortRuns(runs, 'unknown-column', 'asc');
      expect(sorted[0].id).toBe('a');
      expect(sorted[1].id).toBe('b');
    });
  });
});

// ── History filter logic ──────────────────────────────────────

describe('History filter logic', () => {
  function filterRuns(runs: TestRun[], filter: string): TestRun[] {
    return filter === 'all' ? [...runs] : runs.filter(r => r.config === filter);
  }

  it('returns all runs when filter is "all"', () => {
    const runs = [
      makeRun({ id: 'a', config: 'unit' }),
      makeRun({ id: 'b', config: 'e2e' }),
      makeRun({ id: 'c', config: 'smoke' }),
    ];
    expect(filterRuns(runs, 'all')).toHaveLength(3);
  });

  it('filters to only the specified config', () => {
    const runs = [
      makeRun({ id: 'a', config: 'unit' }),
      makeRun({ id: 'b', config: 'e2e' }),
      makeRun({ id: 'c', config: 'unit' }),
    ];
    const result = filterRuns(runs, 'unit');
    expect(result).toHaveLength(2);
    expect(result.every(r => r.config === 'unit')).toBe(true);
  });

  it('returns empty array when no runs match the filter', () => {
    const runs = [
      makeRun({ id: 'a', config: 'unit' }),
    ];
    expect(filterRuns(runs, 'smoke')).toHaveLength(0);
  });

  it('does not mutate the original array', () => {
    const runs = [makeRun({ id: 'a', config: 'unit' })];
    filterRuns(runs, 'all');
    expect(runs).toHaveLength(1);
  });
});
