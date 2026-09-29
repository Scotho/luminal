// admin/src/middleware/routes/loopRoutes.ts — Iterative Loop engine
//
// Three-agent chain: Scout → Operator → Reviewer → Scout (repeat).
// State persisted to admin/data/iterative-loop.json.
// Chaining via cron engine with 30s cooldown between agents.

import { execSync } from 'child_process';
import type { IncomingMessage, ServerResponse } from 'http';
import { ADMIN_BASE } from '../../config';
import { parseBody, readJsonFile, writeJsonFile, ROOT, TIMEOUT_CLAUDE } from '../processPlugin';
import { spawnLongRunning, agents, killProcess } from '../processManager';
import { createCronJobProgrammatic, clearCronJobsByPrefix } from './cronRoutes';
import { json, safeError } from './routeUtils';

// ── Types ─────────────────────────────────────────────────

type AgentRole = 'scout' | 'analyst' | 'operator' | 'reviewer';

interface LoopHistoryEntry {
  iteration: number;
  agent: AgentRole;
  agentId: string;
  startedAt: number;
  completedAt: number | null;
  exitCode: number | null;
  summary: string;
}

type AgentBackend = 'claude' | 'ollama';

interface LoopState {
  enabled: boolean;
  mode: 'supervised' | 'autonomous';
  iteration: number;
  maxIterations: number;
  maxWallClockMs: number;
  startedAt: number | null;
  currentAgent: AgentRole | null;
  currentAgentId: string | null;
  baseCommit: string | null;
  tags: string[];
  prompts: {
    scout: string;
    analyst: string;
    operator: string;
    reviewer: string;
  };
  backends: {
    scout: AgentBackend;
    analyst: AgentBackend;
    operator: AgentBackend;
    reviewer: AgentBackend;
  };
  history: LoopHistoryEntry[];
}

// ── Constants ─────────────────────────────────────────────

const DATA_FILE = 'iterative-loop.json';
const CHAIN_DELAY_MS = 30_000;
const CRON_PREFIX = 'Loop:';

const AGENT_ORDER: AgentRole[] = ['scout', 'analyst', 'operator', 'reviewer'];

