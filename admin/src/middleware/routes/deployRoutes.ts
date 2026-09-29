// ── Deploy Pipeline Routes ─────────────────────────────────
// Wires the admin Deploy Pipeline UI to `firebase deploy` via spawnLongRunning.
//
//  GET  /__admin_deploy/history            — DeployRecord[] newest first
//  POST /__admin_deploy/run                — body {target, dryRun?} — spawns deploy
//  GET  /__admin_deploy/stream?id=...      — SSE stream of an in-flight deploy
//  POST /__admin_deploy/abort?id=...       — kill an in-flight deploy
//
// Safety invariants:
//  • Server-side allowlist of targets (never trust client input).
//  • Refuses to run while git working tree is dirty (unless dryRun).
//  • Never passes `--force`.
//  • Records every run in `admin/data/deploy-pipeline-history.json` so the
//    existing `deploy-history.json` (DeployEntry release log) is unaffected.

import { execSync } from 'child_process';
import type { IncomingMessage, ServerResponse } from 'http';

import { parseBody, readJsonFile, writeJsonFile, ROOT, formatSSE } from '../processPlugin';
import { agents, spawnLongRunning, killProcess, type ProcessState } from '../processManager';
import { json, param, safeError } from './routeUtils';
import type { DeployRecord, DeployTarget } from '../../types';

// ── Constants ─────────────────────────────────────────────

/** Server-side target allowlist. Never trust raw client input. */
export const ALLOWED_TARGETS: readonly DeployTarget[] = [
  'live',
  'test',
  'rules',
  'functions',
  'hosting',
] as const;

/** `firebase deploy --only <spec>` argument for each target. */
const TARGET_FIREBASE_SPEC: Record<DeployTarget, string> = {
  live: 'hosting:luminal-game',
  test: 'hosting:luminal-test',
  rules: 'firestore:rules,database,storage',
  functions: 'functions',
  hosting: 'hosting',
};

const HISTORY_FILE = 'deploy-pipeline-history.json';
const DEPLOY_TIMEOUT_MS = 15 * 60 * 1000; // 15 min hard cap
const LOG_TAIL_BYTES = 4 * 1024;

// ── Helpers ───────────────────────────────────────────────

export function isAllowedTarget(raw: unknown): raw is DeployTarget {
  return typeof raw === 'string' && (ALLOWED_TARGETS as readonly string[]).includes(raw);
}

/** Returns true when the working tree is clean. Never bypassed. */
export function isGitClean(): boolean {
  try {
    const out = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf-8' });
    return out.trim().length === 0;
  } catch {
    // If we can't detect state, treat as dirty (fail closed).
    return false;
  }
}

function readHistory(): DeployRecord[] {
  return readJsonFile<DeployRecord[]>(HISTORY_FILE, []);
}

function writeHistory(records: DeployRecord[]): void {
  // Cap at 200 entries so the file never grows unbounded.
  const trimmed = records.slice(-200);
  writeJsonFile(HISTORY_FILE, trimmed);
}

/** Join the last ~N bytes of an output buffer into a single log tail string. */
function tailLogs(chunks: string[], maxBytes: number): string {
  let total = 0;
  const out: string[] = [];
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    total += chunk.length;
    out.unshift(chunk);
    if (total >= maxBytes) break;
  }
  return out.join('').slice(-maxBytes);
}

