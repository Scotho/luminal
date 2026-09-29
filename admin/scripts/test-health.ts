/**
 * test-health.ts
 *
 * Parses existing structured test results from the test-results/ directory
 * and outputs a TestHealth JSON to stdout.
 *
 * Usage:
 *   npx tsx admin/scripts/test-health.ts [--failures-only]
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import type { TestHealth, TestConfigHealth, TestFailure } from '../src/types.js';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const RESULTS_DIR = resolve(ROOT, 'test-results');
const SRC_DIR = resolve(ROOT, 'src');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect .ts files from a directory, excluding specific subdirs. */
function collectTsFiles(
  dir: string,
  excludeDirs: string[] = ['node_modules', 'e2e', 'styles'],
): string[] {
  const results: string[] = [];

  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (excludeDirs.includes(entry.name)) continue;
      const subResults = collectTsFiles(join(dir, entry.name), excludeDirs);
      results.push(...subResults);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(join(dir, entry.name));
    }
  }

  return results;
}

/** Read and parse a JSON file safely, returning null on any error. */
function readJsonFile(filePath: string): unknown {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw as string);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Exported parsing functions
// ---------------------------------------------------------------------------

/**
 * Parses test-results/index.json data into a TestHealth object.
 * If indexData is null or has no `runs` array, returns an empty TestHealth.
 */
