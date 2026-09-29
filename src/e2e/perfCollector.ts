// src/e2e/perfCollector.ts — T1 headless perf metric collector

import type { PerfSnapshot, HubStats, TickStats } from './perfTypes';

const FRAME_BUDGET_MICROS = 16_600; // 16.6ms at 60fps

function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function computeTickStats(samples: [number, number][]): TickStats {
  if (samples.length === 0) {
    return { avg: 0, p50: 0, p95: 0, p99: 0, max: 0, count: 0 };
  }
  const durations = samples.map(s => s[1]);
  const sorted = [...durations].sort((a, b) => a - b);
  const sum = durations.reduce((a, b) => a + b, 0);

  return {
    avg: Math.round(sum / durations.length),
    p50: computePercentile(sorted, 50),
    p95: computePercentile(sorted, 95),
    p99: computePercentile(sorted, 99),
    max: sorted[sorted.length - 1],
    count: durations.length,
  };
}

function computeNetworkObserved(hubStats: HubStats): PerfSnapshot['network']['observed'] {
  const { messagesRelayed, messagesDropped, deliveryDelays } = hubStats;
  const total = messagesRelayed + messagesDropped;
  const sorted = [...deliveryDelays].sort((a, b) => a - b);
  const sum = deliveryDelays.reduce((a, b) => a + b, 0);

  return {
    messagesRelayed,
    messagesDropped,
    actualLossRate: total > 0 ? messagesDropped / total : 0,
    avgDeliveryMs: deliveryDelays.length > 0 ? Math.round(sum / deliveryDelays.length) : 0,
    p95DeliveryMs: computePercentile(sorted, 95),
    maxDeliveryMs: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
    bandwidthSamples: null,
  };
}

export class HeadlessPerfCollector {
  private _samples: [number, number][] = [];
  private _tickStart = 0;

  beforeTick(_tick: number): void {
    this._tickStart = performance.now();
  }

  afterTick(tick: number): void {
    const durationMicros = Math.round((performance.now() - this._tickStart) * 1000);
    this._samples.push([tick, durationMicros]);
  }

  /** @internal Test-only: inject known samples for deterministic assertions. */
  _injectSamples(samples: [number, number][]): void {
    this._samples = samples;
  }

  snapshot(
    startTime: number,
    configured: { latencyMs: number; packetLossRate: number; jitterMs?: number },
    hubStats: HubStats,
  ): PerfSnapshot {
    const tickStats = computeTickStats(this._samples);
    const budgetViolations = this._samples.filter(s => s[1] > FRAME_BUDGET_MICROS).length;

    return {
      tier: 'T1',
      timing: {
        totalMs: Date.now() - startTime,
        tickSamples: this._samples,
        tickStats,
        budgetViolations,
      },
      network: {
        configured,
        observed: computeNetworkObserved(hubStats),
      },
    };
  }
}