const DEFAULT_PROMPTS: Record<AgentRole, string> = {
  scout: `You are the SCOUT agent in an iterative improvement loop for the Luminal game.

Your job: harden network and performance tracking instrumentation.

1. Audit these files for missing data signals:
   - src/netcode.ts (RTT, heartbeat, connection telemetry)
   - src/core/lockstepManager.ts (rollback, desync, prediction metrics)
   - src/ui/perfStats.ts (rendering, memory, FPS metrics)
   - src/debugLog.ts (diagnostic output)
   - src/net/*.ts (transport layer metrics)

2. Add missing signals that help detect the source of bugs:
   - Packet loss rate, jitter measurement, per-input ack tracking
   - Frame-time histograms, GC pause tracking, sim cost breakdowns
   - Snapshot recovery cost/timing, transport serialization overhead

3. Ensure new telemetry integrates with existing getTelemetry() and getNetcodeStats() APIs.

4. Run the full e2e test suite: npm run test && npx playwright test
   Record what data the new instrumentation captures.

Follow TypeScript strict mode. No as-any casts. Files under 400 lines.`,

  analyst: `You are the ANALYST agent in an iterative improvement loop for the Luminal game.

Your job: interpret telemetry data from the Scout's e2e test run and create actionable specs and tasks for the Operator.

1. Read test output artifacts:
   - Check test-results/ for JSON reports and console logs
   - Look for telemetry output from getTelemetry() and getNetcodeStats() in test logs
   - Review any new instrumentation the Scout added

2. Identify actionable patterns:
   - Desync clustering: which game states trigger hash mismatches?
   - Rollback depth correlations: what network conditions cause deep rollbacks (>8 ticks)?
   - Latency anomalies: RTT spikes, jitter patterns, packet loss correlations
   - Frame-time outliers: which systems cause frame drops (collision, trail, proximity)?
   - Recovery events: how often does full snapshot resync trigger, and what precedes it?

3. Create targeted tasks for the Operator:
   - Use: curl -s -X POST ${ADMIN_BASE}/__admin_task -H 'Content-Type: application/json' -d '{"ref":"TASK-N","tag":"netcode","prompt":"...","source":"analyst-loop","status":"pending","priority":N}'
   - Get the next ref: curl -s -X POST ${ADMIN_BASE}/__admin_ref/next -H 'Content-Type: application/json' -d '{"type":"TASK"}'
   - Each task must be specific and data-backed, not vague
   - Tag tasks with the appropriate tag (netcode, performance, bugs)

4. Write specs for larger findings:
   - Get next ref: curl -s -X POST ${ADMIN_BASE}/__admin_ref/next -H 'Content-Type: application/json' -d '{"type":"SPEC"}'
   - Write spec to docs/superpowers/specs/SPEC-N-<topic>-design.md
   - Link specs to tasks via refs

5. Filter noise — not every data point needs a task. Only create tasks where there is a clear signal and a concrete fix path.

Do NOT modify game code. Your role is analysis and planning only.`,

  operator: `You are the OPERATOR agent in an iterative improvement loop for the Luminal game.

Your job: complete active bugs, performance, and netcode tasks.

1. Fetch pending tasks from the admin dashboard:
   curl -s "${ADMIN_BASE}/__admin_task?status=pending"
   Filter to tasks tagged with the tags specified in the loop header above.
   Sort by priority (1=critical first).

2. For each task:
   - Read the task prompt and any linked specs/bugs
   - Implement the fix or improvement
   - Update related tests
   - If a task should be rejected: log an incident via the admin API with justification

3. Rules:
   - Lockstep/rollback changes must NOT worsen player experience
   - Performance wins must NOT degrade visual appeal
   - Only pursue changes where confidence is high

4. Gate: ALL e2e tests must pass before you are done.
   Run: npm run test && npx playwright test
   If tests fail, fix and retry (up to 5 attempts).
   If still failing after 5 attempts, stop and report.

Follow TypeScript strict mode. No as-any casts. Conventional commits.`,

  reviewer: `You are the REVIEWER agent in an iterative improvement loop for the Luminal game.

Your job: review all code changes from the current iteration.

1. Get the diff since iteration start:
   git diff {baseCommit}..HEAD --stat
   git diff {baseCommit}..HEAD

2. Review every changed file for:
   - Correctness: does the logic do what it claims?
   - Player experience: could this make the game worse for players?
   - Visual quality: do performance changes degrade visual appeal?
   - TypeScript strict compliance: no as-any, no type escapes
   - File size: flag files over 400 lines
   - Test quality: meaningful assertions, no .skip, new code has coverage

3. Produce a review summary:
   - Files changed count
   - Issues found (critical vs suggestion)
   - Overall assessment (approve / concerns)

4. Post critical issues as notes — they will be addressed in the next iteration.
   Do NOT revert or modify code. Your role is review only.`,
};

// ── State management ──────────────────────────────────────

function defaultState(): LoopState {
  return {
    enabled: false,
    mode: 'supervised',
    iteration: 0,
    maxIterations: 10,
    maxWallClockMs: 12 * 60 * 60 * 1000,
    startedAt: null,
    currentAgent: null,
    currentAgentId: null,
    baseCommit: null,
    tags: ['netcode', 'performance', 'bugs'],
    prompts: { ...DEFAULT_PROMPTS },
    backends: { scout: 'claude', analyst: 'claude', operator: 'claude', reviewer: 'claude' },
    history: [],
  };
}

function loadState(): LoopState {
  const raw = readJsonFile<Partial<LoopState>>(DATA_FILE, {});
  return { ...defaultState(), ...raw };
}

function saveState(state: LoopState): void {
  writeJsonFile(DATA_FILE, state);
}

// ── Prompt builder ────────────────────────────────────────

function buildPrompt(state: LoopState, role: AgentRole): string {
  const lastReview = [...state.history]
    .reverse()
    .find(h => h.agent === 'reviewer' && h.summary);
  const reviewNotes = lastReview?.summary ?? 'First iteration — no prior review';

  const userPrompt = (state.prompts[role] || DEFAULT_PROMPTS[role])
    .replace(/\{baseCommit\}/g, state.baseCommit ?? 'HEAD~10');

  return `[ITERATIVE LOOP — Agent: ${role.charAt(0).toUpperCase() + role.slice(1)} — Iteration ${state.iteration}/${state.maxIterations}]
[Mode: ${state.mode}]
[Base commit: ${state.baseCommit ?? 'unknown'}]
[Tags: ${state.tags.join(', ')}]
[Previous reviewer notes: ${reviewNotes}]

--- AGENT INSTRUCTIONS ---

${userPrompt}

--- CHAIN PROTOCOL ---

When your work is complete:
1. Post a note to any active orchestrator session summarizing what you did
2. Call: curl -s -X POST ${ADMIN_BASE}/__admin_loop/advance -H 'Content-Type: application/json' -d '{"agent":"${role}","summary":"<brief summary of work done>"}'

This will automatically chain to the next agent. Do NOT create cron jobs directly.`;
}

