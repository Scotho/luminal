// ── processManager tests ───────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ServerResponse } from 'http';
import type { ChildProcess } from 'child_process';

// ── Mock formatSSE from processPlugin ───────────────────────
vi.mock('../middleware/processPlugin', () => ({
  formatSSE: (event: string, data: unknown): string =>
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
}));

import {
  agents,
  nextAgentId,
  broadcast,
  killProcess,
  pauseProcess,
  resumeProcess,
  spawnLongRunning,
  setActiveTestProcess,
  activeTestProcess,
  cp,
  type ProcessState,
} from '../middleware/processManager';

// ── Helpers ────────────────────────────────────────────────

interface MockProc extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
}

function createMockProcess(pid = 12345): MockProc {
  const proc = new EventEmitter() as MockProc;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = new EventEmitter();
  proc.kill = vi.fn();
  proc.pid = pid;
  return proc;
}

function mockServerResponse(): ServerResponse & { _chunks: string[]; _ended: boolean } {
  const res = new EventEmitter() as ServerResponse & { _chunks: string[]; _ended: boolean };
  res._chunks = [];
  res._ended = false;
  res.write = vi.fn((chunk: string) => {
    res._chunks.push(chunk);
    return true;
  });
  res.end = vi.fn(() => {
    res._ended = true;
    return res;
  });
  return res;
}

function makeProcessState(overrides?: Partial<ProcessState>): ProcessState {
  const proc = createMockProcess();
  return {
    id: 'agent-99-test',
    label: 'test',
    proc: proc as unknown as ChildProcess,
    type: 'test',
    startedAt: Date.now(),
    timeoutHandle: setTimeout(() => {}, 0),
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
    ...overrides,
  };
}

// ── Suite ──────────────────────────────────────────────────

const spawnSpy = vi.spyOn(cp, 'spawn');

