/*
 * scripts/ingest-test-results.ts — Flakiness ingestion helper (TASK-13)
 *
 * Runs the Vitest suite with the JSON reporter, parses the output, and POSTs
 * per-test results to the admin dashboard's flakiness tracker endpoint. Use
 * this on CI or locally after a full test run to accumulate pass/fail history
 * over time and surface flaky tests in the dashboard.
 *
 * Usage:
 *   npx tsx scripts/ingest-test-results.ts                # run tests + ingest
 *   npx tsx scripts/ingest-test-results.ts --from FILE    # parse existing JSON
 *   npx tsx scripts/ingest-test-results.ts --admin URL    # override admin URL
 *
 * Defaults:
 *   - Vitest command: `npx vitest run --reporter=json --outputFile=<tmp>`
 *   - Admin URL:      http://localhost:5175
 *   - Temp file:      <os.tmpdir>/luminal-vitest-results.json
 *
 * Notes:
 *   - This script is NEVER invoked during automated agent sessions; the
 *     task spec explicitly forbids execution as part of TASK-13. It must be
 *     runnable on demand by a developer or CI step.
 *   - If the admin dashboard is not reachable, the script logs a warning and
 *     exits 0 so it does not block the CI pipeline.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface IngestResult {
  testName: string;
  file: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs?: number;
}

interface VitestAssertionResult {
  fullName?: string;
  title?: string;
  status?: string;
  duration?: number;
}

interface VitestTestResult {
  name: string;
  assertionResults: VitestAssertionResult[];
}

interface VitestJsonReport {
  testResults: VitestTestResult[];
}

function parseArgs(argv: readonly string[]): { fromFile: string | null; adminUrl: string } {
  let fromFile: string | null = null;
  let adminUrl = 'http://localhost:5175';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from' && argv[i + 1]) { fromFile = argv[i + 1]; i++; }
    else if (a === '--admin' && argv[i + 1]) { adminUrl = argv[i + 1]; i++; }
  }
  return { fromFile, adminUrl };
}

function mapStatus(s: string | undefined): 'pass' | 'fail' | 'skip' {
  if (s === 'passed') return 'pass';
  if (s === 'failed') return 'fail';
  return 'skip';
}

function parseReport(report: VitestJsonReport): IngestResult[] {
  const out: IngestResult[] = [];
  for (const suite of report.testResults ?? []) {
    for (const a of suite.assertionResults ?? []) {
      const testName = a.fullName || a.title || '(unnamed)';
      const entry: IngestResult = {
        testName: `${suite.name} > ${testName}`,
        file: suite.name,
        status: mapStatus(a.status),
      };
      if (typeof a.duration === 'number') entry.durationMs = a.duration;
      out.push(entry);
    }
  }
  return out;
}

function runVitest(outputFile: string): void {
  console.log('[ingest] Running vitest with JSON reporter...');
  const result = spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${outputFile}`], {
    stdio: 'inherit',
    shell: true,
  });
  // Vitest exits non-zero on test failure but still writes JSON — do not throw.
  if (result.error) {
    console.warn('[ingest] vitest invocation error:', result.error.message);
  }
}

async function postResults(adminUrl: string, results: IngestResult[]): Promise<void> {
  const url = `${adminUrl.replace(/\/$/, '')}/__admin_flakiness/ingest`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results }),
    });
    if (!res.ok) {
      console.warn(`[ingest] Admin returned HTTP ${res.status}: ${await res.text()}`);
      return;
    }
    const body = (await res.json()) as { ingested?: number; total?: number };
    console.log(`[ingest] Ingested ${body.ingested ?? '?'} results (total tracked: ${body.total ?? '?'}).`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ingest] Failed to reach admin (${url}): ${msg}`);
  }
}

async function main(): Promise<void> {
  const { fromFile, adminUrl } = parseArgs(process.argv.slice(2));
  const outputFile = fromFile ?? join(tmpdir(), 'luminal-vitest-results.json');

  if (!fromFile) runVitest(outputFile);

  if (!existsSync(outputFile)) {
    console.error(`[ingest] Expected JSON report not found at ${outputFile}`);
    process.exit(1);
  }

  let report: VitestJsonReport;
  try {
    const raw = readFileSync(outputFile, 'utf-8');
    report = JSON.parse(raw) as VitestJsonReport;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ingest] Failed to parse ${outputFile}: ${msg}`);
    process.exit(1);
  }

  const results = parseReport(report);
  console.log(`[ingest] Parsed ${results.length} test results.`);
  await postResults(adminUrl, results);
}

void main();
