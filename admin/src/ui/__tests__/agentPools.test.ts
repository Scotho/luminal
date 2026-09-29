import { describe, it, expect, beforeEach } from 'vitest';

// The module has mutable state in _localPool, so we need to re-import fresh state.
// Since we can't easily reset module state, we test in order that accounts for mutation.

import {
  getAgentPools,
  getAvailablePools,
  getPool,
  setLocalPoolStatus,
} from '../agentPools';

describe('agentPools', () => {
  // Note: setLocalPoolStatus mutates module-level state. Tests run in declaration order
  // and later tests account for prior mutations.

  describe('getAgentPools', () => {
    it('returns both claude and local pools', () => {
      const pools = getAgentPools();
      expect(pools).toHaveLength(2);
      expect(pools[0].id).toBe('claude');
      expect(pools[1].id).toBe('local');
    });

    it('claude pool is always cloud type and available', () => {
      const pools = getAgentPools();
      const claude = pools.find(p => p.id === 'claude')!;
      expect(claude.type).toBe('cloud');
      expect(claude.available).toBe(true);
      expect(claude.label).toBe('Claude');
    });

    it('local pool defaults to unavailable', () => {
      // We call setLocalPoolStatus(false) to reset to baseline for this test
      setLocalPoolStatus(false);
      const pools = getAgentPools();
      const local = pools.find(p => p.id === 'local')!;
      expect(local.type).toBe('local');
      expect(local.available).toBe(false);
    });
  });

  describe('getAvailablePools', () => {
    it('returns only claude when local is unavailable', () => {
      setLocalPoolStatus(false);
      const available = getAvailablePools();
      expect(available).toHaveLength(1);
      expect(available[0].id).toBe('claude');
    });

    it('returns both pools when local is available', () => {
      setLocalPoolStatus(true);
      const available = getAvailablePools();
      expect(available).toHaveLength(2);
      expect(available.map(p => p.id)).toContain('local');
    });
  });

  describe('setLocalPoolStatus', () => {
    it('updates local pool availability', () => {
      setLocalPoolStatus(true);
      const local = getPool('local')!;
      expect(local.available).toBe(true);

      setLocalPoolStatus(false);
      const local2 = getPool('local')!;
      expect(local2.available).toBe(false);
    });

    it('updates local pool model name', () => {
      setLocalPoolStatus(true, 'qwen2.5:7b');
      const local = getPool('local')!;
      expect(local.model).toBe('qwen2.5:7b');
    });

    it('clears model when not provided', () => {
      setLocalPoolStatus(true, 'llama3');
      setLocalPoolStatus(false);
      const local = getPool('local')!;
      expect(local.model).toBeUndefined();
    });
  });

  describe('getPool', () => {
    it('returns claude pool by id', () => {
      const pool = getPool('claude');
      expect(pool).toBeDefined();
      expect(pool!.id).toBe('claude');
      expect(pool!.label).toBe('Claude');
    });

    it('returns local pool by id', () => {
      const pool = getPool('local');
      expect(pool).toBeDefined();
      expect(pool!.id).toBe('local');
    });

    it('returns undefined for unknown id', () => {
      const pool = getPool('nonexistent');
      expect(pool).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      const pool = getPool('');
      expect(pool).toBeUndefined();
    });
  });
});
