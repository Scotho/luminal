// E2E Global Setup — writes structured results on teardown
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  createRunDir,
  writeTestResult,
  writeRunSummary,
  updateIndex,
  getGitInfo,
  slugify,
} from '../../scripts/test-results.js';
import { analyze } from './perfAnalyzer';

const PENDING_FILE = resolve(import.meta.dirname, '../../test-results/.e2e-pending.json');

let runId = '';
let runDir = '';

export function setup() {
  const result = createRunDir('e2e');
  runId = result.runId;
  runDir = result.runDir;
  // Clean any stale pending file
  if (existsSync(PENDING_FILE)) unlinkSync(PENDING_FILE);
}

export function teardown() {
  if (!existsSync(PENDING_FILE)) return;

  let scenarioResults: any[];
  try {
    scenarioResults = JSON.parse(readFileSync(PENDING_FILE, 'utf8'));
  } catch {
    return;
  }
  unlinkSync(PENDING_FILE);

  if (!scenarioResults.length) return;

  const gitInfo = getGitInfo();
  const testEntries: any[] = [];

  for (const scenario of scenarioResults) {
    const testId = slugify(scenario.name);

    let group = 'unknown';
    if (/^[Cc]\d/.test(scenario.name)) group = 'casual';
    else if (/^[Ll]\d/.test(scenario.name)) group = 'lobby';
    else if (/^[Ss]\d/.test(scenario.name)) group = 'soak';

    let deaths: any[] = [];
    const hashChecks = { total: 0, mismatches: 0, details: [] as any[] };

    if (scenario.clients) {
      const deathMap = new Map<string, any>();
      for (let ci = 0; ci < scenario.clients.length; ci++) {
        for (const d of scenario.clients[ci].deaths) {
          const key = `${d.playerIndex}-${d.tick}`;
          if (!deathMap.has(key)) deathMap.set(key, { playerIndex: d.playerIndex, tick: d.tick, clients: [] });
          deathMap.get(key)!.clients.push(ci);
        }
      }
      deaths = [...deathMap.values()];

      if (scenario.clients.length >= 2) {
        const h0 = new Map(scenario.clients[0].hashes.map((h: any) => [h.tick, h.hash]));
        const h1 = new Map(scenario.clients[1].hashes.map((h: any) => [h.tick, h.hash]));
        const common = [...h0.keys()].filter((t: number) => h1.has(t));
        hashChecks.total = common.length;
        for (const t of common) {
          if (h0.get(t) !== h1.get(t)) {
            hashChecks.mismatches++;
            hashChecks.details.push({ tick: t, hashes: [h0.get(t)!, h1.get(t)!] });
          }
        }
      }
    }

    // Run perf analysis if perf data present
    if (scenario.perf) {
      scenario.perf.grade = analyze(scenario.perf);
    }

    // Save replay frames if available
    const hasReplay = scenario.replayFrames?.length > 0;
    const status = scenario.status || 'pass';
    const error = scenario.error || null;
    const testDir = writeTestResult(runDir, testId, {
      id: testId, name: scenario.name, status, durationMs: scenario.durationMs || 0, group,
      matchType: scenario.matchType, seed: scenario.seed,
      maxTicks: scenario.maxTicks, actualTicks: scenario.actualTicks,
      playerCount: scenario.playerCount, humanCount: scenario.humanCount,
      aiCount: scenario.aiCount, network: scenario.network,
      deaths, hashChecks, error,
      replayFile: hasReplay ? 'replay.json' : null,
      ...(scenario.perf ? { perf: scenario.perf } : {}),
    });
    if (hasReplay) {
      writeFileSync(resolve(testDir, 'replay.json'), JSON.stringify(scenario.replayFrames), 'utf8');
    }

    testEntries.push({ id: testId, name: scenario.name, status, durationMs: scenario.durationMs || 0, group, error });
  }

  const timestamp = new Date().toISOString();

  writeRunSummary(runDir, {
    id: runId, type: 'e2e', timestamp, durationMs: 0,
    platform: process.platform,
    gitBranch: gitInfo.branch, gitCommit: gitInfo.commit,
    tests: testEntries,
    summary: { total: testEntries.length, passed: testEntries.filter(t => t.status === 'pass').length, failed: testEntries.filter(t => t.status === 'fail').length, skipped: 0 },
  });

  const passed = testEntries.filter(t => t.status === 'pass').length;
  const failed = testEntries.filter(t => t.status === 'fail').length;
  updateIndex('e2e', {
    id: runId, type: 'e2e', timestamp, durationMs: 0,
    total: testEntries.length, passed, failed, skipped: 0,
  });
}
