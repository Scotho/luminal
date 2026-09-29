// ── CC Usage tests ────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import type { CCUsageRecord } from '../types';
import { aggregateUsage, estimateCost } from '../ui/ccUsage';

// ── Fixtures ──────────────────────────────────────────────

const mockRecords: CCUsageRecord[] = [
  {
    sessionId: 'test-1',
    label: 'Test',
    ts: '2026-04-05T10:00:00Z',
    duration: 5000,
    usage: { inputTokens: 1000, outputTokens: 500, cacheRead: 200, cacheCreation: 100 },
    exitCode: 0,
  },
  {
    sessionId: 'test-2',
    label: 'Test 2',
    ts: '2026-04-05T11:00:00Z',
    duration: 3000,
    usage: { inputTokens: 2000, outputTokens: 1000 },
    exitCode: 1,
  },
];

// ── aggregateUsage ────────────────────────────────────────

describe('aggregateUsage', () => {
  it('returns zeroes for empty array', () => {
    const result = aggregateUsage([]);
    expect(result).toEqual({
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheCreation: 0,
      totalSessions: 0,
      totalDurationMs: 0,
    });
  });

  it('aggregates a single record', () => {
    const result = aggregateUsage([mockRecords[0]]);
    expect(result.totalInput).toBe(1000);
    expect(result.totalOutput).toBe(500);
    expect(result.totalCacheRead).toBe(200);
    expect(result.totalCacheCreation).toBe(100);
    expect(result.totalSessions).toBe(1);
    expect(result.totalDurationMs).toBe(5000);
  });

  it('sums across multiple records', () => {
    const result = aggregateUsage(mockRecords);
    expect(result.totalInput).toBe(3000);
    expect(result.totalOutput).toBe(1500);
    expect(result.totalCacheRead).toBe(200); // only first record has cacheRead
    expect(result.totalCacheCreation).toBe(100); // only first record has cacheCreation
    expect(result.totalSessions).toBe(2);
    expect(result.totalDurationMs).toBe(8000);
  });

  it('handles records with null duration', () => {
    const record: CCUsageRecord = {
      sessionId: 'null-dur',
      label: 'Null duration',
      ts: '2026-04-05T12:00:00Z',
      duration: null,
      usage: { inputTokens: 500, outputTokens: 250 },
      exitCode: 0,
    };
    const result = aggregateUsage([record]);
    expect(result.totalDurationMs).toBe(0);
    expect(result.totalInput).toBe(500);
  });

  it('handles records with no cache fields', () => {
    const record: CCUsageRecord = {
      sessionId: 'no-cache',
      label: 'No cache',
      ts: '2026-04-05T12:00:00Z',
      duration: 1000,
      usage: { inputTokens: 100, outputTokens: 50 },
      exitCode: 0,
    };
    const result = aggregateUsage([record]);
    expect(result.totalCacheRead).toBe(0);
    expect(result.totalCacheCreation).toBe(0);
  });
});

// ── estimateCost ──────────────────────────────────────────

describe('estimateCost', () => {
  it('returns 0 for empty array', () => {
    expect(estimateCost([])).toBe(0);
  });

  it('calculates cost with default rates', () => {
    // Record 1: input=1000, output=500, cacheRead=200
    //   non-cache input = 1000 - 200 = 800
    //   cost = (800/1M)*15 + (200/1M)*1.5 + (500/1M)*75
    //        = 0.012 + 0.0003 + 0.0375 = 0.0498
    //
    // Record 2: input=2000, output=1000, cacheRead=0
    //   cost = (2000/1M)*15 + 0 + (1000/1M)*75
    //        = 0.03 + 0 + 0.075 = 0.105
    //
    // Total = 0.0498 + 0.105 = 0.1548
    const cost = estimateCost(mockRecords);
    expect(cost).toBeCloseTo(0.1548, 4);
  });

  it('calculates cost with custom rates', () => {
    const cost = estimateCost(mockRecords, 10, 50, 1);
    // Record 1: (800/1M)*10 + (200/1M)*1 + (500/1M)*50
    //         = 0.008 + 0.0002 + 0.025 = 0.0332
    // Record 2: (2000/1M)*10 + 0 + (1000/1M)*50
    //         = 0.02 + 0 + 0.05 = 0.07
    // Total = 0.1032
    expect(cost).toBeCloseTo(0.1032, 4);
  });

  it('handles zero usage', () => {
    const record: CCUsageRecord = {
      sessionId: 'zero',
      label: 'Zero',
      ts: '2026-04-05T10:00:00Z',
      duration: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      exitCode: 0,
    };
    expect(estimateCost([record])).toBe(0);
  });

  it('handles cache-heavy usage (cacheRead > 0 reduces input cost)', () => {
    const record: CCUsageRecord = {
      sessionId: 'cache-heavy',
      label: 'Cache Heavy',
      ts: '2026-04-05T10:00:00Z',
      duration: 1000,
      usage: { inputTokens: 10000, outputTokens: 100, cacheRead: 9000 },
      exitCode: 0,
    };
    // non-cache input = 10000 - 9000 = 1000
    // cost = (1000/1M)*15 + (9000/1M)*1.5 + (100/1M)*75
    //      = 0.015 + 0.0135 + 0.0075 = 0.036
    const cost = estimateCost([record]);
    expect(cost).toBeCloseTo(0.036, 4);

    // Compare with no-cache version to verify cache saves money
    const noCacheRecord: CCUsageRecord = {
      ...record,
      sessionId: 'no-cache',
      usage: { inputTokens: 10000, outputTokens: 100 },
    };
    const noCacheCost = estimateCost([noCacheRecord]);
    expect(noCacheCost).toBeGreaterThan(cost);
  });

  it('single record cost matches manual calculation', () => {
    const cost = estimateCost([mockRecords[0]]);
    // input=1000, output=500, cacheRead=200
    // non-cache input = 800
    // (800/1M)*15 = 0.012
    // (200/1M)*1.5 = 0.0003
    // (500/1M)*75 = 0.0375
    expect(cost).toBeCloseTo(0.0498, 4);
  });
});
