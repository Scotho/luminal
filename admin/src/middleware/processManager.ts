import * as _cp from 'child_process';
import type { ChildProcess } from 'child_process';
import type { ServerResponse } from 'http';
import { formatSSE } from './processPlugin';

/** Indirection for spawn so tests can intercept it. */
export const cp = { spawn: _cp.spawn };

// ── Platform detection ─────────────────────────────────────
const isWindows = process.platform === 'win32';

// ── Process state ──────────────────────────────────────────

export type ProcessType = 'test' | 'claude' | 'aider' | 'deploy';

export interface ProcessState {
  id: string;
  label: string;
  proc: ChildProcess;
  type: ProcessType;
  startedAt: number;
  timeoutHandle: ReturnType<typeof setTimeout>;
  idleHandle: ReturnType<typeof setTimeout> | null;
  sseClients: Set<ServerResponse>;
  output: string[];
  exitCode: number | null;
  exitSignal: string | null;
  duration: number | null;
  done: boolean;
  claudeSessionId: string | null;
  paused: boolean;
  pausedAt?: number;
  totalPausedMs: number;
  /** When true, neither hard timeout nor idle timeout will kill this process. */
  noTimeout?: boolean;
}

// Idle watchdog — kill agent if no stdout/stderr for this long
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Aider startup banner lines that are noise in the admin UI
const AIDER_NOISE_RE = /^(Detected dumb terminal|Aider v\d|Model:|Git repo:|Warning: For large repos|See: https:\/\/aider\.chat|Repo-map:|Added .+ to the chat|Restored previous conversation history\.)/i;

/** All managed processes keyed by agent ID. */
export const agents = new Map<string, ProcessState>();
/** Legacy: single active test process (tests are still exclusive). */
export let activeTestProcess: ProcessState | null = null;
let _agentSeq = 0;

export function setActiveTestProcess(state: ProcessState | null): void {
  activeTestProcess = state;
}

export function nextAgentId(label: string): string {
  return `agent-${++_agentSeq}-${label.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)}`;
}

// ── SSE broadcast ──────────────────────────────────────────

export function broadcast(state: ProcessState, chunk: string): void {
  for (const client of state.sseClients) {
    try {
      client.write(chunk);
    } catch {
      state.sseClients.delete(client);
    }
  }
}

// ── Cancellation ───────────────────────────────────────────

export function killProcess(state: ProcessState, reason?: string): void {
  clearTimeout(state.timeoutHandle);
  if (state.idleHandle) clearTimeout(state.idleHandle);
  if (reason) {
    const msg = formatSSE('stderr', { line: `[harness] ${reason}`, ts: Date.now() });
    state.output.push(msg);
    broadcast(state, msg);
  }
  state.proc.kill('SIGTERM');
  const killTimer = setTimeout(() => {
    if (!state.done) state.proc.kill('SIGKILL');
  }, 3000);
  // Avoid keeping the process alive just for the kill timer
  killTimer.unref?.();
}

/** Reset the idle watchdog — call on every stdout/stderr activity. */
function resetIdleTimer(state: ProcessState): void {
  if (state.idleHandle) clearTimeout(state.idleHandle);
  if (state.paused || state.done || state.noTimeout) return;
  state.idleHandle = setTimeout(() => {
    if (state.done || state.paused) return;
    killProcess(state, `Agent idle for ${IDLE_TIMEOUT_MS / 60_000}m with no output — killing.`);
  }, IDLE_TIMEOUT_MS);
  state.idleHandle.unref?.();
}

export function pauseProcess(state: ProcessState): boolean {
  if (state.done || state.paused) return false;
  state.paused = true;
  state.pausedAt = Date.now();
  // Clear timeouts while paused (prevent timeout/idle kill during pause)
  clearTimeout(state.timeoutHandle);
  if (state.idleHandle) clearTimeout(state.idleHandle);
  // Windows doesn't support SIGSTOP/SIGCONT. On Windows, "pause" only
  // suspends timeout enforcement — the process continues running.
  if (!isWindows) {
    try { state.proc.kill('SIGSTOP'); } catch { /* signal failed */ }
  }
  broadcast(state, formatSSE('status', { message: 'Agent paused', paused: true, ts: Date.now() }));
  return true;
}

export function resumeProcess(state: ProcessState, timeoutMs: number): boolean {
  if (state.done || !state.paused) return false;
  const pausedDuration = Date.now() - (state.pausedAt ?? Date.now());
  state.totalPausedMs += pausedDuration;
  state.pausedAt = undefined;
  state.paused = false;
  if (!isWindows) {
    try { state.proc.kill('SIGCONT'); } catch { /* signal failed */ }
  }
  // Re-arm timeout based on original duration minus elapsed active time (skip if noTimeout)
  if (!state.noTimeout) {
    const activeMs = Date.now() - state.startedAt - state.totalPausedMs;
    const remaining = Math.max(timeoutMs - activeMs, 30_000);
    state.timeoutHandle = setTimeout(() => killProcess(state), remaining);
  }
  resetIdleTimer(state);
  broadcast(state, formatSSE('status', { message: 'Agent resumed', paused: false, ts: Date.now() }));
  return true;
}

