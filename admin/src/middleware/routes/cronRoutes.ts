// admin/src/middleware/routes/cronRoutes.ts — Server-side cron engine
//
// Manages timer-based cron jobs that can spawn Claude Code agents.
// Jobs persist to admin/data/cron-jobs.json and timers are re-armed on module load.

import type { IncomingMessage, ServerResponse } from 'http';
import { parseBody, readJsonFile, writeJsonFile, ROOT, TIMEOUT_CLAUDE } from '../processPlugin';
import { spawnLongRunning } from '../processManager';
import { json, safeError } from './routeUtils';

export interface CronJob {
  id: string;
  name: string;
  prompt: string;
  delayMs: number;
  mode: 'once' | 'repeat';
  enabled: boolean;
  createdAt: number;
  lastFired?: number;
  lastAgentId?: string;
  firedCount: number;
}

const DATA_FILE = 'cron-jobs.json';
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const timerArmedAt = new Map<string, number>();
const _fireCallbacks = new Map<string, (agentId: string) => void>();

function loadJobs(): CronJob[] {
  return readJsonFile<CronJob[]>(DATA_FILE, []);
}

function saveJobs(jobs: CronJob[]): void {
  writeJsonFile(DATA_FILE, jobs);
}

function fireJob(job: CronJob): void {
  let state;
  try {
    state = spawnLongRunning(
      'claude',
      'claude',
      TIMEOUT_CLAUDE,
      ROOT,
      {
        shell: false,
        args: [
          '-p', '--verbose', '--output-format', 'stream-json',
          '--dangerously-skip-permissions',
          job.prompt,
        ],
        label: `Cron: ${job.name}`,
      },
    );
  } catch (err) {
    console.error(`[cron] Failed to spawn agent for "${job.name}":`, err);
    // Re-arm repeat jobs even on spawn failure so the cycle continues
    if (job.mode === 'repeat' && job.enabled) armTimer(job);
    return;
  }

  const jobs = loadJobs();
  const target = jobs.find(j => j.id === job.id);
  if (target) {
    target.lastFired = Date.now();
    target.lastAgentId = state.id;
    target.firedCount = (target.firedCount || 0) + 1;
    if (target.mode === 'once') {
      target.enabled = false;
    }
    saveJobs(jobs);
    // Re-arm repeat jobs using the updated target (not stale `job` param)
    if (target.mode === 'repeat' && target.enabled) {
      armTimer(target);
    }
  }

  // Notify programmatic callers
  const cb = _fireCallbacks.get(job.id);
  if (cb) {
    _fireCallbacks.delete(job.id);
    cb(state.id);
  }
}

function armTimer(job: CronJob): void {
  clearTimer(job.id);
  if (!job.enabled) return;

  const armed = Date.now();
  const handle = setTimeout(() => {
    timers.delete(job.id);
    timerArmedAt.delete(job.id);
    // Re-read from disk in case it was disabled in the meantime
    const current = loadJobs().find(j => j.id === job.id);
    if (!current || !current.enabled) return;
    fireJob(current);
  }, job.delayMs);
  handle.unref?.();
  timers.set(job.id, handle);
  timerArmedAt.set(job.id, armed);
}

function clearTimer(id: string): void {
  const existing = timers.get(id);
  if (existing) {
    clearTimeout(existing);
    timers.delete(id);
  }
  timerArmedAt.delete(id);
}

/** Re-arm all enabled jobs on startup. */
function bootTimers(): void {
  const jobs = loadJobs();
  for (const job of jobs) {
    if (job.enabled) armTimer(job);
  }
}

let _booted = false;

/** Call once the server is ready (after processPlugin constants are initialized). */
export function startCronEngine(): void {
  if (_booted) return;
  _booted = true;
  bootTimers();
}

