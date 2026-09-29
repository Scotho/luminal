import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockLocalStorage } from '../../__tests__/helpers';

// Install localStorage mock before module imports (needed by persistOllamaUsage)
const storage = mockLocalStorage();

// Stub fetch for _tryLinkToSession (fires on completeSession)
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}), text: async () => '' })));

import {
  SessionManager,
  tryParseStreamJson,
  classifyOutputLine,
  makeCard,
  truncateLines,
  _setDispatchCC,
  _setPersistUsage,
} from '../ccSessionManager';

// Wire the circular-dependency stubs so completeSession doesn't crash
_setDispatchCC(vi.fn(async () => 'test-id'));
_setPersistUsage(vi.fn(async () => {}));

describe('SessionManager', () => {
  let mgr: SessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new SessionManager();
    storage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── createSession ─────────────────────────────────────
  describe('createSession', () => {
    it('creates a session with correct defaults', () => {
      const s = mgr.createSession('my-label');
      expect(s.label).toBe('my-label');
      expect(s.status).toBe('running');
      expect(s.cards).toEqual([]);
      expect(s.result).toBeNull();
      expect(s.usage).toBeNull();
      expect(s.exitCode).toBeNull();
      expect(s.duration).toBeNull();
      expect(s.backend).toBe('cc');
      expect(s.prompt).toBeNull();
    });

    it('uses provided agentId as session id', () => {
      const s = mgr.createSession('label', 'agent-42');
      expect(s.id).toBe('agent-42');
      expect(s.agentIds).toEqual(['agent-42']);
      expect(s.lastAgentId).toBe('agent-42');
    });

    it('generates an id when no agentId provided', () => {
      const s = mgr.createSession('label');
      expect(s.id).toMatch(/^cc-/);
      expect(s.agentIds).toEqual([]);
      expect(s.lastAgentId).toBeNull();
    });

    it('sets backend parameter', () => {
      const s = mgr.createSession('label', undefined, 'ollama');
      expect(s.backend).toBe('ollama');
    });

    it('selects the newly created session', () => {
      const s = mgr.createSession('label');
      expect(mgr.selectedId).toBe(s.id);
      expect(mgr.selected()).toBe(s);
    });

    it('adds session to front of list', () => {
      const s1 = mgr.createSession('first');
      const s2 = mgr.createSession('second');
      expect(mgr.all()[0]).toBe(s2);
      expect(mgr.all()[1]).toBe(s1);
    });
  });

  // ── processLine: text_delta ───────────────────────────
  describe('processLine — text_delta', () => {
    it('accumulates text from text_delta events into a single assistant card', () => {
      const s = mgr.createSession('test');
      const evt1 = JSON.stringify({
        type: 'stream_event',
        event: { delta: { type: 'text_delta', text: 'Hello ' } },
      });
      const evt2 = JSON.stringify({
        type: 'stream_event',
        event: { delta: { type: 'text_delta', text: 'world' } },
      });
      mgr.processLine(s.id, evt1);
      mgr.processLine(s.id, evt2);
      vi.advanceTimersByTime(100); // flush debounced card creation

      // Should be a single card accumulating text
      expect(s.cards).toHaveLength(1);
      expect(s.cards[0].type).toBe('text');
      expect(s.cards[0].role).toBe('assistant');
      expect(s.cards[0].body).toBe('Hello world');
    });

    it('handles plain text as fallback (non-JSON lines)', () => {
      const s = mgr.createSession('test');
      mgr.processLine(s.id, 'some plain text');
      vi.advanceTimersByTime(100); // flush debounced card creation
      expect(s.cards).toHaveLength(1);
      expect(s.cards[0].body).toContain('some plain text');
    });
  });

  // ── processLine: content_block_start with tool_use ────
  describe('processLine — tool blocks', () => {
    it('creates a tool card for content_block_start with tool_use', () => {
      const s = mgr.createSession('test');
      const evt = JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Read' },
      });
      mgr.processLine(s.id, evt);

      expect(s.cards).toHaveLength(1);
      expect(s.cards[0].type).toBe('tool');
      expect(s.cards[0].title).toBe('Read');
      expect(s.cards[0].role).toBe('tool');
      expect(s.cards[0].toolStatus).toBe('running');
    });

    it('creates an agent card for Agent tool', () => {
      const s = mgr.createSession('test');
      const evt = JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Agent' },
      });
      mgr.processLine(s.id, evt);

      expect(s.cards).toHaveLength(1);
      expect(s.cards[0].type).toBe('tool');
      expect(s.cards[0].role).toBe('agent');
      expect(s.cards[0].title).toBe('Agent');
      expect(s.cards[0].agentLabel).toBe('Subagent');
      expect(s.cards[0].toolStatus).toBe('running');
    });

    it('increments agent depth on Agent tool_use', () => {
      const s = mgr.createSession('test');
      // First Agent block — depth 0, then increments to 1
      mgr.processLine(s.id, JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Agent' },
      }));
      expect(s.cards[0].depth).toBe(0);

      // Text inside the agent should be at depth 1
      mgr.processLine(s.id, JSON.stringify({
        type: 'stream_event',
        event: { delta: { type: 'text_delta', text: 'inside agent' } },
      }));
      vi.advanceTimersByTime(100); // flush debounced card creation
      // The text card should have depth 1 since we incremented after agent block
      const textCard = s.cards.find(c => c.type === 'text' && c.role === 'assistant');
      expect(textCard).toBeDefined();
      expect(textCard!.depth).toBe(1);
    });
  });

  // ── processLine: content_block_stop ───────────────────
  describe('processLine — content_block_stop', () => {
    it('marks the last running tool as done', () => {
      const s = mgr.createSession('test');
      mgr.processLine(s.id, JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Edit' },
      }));
      expect(s.cards[0].toolStatus).toBe('running');

      mgr.processLine(s.id, JSON.stringify({ type: 'content_block_stop' }));
      expect(s.cards[0].toolStatus).toBe('done');
    });

    it('decrements agent depth when agent card completes', () => {
      const s = mgr.createSession('test');
      // Start an agent (depth 0 -> 1)
      mgr.processLine(s.id, JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Agent' },
      }));
      // End the agent (depth 1 -> 0)
      mgr.processLine(s.id, JSON.stringify({ type: 'content_block_stop' }));
      expect(s.cards[0].toolStatus).toBe('done');

      // Next text should be at depth 0
      mgr.processLine(s.id, JSON.stringify({
        type: 'stream_event',
        event: { delta: { type: 'text_delta', text: 'back to top' } },
      }));
      vi.advanceTimersByTime(100); // flush debounced card creation
      const textCard = s.cards.find(c => c.type === 'text' && c.role === 'assistant');
      expect(textCard!.depth).toBe(0);
    });
  });

  // ── processLine: stderr ───────────────────────────────
  describe('processLine — stderr', () => {
    it('creates error card for lines containing "error"', () => {
      const s = mgr.createSession('test');
      mgr.processLine(s.id, 'Error: something broke', true);
      expect(s.cards).toHaveLength(1);
      expect(s.cards[0].type).toBe('error');
      expect(s.cards[0].title).toBe('Error');
      expect(s.cards[0].role).toBe('system');
    });

    it('creates system card for other stderr lines', () => {
      const s = mgr.createSession('test');
      mgr.processLine(s.id, 'some warning message', true);
      expect(s.cards).toHaveLength(1);
      expect(s.cards[0].type).toBe('system');
      expect(s.cards[0].title).toBe('System');
      expect(s.cards[0].role).toBe('system');
    });
  });

  // ── processLine: result event ─────────────────────────
  describe('processLine — result event', () => {
    it('creates a result card and sets session result', () => {
      const s = mgr.createSession('test');
      const evt = JSON.stringify({
        type: 'result',
        result: 'Task completed successfully',
      });
      mgr.processLine(s.id, evt);

      const resultCard = s.cards.find(c => c.type === 'result');
      expect(resultCard).toBeDefined();
      expect(resultCard!.body).toBe('Task completed successfully');
      expect(resultCard!.role).toBe('assistant');
      expect(s.result).toBe('Task completed successfully');
    });

    it('captures usage data from result event', () => {
      const s = mgr.createSession('test');
      const evt = JSON.stringify({
        type: 'result',
        result: 'Done',
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 50,
        },
      });
      mgr.processLine(s.id, evt);

      expect(s.usage).toEqual({
        inputTokens: 1000,
        outputTokens: 500,
        cacheRead: 200,
        cacheCreation: 50,
      });
    });
  });

  // ── processLine: system event ─────────────────────────
  describe('processLine — system event', () => {
    it('creates system card for system events', () => {
      const s = mgr.createSession('test');
      const evt = JSON.stringify({ type: 'system', subtype: 'init' });
      mgr.processLine(s.id, evt);

      expect(s.cards).toHaveLength(1);
      expect(s.cards[0].type).toBe('system');
      expect(s.cards[0].role).toBe('system');
    });

    it('handles api_retry subtype', () => {
      const s = mgr.createSession('test');
      const evt = JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 3 });
      mgr.processLine(s.id, evt);

      expect(s.cards[0].preview).toContain('API retry');
      expect(s.cards[0].preview).toContain('3');
    });
  });

  // ── processLine: ignores unknown session IDs ──────────
  describe('processLine — unknown session', () => {
    it('does nothing for unknown session IDs', () => {
      // Should not throw
      mgr.processLine('nonexistent-id', 'some text');
    });
  });

  // ── completeSession ───────────────────────────────────
  describe('completeSession', () => {
    it('sets status to done for exit code 0', () => {
      const s = mgr.createSession('test');
      mgr.completeSession(s.id, 0);
      expect(s.status).toBe('done');
      expect(s.exitCode).toBe(0);
    });

    it('sets status to error for non-zero exit code', () => {
      const s = mgr.createSession('test');
      mgr.completeSession(s.id, 1);
      expect(s.status).toBe('error');
      expect(s.exitCode).toBe(1);
    });

    it('sets duration', () => {
      const s = mgr.createSession('test');
      mgr.completeSession(s.id, 0);
      expect(s.duration).toBeGreaterThanOrEqual(0);
      expect(typeof s.duration).toBe('number');
    });

    it('cleans up agentDepth on complete', () => {
      const s = mgr.createSession('test');
      // Start an agent block to set depth
      mgr.processLine(s.id, JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Agent' },
      }));
      mgr.completeSession(s.id, 0);
      // After completion, new text in a new session should start at depth 0
      const s2 = mgr.createSession('test2');
      mgr.processLine(s2.id, JSON.stringify({
        type: 'stream_event',
        event: { delta: { type: 'text_delta', text: 'fresh' } },
      }));
      vi.advanceTimersByTime(100); // flush debounced card creation
      expect(s2.cards[0].depth).toBe(0);
    });

    it('flushes accumulated text on complete', () => {
      const s = mgr.createSession('test');
      mgr.processLine(s.id, JSON.stringify({
        type: 'stream_event',
        event: { delta: { type: 'text_delta', text: 'partial text' } },
      }));
      mgr.completeSession(s.id, 0);

      const textCards = s.cards.filter(c => c.type === 'text' && c.role === 'assistant');
      expect(textCards.length).toBeGreaterThanOrEqual(1);
      expect(textCards[0].body).toContain('partial text');
    });
  });

  // ── cancelSession ─────────────────────────────────────
  describe('cancelSession', () => {
    it('sets status to cancelled', () => {
      const s = mgr.createSession('test');
      mgr.cancelSession(s.id);
      expect(s.status).toBe('cancelled');
    });

    it('sets duration', () => {
      const s = mgr.createSession('test');
      mgr.cancelSession(s.id);
      expect(s.duration).toBeGreaterThanOrEqual(0);
    });

    it('cleans up agentDepth on cancel', () => {
      const s = mgr.createSession('test');
      mgr.processLine(s.id, JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Agent' },
      }));
      mgr.cancelSession(s.id);
      // Should not affect new sessions
      const s2 = mgr.createSession('test2');
      mgr.processLine(s2.id, JSON.stringify({
        type: 'stream_event',
        event: { delta: { type: 'text_delta', text: 'fresh' } },
      }));
      vi.advanceTimersByTime(100); // flush debounced card creation
      expect(s2.cards[0].depth).toBe(0);
    });
  });

  // ── addUserMessage ────────────────────────────────────
  describe('addUserMessage', () => {
    it('adds a user card to the session', () => {
      const s = mgr.createSession('test');
      mgr.addUserMessage(s.id, 'Hello there');

      expect(s.cards).toHaveLength(1);
      expect(s.cards[0].type).toBe('text');
      expect(s.cards[0].role).toBe('user');
      expect(s.cards[0].title).toBe('You');
      expect(s.cards[0].body).toBe('Hello there');
    });

    it('does nothing for unknown session id', () => {
      mgr.addUserMessage('nonexistent', 'test');
      // Should not throw
    });
  });

  // ── continueSession ───────────────────────────────────
  describe('continueSession', () => {
    it('resets status to running', () => {
      const s = mgr.createSession('test');
      mgr.completeSession(s.id, 0);
      expect(s.status).toBe('done');

      const result = mgr.continueSession(s.id, 'agent-2');
      expect(result).toBe(s);
      expect(s.status).toBe('running');
    });

    it('clears exitCode and resets text accum', () => {
      const s = mgr.createSession('test');
      mgr.completeSession(s.id, 1);
      expect(s.exitCode).toBe(1);

      mgr.continueSession(s.id, 'agent-2');
      expect(s.exitCode).toBeNull();
    });

    it('appends agentId to agentIds', () => {
      const s = mgr.createSession('test', 'agent-1');
      mgr.completeSession(s.id, 0);
      mgr.continueSession(s.id, 'agent-2');

      expect(s.agentIds).toContain('agent-1');
      expect(s.agentIds).toContain('agent-2');
      expect(s.lastAgentId).toBe('agent-2');
    });

    it('returns null for unknown session id', () => {
      const result = mgr.continueSession('nonexistent', 'agent-x');
      expect(result).toBeNull();
    });
  });

  // ── selected / running ────────────────────────────────
  describe('selected() and running()', () => {
    it('selected() returns the selected session', () => {
      const s = mgr.createSession('test');
      expect(mgr.selected()).toBe(s);
    });

    it('selected() returns null when no selection', () => {
      expect(mgr.selected()).toBeNull();
    });

    it('running() returns only running sessions', () => {
      const s1 = mgr.createSession('one');
      const s2 = mgr.createSession('two');
      mgr.completeSession(s1.id, 0);

      const running = mgr.running();
      expect(running).toHaveLength(1);
      expect(running[0]).toBe(s2);
    });

    it('running() returns empty when all sessions complete', () => {
      const s = mgr.createSession('test');
      mgr.completeSession(s.id, 0);
      expect(mgr.running()).toEqual([]);
    });
  });

  // ── Text accumulation: multi-delta concatenation ──────
  describe('text accumulation', () => {
    it('multiple text_delta events concatenate into one assistant card', () => {
      const s = mgr.createSession('test');
      const deltas = ['Hello', ' ', 'world', '!'];
      for (const text of deltas) {
        mgr.processLine(s.id, JSON.stringify({
          type: 'stream_event',
          event: { delta: { type: 'text_delta', text } },
        }));
      }

      vi.advanceTimersByTime(100); // flush debounced card creation
      const textCards = s.cards.filter(c => c.type === 'text' && c.role === 'assistant');
      expect(textCards).toHaveLength(1);
      expect(textCards[0].body).toBe('Hello world!');
    });

    it('text accumulation resets after content_block_start', () => {
      const s = mgr.createSession('test');
      // Send some text
      mgr.processLine(s.id, JSON.stringify({
        type: 'stream_event',
        event: { delta: { type: 'text_delta', text: 'first text' } },
      }));
      vi.advanceTimersByTime(100); // flush first text card
      // Tool block flushes text
      mgr.processLine(s.id, JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Read' },
      }));
      // More text after tool
      mgr.processLine(s.id, JSON.stringify({
        type: 'stream_event',
        event: { delta: { type: 'text_delta', text: 'second text' } },
      }));
      vi.advanceTimersByTime(100); // flush second text card

      const textCards = s.cards.filter(c => c.type === 'text' && c.role === 'assistant');
      expect(textCards).toHaveLength(2);
      expect(textCards[0].body).toBe('first text');
      expect(textCards[1].body).toBe('second text');
    });
  });

  // ── Depth tracking: nested agents ─────────────────────
  describe('depth tracking', () => {
    it('nested agents produce cards with incrementing depth', () => {
      const s = mgr.createSession('test');

      // Agent at depth 0
      mgr.processLine(s.id, JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Agent' },
      }));
      expect(s.cards[0].depth).toBe(0);

      // Nested Agent at depth 1
      mgr.processLine(s.id, JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Agent' },
      }));
      expect(s.cards[1].depth).toBe(1);

      // Tool at depth 2
      mgr.processLine(s.id, JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Edit' },
      }));
      expect(s.cards[2].depth).toBe(2);
    });

    it('depth decrements back through nested stops', () => {
      const s = mgr.createSession('test');

      // Start agent (depth 0 -> 1)
      mgr.processLine(s.id, JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Agent' },
      }));
      // Start nested agent (depth 1 -> 2)
      mgr.processLine(s.id, JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Agent' },
      }));
      // Stop nested agent (depth 2 -> 1)
      mgr.processLine(s.id, JSON.stringify({ type: 'content_block_stop' }));
      // Stop outer agent (depth 1 -> 0)
      mgr.processLine(s.id, JSON.stringify({ type: 'content_block_stop' }));

      // Text after all agents are closed should be at depth 0
      mgr.processLine(s.id, JSON.stringify({
        type: 'stream_event',
        event: { delta: { type: 'text_delta', text: 'top level' } },
      }));
      vi.advanceTimersByTime(100); // flush debounced card creation
      const textCard = s.cards.find(c => c.type === 'text' && c.role === 'assistant');
      expect(textCard!.depth).toBe(0);
    });
  });

  // ── onChange listener ─────────────────────────────────
  describe('onChange', () => {
    it('fires callback on session state changes', () => {
      const cb = vi.fn();
      mgr.onChange(cb);
      mgr.createSession('test');
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe stops callbacks', () => {
      const cb = vi.fn();
      const unsub = mgr.onChange(cb);
      unsub();
      mgr.createSession('test');
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ── History limit ─────────────────────────────────────
  describe('history limit', () => {
    it('limits sessions to MAX_HISTORY (10)', () => {
      for (let i = 0; i < 15; i++) {
        const s = mgr.createSession(`session-${i}`);
        mgr.completeSession(s.id, 0);
      }
      expect(mgr.all().length).toBeLessThanOrEqual(10);
    });

    it('pinned sessions survive history pruning', () => {
      const pinned = mgr.createSession('pinned');
      mgr.togglePin(pinned.id);
      mgr.completeSession(pinned.id, 0);

      for (let i = 0; i < 12; i++) {
        const s = mgr.createSession(`session-${i}`);
        mgr.completeSession(s.id, 0);
      }

      const all = mgr.all();
      expect(all.find(s => s.id === pinned.id)).toBeDefined();
    });
  });

  // ── Queue management ──────────────────────────────────
  describe('queue', () => {
    it('starts with empty queue', () => {
      expect(mgr.queueLength()).toBe(0);
      expect(mgr.getQueue()).toEqual([]);
    });

    it('removeFromQueue removes an item', () => {
      // Access queue via enqueue when at concurrency limit
      // Create 3 running sessions to reach limit
      for (let i = 0; i < 3; i++) {
        mgr.createSession(`sess-${i}`);
      }
      mgr.enqueue('queued-1', 'prompt-1');
      mgr.enqueue('queued-2', 'prompt-2');
      expect(mgr.queueLength()).toBe(2);

      mgr.removeFromQueue(0);
      expect(mgr.queueLength()).toBe(1);
      expect(mgr.getQueue()[0].label).toBe('queued-2');
    });
  });

  // ── Pin management ────────────────────────────────────
  describe('pinning', () => {
    it('togglePin pins and unpins a session', () => {
      const s = mgr.createSession('test');
      expect(mgr.isPinned(s.id)).toBe(false);

      mgr.togglePin(s.id);
      expect(mgr.isPinned(s.id)).toBe(true);

      mgr.togglePin(s.id);
      expect(mgr.isPinned(s.id)).toBe(false);
    });
  });
});

// ── Utility functions ─────────────────────────────────

describe('tryParseStreamJson', () => {
  it('parses valid JSON', () => {
    const result = tryParseStreamJson('{"type":"test"}');
    expect(result).toEqual({ type: 'test' });
  });

  it('returns null for invalid JSON', () => {
    expect(tryParseStreamJson('not json')).toBeNull();
  });
});

describe('classifyOutputLine', () => {
  it('classifies success lines as text', () => {
    expect(classifyOutputLine('PASS src/foo.test.ts')).toBe('text');
    expect(classifyOutputLine('Found 3 files')).toBe('text');
  });

  it('classifies error lines as error', () => {
    expect(classifyOutputLine('Error: failed')).toBe('error');
    expect(classifyOutputLine('FAIL src/foo.test.ts')).toBe('error');
  });

  it('classifies warning lines as system', () => {
    expect(classifyOutputLine('Warning: deprecated')).toBe('system');
  });

  it('defaults to text', () => {
    expect(classifyOutputLine('regular line')).toBe('text');
  });
});

describe('truncateLines', () => {
  it('returns text unchanged when under maxLines', () => {
    expect(truncateLines('line1\nline2', 5)).toBe('line1\nline2');
  });

  it('truncates with ellipsis when over maxLines', () => {
    const text = 'line1\nline2\nline3\nline4\nline5';
    const result = truncateLines(text, 3);
    expect(result).toContain('line1');
    expect(result).toContain('...');
    expect(result).not.toContain('line5');
  });
});

describe('makeCard', () => {
  it('creates card with correct fields', () => {
    const card = makeCard('text', 'Title', 'Preview text', 'Full body text');
    expect(card.id).toMatch(/^card-/);
    expect(card.type).toBe('text');
    expect(card.title).toBe('Title');
    expect(card.body).toBe('Full body text');
    expect(card.ts).toBeGreaterThan(0);
  });

  it('passes optional role, depth, toolStatus', () => {
    const card = makeCard('tool', 'Edit', 'Editing...', '', {
      role: 'tool',
      depth: 2,
      toolStatus: 'running',
    });
    expect(card.role).toBe('tool');
    expect(card.depth).toBe(2);
    expect(card.toolStatus).toBe('running');
  });

  it('truncates preview to 300 chars', () => {
    const longPreview = 'x'.repeat(500);
    const card = makeCard('text', 'T', longPreview, 'body');
    expect(card.preview.length).toBe(300);
  });
});
