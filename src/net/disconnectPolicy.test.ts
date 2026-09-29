// ── DisconnectPolicy Tests ────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DisconnectPolicy, CASUAL_POLICY, RANKED_POLICY, type DisconnectLevel } from './disconnectPolicy';

describe('DisconnectPolicy', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts at connected', () => {
    const policy = new DisconnectPolicy(CASUAL_POLICY);
    expect(policy.level).toBe('connected');
  });

  it('transitions to warning after warningMs', () => {
    const policy = new DisconnectPolicy(CASUAL_POLICY);
    vi.advanceTimersByTime(5001);
    policy.update();
    expect(policy.level).toBe('warning');
  });

  it('transitions to critical after criticalMs', () => {
    const policy = new DisconnectPolicy(CASUAL_POLICY);
    vi.advanceTimersByTime(10001);
    policy.update();
    expect(policy.level).toBe('critical');
  });

  it('transitions to forfeit after forfeitMs (casual = 20s)', () => {
    const policy = new DisconnectPolicy(CASUAL_POLICY);
    vi.advanceTimersByTime(20001);
    policy.update();
    expect(policy.level).toBe('forfeit');
  });

  it('transitions to forfeit after forfeitMs (ranked = 30s)', () => {
    const policy = new DisconnectPolicy(RANKED_POLICY);
    vi.advanceTimersByTime(25000);
    policy.update();
    expect(policy.level).toBe('critical'); // not yet forfeit
    vi.advanceTimersByTime(6000);
    policy.update();
    expect(policy.level).toBe('forfeit');
  });

  it('resets to connected on recordInput', () => {
    const policy = new DisconnectPolicy(CASUAL_POLICY);
    vi.advanceTimersByTime(12000);
    policy.update();
    expect(policy.level).toBe('critical');

    policy.recordInput();
    expect(policy.level).toBe('connected');
  });

  it('fires onLevelChange callback on transitions', () => {
    const transitions: { level: DisconnectLevel; elapsed: number }[] = [];
    const policy = new DisconnectPolicy(CASUAL_POLICY);
    policy.onLevelChange((level, elapsed) => transitions.push({ level, elapsed }));

    vi.advanceTimersByTime(5001);
    policy.update();
    expect(transitions.length).toBe(1);
    expect(transitions[0].level).toBe('warning');

    vi.advanceTimersByTime(5000);
    policy.update();
    expect(transitions.length).toBe(2);
    expect(transitions[1].level).toBe('critical');

    // Reconnect
    policy.recordInput();
    expect(transitions.length).toBe(3);
    expect(transitions[2].level).toBe('connected');
  });

  it('fires onLevelChange with warning level and numeric elapsed when transitioning from connected', () => {
    const policy = new DisconnectPolicy(CASUAL_POLICY);
    let callLevel: DisconnectLevel | null = null;
    let callElapsed: number | null = null;
    policy.onLevelChange((level, elapsed) => {
      callLevel = level;
      callElapsed = elapsed;
    });

    policy.recordInput(); // ensure we start connected
    vi.advanceTimersByTime(5001); // past CASUAL_POLICY.warningMs (5000ms)
    policy.update();

    expect(callLevel).toBe('warning');
    expect(typeof callElapsed).toBe('number');
  });

  it('does not fire duplicate transitions', () => {
    const transitions: DisconnectLevel[] = [];
    const policy = new DisconnectPolicy(CASUAL_POLICY);
    policy.onLevelChange((level) => transitions.push(level));

    vi.advanceTimersByTime(6000);
    policy.update();
    policy.update();
    policy.update();
    expect(transitions.length).toBe(1);
  });

  it('reset clears state', () => {
    const policy = new DisconnectPolicy(CASUAL_POLICY);
    vi.advanceTimersByTime(15000);
    policy.update();
    expect(policy.level).toBe('critical');

    policy.reset();
    expect(policy.level).toBe('connected');
    policy.update();
    expect(policy.level).toBe('connected');
  });
});