function nextId(): string {
  return `deploy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Build the shell-safe `firebase deploy` command for a target. */
export function buildDeployCommand(target: DeployTarget, dryRun: boolean): string {
  const spec = TARGET_FIREBASE_SPEC[target];
  const parts = ['firebase', 'deploy', '--only', spec, '--non-interactive'];
  if (dryRun) parts.push('--dry-run');
  return parts.join(' ');
}

// Tracks process → record id so we can update history on close.
const runningIds = new Map<string, string>();

/** Create + persist a new DeployRecord, return it. */
function openRecord(target: DeployTarget, dryRun: boolean, triggeredBy?: string): DeployRecord {
  const record: DeployRecord = {
    id: nextId(),
    target,
    startedAt: Date.now(),
    status: 'running',
    triggeredBy: triggeredBy ?? 'admin-ui',
  };
  if (dryRun) {
    record.triggeredBy = `${record.triggeredBy}:dryRun`;
  }
  const history = readHistory();
  history.push(record);
  writeHistory(history);
  return record;
}

/** Finalize a record with exit code + log tail. */
function closeRecord(
  id: string,
  status: DeployRecord['status'],
  exitCode: number | null,
  logTail: string,
): void {
  const history = readHistory();
  const idx = history.findIndex(r => r.id === id);
  if (idx === -1) return;
  history[idx] = {
    ...history[idx],
    status,
    exitCode: exitCode ?? undefined,
    finishedAt: Date.now(),
    logTail,
  };
  writeHistory(history);
}

/** Wire process lifecycle to persist the record on exit. */
function attachLifecycle(state: ProcessState, recordId: string): void {
  runningIds.set(state.id, recordId);
  state.proc.on('close', (code, signal) => {
    runningIds.delete(state.id);
    const status: DeployRecord['status'] =
      signal ? 'aborted' : code === 0 ? 'success' : 'failure';
    closeRecord(recordId, status, code, tailLogs(state.output, LOG_TAIL_BYTES));
  });
}

// ── Main router ───────────────────────────────────────────

export async function deployRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const { method, url } = req;
  if (!url?.startsWith('/__admin_deploy/')) return false;

  // ── GET /__admin_deploy/history ───────────────────────
  if (method === 'GET' && url.startsWith('/__admin_deploy/history')) {
    const history = readHistory();
    // Newest first
    const sorted = [...history].reverse();
    json(res, 200, sorted);
    return true;
  }

  // ── POST /__admin_deploy/run ──────────────────────────
  if (method === 'POST' && url === '/__admin_deploy/run') {
    try {
      const body = await parseBody(req);
      const rawTarget = body['target'];
      const dryRun = body['dryRun'] === true;
      const triggeredBy = typeof body['triggeredBy'] === 'string' ? body['triggeredBy'] : undefined;

      if (!isAllowedTarget(rawTarget)) {
        json(res, 400, { error: `Invalid target. Allowed: ${ALLOWED_TARGETS.join(', ')}` });
        return true;
      }

      // Block if any deploy is already in flight (consult the on-disk history
      // as the source of truth — `runningIds` is purely a lookup helper).
      {
        const history = readHistory();
        const active = history.find(r => r.status === 'running');
        if (active) {
          json(res, 409, { error: 'A deploy is already running', activeId: active.id });
          return true;
        }
      }

      // Real (non dry-run) deploys require a clean working tree.
      if (!dryRun && !isGitClean()) {
        json(res, 409, { error: 'Working tree is dirty — commit or stash before deploying' });
        return true;
      }

      const command = buildDeployCommand(rawTarget, dryRun);
      const record = openRecord(rawTarget, dryRun, triggeredBy);
      const state = spawnLongRunning(
        'deploy',
        command,
        DEPLOY_TIMEOUT_MS,
        ROOT,
        { label: `deploy:${rawTarget}${dryRun ? ':dry' : ''}` },
      );
      attachLifecycle(state, record.id);

      json(res, 200, { ok: true, id: record.id, agentId: state.id, command });
    } catch (err) {
      json(res, 400, { error: safeError(err) });
    }
    return true;
  }

  // ── GET /__admin_deploy/stream?id=... ─────────────────
  if (method === 'GET' && url.startsWith('/__admin_deploy/stream')) {
    const id = param(url, 'id');
    // Find the agent keyed to this deploy record
    const agentId = [...runningIds.entries()].find(([, recId]) => recId === id)?.[0];
    const state = agentId ? agents.get(agentId) : undefined;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    if (!state) {
      res.write(formatSSE('status', { message: 'Deploy not found or already finished' }));
      res.end();
      return true;
    }

    // Replay buffered output
    for (const chunk of state.output) res.write(chunk);

    if (state.done) {
      res.end();
      return true;
    }

    state.sseClients.add(res);
    req.on('close', () => { state.sseClients.delete(res); });
    return true;
  }

  // ── POST /__admin_deploy/abort?id=... ─────────────────
  if (method === 'POST' && url.startsWith('/__admin_deploy/abort')) {
    const id = param(url, 'id');
    const agentId = [...runningIds.entries()].find(([, recId]) => recId === id)?.[0];
    const state = agentId ? agents.get(agentId) : undefined;
    if (!state || state.done) {
      json(res, 200, { ok: true, alreadyDone: true });
      return true;
    }
    killProcess(state, 'Aborted by operator');
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
