import { describe, it, expect } from 'vitest';
import { HeadlessPerfCollector } from './perfCollector';
import type { HubStats } from './perfTypes';

function makeHubStats(overrides?: Partial<HubStats>): HubStats {
  return {
    messagesRelayed: 10,
    messagesDropped: 2,
    deliveryDelays: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45],
    ...overrides,
  };
}

describe('HeadlessPerfCollector', () => {
  it('records tick timing samples', () => {
    const collector = new HeadlessPerfCollector();
    for (let t = 0; t < 10; t++) {
      collector.beforeTick(t);
      collector.afterTick(t);
    }
    const snap = collector.snapshot(
      Date.now() - 1000,
      { latencyMs: 50, packetLossRate: 0.1 },
      makeHubStats(),
    );
    expect(snap.tier).toBe('T1');
    expect(snap.timing.tickSamples).toHaveLength(10);
    expect(snap.timing.tickStats.count).toBe(10);
    expect(snap.timing.tickStats.avg).toBeGreaterThanOrEqual(0);
    expect(snap.timing.tickStats.p50).toBeGreaterThanOrEqual(0);
    expect(snap.timing.tickStats.p95).toBeGreaterThanOrEqual(0);
    expect(snap.timing.tickStats.p99).toBeGreaterThanOrEqual(0);
    expect(snap.timing.tickStats.max).toBeGreaterThanOrEqual(0);
  });

  it('computes tick stats correctly from known data', () => {
    const collector = new HeadlessPerfCollector();
    collector._injectSamples(
      Array.from({ length: 100 }, (_, i) => [i, (i + 1) * 10] as [number, number])
    );
    const snap = collector.snapshot(
      Date.now() - 500,
      { latencyMs: 0, packetLossRate: 0 },
      makeHubStats({ messagesRelayed: 0, messagesDropped: 0, deliveryDelays: [] }),
    );
    expect(snap.timing.tickStats.count).toBe(100);
    expect(snap.timing.tickStats.avg).toBeCloseTo(505, 0);
    expect(snap.timing.tickStats.p50).toBe(510);
    expect(snap.timing.tickStats.p95).toBe(960);
    expect(snap.timing.tickStats.max).toBe(1000);
  });

  it('counts budget violations (ticks > 16600μs)', () => {
    const collector = new HeadlessPerfCollector();
    collector._injectSamples([
      [0, 1000], [1, 5000], [2, 16000],
      [3, 17000], [4, 20000],
    ]);
    const snap = collector.snapshot(
      Date.now() - 100,
      { latencyMs: 0, packetLossRate: 0 },
      makeHubStats({ messagesRelayed: 0, messagesDropped: 0, deliveryDelays: [] }),
    );
    expect(snap.timing.budgetViolations).toBe(2);
  });

  it('computes network observed stats from hub stats', () => {
    const collector = new HeadlessPerfCollector();
    collector._injectSamples([[0, 100]]);
    const hubStats: HubStats = {
      messagesRelayed: 80, messagesDropped: 20,
      deliveryDelays: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    };
    const snap = collector.snapshot(
      Date.now() - 100,
      { latencyMs: 25, packetLossRate: 0.1, jitterMs: 5 },
      hubStats,
    );
    expect(snap.network.configured.latencyMs).toBe(25);
    expect(snap.network.configured.packetLossRate).toBe(0.1);
    expect(snap.network.configured.jitterMs).toBe(5);
    expect(snap.network.observed.messagesRelayed).toBe(80);
    expect(snap.network.observed.messagesDropped).toBe(20);
    expect(snap.network.observed.actualLossRate).toBeCloseTo(0.2, 2);
    expect(snap.network.observed.avgDeliveryMs).toBe(55);
    expect(snap.network.observed.p95DeliveryMs).toBe(100);
    expect(snap.network.observed.maxDeliveryMs).toBe(100);
    expect(snap.network.observed.bandwidthSamples).toBeNull();
  });

  it('snapshot has no browser block for T1', () => {
    const collector = new HeadlessPerfCollector();
    collector._injectSamples([[0, 100]]);
    const snap = collector.snapshot(
      Date.now(), { latencyMs: 0, packetLossRate: 0 }, makeHubStats(),
    );
    expect(snap.browser).toBeUndefined();
  });
});
