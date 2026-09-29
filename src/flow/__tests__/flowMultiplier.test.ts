import { describe, it, expect } from 'vitest';
import { getFlowMultiplier, FLOW_MULTIPLIER_LABELS } from '../flowMultiplier';

describe('getFlowMultiplier', () => {
  it('returns tier 0 / 1x for streak 0', () => {
    const r = getFlowMultiplier(0);
    expect(r.tier).toBe(0);
    expect(r.multiplier).toBe(1);
  });

  it('returns tier 0 / 1x for streak 2', () => {
    const r = getFlowMultiplier(2);
    expect(r.tier).toBe(0);
    expect(r.multiplier).toBe(1);
  });

  it('returns tier 1 / 3x for streak 3', () => {
    const r = getFlowMultiplier(3);
    expect(r.tier).toBe(1);
    expect(r.multiplier).toBe(3);
  });

  it('returns tier 1 / 3x for streak 4', () => {
    const r = getFlowMultiplier(4);
    expect(r.tier).toBe(1);
    expect(r.multiplier).toBe(3);
  });

  it('returns tier 2 / 5x for streak 5', () => {
    const r = getFlowMultiplier(5);
    expect(r.tier).toBe(2);
    expect(r.multiplier).toBe(5);
  });

  it('returns tier 2 / 5x for streak 9', () => {
    const r = getFlowMultiplier(9);
    expect(r.tier).toBe(2);
    expect(r.multiplier).toBe(5);
  });

  it('returns tier 3 / 10x for streak 10', () => {
    const r = getFlowMultiplier(10);
    expect(r.tier).toBe(3);
    expect(r.multiplier).toBe(10);
  });

  it('absorbs 20-streak into 10x bucket', () => {
    const r = getFlowMultiplier(20);
    expect(r.tier).toBe(3);
    expect(r.multiplier).toBe(10);
  });

  it('handles very high streaks', () => {
    const r = getFlowMultiplier(100);
    expect(r.tier).toBe(3);
    expect(r.multiplier).toBe(10);
  });
});

describe('FLOW_MULTIPLIER_LABELS', () => {
  it('has labels for all tiers', () => {
    expect(FLOW_MULTIPLIER_LABELS[0]).toBe('1+ STREAK');
    expect(FLOW_MULTIPLIER_LABELS[1]).toBe('3+ STREAK');
    expect(FLOW_MULTIPLIER_LABELS[2]).toBe('5+ STREAK');
    expect(FLOW_MULTIPLIER_LABELS[3]).toBe('10+ STREAK');
  });
});
