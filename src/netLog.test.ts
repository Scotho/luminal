import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { net, startCapture, drainCapture, stopCapture, type NetLogEntry } from './netLog';

describe('netLog capture API', () => {
  beforeEach(() => {
    startCapture();
    // Suppress console output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    stopCapture();
    vi.restoreAllMocks();
  });

  it('startCapture / drainCapture basic flow', () => {
    net.info('[transport] connected');
    const entries = drainCapture();
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.level).toBe('info');
    expect(entry.tag).toBe('transport');
    expect(entry.args).toEqual(['[transport] connected']);
    expect(typeof entry.ts).toBe('number');
  });

  it('extracts tag from bracketed prefix', () => {
    net.log('[transport] test');
    const entries = drainCapture();
    expect(entries[0].tag).toBe('transport');
  });

  it('falls back to "general" when no tag bracket present', () => {
    net.log('no tag here');
    const entries = drainCapture();
    expect(entries[0].tag).toBe('general');
  });

  it('drain clears buffer — second drain is empty', () => {
    net.log('[x] one');
    net.log('[x] two');
    const first = drainCapture();
    expect(first).toHaveLength(2);
    const second = drainCapture();
    expect(second).toHaveLength(0);
  });

  it('stopCapture disables buffering', () => {
    stopCapture();
    net.log('[x] should not be captured');
    // drainCapture when not active returns []
    const entries = drainCapture();
    expect(entries).toHaveLength(0);
  });

  it('ring buffer cap — start with max=5, push 7, only last 5 remain', () => {
    startCapture(5);
    for (let i = 0; i < 7; i++) {
      net.log(`[test] entry ${i}`);
    }
    const entries = drainCapture();
    expect(entries).toHaveLength(5);
    expect(entries[0].args[0]).toBe('[test] entry 2');
    expect(entries[4].args[0]).toBe('[test] entry 6');
  });

  it('capture works even when debug is off', () => {
    window.NETCODE_DEBUG = false;
    net.log('[x] should still capture');
    const entries = drainCapture();
    expect(entries).toHaveLength(1);
    expect(entries[0].tag).toBe('x');
    // Clean up
    delete window.NETCODE_DEBUG;
  });

  it('drainCapture preserves capture-active state', () => {
    net.log('[a] first');
    drainCapture();
    // Capture should still be active after drain
    net.log('[b] second');
    const entries = drainCapture();
    expect(entries).toHaveLength(1);
    expect(entries[0].tag).toBe('b');
  });

  it('each level is recorded correctly', () => {
    net.log('[t] log msg');
    net.warn('[t] warn msg');
    net.info('[t] info msg');
    net.error('[t] error msg');
    const entries = drainCapture();
    expect(entries).toHaveLength(4);
    expect(entries[0].level).toBe('log');
    expect(entries[1].level).toBe('warn');
    expect(entries[2].level).toBe('info');
    expect(entries[3].level).toBe('error');
  });
});