// ── Agent spawning ────────────────────────────────────────

function getHeadCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function spawnAgent(state: LoopState, role: AgentRole): string {
  const prompt = buildPrompt(state, role);
  const label = `Loop ${role.charAt(0).toUpperCase() + role.slice(1)} (iter ${state.iteration})`;
  const backend = state.backends?.[role] ?? 'claude';

  const proc = backend === 'ollama'
    ? spawnLongRunning(
        'aider', // Use aider process type for Ollama-based agents
        'aider',
        TIMEOUT_CLAUDE,
        ROOT,
        {
          shell: false,
          args: [
            '--message', prompt,
            '--model', 'ollama_chat/qwen3:14b',
            '--no-pretty', '--yes-always', '--no-show-model-warnings',
            '--edit-format', 'diff', '--encoding', 'utf-8',
            '--auto-commits', '--subtree-only',
          ],
          label: `${label} [ollama]`,
        },
      )
    : spawnLongRunning(
        'claude',
        'claude',
        TIMEOUT_CLAUDE,
        ROOT,
        {
          shell: false,
          args: [
            '-p', '--verbose', '--output-format', 'stream-json',
            '--dangerously-skip-permissions',
            prompt,
          ],
          label,
        },
      );

  state.currentAgent = role;
  state.currentAgentId = proc.id;
  state.history.push({
    iteration: state.iteration,
    agent: role,
    agentId: proc.id,
    startedAt: Date.now(),
    completedAt: null,
    exitCode: null,
    summary: '',
  });
  saveState(state);
  return proc.id;
}

// ── Orphan watchdog ───────────────────────────────────────
// Detects when a loop agent exits without calling /advance and handles it.

let _watchdogHandle: ReturnType<typeof setInterval> | null = null;

function startWatchdog(): void {
  if (_watchdogHandle) return;
  _watchdogHandle = setInterval(checkOrphan, 30_000);
  _watchdogHandle.unref?.();
}

function stopWatchdog(): void {
  if (_watchdogHandle) { clearInterval(_watchdogHandle); _watchdogHandle = null; }
}

function checkOrphan(): void {
  const state = loadState();
  if (!state.enabled || !state.currentAgentId) return;

  const proc = agents.get(state.currentAgentId);

  // Agent still running — nothing to do
  if (proc && !proc.done) return;

  // Agent is gone or done — it didn't call /advance
  const exitCode = proc?.exitCode ?? null;
  const role = state.currentAgent;

  // Update history entry
  const entry = [...state.history].reverse().find(
    h => h.agentId === state.currentAgentId && !h.completedAt,
  );
  if (entry) {
    entry.completedAt = Date.now();
    entry.exitCode = exitCode;
    entry.summary = `[Auto-detected] Agent exited without advancing (code: ${exitCode})`;
  }

  // Determine next action based on mode
  const nonZero = exitCode !== null && exitCode !== 0;

  if (state.mode === 'supervised' && nonZero) {
    // Supervised + non-zero exit → halt
    state.enabled = false;
    state.currentAgent = null;
    state.currentAgentId = null;
    saveState(state);
    stopWatchdog();
    return;
  }

  // Auto-advance: chain to next agent
  const currentIdx = AGENT_ORDER.indexOf(role!);
  const nextIdx = (currentIdx + 1) % AGENT_ORDER.length;
  const nextAgent = AGENT_ORDER[nextIdx];
  const nextIteration = nextAgent === 'scout' ? state.iteration + 1 : state.iteration;

  // Check ceilings
  if (nextIteration > state.maxIterations) {
    state.enabled = false;
    state.currentAgent = null;
    state.currentAgentId = null;
    saveState(state);
    stopWatchdog();
    return;
  }
  const elapsed = Date.now() - (state.startedAt ?? Date.now());
  if (elapsed >= state.maxWallClockMs) {
    state.enabled = false;
    state.currentAgent = null;
    state.currentAgentId = null;
    saveState(state);
    stopWatchdog();
    return;
  }

  if (nextAgent === 'scout') {
    state.iteration = nextIteration;
    state.baseCommit = getHeadCommit();
  }

  state.currentAgent = nextAgent;
  state.currentAgentId = null;
  saveState(state);

  createCronJobProgrammatic({
    name: `${CRON_PREFIX} ${nextAgent.charAt(0).toUpperCase() + nextAgent.slice(1)} (iter ${state.iteration})`,
    prompt: buildPrompt(state, nextAgent),
    delayMs: CHAIN_DELAY_MS,
    onFired: (agentId: string) => {
      const s = loadState();
      if (s.enabled && s.currentAgent === nextAgent) {
        s.currentAgentId = agentId;
        s.history.push({
          iteration: s.iteration,
          agent: nextAgent,
          agentId,
          startedAt: Date.now(),
          completedAt: null,
          exitCode: null,
          summary: '',
        });
        saveState(s);
      }
    },
  });
}