/** Create a cron job programmatically (used by loop engine). */
export function createCronJobProgrammatic(opts: {
  name: string;
  prompt: string;
  delayMs: number;
  label?: string;
  onFired?: (agentId: string) => void;
}): CronJob {
  const job: CronJob = {
    id: `cron_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: opts.name,
    prompt: opts.prompt,
    delayMs: opts.delayMs,
    mode: 'once',
    enabled: true,
    createdAt: Date.now(),
    firedCount: 0,
  };

  const jobs = loadJobs();
  jobs.push(job);
  saveJobs(jobs);

  if (opts.onFired) {
    _fireCallbacks.set(job.id, opts.onFired);
  }

  armTimer(job);
  return job;
}

/** Remove all cron jobs whose name starts with a given prefix. */
export function clearCronJobsByPrefix(prefix: string): void {
  let jobs = loadJobs();
  for (const job of jobs) {
    if (job.name.startsWith(prefix)) {
      clearTimer(job.id);
      _fireCallbacks.delete(job.id);
    }
  }
  jobs = jobs.filter(j => !j.name.startsWith(prefix));
  saveJobs(jobs);
}

export async function cronRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const { method, url } = req;
  if (!url?.startsWith('/__admin_cron')) return false;

  // GET /__admin_cron — list all jobs + timer state
  if (method === 'GET' && (url === '/__admin_cron' || url.startsWith('/__admin_cron?'))) {
    const jobs = loadJobs();
    const result = jobs.map(j => {
      const active = timers.has(j.id);
      const armed = timerArmedAt.get(j.id);
      return {
        ...j,
        timerActive: active,
        nextFireAt: active && armed ? armed + j.delayMs : undefined,
      };
    });
    json(res, 200, result);
    return true;
  }

  // POST /__admin_cron — create a new cron job
  if (method === 'POST' && url === '/__admin_cron') {
    try {
      const body = await parseBody(req);
      const name = String(body['name'] ?? '').trim();
      const prompt = String(body['prompt'] ?? '').trim();
      const delayMs = Number(body['delayMs'] ?? 60_000);
      const mode = body['mode'] === 'repeat' ? 'repeat' : 'once';

      if (!name) {
        json(res, 400, { error: 'Missing name' });
        return true;
      }
      if (!prompt) {
        json(res, 400, { error: 'Missing prompt' });
        return true;
      }
      if (delayMs < 10_000) {
        json(res, 400, { error: 'Delay must be at least 10 seconds' });
        return true;
      }

      const job: CronJob = {
        id: `cron_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name,
        prompt,
        delayMs,
        mode,
        enabled: true,
        createdAt: Date.now(),
        firedCount: 0,
      };

      const jobs = loadJobs();
      jobs.push(job);
      saveJobs(jobs);
      armTimer(job);

      json(res, 200, { ok: true, job });
    } catch (err) {
      json(res, 400, { error: safeError(err) });
    }
    return true;
  }

  // DELETE /__admin_cron?id=X — remove a cron job
  if (method === 'DELETE' && url.startsWith('/__admin_cron?')) {
    const id = new URL(url, 'http://localhost').searchParams.get('id') ?? '';
    if (!id) {
      json(res, 400, { error: 'Missing id' });
      return true;
    }
    clearTimer(id);
    let jobs = loadJobs();
    jobs = jobs.filter(j => j.id !== id);
    saveJobs(jobs);
    json(res, 200, { ok: true });
    return true;
  }

  // PATCH /__admin_cron/toggle — enable/disable
  if (method === 'PATCH' && url.startsWith('/__admin_cron/toggle')) {
    try {
      const body = await parseBody(req);
      const id = String(body['id'] ?? '');
      if (!id) {
        json(res, 400, { error: 'Missing id' });
        return true;
      }
      const jobs = loadJobs();
      const job = jobs.find(j => j.id === id);
      if (!job) {
        json(res, 404, { error: 'Job not found' });
        return true;
      }
      job.enabled = !job.enabled;
      saveJobs(jobs);
      if (job.enabled) {
        armTimer(job);
      } else {
        clearTimer(id);
      }
      json(res, 200, { ok: true, enabled: job.enabled });
    } catch (err) {
      json(res, 400, { error: safeError(err) });
    }
    return true;
  }

  // POST /__admin_cron/fire — fire a job immediately
  if (method === 'POST' && url.startsWith('/__admin_cron/fire')) {
    try {
      const body = await parseBody(req);
      const id = String(body['id'] ?? '');
      if (!id) {
        json(res, 400, { error: 'Missing id' });
        return true;
      }
      const jobs = loadJobs();
      const job = jobs.find(j => j.id === id);
      if (!job) {
        json(res, 404, { error: 'Job not found' });
        return true;
      }
      fireJob(job);
      // Re-read to get updated lastAgentId
      const updated = loadJobs().find(j => j.id === id);
      json(res, 200, { ok: true, agentId: updated?.lastAgentId });
    } catch (err) {
      json(res, 400, { error: safeError(err) });
    }
    return true;
  }

  return false;
}
