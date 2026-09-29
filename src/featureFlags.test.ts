import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock Firebase modules BEFORE importing ──
const mockOnValue = vi.fn(() => vi.fn());

vi.mock('firebase/database', () => ({
  ref: vi.fn((_db: unknown, path: string) => ({ __path: path })),
  onValue: (...args: unknown[]) => mockOnValue(...args),
}));

vi.mock('./firebase', () => ({
  rtdb: {},
  auth: { currentUser: null },
}));

import { evaluate, isFeatureEnabled, _resetForTesting } from './featureFlags';

describe('featureFlags', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  describe('evaluate()', () => {
    it('returns false when flag is disabled', () => {
      expect(evaluate({ enabled: false }, 'user1')).toBe(false);
    });

    it('returns true when flag is enabled with no rollout or targeting', () => {
      expect(evaluate({ enabled: true }, 'user1')).toBe(true);
    });

    it('returns true when flag is enabled and rolloutPct is undefined', () => {
      expect(evaluate({ enabled: true }, undefined)).toBe(true);
    });

    it('returns true for targeted uid even if rolloutPct is 0', () => {
      expect(evaluate({
        enabled: true,
        rolloutPct: 0,
        targetUids: ['special-user'],
      }, 'special-user')).toBe(true);
    });

    it('returns false for non-targeted uid when rolloutPct is 0', () => {
      expect(evaluate({
        enabled: true,
        rolloutPct: 0,
        targetUids: ['special-user'],
      }, 'other-user')).toBe(false);
    });

    it('returns false when rolloutPct < 100 and no uid', () => {
      expect(evaluate({
        enabled: true,
        rolloutPct: 50,
      }, undefined)).toBe(false);
    });

    it('deterministically hashes the same uid to the same bucket', () => {
      const flag = { enabled: true, rolloutPct: 50 };
      const first = evaluate(flag, 'test-user-abc');
      const second = evaluate(flag, 'test-user-abc');
      expect(first).toBe(second);
    });

    it('100% rollout enables for all users', () => {
      const flag = { enabled: true, rolloutPct: 100 };
      // rolloutPct === 100 means the rolloutPct < 100 branch is skipped, so returns true
      expect(evaluate(flag, 'any-user')).toBe(true);
    });

    it('0% rollout disables for all non-targeted users', () => {
      const flag = { enabled: true, rolloutPct: 0 };
      // Verify multiple different users all get false
      const results = ['u1', 'u2', 'u3', 'u4', 'u5'].map(u => evaluate(flag, u));
      expect(results.every(r => r === false)).toBe(true);
    });

    it('produces a reasonable distribution across many uids', () => {
      const flag = { enabled: true, rolloutPct: 50 };
      let enabled = 0;
      const total = 1000;
      for (let i = 0; i < total; i++) {
        if (evaluate(flag, `user-${i}`)) enabled++;
      }
      // Should be roughly 50% — allow 35-65% range
      expect(enabled).toBeGreaterThan(total * 0.35);
      expect(enabled).toBeLessThan(total * 0.65);
    });
  });

  describe('isFeatureEnabled()', () => {
    it('returns false for unknown flags', () => {
      expect(isFeatureEnabled('nonexistent')).toBe(false);
    });
  });
});