/** Export for processPlugin to call on server start. */
export function startLoopWatchdog(): void {
  const state = loadState();
  if (state.enabled) startWatchdog();
}

// ── Route handlers ────────────────────────────────────────

export async function loopRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const { method, url } = req;
  if (!url?.startsWith('/__admin_loop')) return false;

  // GET /__admin_loop — return full state
  if (method === 'GET' && (url === '/__admin_loop' || url.startsWith('/__admin_loop?'))) {
    json(res, 200, loadState());
    return true;
  }

  // POST /__admin_loop/start — begin the loop
  if (method === 'POST' && url === '/__admin_loop/start') {
    try {
      const state = loadState();
      if (state.enabled) {
        json(res, 409, { error: 'Loop is already running' });
        return true;
      }

      state.enabled = true;
      state.iteration = 1;
      state.startedAt = Date.now();
      state.baseCommit = getHeadCommit();
      state.history = [];

      const agentId = spawnAgent(state, 'scout');
      startWatchdog();
      json(res, 200, { ok: true, agentId, iteration: 1 });
    } catch (err) {
      json(res, 500, { error: safeError(err) });
    }
    return true;
  }

  // POST /__admin_loop/stop — halt the loop
  if (method === 'POST' && url === '/__admin_loop/stop') {
    try {
      const state = loadState();
      state.enabled = false;

      // Kill active agent if running
      if (state.currentAgentId) {
        const proc = agents.get(state.currentAgentId);
        if (proc && !proc.done) {
          killProcess(proc, 'Loop stopped by operator.');
        }
      }

      state.currentAgent = null;
      state.currentAgentId = null;
      saveState(state);

      // Clear pending loop cron jobs + stop watchdog
      clearCronJobsByPrefix(CRON_PREFIX);
      stopWatchdog();

      json(res, 200, { ok: true });
    } catch (err) {
      json(res, 500, { error: safeError(err) });
    }
    return true;
  }

  // PATCH /__admin_loop/config — update settings (only when stopped)
  if (method === 'PATCH' && url === '/__admin_loop/config') {
    try {
      const body = await parseBody(req);
      const state = loadState();

      if (state.enabled) {
        json(res, 409, { error: 'Cannot change config while loop is running. Stop it first.' });
        return true;
      }

      if (typeof body['mode'] === 'string') {
        state.mode = body['mode'] === 'autonomous' ? 'autonomous' : 'supervised';
      }
      if (typeof body['maxIterations'] === 'number') {
        state.maxIterations = Math.max(1, body['maxIterations'] as number);
      }
      if (typeof body['maxWallClockMs'] === 'number') {
        state.maxWallClockMs = Math.max(60_000, body['maxWallClockMs'] as number);
      }
      if (Array.isArray(body['tags'])) {
        state.tags = (body['tags'] as string[]).map(String).filter(Boolean);
      }
      if (body['prompts'] && typeof body['prompts'] === 'object') {
        const p = body['prompts'] as Record<string, unknown>;
        if (typeof p['scout'] === 'string') state.prompts.scout = p['scout'];
        if (typeof p['analyst'] === 'string') state.prompts.analyst = p['analyst'];
        if (typeof p['operator'] === 'string') state.prompts.operator = p['operator'];
        if (typeof p['reviewer'] === 'string') state.prompts.reviewer = p['reviewer'];
      }
      if (body['backends'] && typeof body['backends'] === 'object') {
        const b = body['backends'] as Record<string, unknown>;
        const valid = ['claude', 'ollama'];
        for (const role of AGENT_ORDER) {
          if (typeof b[role] === 'string' && valid.includes(b[role] as string)) {
            state.backends[role] = b[role] as AgentBackend;
          }
        }
      }

      saveState(state);
      json(res, 200, { ok: true });
    } catch (err) {
      json(res, 400, { error: safeError(err) });
    }
    return true;
  }

  // POST /__admin_loop/advance — called by agents to chain to next
  if (method === 'POST' && url === '/__admin_loop/advance') {
    try {
      const body = await parseBody(req);
      const agentRole = String(body['agent'] ?? '') as AgentRole;
      const summary = String(body['summary'] ?? '');

      const state = loadState();

      if (!state.enabled) {
        json(res, 409, { error: 'Loop is not running' });
        return true;
      }

      if (agentRole !== state.currentAgent) {
        json(res, 400, { error: `Expected agent "${state.currentAgent}", got "${agentRole}"` });
        return true;
      }

      // Record completion in history
      const entry = [...state.history].reverse().find(
        h => h.agent === agentRole && h.iteration === state.iteration && !h.completedAt,
      );
      if (entry) {
        entry.completedAt = Date.now();
        entry.summary = summary;
        // Get exit code from process manager
        const proc = state.currentAgentId ? agents.get(state.currentAgentId) : null;
        entry.exitCode = proc?.exitCode ?? 0;
      }

      // Determine next agent
      const currentIdx = AGENT_ORDER.indexOf(agentRole);
      const nextIdx = (currentIdx + 1) % AGENT_ORDER.length;
      const nextAgent = AGENT_ORDER[nextIdx];
      const nextIteration = nextAgent === 'scout' ? state.iteration + 1 : state.iteration;

      // Check ceilings
      if (nextIteration > state.maxIterations) {
        state.enabled = false;
        state.currentAgent = null;
        state.currentAgentId = null;
        saveState(state);
        json(res, 200, { ok: true, halted: true, reason: `Max iterations reached (${state.maxIterations})` });
        return true;
      }

      const elapsed = Date.now() - (state.startedAt ?? Date.now());
      if (elapsed >= state.maxWallClockMs) {
        state.enabled = false;
        state.currentAgent = null;
        state.currentAgentId = null;
        saveState(state);
        json(res, 200, { ok: true, halted: true, reason: 'Max wall-clock time reached' });
        return true;
      }

      // Supervised mode: halt on non-zero exit
      if (state.mode === 'supervised' && entry?.exitCode && entry.exitCode !== 0) {
        state.enabled = false;
        state.currentAgent = null;
        state.currentAgentId = null;
        saveState(state);
        json(res, 200, { ok: true, halted: true, reason: `Agent "${agentRole}" exited with code ${entry.exitCode} (supervised mode)` });
        return true;
      }

      // Update iteration and base commit for new scout iteration
      if (nextAgent === 'scout') {
        state.iteration = nextIteration;
        state.baseCommit = getHeadCommit();
      }

      // Chain to next agent via cron with 30s cooldown
      state.currentAgent = nextAgent;
      state.currentAgentId = null; // Will be set when cron fires
      saveState(state);

      createCronJobProgrammatic({
        name: `${CRON_PREFIX} ${nextAgent.charAt(0).toUpperCase() + nextAgent.slice(1)} (iter ${state.iteration})`,
        prompt: buildPrompt(state, nextAgent),
        delayMs: CHAIN_DELAY_MS,
        onFired: (agentId: string) => {
          const s = loadState();
          if (s.enabled && s.currentAgent === nextAgent) {
            s.currentAgentId = agentId;
            // Record in history
            s.history.push({
              iteration: s.iteration,
              agent: nextAgent,
              agentId,
              startedAt: Date.now(),
              completedAt: null,
              exitCode: null,
              summary: '',
            });
            saveState(s);
          }
        },
      });

      startWatchdog();
      json(res, 200, {
        ok: true,
        halted: false,
        nextAgent,
        iteration: state.iteration,
        chainingIn: `${CHAIN_DELAY_MS / 1000}s`,
      });
    } catch (err) {
      json(res, 500, { error: safeError(err) });
    }
    return true;
  }

  return false;
}
