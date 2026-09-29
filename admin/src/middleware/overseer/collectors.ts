// admin/src/middleware/overseer/collectors.ts
// Domain collector functions — fetch data from admin endpoints and return
// structured DomainSnapshot objects. Pure data collection, no analysis.

import type { DomainSnapshot, DomainId } from './types';

export interface CollectorContext {
  adminBase: string; // e.g. 'http://localhost:5175'
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fetchJson<T>(ctx: CollectorContext, path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${ctx.adminBase}${path}`);
    if (!res.ok) return fallback;
    return await res.json() as T;
  } catch {
    return fallback;
  }
}

function makeSnapshot(
  domain: DomainId,
  data: Record<string, unknown>,
  metrics: Record<string, number>,
): DomainSnapshot {
  return { domain, ts: Date.now(), data, metrics };
}

// ── 1. Bugs ──────────────────────────────────────────────────────────────────

interface BugReport {
  id?: string;
  error?: string;
  ts?: number;
}

export async function collectBugs(ctx: CollectorContext): Promise<DomainSnapshot> {
  const reports = await fetchJson<BugReport[]>(ctx, '/data/bug-reports.json', []);

  const windowMs = 10 * 60 * 1000; // 10 minutes
  const cutoff = Date.now() - windowMs;

  const recent = reports.filter((r) => typeof r.ts === 'number' && r.ts >= cutoff);

  // Cluster by first 80 chars of error string
  const errorPrefixes = new Set<string>();
  for (const r of recent) {
    if (typeof r.error === 'string') {
      errorPrefixes.add(r.error.slice(0, 80));
    }
  }

  const burstDetected = recent.length >= 3 ? 1 : 0;

  return makeSnapshot(
    'bugs',
    { reports: recent },
    {
      totalRecent: recent.length,
      burstDetected,
      uniqueErrors: errorPrefixes.size,
    },
  );
}

// ── 2. Tests ─────────────────────────────────────────────────────────────────

interface TestRun {
  id?: string;
  passed?: number;
  failed?: number;
  status?: string;
}

interface TestLogData {
  runs?: TestRun[];
}

interface CIRun {
  id?: string;
  status?: string; // 'passed' | 'failed' | 'running' | etc.
}

export async function collectTests(ctx: CollectorContext): Promise<DomainSnapshot> {
  const [testLog, ciRuns] = await Promise.all([
    fetchJson<TestLogData>(ctx, '/data/test-log.json', {}),
    fetchJson<CIRun[]>(ctx, '/__admin_ci/runs', []),
  ]);

  const runs: TestRun[] = Array.isArray(testLog.runs) ? testLog.runs : [];
  const last5 = runs.slice(-5);

  let recentPasses = 0;
  let recentFailures = 0;
  for (const run of last5) {
    recentPasses += typeof run.passed === 'number' ? run.passed : 0;
    recentFailures += typeof run.failed === 'number' ? run.failed : 0;
  }

  const ci = Array.isArray(ciRuns) ? ciRuns : [];
  const ciFailures = ci.filter((r) => r.status === 'failed').length;
  const ciInProgress = ci.filter((r) => r.status === 'running').length;

  return makeSnapshot(
    'tests',
    { recentRuns: last5, ciRuns: ci },
    {
      recentPasses,
      recentFailures,
      ciFailures,
      ciInProgress,
      totalRuns: runs.length,
    },
  );
}

// ── 3. Server Health ──────────────────────────────────────────────────────────

interface StatusResponse {
  running?: boolean;
  agents?: unknown[];
}

interface PlayerHistoryPoint {
  players?: number;
  lobbies?: number;
  matches?: number;
  ts?: number;
}

export async function collectServerHealth(ctx: CollectorContext): Promise<DomainSnapshot> {
  const [status, history] = await Promise.all([
    fetchJson<StatusResponse>(ctx, '/__admin_exec/status', {}),
    fetchJson<PlayerHistoryPoint[]>(ctx, '/data/player-history.json', []),
  ]);

  const adminRunning = status.running ? 1 : 0;
  const activeAgents = Array.isArray(status.agents) ? status.agents.length : 0;

  const latest = Array.isArray(history) && history.length > 0
    ? history[history.length - 1]
    : null;

  const playerCount = typeof latest?.players === 'number' ? latest.players : 0;
  const lobbyCount = typeof latest?.lobbies === 'number' ? latest.lobbies : 0;
  const matchCount = typeof latest?.matches === 'number' ? latest.matches : 0;

  return makeSnapshot(
    'server-health',
    { status, latestPoint: latest },
    { adminRunning, activeAgents, playerCount, lobbyCount, matchCount },
  );
}

// ── 4. Perf ───────────────────────────────────────────────────────────────────

export async function collectPerf(ctx: CollectorContext): Promise<DomainSnapshot> {
  const budget = await fetchJson<Record<string, unknown>>(ctx, '/data/perf-budget.json', {});
  const hasBudget = Object.keys(budget).length > 0 ? 1 : 0;

  return makeSnapshot(
    'perf',
    { budget },
    { hasBudget },
  );
}

// ── 5. Player Activity ────────────────────────────────────────────────────────

export async function collectPlayerActivity(ctx: CollectorContext): Promise<DomainSnapshot> {
  const history = await fetchJson<PlayerHistoryPoint[]>(ctx, '/data/player-history.json', []);

  const hourMs = 60 * 60 * 1000;
  const cutoff = Date.now() - hourMs;

  const recent = Array.isArray(history)
    ? history.filter((p) => typeof p.ts === 'number' && p.ts >= cutoff)
    : [];

  const currentPlayers = recent.length > 0
    ? (typeof recent[recent.length - 1].players === 'number' ? recent[recent.length - 1].players! : 0)
    : 0;

  const peakLastHour = recent.reduce((max, p) => {
    const count = typeof p.players === 'number' ? p.players : 0;
    return count > max ? count : max;
  }, 0);

  return makeSnapshot(
    'player-activity',
    { recentPoints: recent },
    { currentPlayers, peakLastHour, dataPoints: recent.length },
  );
}

// ── 6. Deploy ─────────────────────────────────────────────────────────────────

interface VersionResponse {
  version?: string;
}

export async function collectDeploy(ctx: CollectorContext): Promise<DomainSnapshot> {
  const versionData = await fetchJson<VersionResponse>(ctx, '/__admin_exec/version', {});
  const hasVersion = typeof versionData.version === 'string' && versionData.version.length > 0
    ? 1
    : 0;

  return makeSnapshot(
    'deploy',
    { version: versionData },
    { hasVersion },
  );
}

// ── 7. Stale Tasks ────────────────────────────────────────────────────────────

interface TaskEntry {
  id?: string;
  status?: string;
  modified?: string;
  created?: string;
}

export async function collectStaleTasks(ctx: CollectorContext): Promise<DomainSnapshot> {
  const tasks = await fetchJson<TaskEntry[]>(ctx, '/data/tasks.json', []);

  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - sevenDaysMs;

  const allTasks = Array.isArray(tasks) ? tasks : [];
  const pending = allTasks.filter((t) => t.status !== 'done');

  const stale = pending.filter((t) => {
    const dateStr = t.modified ?? t.created;
    if (!dateStr) return true; // no date = treat as stale
    const ts = new Date(dateStr).getTime();
    return Number.isFinite(ts) && ts < cutoff;
  });

  return makeSnapshot(
    'stale-tasks',
    { staleTasks: stale },
    {
      staleCount: stale.length,
      pendingCount: pending.length,
      totalCount: allTasks.length,
    },
  );
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const COLLECTORS: Record<DomainId, (ctx: CollectorContext) => Promise<DomainSnapshot>> = {
  'bugs': collectBugs,
  'tests': collectTests,
  'server-health': collectServerHealth,
  'perf': collectPerf,
  'player-activity': collectPlayerActivity,
  'deploy': collectDeploy,
  'stale-tasks': collectStaleTasks,
};