// ── Spawn long-running process ─────────────────────────────

export function spawnLongRunning(
  type: ProcessType,
  command: string,
  timeoutMs: number,
  root: string,
  opts?: { shell?: boolean; args?: string[]; id?: string; label?: string; noTimeout?: boolean },
): ProcessState {
  const proc = cp.spawn(command, opts?.args ?? [], {
    shell: opts?.shell ?? true,
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0', TERM: 'dumb' },
  });

  const agentId = opts?.id ?? nextAgentId(opts?.label ?? type);
  const agentLabel = opts?.label ?? type;
  const noTimeout = opts?.noTimeout === true;

  // Use a no-op timer handle when timeouts are disabled
  const timeoutHandle = noTimeout
    ? setTimeout(() => {}, 0)   // immediately cleared below
    : setTimeout(() => killProcess(state, 'Hard timeout reached.'), timeoutMs);
  if (noTimeout) clearTimeout(timeoutHandle);

  const state: ProcessState = {
    id: agentId,
    label: agentLabel,
    proc,
    type,
    startedAt: Date.now(),
    timeoutHandle,
    idleHandle: null,
    sseClients: new Set(),
    output: [],
    exitCode: null,
    exitSignal: null,
    duration: null,
    done: false,
    claudeSessionId: null,
    paused: false,
    totalPausedMs: 0,
    noTimeout,
  };

  // Start idle watchdog (skipped when noTimeout)
  if (!noTimeout) resetIdleTimer(state);

  // SSE keepalive — send a comment ping every 15s to prevent browser/proxy
  // from dropping idle connections (critical for aider model-loading phase)
  const heartbeat = setInterval(() => {
    if (state.done) { clearInterval(heartbeat); return; }
    for (const client of state.sseClients) {
      try { client.write(': keepalive\n\n'); } catch { state.sseClients.delete(client); }
    }
  }, 15_000);
  heartbeat.unref?.();

  // Buffer partial lines from stdout (stream-json events may span chunks)
  let stdoutBuf = '';
  proc.stdout?.on('data', (chunk: Buffer) => {
    resetIdleTimer(state);
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop() ?? '';  // keep incomplete trailing line
    for (const line of lines) {
      if (line === '') continue;
      // Suppress known aider startup banner noise on stdout too
      if (type === 'aider' && AIDER_NOISE_RE.test(line)) continue;
      const msg = formatSSE('stdout', { line, ts: Date.now() });
      state.output.push(msg);
      // Skip live broadcast while paused (process may still run on Windows)
      if (!state.paused) broadcast(state, msg);

      // For claude processes, detect session_id and result events
      if (type === 'claude') {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          // Capture session_id from any event that includes it
          if (typeof parsed.session_id === 'string' && parsed.session_id) {
            state.claudeSessionId = parsed.session_id;
          }
          if (parsed.type === 'result' && parsed.result != null) {
            const resultMsg = formatSSE('task-result', {
              agentId: state.id,
              result: parsed.result,
              session_id: parsed.session_id ?? state.claudeSessionId,
              usage: parsed.usage ?? null,
              ts: Date.now(),
            });
            state.output.push(resultMsg);
            if (!state.paused) broadcast(state, resultMsg);
          }
        } catch { /* not JSON or not a result event */ }
      }
    }
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    resetIdleTimer(state);
    for (const line of chunk.toString().split('\n')) {
      if (line === '') continue;
      // Suppress known aider startup banner noise (dumb terminal notice, version header, etc.)
      if (type === 'aider' && AIDER_NOISE_RE.test(line)) continue;
      const msg = formatSSE('stderr', { line, ts: Date.now() });
      state.output.push(msg);
      if (!state.paused) broadcast(state, msg);
    }
  });

  proc.on('close', (code, signal) => {
    clearTimeout(state.timeoutHandle);
    if (state.idleHandle) clearTimeout(state.idleHandle);
    clearInterval(heartbeat);
    state.exitCode = code;
    state.exitSignal = signal;
    state.duration = Date.now() - state.startedAt;

    const msg = formatSSE('exit', {
      agentId: state.id,
      code,
      signal,
      duration: state.duration,
    });
    state.output.push(msg);
    broadcast(state, msg);

    // Delay marking done + closing clients so the exit event has time to flush
    setTimeout(() => {
      state.done = true;
      for (const client of state.sseClients) {
        try { client.end(); } catch { /* SSE client already closed */ }
      }
      state.sseClients.clear();
    }, 500);

    if (activeTestProcess === state) {
      activeTestProcess = null;
    }
    // Keep in agents map for history — clean up after 10 minutes
    setTimeout(() => { agents.delete(state.id); }, 10 * 60 * 1000);
  });

  agents.set(agentId, state);
  return state;
}
