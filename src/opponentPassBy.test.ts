import { describe, it, expect, beforeEach } from 'vitest';
import { shouldTriggerPassBy, selectPassByVariant, resetPassByCooldowns } from './opponentPassBy';
import type { PassByConfig } from './types/index';

const PASS_BY_CONFIG: PassByConfig = {
  slowSamples: ['passby-slow-01', 'passby-slow-02', 'passby-slow-03', 'passby-slow-04'],
  mediumSamples: ['passby-medium-01', 'passby-medium-02', 'passby-medium-03', 'passby-medium-04'],
  fastSamples: ['passby-fast-01', 'passby-fast-02', 'passby-fast-03', 'passby-fast-04'],
  speedThresholds: [0.8, 1.3],
  triggerRange: 60,
  cooldown: 1.5,
};

describe('opponentPassBy', () => {
  beforeEach(() => {
    resetPassByCooldowns();
  });

  it('triggers when radial velocity flips from approaching to receding', () => {
    const result = shouldTriggerPassBy('opp1', -10, 5, 30, PASS_BY_CONFIG, 10);
    expect(result).toBe(true);
  });

  it('does not trigger when still approaching', () => {
    const result = shouldTriggerPassBy('opp1', -10, -5, 30, PASS_BY_CONFIG, 10);
    expect(result).toBe(false);
  });

  it('does not trigger when out of range', () => {
    const result = shouldTriggerPassBy('opp1', -10, 5, 100, PASS_BY_CONFIG, 10);
    expect(result).toBe(false);
  });

  it('does not trigger during cooldown', () => {
    shouldTriggerPassBy('opp1', -10, 5, 30, PASS_BY_CONFIG, 10);
    const result = shouldTriggerPassBy('opp1', -10, 5, 30, PASS_BY_CONFIG, 10.5);
    expect(result).toBe(false);
  });

  it('triggers again after cooldown expires', () => {
    shouldTriggerPassBy('opp1', -10, 5, 30, PASS_BY_CONFIG, 10);
    const result = shouldTriggerPassBy('opp1', -10, 5, 30, PASS_BY_CONFIG, 12);
    expect(result).toBe(true);
  });

  it('selects slow variant for low speed', () => {
    const key = selectPassByVariant(PASS_BY_CONFIG, 0.5);
    expect(PASS_BY_CONFIG.slowSamples).toContain(key);
  });

  it('selects medium variant for mid speed', () => {
    const key = selectPassByVariant(PASS_BY_CONFIG, 1.0);
    expect(PASS_BY_CONFIG.mediumSamples).toContain(key);
  });

  it('selects fast variant for high speed', () => {
    const key = selectPassByVariant(PASS_BY_CONFIG, 1.5);
    expect(PASS_BY_CONFIG.fastSamples).toContain(key);
  });
});