export function parseTestIndex(indexData: unknown): TestHealth {
  const empty: TestHealth = {
    configs: {},
    failures: [],
    untested: [],
    coverage: { withTests: 0, total: 0, percent: 0 },
    generated: new Date().toISOString(),
  };

  if (
    indexData === null ||
    indexData === undefined ||
    typeof indexData !== 'object' ||
    !Array.isArray((indexData as Record<string, unknown>)['runs'])
  ) {
    return empty;
  }

  const runs = (indexData as Record<string, unknown>)['runs'] as Array<{
    id: string;
    type: string;
    timestamp: string;
    durationMs: number;
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  }>;

  if (runs.length === 0) return empty;

  // Group all runs by type, sorted newest-first
  const runsByType = new Map<string, typeof runs>();
  for (const run of runs) {
    const arr = runsByType.get(run.type) ?? [];
    arr.push(run);
    runsByType.set(run.type, arr);
  }
  for (const arr of runsByType.values()) {
    arr.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  const configs: Record<string, TestConfigHealth> = {};
  const failures: TestFailure[] = [];

  for (const [type, typeRuns] of runsByType) {
    const latest = typeRuns[0];
    const recentRuns = typeRuns.slice(0, 5);

    // Collect test names that passed and failed across recent runs
    const passedNames = new Set<string>();
    const failedNames = new Set<string>();

    for (const run of recentRuns) {
      const runJsonPath = resolve(RESULTS_DIR, type, run.id, 'run.json');
      if (!existsSync(runJsonPath)) continue;
      const runData = readJsonFile(runJsonPath) as Record<string, unknown> | null;
      if (!runData || !Array.isArray(runData['tests'])) continue;
      const tests = runData['tests'] as Array<{ name: string; status: string; error: string | null }>;
      for (const test of tests) {
        if (test.status === 'pass') passedNames.add(test.name);
        if (test.status === 'fail') {
          failedNames.add(test.name);
          // Only add to failures list from the latest run
          if (run === latest && test.error) {
            failures.push({ test: test.name, config: type, error: test.error });
          }
        }
      }
    }

    // Flaky = appeared in both passed and failed across recent runs
    let flaky = 0;
    for (const name of failedNames) {
      if (passedNames.has(name)) flaky++;
    }

    configs[type] = {
      total: latest.total,
      passed: latest.passed,
      failed: latest.failed,
      skipped: latest.skipped,
      flaky,
      lastRun: latest.timestamp,
      duration: Math.round(latest.durationMs / 1000),
    };
  }

  return {
    configs,
    failures,
    untested: [],
    coverage: { withTests: 0, total: 0, percent: 0 },
    generated: new Date().toISOString(),
  };
}

/**
 * Finds source files that have no corresponding .test.ts counterpart.
 *
 * Excludes:
 * - .test.ts files
 * - /types/index.ts
 * - barrel /index.ts files
 * - .css files
 * - .d.ts files
 */
export function findUntestedModules(srcFiles: string[], testFiles: string[]): string[] {
  // Normalise slashes for cross-platform comparison
  const normalize = (p: string) => p.replace(/\\/g, '/');

  // Build a set of source paths that tests cover.
  // Strategy: for each test file, compute the source equivalent by replacing
  // .test.ts → .ts, then check both the full path and basename matches.
  const testedSourcePaths = new Set<string>();
  const testedBasenames = new Set<string>();

  for (const tf of testFiles) {
    const norm = normalize(tf);
    if (!norm.endsWith('.test.ts')) continue;
    // Full path equivalent: replace .test.ts with .ts
    const sourceEquiv = norm.replace(/\.test\.ts$/, '.ts');
    testedSourcePaths.add(sourceEquiv);
    // Also track just the basename for cross-directory matching
    const basename = sourceEquiv.split('/').pop() ?? '';
    if (basename) testedBasenames.add(basename);
  }

  // Filter srcFiles to only those that need tests
  return srcFiles
    .map(normalize)
    .filter(f => {
      // Exclude test files themselves
      if (f.endsWith('.test.ts')) return false;
      // Exclude declaration files
      if (f.endsWith('.d.ts')) return false;
      // Exclude CSS files
      if (f.endsWith('.css')) return false;
      // Exclude /types/index.ts
      if (f.includes('/types/index.ts')) return false;
      // Exclude barrel index.ts files (any path ending in /index.ts)
      if (f.endsWith('/index.ts')) return false;
      return true;
    })
    .filter(f => {
      // Check if there's a matching test file by full path
      if (testedSourcePaths.has(f)) return false;
      // Check if there's a matching test file by basename
      const basename = f.split('/').pop() ?? '';
      if (basename && testedBasenames.has(basename)) return false;
      return true;
    });
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Reads test-results/ from disk, scans src/ for .ts files, and assembles
 * a complete TestHealth object.
 */
export async function generateTestHealth(): Promise<TestHealth> {
  // Read index.json if it exists
  const indexPath = resolve(RESULTS_DIR, 'index.json');
  let indexData: unknown = null;
  if (existsSync(indexPath)) {
    indexData = readJsonFile(indexPath);
  }

  // Parse test index (configs + failures)
  const health = parseTestIndex(indexData);

  // Scan src/ for .ts files
  const allSrcFiles = collectTsFiles(SRC_DIR, ['node_modules', 'e2e', 'styles']);
  const testFiles = allSrcFiles.filter(f => f.endsWith('.test.ts'));
  const srcFiles = allSrcFiles;

  // Find untested modules
  health.untested = findUntestedModules(srcFiles, testFiles);

  // Calculate coverage stats
  const filteredSrc = srcFiles
    .map(f => f.replace(/\\/g, '/'))
    .filter(f => {
      if (f.endsWith('.test.ts')) return false;
      if (f.endsWith('.d.ts')) return false;
      if (f.endsWith('.css')) return false;
      if (f.includes('/types/index.ts')) return false;
      if (f.endsWith('/index.ts')) return false;
      return true;
    });

  const total = filteredSrc.length;
  const withTests = total - health.untested.length;
  const percent = total > 0 ? Math.round((withTests / total) * 100) : 0;

  health.coverage = { withTests, total, percent };

  return health;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const isMain = (() => {
  try {
    const scriptUrl = new URL(import.meta.url);
    let scriptPath = scriptUrl.pathname.replace(/^\/([A-Z]:)/, '$1');
    scriptPath = scriptPath.replace(/\\/g, '/');
    const argv1 = process.argv[1]?.replace(/\\/g, '/') ?? '';
    return argv1.endsWith(scriptPath) || argv1.includes('test-health');
  } catch {
    return false;
  }
})();

if (isMain) {
  const args = process.argv.slice(2);
  const failuresOnly = args.includes('--failures-only');

  generateTestHealth()
    .then(health => {
      const output = failuresOnly
        ? { failures: health.failures, generated: health.generated }
        : health;
      process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    })
    .catch(err => {
      console.error('test-health error:', err);
      process.exit(1);
    });
}
