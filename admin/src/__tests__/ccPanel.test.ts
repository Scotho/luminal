import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager, classifyOutputLine } from '../ui/ccPanel';

describe('SessionManager', () => {
  let mgr: SessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new SessionManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with no sessions', () => {
    expect(mgr.all()).toEqual([]);
    expect(mgr.active()).toBeNull();
  });

  it('createSession adds a running session', () => {
    const s = mgr.createSession('test-label');
    expect(s.id).toBeTruthy();
    expect(s.label).toBe('test-label');
    expect(s.status).toBe('running');
    expect(s.cards).toEqual([]);
    expect(mgr.active()).toBe(s);
    expect(mgr.all()).toHaveLength(1);
  });

  it('processLine adds text cards for plain lines', () => {
    const s = mgr.createSession('test');
    mgr.processLine(s.id, 'hello world');
    mgr.processLine(s.id, 'more text');
    vi.advanceTimersByTime(100); // flush debounced card creation
    // Text lines accumulate into a single "Response" card
    expect(s.cards.length).toBe(1);
    expect(s.cards[0].type).toBe('text');
    expect(s.cards[0].body).toContain('hello world');
    expect(s.cards[0].body).toContain('more text');
  });

  it('processLine creates error cards for stderr', () => {
    const s = mgr.createSession('test');
    mgr.processLine(s.id, 'Error: something broke', true);
    expect(s.cards.length).toBe(1);
    expect(s.cards[0].type).toBe('error');
  });

  it('processLine creates system cards for stderr warnings', () => {
    const s = mgr.createSession('test');
    mgr.processLine(s.id, 'some warning message', true);
    expect(s.cards.length).toBe(1);
    expect(s.cards[0].type).toBe('system');
  });

  it('processLine handles stream-json text_delta events', () => {
    const s = mgr.createSession('test');
    const event = JSON.stringify({
      type: 'stream_event',
      event: { delta: { type: 'text_delta', text: 'Hello from CC' } },
    });
    mgr.processLine(s.id, event);
    vi.advanceTimersByTime(100); // flush debounced card creation
    expect(s.cards.length).toBe(1);
    expect(s.cards[0].type).toBe('text');
    expect(s.cards[0].body).toContain('Hello from CC');
  });

  it('processLine creates tool cards for content_block_start', () => {
    const s = mgr.createSession('test');
    const event = JSON.stringify({
      type: 'content_block_start',
      content_block: { type: 'tool_use', name: 'Read' },
    });
    mgr.processLine(s.id, event);
    expect(s.cards.length).toBe(1);
    expect(s.cards[0].type).toBe('tool');
    expect(s.cards[0].title).toBe('Read');
  });

  it('processLine creates result cards', () => {
    const s = mgr.createSession('test');
    const event = JSON.stringify({
      type: 'result',
      result: 'Task completed successfully',
    });
    mgr.processLine(s.id, event);
    const resultCard = s.cards.find(c => c.type === 'result');
    expect(resultCard).toBeDefined();
    expect(resultCard!.body).toBe('Task completed successfully');
    expect(s.result).toBe('Task completed successfully');
  });

  it('completeSession sets status and duration', () => {
    const s = mgr.createSession('test');
    mgr.completeSession(s.id, 0);
    expect(s.status).toBe('done');
    expect(s.exitCode).toBe(0);
    expect(s.duration).toBeGreaterThanOrEqual(0);
    expect(mgr.active()).toBeNull();
  });

  it('completeSession with non-zero code sets error status', () => {
    const s = mgr.createSession('test');
    mgr.completeSession(s.id, 1);
    expect(s.status).toBe('error');
  });

  it('cancelSession sets cancelled status', () => {
    const s = mgr.createSession('test');
    mgr.cancelSession(s.id);
    expect(s.status).toBe('cancelled');
    expect(mgr.active()).toBeNull();
  });

  it('all() returns sessions newest first', () => {
    const s1 = mgr.createSession('first');
    mgr.completeSession(s1.id, 0);
    const s2 = mgr.createSession('second');
    const all = mgr.all();
    expect(all[0].label).toBe('second');
    expect(all[1].label).toBe('first');
  });

  it('onChange fires when session state changes', () => {
    const cb = vi.fn();
    mgr.onChange(cb);
    mgr.createSession('test');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('onChange unsubscribe stops callbacks', () => {
    const cb = vi.fn();
    const unsub = mgr.onChange(cb);
    unsub();
    mgr.createSession('test');
    expect(cb).not.toHaveBeenCalled();
  });

  it('limits history to 10 sessions', () => {
    for (let i = 0; i < 12; i++) {
      const s = mgr.createSession(`session-${i}`);
      mgr.completeSession(s.id, 0);
    }
    expect(mgr.all().length).toBeLessThanOrEqual(10);
  });
});

describe('classifyOutputLine', () => {
  it('classifies text lines', () => {
    expect(classifyOutputLine('✓ test passed')).toBe('text');
    expect(classifyOutputLine('PASS src/foo.test.ts')).toBe('text');
    expect(classifyOutputLine('Found 3 issues')).toBe('text');
    expect(classifyOutputLine('Fixed empty catch')).toBe('text');
  });

  it('classifies error lines', () => {
    expect(classifyOutputLine('✗ test failed')).toBe('error');
    expect(classifyOutputLine('FAIL src/foo.test.ts')).toBe('error');
    expect(classifyOutputLine('Error: something broke')).toBe('error');
  });

  it('classifies system lines', () => {
    expect(classifyOutputLine('Warning: file too large')).toBe('system');
  });

  it('classifies text lines by default', () => {
    expect(classifyOutputLine('Reading file...')).toBe('text');
  });
});
