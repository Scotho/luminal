// scripts/test-results.js — Shared test results utilities
// Used by ui-tests.js and the E2E test reporter to write structured test results.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const RESULTS_ROOT = path.resolve(PROJECT_ROOT, 'test-results');
const INDEX_PATH = path.resolve(RESULTS_ROOT, 'index.json');
const MAX_RUNS_PER_TYPE = 20;

// ── generateRunId ─────────────────────────────────────────────────────────────

/**
 * Returns a string like `2026-04-04T14-30-00_a1b2c3`
 * ISO timestamp (colons/periods replaced with dashes, truncated to seconds)
 * + underscore + 6 random hex chars.
 */
export function generateRunId() {
  const iso = new Date().toISOString(); // e.g. "2026-04-04T14:30:00.123Z"
  const truncated = iso.slice(0, 19);  // "2026-04-04T14:30:00"
  const sanitized = truncated.replace(/[:.]/g, '-'); // "2026-04-04T14-30-00"
  const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return `${sanitized}_${hex}`;
}

// ── createRunDir ──────────────────────────────────────────────────────────────

/**
 * Creates `test-results/{type}/{runId}/` and all parent dirs.
 * @param {'e2e' | 'ui'} type
 * @returns {{ runId: string, runDir: string }}
 */
export function createRunDir(type) {
  const runId = generateRunId();
  const runDir = path.resolve(RESULTS_ROOT, type, runId);
  fs.mkdirSync(runDir, { recursive: true });
  return { runId, runDir };
}

// ── writeTestResult ───────────────────────────────────────────────────────────

/**
 * Writes `data` as JSON to `{runDir}/{testId}/result.json`.
 * Creates the test directory if needed.
 * @param {string} runDir
 * @param {string} testId
 * @param {object} data
 * @returns {string} The test directory path
 */
export function writeTestResult(runDir, testId, data) {
  const testDir = path.resolve(runDir, testId);
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(
    path.resolve(testDir, 'result.json'),
    JSON.stringify(data, null, 2),
    'utf8'
  );
  return testDir;
}

// ── writeRunSummary ───────────────────────────────────────────────────────────

/**
 * Writes `runData` as JSON to `{runDir}/run.json`.
 * @param {string} runDir
 * @param {object} runData
 */
export function writeRunSummary(runDir, runData) {
  fs.writeFileSync(
    path.resolve(runDir, 'run.json'),
    JSON.stringify(runData, null, 2),
    'utf8'
  );
}

// ── updateIndex ───────────────────────────────────────────────────────────────

/**
 * Reads `test-results/index.json` (creates it if missing), appends `runSummary`
 * to the `runs` array, sorts descending by timestamp, prunes oldest runs of the
 * given type (beyond 20), then writes the updated index back.
 * @param {'e2e' | 'ui'} type
 * @param {object} runSummary  Must include a `timestamp` field for sorting.
 */
export function updateIndex(type, runSummary) {
  fs.mkdirSync(RESULTS_ROOT, { recursive: true });

  let index;
  if (fs.existsSync(INDEX_PATH)) {
    try {
      index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    } catch {
      index = { lastUpdated: null, runs: [] };
    }
  } else {
    index = { lastUpdated: null, runs: [] };
  }

  if (!Array.isArray(index.runs)) {
    index.runs = [];
  }

  // Append and sort descending by timestamp
  index.runs.push(runSummary);
  index.runs.sort((a, b) => {
    const ta = a.timestamp ?? '';
    const tb = b.timestamp ?? '';
    return tb < ta ? -1 : tb > ta ? 1 : 0;
  });

  // Prune oldest runs of this type beyond MAX_RUNS_PER_TYPE
  const typeRuns = index.runs.filter((r) => r.type === type);
  if (typeRuns.length > MAX_RUNS_PER_TYPE) {
    const toRemove = typeRuns.slice(MAX_RUNS_PER_TYPE); // oldest (already sorted desc)
    const removeIds = new Set(toRemove.map((r) => r.id));
    index.runs = index.runs.filter((r) => !removeIds.has(r.id));

    for (const run of toRemove) {
      const runDir = path.resolve(RESULTS_ROOT, type, run.id);
      if (fs.existsSync(runDir)) {
        fs.rmSync(runDir, { recursive: true, force: true });
      }
    }
  }

  index.lastUpdated = new Date().toISOString();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
}

// ── getGitInfo ────────────────────────────────────────────────────────────────

/**
 * Returns `{ branch, commit }` from the current git repo.
 * Falls back to `'unknown'` values on failure.
 * @returns {{ branch: string, commit: string }}
 */
export function getGitInfo() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    }).trim();
    const commit = execSync('git rev-parse --short HEAD', {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    }).trim();
    return { branch, commit };
  } catch {
    return { branch: 'unknown', commit: 'unknown' };
  }
}

// ── slugify ───────────────────────────────────────────────────────────────────

/**
 * Converts a test name to a filesystem-safe slug.
 * e.g. "C1: full casual round" → "c1-full-casual-round"
 * @param {string} name
 * @returns {string}
 */
export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}