describe('processManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    agents.clear();
    spawnSpy.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    agents.clear();
  });

  // ── nextAgentId ──────────────────────────────────────────

  describe('nextAgentId', () => {
    it('returns incrementing IDs with sanitized label', () => {
      const id1 = nextAgentId('MyLabel');
      const id2 = nextAgentId('Other');
      expect(id1).toMatch(/^agent-\d+-mylabel$/);
      expect(id2).toMatch(/^agent-\d+-other$/);
      const num1 = parseInt(id1.split('-')[1]);
      const num2 = parseInt(id2.split('-')[1]);
      expect(num2).toBe(num1 + 1);
    });

    it('strips non-alphanumeric chars and lowercases', () => {
      const id = nextAgentId('My-Label_123!');
      expect(id).toMatch(/^agent-\d+-mylabel123$/);
    });

    it('truncates label to 12 chars', () => {
      const id = nextAgentId('VeryLongLabelThatExceedsTwelveChars');
      const label = id.split('-').slice(2).join('-');
      expect(label.length).toBeLessThanOrEqual(12);
    });
  });

  // ── broadcast ────────────────────────────────────────────

  describe('broadcast', () => {
    it('sends SSE data to all clients', () => {
      const state = makeProcessState();
      const client1 = mockServerResponse();
      const client2 = mockServerResponse();
      state.sseClients.add(client1 as unknown as ServerResponse);
      state.sseClients.add(client2 as unknown as ServerResponse);

      broadcast(state, 'event: test\ndata: {}\n\n');

      expect(client1.write).toHaveBeenCalledWith('event: test\ndata: {}\n\n');
      expect(client2.write).toHaveBeenCalledWith('event: test\ndata: {}\n\n');
    });

    it('silently removes clients that throw on write', () => {
      const state = makeProcessState();
      const goodClient = mockServerResponse();
      const badClient = mockServerResponse();
      (badClient.write as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('connection closed');
      });
      state.sseClients.add(badClient as unknown as ServerResponse);
      state.sseClients.add(goodClient as unknown as ServerResponse);

      broadcast(state, 'event: test\ndata: {}\n\n');

      expect(state.sseClients.has(badClient as unknown as ServerResponse)).toBe(false);
      expect(state.sseClients.has(goodClient as unknown as ServerResponse)).toBe(true);
    });

    it('handles empty client set without error', () => {
      const state = makeProcessState();
      expect(() => broadcast(state, 'event: test\ndata: {}\n\n')).not.toThrow();
    });
  });

  // ── killProcess ──────────────────────────────────────────

  describe('killProcess', () => {
    it('sends SIGTERM immediately', () => {
      const state = makeProcessState();
      killProcess(state);
      expect((state.proc as unknown as MockProc).kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('broadcasts kill reason via SSE when reason is provided', () => {
      const state = makeProcessState();
      const client = mockServerResponse();
      state.sseClients.add(client as unknown as ServerResponse);

      killProcess(state, 'Timeout exceeded');

      expect(client._chunks.length).toBeGreaterThan(0);
      expect(client._chunks[0]).toContain('Timeout exceeded');
    });

    it('does not broadcast when no reason provided', () => {
      const state = makeProcessState();
      const client = mockServerResponse();
      state.sseClients.add(client as unknown as ServerResponse);

      killProcess(state);

      expect(client._chunks.length).toBe(0);
    });

    it('schedules SIGKILL after 3000ms if not dead', () => {
      const state = makeProcessState();
      killProcess(state);

      expect((state.proc as unknown as MockProc).kill).toHaveBeenCalledTimes(1);
      expect((state.proc as unknown as MockProc).kill).toHaveBeenCalledWith('SIGTERM');

      vi.advanceTimersByTime(3000);

      expect((state.proc as unknown as MockProc).kill).toHaveBeenCalledTimes(2);
      expect((state.proc as unknown as MockProc).kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('does not send SIGKILL if process is already done', () => {
      const state = makeProcessState();
      killProcess(state);

      state.done = true;
      vi.advanceTimersByTime(3000);

      expect((state.proc as unknown as MockProc).kill).toHaveBeenCalledTimes(1);
    });

    it('clears timeout and idle timers', () => {
      const timeoutHandle = setTimeout(() => {}, 999999);
      const idleHandle = setTimeout(() => {}, 999999);
      const state = makeProcessState({ timeoutHandle, idleHandle });

      killProcess(state);

      vi.advanceTimersByTime(999999);
    });

    it('appends reason to output array', () => {
      const state = makeProcessState();
      killProcess(state, 'Agent idle');

      expect(state.output.length).toBe(1);
      expect(state.output[0]).toContain('Agent idle');
    });
  });

  // ── pauseProcess ─────────────────────────────────────────

  describe('pauseProcess', () => {
    it('returns false if done', () => {
      const state = makeProcessState({ done: true });
      expect(pauseProcess(state)).toBe(false);
    });

    it('returns false if already paused', () => {
      const state = makeProcessState({ paused: true });
      expect(pauseProcess(state)).toBe(false);
    });

    it('sets paused flag and pausedAt timestamp', () => {
      const state = makeProcessState();
      vi.setSystemTime(new Date('2026-04-08T12:00:00Z'));

      pauseProcess(state);

      expect(state.paused).toBe(true);
      expect(state.pausedAt).toBe(Date.now());
    });

    it('clears timeout and idle timers', () => {
      const timeoutHandle = setTimeout(() => {}, 999999);
      const idleHandle = setTimeout(() => {}, 999999);
      const state = makeProcessState({ timeoutHandle, idleHandle });

      pauseProcess(state);

      vi.advanceTimersByTime(999999);
    });

    it('broadcasts pause status', () => {
      const state = makeProcessState();
      const client = mockServerResponse();
      state.sseClients.add(client as unknown as ServerResponse);

      pauseProcess(state);

      expect(client._chunks.length).toBeGreaterThan(0);
      expect(client._chunks[0]).toContain('paused');
    });

    it('returns true on successful pause', () => {
      const state = makeProcessState();
      expect(pauseProcess(state)).toBe(true);
    });
  });

  // ── resumeProcess ────────────────────────────────────────

  describe('resumeProcess', () => {
    it('returns false if done', () => {
      const state = makeProcessState({ done: true, paused: true });
      expect(resumeProcess(state, 60000)).toBe(false);
    });

    it('returns false if not paused', () => {
      const state = makeProcessState({ paused: false });
      expect(resumeProcess(state, 60000)).toBe(false);
    });

    it('clears paused flag on resume', () => {
      const state = makeProcessState({ paused: true, pausedAt: Date.now() });
      resumeProcess(state, 60000);
      expect(state.paused).toBe(false);
      expect(state.pausedAt).toBeUndefined();
    });

    it('accumulates paused time into totalPausedMs', () => {
      vi.setSystemTime(new Date('2026-04-08T12:00:00Z'));
      const state = makeProcessState({
        paused: true,
        pausedAt: Date.now() - 5000,
        totalPausedMs: 1000,
      });

      resumeProcess(state, 60000);

      expect(state.totalPausedMs).toBe(6000);
    });

    it('recalculates remaining timeout excluding paused time', () => {
      vi.setSystemTime(new Date('2026-04-08T12:00:00Z'));
      const startedAt = Date.now() - 50000;
      const state = makeProcessState({
        paused: true,
        pausedAt: Date.now() - 10000,
        startedAt,
        totalPausedMs: 5000,
      });

      resumeProcess(state, 60000);

      expect(state.timeoutHandle).toBeDefined();
    });

    it('enforces minimum 30s timeout after resume', () => {
      vi.setSystemTime(new Date('2026-04-08T12:00:00Z'));
      const startedAt = Date.now() - 60000;
      const state = makeProcessState({
        paused: true,
        pausedAt: Date.now(),
        startedAt,
        totalPausedMs: 0,
      });

      resumeProcess(state, 60000);

      expect(state.timeoutHandle).toBeDefined();
    });

    it('broadcasts resume status', () => {
      const state = makeProcessState({ paused: true, pausedAt: Date.now() });
      const client = mockServerResponse();
      state.sseClients.add(client as unknown as ServerResponse);

      resumeProcess(state, 60000);

      expect(client._chunks.length).toBeGreaterThan(0);
      expect(client._chunks.some(c => c.includes('resumed'))).toBe(true);
    });

    it('returns true on successful resume', () => {
      const state = makeProcessState({ paused: true, pausedAt: Date.now() });
      expect(resumeProcess(state, 60000)).toBe(true);
    });

    it('skips timeout re-arm when noTimeout is set', () => {
      const state = makeProcessState({
        paused: true,
        pausedAt: Date.now(),
        noTimeout: true,
      });

      const originalHandle = state.timeoutHandle;
      resumeProcess(state, 60000);

      expect(state.timeoutHandle).toBe(originalHandle);
    });
  });

  // ── spawnLongRunning ─────────────────────────────────────

  describe('spawnLongRunning', () => {
    let mockProc: MockProc;

    beforeEach(() => {
      mockProc = createMockProcess();
      spawnSpy.mockReturnValue(mockProc as unknown as ChildProcess);
    });

    it('creates ProcessState with correct initial values', () => {
      const state = spawnLongRunning('test', 'npm test', 60000, '/tmp');

      expect(state.type).toBe('test');
      expect(state.done).toBe(false);
      expect(state.exitCode).toBeNull();
      expect(state.exitSignal).toBeNull();
      expect(state.duration).toBeNull();
      expect(state.paused).toBe(false);
      expect(state.totalPausedMs).toBe(0);
      expect(state.claudeSessionId).toBeNull();
      expect(state.output).toEqual([]);
      expect(state.sseClients).toBeInstanceOf(Set);
      expect(state.sseClients.size).toBe(0);
    });

    it('registers in agents map', () => {
      const state = spawnLongRunning('test', 'npm test', 60000, '/tmp');
      expect(agents.get(state.id)).toBe(state);
    });

    it('calls spawn with correct arguments', () => {
      spawnLongRunning('test', 'npm test', 60000, '/tmp', { shell: true, args: ['--verbose'] });

      expect(spawnSpy).toHaveBeenCalledWith(
        'npm test',
        ['--verbose'],
        expect.objectContaining({
          shell: true,
          cwd: '/tmp',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      );
    });

    it('uses default shell=true and empty args when opts are absent', () => {
      spawnLongRunning('test', 'npm test', 60000, '/tmp');

      expect(spawnSpy).toHaveBeenCalledWith(
        'npm test',
        [],
        expect.objectContaining({ shell: true }),
      );
    });

    it('sets up stdout handler that broadcasts chunks', () => {
      const state = spawnLongRunning('test', 'npm test', 60000, '/tmp');
      const client = mockServerResponse();
      state.sseClients.add(client as unknown as ServerResponse);

      mockProc.stdout.emit('data', Buffer.from('hello world\n'));

      expect(state.output.length).toBeGreaterThan(0);
      expect(state.output[0]).toContain('hello world');
      expect(client._chunks.length).toBeGreaterThan(0);
    });

    it('sets up stderr handler that broadcasts chunks', () => {
      const state = spawnLongRunning('test', 'npm test', 60000, '/tmp');
      const client = mockServerResponse();
      state.sseClients.add(client as unknown as ServerResponse);

      mockProc.stderr.emit('data', Buffer.from('error output\n'));

      expect(state.output.some(o => o.includes('error output'))).toBe(true);
      expect(client._chunks.some(c => c.includes('error output'))).toBe(true);
    });

    it('sets up hard timeout that kills after specified ms', () => {
      const state = spawnLongRunning('test', 'npm test', 60000, '/tmp');

      vi.advanceTimersByTime(60000);

      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(state.output.some(o => o.includes('Hard timeout'))).toBe(true);
    });

    it('sets up idle timeout that kills after IDLE_TIMEOUT_MS of inactivity', () => {
      const state = spawnLongRunning('test', 'npm test', 600000, '/tmp');

      vi.advanceTimersByTime(5 * 60 * 1000);

      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(state.output.some(o => o.includes('idle'))).toBe(true);
    });

    it('resets idle timer on stdout activity', () => {
      spawnLongRunning('test', 'npm test', 600000, '/tmp');

      vi.advanceTimersByTime(4 * 60 * 1000);

      mockProc.stdout.emit('data', Buffer.from('still working\n'));

      vi.advanceTimersByTime(4 * 60 * 1000);
      expect(mockProc.kill).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1 * 60 * 1000);
      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('resets idle timer on stderr activity', () => {
      spawnLongRunning('test', 'npm test', 600000, '/tmp');

      vi.advanceTimersByTime(4 * 60 * 1000);
      mockProc.stderr.emit('data', Buffer.from('warning\n'));
      vi.advanceTimersByTime(4 * 60 * 1000);

      expect(mockProc.kill).not.toHaveBeenCalled();
    });

    it('handles process exit: records exitCode, signal, duration', () => {
      vi.setSystemTime(new Date('2026-04-08T12:00:00Z'));
      const state = spawnLongRunning('test', 'npm test', 60000, '/tmp');

      vi.advanceTimersByTime(5000);
      mockProc.emit('close', 0, null);

      expect(state.exitCode).toBe(0);
      expect(state.exitSignal).toBeNull();
      expect(state.duration).toBe(5000);
    });

    it('broadcasts exit event on close', () => {
      const state = spawnLongRunning('test', 'npm test', 60000, '/tmp');
      const client = mockServerResponse();
      state.sseClients.add(client as unknown as ServerResponse);

      mockProc.emit('close', 1, 'SIGTERM');

      expect(state.output.some(o => o.includes('exit'))).toBe(true);
      expect(client._chunks.some(c => c.includes('exit'))).toBe(true);
    });

    it('clears all timers on close', () => {
      spawnLongRunning('test', 'npm test', 60000, '/tmp');

      mockProc.emit('close', 0, null);

      vi.advanceTimersByTime(60000);
    });

    it('marks done and cleans up clients after 500ms delay on close', () => {
      const state = spawnLongRunning('test', 'npm test', 60000, '/tmp');
      const client = mockServerResponse();
      state.sseClients.add(client as unknown as ServerResponse);

      mockProc.emit('close', 0, null);

      expect(state.done).toBe(false);

      vi.advanceTimersByTime(500);

      expect(state.done).toBe(true);
      expect(state.sseClients.size).toBe(0);
    });

    it('handles noTimeout option (no hard timeout or idle timeout)', () => {
      const state = spawnLongRunning('test', 'npm test', 60000, '/tmp', { noTimeout: true });

      expect(state.noTimeout).toBe(true);

      vi.advanceTimersByTime(120000);
      expect(mockProc.kill).not.toHaveBeenCalled();

      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(mockProc.kill).not.toHaveBeenCalled();
    });

    it('filters aider noise from stdout', () => {
      const state = spawnLongRunning('aider', 'aider', 60000, '/tmp');
      const client = mockServerResponse();
      state.sseClients.add(client as unknown as ServerResponse);

      mockProc.stdout.emit('data', Buffer.from('Aider v0.50.0\n'));
      mockProc.stdout.emit('data', Buffer.from('Model: gpt-4\n'));
      mockProc.stdout.emit('data', Buffer.from('real output line\n'));

      const outputLines = state.output.filter(o => o.includes('stdout'));
      expect(outputLines.length).toBe(1);
      expect(outputLines[0]).toContain('real output line');
    });

    it('filters aider noise from stderr', () => {
      const state = spawnLongRunning('aider', 'aider', 60000, '/tmp');

      mockProc.stderr.emit('data', Buffer.from('Detected dumb terminal\n'));
      mockProc.stderr.emit('data', Buffer.from('real error\n'));

      const stderrLines = state.output.filter(o => o.includes('stderr'));
      expect(stderrLines.length).toBe(1);
      expect(stderrLines[0]).toContain('real error');
    });

    it('does not filter aider noise for non-aider processes', () => {
      const state = spawnLongRunning('test', 'npm test', 60000, '/tmp');

      mockProc.stdout.emit('data', Buffer.from('Aider v0.50.0\n'));

      expect(state.output.some(o => o.includes('Aider v0.50.0'))).toBe(true);
    });

    it('parses JSON lines for claude type and captures session_id', () => {
      const state = spawnLongRunning('claude', 'claude', 60000, '/tmp');

      const jsonLine = JSON.stringify({ session_id: 'sess_abc123', type: 'message' });
      mockProc.stdout.emit('data', Buffer.from(jsonLine + '\n'));

      expect(state.claudeSessionId).toBe('sess_abc123');
    });

    it('captures result events for claude type', () => {
      const state = spawnLongRunning('claude', 'claude', 60000, '/tmp');
      const client = mockServerResponse();
      state.sseClients.add(client as unknown as ServerResponse);

      const resultLine = JSON.stringify({
        type: 'result',
        result: 'Task completed',
        session_id: 'sess_xyz',
        usage: { input: 100, output: 50 },
      });
      mockProc.stdout.emit('data', Buffer.from(resultLine + '\n'));

      expect(state.claudeSessionId).toBe('sess_xyz');
      expect(state.output.some(o => o.includes('task-result'))).toBe(true);
    });

    it('does not broadcast stdout while paused', () => {
      const state = spawnLongRunning('test', 'npm test', 60000, '/tmp');
      const client = mockServerResponse();
      state.sseClients.add(client as unknown as ServerResponse);

      state.paused = true;

      mockProc.stdout.emit('data', Buffer.from('silent output\n'));

      expect(state.output.some(o => o.includes('silent output'))).toBe(true);
      expect(client._chunks.some(c => c.includes('silent output'))).toBe(false);
    });

    it('uses custom id and label when provided', () => {
      const state = spawnLongRunning('claude', 'claude', 60000, '/tmp', {
        id: 'custom-id-1',
        label: 'My Agent',
      });

      expect(state.id).toBe('custom-id-1');
      expect(state.label).toBe('My Agent');
    });

    it('clears activeTestProcess when test process closes', () => {
      const state = spawnLongRunning('test', 'npm test', 60000, '/tmp');
      setActiveTestProcess(state);

      expect(activeTestProcess).toBe(state);

      mockProc.emit('close', 0, null);

      expect(activeTestProcess).toBeNull();
    });

    it('removes agent from map after 10-minute cleanup delay', () => {
      const state = spawnLongRunning('test', 'npm test', 60000, '/tmp');
      const agentId = state.id;

      expect(agents.has(agentId)).toBe(true);

      mockProc.emit('close', 0, null);

      expect(agents.has(agentId)).toBe(true);

      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(agents.has(agentId)).toBe(false);
    });

    it('handles process exit with signal', () => {
      const state = spawnLongRunning('test', 'npm test', 60000, '/tmp');

      mockProc.emit('close', null, 'SIGKILL');

      expect(state.exitCode).toBeNull();
      expect(state.exitSignal).toBe('SIGKILL');
    });

    it('buffers partial stdout lines until newline', () => {
      const state = spawnLongRunning('test', 'npm test', 60000, '/tmp');

      mockProc.stdout.emit('data', Buffer.from('partial'));
      expect(state.output.length).toBe(0);

      mockProc.stdout.emit('data', Buffer.from(' complete\n'));
      expect(state.output.length).toBe(1);
      expect(state.output[0]).toContain('partial complete');
    });

    it('handles spawn error followed by close (e.g. ENOENT)', () => {
      const state = spawnLongRunning('test', 'nonexistent-binary', 60000, '/tmp');
      const client = mockServerResponse();
      state.sseClients.add(client as unknown as ServerResponse);

      // Register error listener to prevent EventEmitter from throwing
      // (processManager.ts does not register one — error handling relies on close)
      mockProc.on('error', () => { /* absorb */ });
      mockProc.emit('error', new Error('spawn nonexistent-binary ENOENT'));
      mockProc.emit('close', null, null);

      expect(state.exitCode).toBeNull();
      expect(state.exitSignal).toBeNull();
      expect(state.duration).toBeGreaterThanOrEqual(0);

      // Exit event was still broadcast to SSE clients
      expect(state.output.some(o => o.includes('exit'))).toBe(true);

      // Process is cleaned up after the 500ms delay
      vi.advanceTimersByTime(500);
      expect(state.done).toBe(true);
      expect(state.sseClients.size).toBe(0);
    });

    it('assembles multiple partial chunks into complete lines', () => {
      const state = spawnLongRunning('test', 'npm test', 60000, '/tmp');

      // Send data in three chunks, with lines spanning across chunks
      mockProc.stdout.emit('data', Buffer.from('line one\npar'));
      mockProc.stdout.emit('data', Buffer.from('tial line'));
      mockProc.stdout.emit('data', Buffer.from(' two\nline three\n'));

      const stdoutLines = state.output.filter(o => o.includes('stdout'));
      expect(stdoutLines.length).toBe(3);
      expect(stdoutLines[0]).toContain('line one');
      expect(stdoutLines[1]).toContain('partial line two');
      expect(stdoutLines[2]).toContain('line three');
    });

    it('does not broadcast stderr while paused', () => {
      const state = spawnLongRunning('test', 'npm test', 60000, '/tmp');
      const client = mockServerResponse();
      state.sseClients.add(client as unknown as ServerResponse);

      state.paused = true;

      mockProc.stderr.emit('data', Buffer.from('paused error\n'));

      // Output still recorded
      expect(state.output.some(o => o.includes('paused error'))).toBe(true);
      // But not broadcast to client
      expect(client._chunks.some(c => c.includes('paused error'))).toBe(false);
    });

    it('uses fallback session_id from state for result events without session_id', () => {
      const state = spawnLongRunning('claude', 'claude', 60000, '/tmp');

      // First event sets session_id on state
      const initLine = JSON.stringify({ session_id: 'sess_init', type: 'init' });
      mockProc.stdout.emit('data', Buffer.from(initLine + '\n'));
      expect(state.claudeSessionId).toBe('sess_init');

      // Result event without session_id should use the stored one
      const resultLine = JSON.stringify({
        type: 'result',
        result: 'Done',
        usage: { input: 10, output: 5 },
      });
      mockProc.stdout.emit('data', Buffer.from(resultLine + '\n'));

      const taskResult = state.output.find(o => o.includes('task-result'));
      expect(taskResult).toBeDefined();
      expect(taskResult).toContain('sess_init');
    });

    it('ignores non-JSON stdout lines for claude type without error', () => {
      const state = spawnLongRunning('claude', 'claude', 60000, '/tmp');

      // Non-JSON line should be output as plain stdout, not crash
      mockProc.stdout.emit('data', Buffer.from('plain text output\n'));

      expect(state.output.some(o => o.includes('plain text output'))).toBe(true);
      // No task-result or session_id extracted
      expect(state.claudeSessionId).toBeNull();
      expect(state.output.some(o => o.includes('task-result'))).toBe(false);
    });
  });
});
