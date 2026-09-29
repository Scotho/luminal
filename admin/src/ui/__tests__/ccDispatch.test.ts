import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockLocalStorage } from '../../__tests__/helpers';

// Install localStorage mock before module imports
const storage = mockLocalStorage();

// ── Mock EventSource ─────────────────────────────────────
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Record<string, ((ev: MessageEvent) => void)[]> = {};
  onerror: (() => void) | null = null;
  readyState = 0;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (ev: MessageEvent) => void): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(cb);
  }

  close(): void {
    this.readyState = 2;
  }

  // Test helper: emit an event
  _emit(type: string, data: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const cb of this.listeners[type] ?? []) {
      cb(event);
    }
  }

  static reset(): void {
    MockEventSource.instances = [];
  }
}

vi.stubGlobal('EventSource', MockEventSource);

// ── Mock fetch ───────────────────────────────────────────
const mockFetchFn = vi.fn();
vi.stubGlobal('fetch', mockFetchFn);

// ── Mock document for DOM elements ───────────────────────
// ccDispatch references document.getElementById('cc-flyout')
const mockElement = { classList: { add: vi.fn(), remove: vi.fn() } };
vi.stubGlobal('document', {
  getElementById: vi.fn(() => mockElement),
  createElement: vi.fn(() => ({ style: {}, addEventListener: vi.fn() })),
  body: { appendChild: vi.fn() },
  addEventListener: vi.fn(),
  querySelectorAll: vi.fn(() => []),
});

// Import after mocks are set up
import { _setDispatchCC, _setPersistUsage } from '../ccSessionManager';
_setDispatchCC(vi.fn(async () => 'test'));
_setPersistUsage(vi.fn(async () => {}));

import {
  dispatchCC,
  dispatchOllama,
  wireAgentStream,
  onTaskResult,
} from '../ccDispatch';

import { sessionManager } from '../ccSessionManager';

beforeEach(() => {
  vi.useFakeTimers();
  storage.clear();
  mockFetchFn.mockReset();
  MockEventSource.reset();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('dispatchCC', () => {
  it('calls POST /__admin_exec/claude with prompt and label', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ agentId: 'agent-abc' }),
    });

    const sessionId = await dispatchCC('My Task', 'Do something');
    expect(mockFetchFn).toHaveBeenCalledWith('/__admin_exec/claude', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"prompt":"Do something"'),
    }));
    expect(sessionId).toBeTruthy();
  });

  it('creates a session and wires EventSource on success', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ agentId: 'agent-xyz' }),
    });

    await dispatchCC('Test', 'prompt');

    // EventSource should have been created for the agent stream
    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0].url).toContain('agent-xyz');
  });

  it('creates error session when fetch fails', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Server error' }),
    });

    const sessionId = await dispatchCC('Fail Task', 'prompt');
    const session = sessionManager.all().find(s => s.id === sessionId);
    expect(session).toBeDefined();
    // Session should be completed with error
    expect(session!.status).toBe('error');
  });

  it('creates error session when fetch throws', async () => {
    mockFetchFn.mockRejectedValueOnce(new Error('Network error'));

    const sessionId = await dispatchCC('Network Fail', 'prompt');
    const session = sessionManager.all().find(s => s.id === sessionId);
    expect(session).toBeDefined();
    expect(session!.status).toBe('error');
  });
});

describe('wireAgentStream', () => {
  it('creates EventSource with correct URL', () => {
    const session = sessionManager.createSession('test', 'agent-123');
    wireAgentStream(session, 'agent-123');

    expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(1);
    const es = MockEventSource.instances[MockEventSource.instances.length - 1];
    expect(es.url).toBe('/__admin_exec/stream?agent=agent-123');
  });

  it('processes stdout events', () => {
    const session = sessionManager.createSession('test', 'agent-s1');
    wireAgentStream(session, 'agent-s1');

    const es = MockEventSource.instances[MockEventSource.instances.length - 1];
    es._emit('stdout', { line: 'hello from stream' });

    vi.advanceTimersByTime(100); // flush debounced card creation
    // The line should have been processed into the session
    expect(session.cards.length).toBeGreaterThanOrEqual(1);
  });

  it('processes stderr events', () => {
    const session = sessionManager.createSession('test', 'agent-s2');
    wireAgentStream(session, 'agent-s2');

    const es = MockEventSource.instances[MockEventSource.instances.length - 1];
    es._emit('stderr', { line: 'Error: something went wrong' });

    const errorCards = session.cards.filter(c => c.type === 'error');
    expect(errorCards.length).toBeGreaterThanOrEqual(1);
  });

  it('completes session on exit event', () => {
    const session = sessionManager.createSession('test', 'agent-s3');
    wireAgentStream(session, 'agent-s3');

    const es = MockEventSource.instances[MockEventSource.instances.length - 1];
    es._emit('exit', { code: 0 });

    expect(session.status).toBe('done');
    expect(session.exitCode).toBe(0);
    expect(es.readyState).toBe(2); // closed
  });

  it('completes session with error on non-zero exit', () => {
    const session = sessionManager.createSession('test', 'agent-s4');
    wireAgentStream(session, 'agent-s4');

    const es = MockEventSource.instances[MockEventSource.instances.length - 1];
    es._emit('exit', { code: 1 });

    expect(session.status).toBe('error');
    expect(session.exitCode).toBe(1);
  });

  it('fires task-result listeners', () => {
    const cb = vi.fn();
    const unsub = onTaskResult(cb);

    const session = sessionManager.createSession('test', 'agent-s5');
    wireAgentStream(session, 'agent-s5');

    const es = MockEventSource.instances[MockEventSource.instances.length - 1];
    es._emit('task-result', { result: 'done!', session_id: null, usage: null });

    expect(cb).toHaveBeenCalledWith(session.id, session.label, 'done!');
    unsub();
  });
});

describe('dispatchOllama', () => {
  it('calls POST /__admin_exec/ollama-chat with prompt and model', async () => {
    // Mock a ReadableStream for SSE response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const chunk = 'event:exit\ndata:{"code":0}\n\n';
        controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });

    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      body: stream,
    });

    const sessionId = await dispatchOllama('Ollama Task', 'summarize this', 'qwen2.5:7b');

    expect(mockFetchFn).toHaveBeenCalledWith('/__admin_exec/ollama-chat', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"prompt":"summarize this"'),
    }));
    expect(sessionId).toBeTruthy();

    const session = sessionManager.all().find(s => s.id === sessionId);
    expect(session).toBeDefined();
    expect(session!.backend).toBe('ollama');
  });

  it('creates error session when fetch fails for Ollama', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: false,
      body: null,
      json: async () => ({ error: 'Ollama not running' }),
    });

    const sessionId = await dispatchOllama('Fail Ollama', 'prompt');
    const session = sessionManager.all().find(s => s.id === sessionId);
    expect(session).toBeDefined();
    expect(session!.status).toBe('error');
  });
});

describe('onTaskResult', () => {
  it('registers and unregisters callbacks', () => {
    const cb = vi.fn();
    const unsub = onTaskResult(cb);
    expect(typeof unsub).toBe('function');
    unsub();
  });
});
