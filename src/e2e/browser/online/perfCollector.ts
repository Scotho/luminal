// src/e2e/browser/online/perfCollector.ts — T2 browser perf collector via Playwright

import type { Page } from 'playwright';
import type { PerfSnapshot, TickStats } from '../../perfTypes';
import type { ConsoleEntry } from './matchFlow';

/** Script injected into the game page to collect perf data. */
const INJECTION_SCRIPT = `
(() => {
  if (window.__PERF_SAMPLES) return; // already injected
  window.__PERF_SAMPLES = { longTasks: [], layoutShifts: [], lcpValue: null, frameSamples: [] };
  const s = window.__PERF_SAMPLES;

  // Long tasks (>50ms)
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        s.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {}

  // Layout shifts
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          s.layoutShifts.push({ startTime: entry.startTime, value: entry.value });
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}

  // LCP
  try {
    new PerformanceObserver(list => {
      const entries = list.getEntries();
      if (entries.length > 0) s.lcpValue = entries[entries.length - 1].startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}

  // Frame timing — sample every 60th frame
  let frameCount = 0;
  let lastTs = performance.now();
  function onFrame(ts) {
    frameCount++;
    if (frameCount % 60 === 0) {
      const delta = ts - lastTs;
      s.frameSamples.push([frameCount, Math.round(delta * 1000)]); // [frame, micros]
      lastTs = ts;
    } else if (frameCount === 1) {
      lastTs = ts;
    }
    requestAnimationFrame(onFrame);
  }
  requestAnimationFrame(onFrame);
})();
`;

interface PagePerfData {
  longTasks: { startTime: number; duration: number }[];
  layoutShifts: { startTime: number; value: number }[];
  lcpValue: number | null;
  frameSamples: [number, number][];
}

interface BandwidthEntry {
  ts: number;
  bytes: number;
}

function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
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

export class BrowserPerfCollector {
  private _startTime = Date.now();
  private _bandwidth: BandwidthEntry[] = [];
  private _responseListeners: Array<() => void> = [];

  /** Inject perf collection script into a page. Call after page.goto(). */
  async inject(page: Page): Promise<void> {
    await page.evaluate(INJECTION_SCRIPT);
  }

  /** Track response sizes for bandwidth estimation. Call once per page. */
  trackBandwidth(page: Page): void {
    const handler = (response: { headerValue: (name: string) => Promise<string | null> }) => {
      response.headerValue('content-length').then(cl => {
        if (cl) this._bandwidth.push({ ts: Date.now(), bytes: parseInt(cl, 10) });
      }).catch(() => {});
    };
    page.on('response', handler);
    this._responseListeners.push(() => page.off('response', handler));
  }

  /** Harvest perf data from both pages and merge into a PerfSnapshot. */
  async harvest(
    hostPage: Page,
    guestPage: Page,
    consoleLogs: ConsoleEntry[],
  ): Promise<PerfSnapshot> {
    const [hostData, guestData] = await Promise.all([
      this._harvestPage(hostPage),
      this._harvestPage(guestPage),
    ]);

    // Merge: worst-of-both for scalars, concatenate arrays
    const allLongTasks = [...hostData.longTasks, ...guestData.longTasks];
    const allLayoutShifts = [...hostData.layoutShifts, ...guestData.layoutShifts];
    const allFrameSamples = [...hostData.frameSamples, ...guestData.frameSamples];
    const lcp = Math.max(hostData.lcpValue ?? 0, guestData.lcpValue ?? 0) || undefined;

    // Memory: worst-of-both
    const [hostMem, guestMem] = await Promise.all([
      this._harvestMemory(hostPage),
      this._harvestMemory(guestPage),
    ]);
    const jsHeapUsedMb = Math.max(hostMem.used, guestMem.used) || undefined;
    const jsHeapTotalMb = Math.max(hostMem.total, guestMem.total) || undefined;

    // Network from console logs: parse [NET] RTT lines
    const networkStats = this._parseNetLogs(consoleLogs);

    const tickStats = computeTickStats(allFrameSamples);
    const budgetViolations = allFrameSamples.filter(s => s[1] > 16_600).length;

    return {
      tier: 'T2',
      timing: {
        totalMs: Date.now() - this._startTime,
        tickSamples: allFrameSamples,
        tickStats,
        budgetViolations,
      },
      network: {
        configured: { latencyMs: 0, packetLossRate: 0 }, // T2 uses real network
        observed: networkStats,
      },
      browser: {
        longTasks: allLongTasks,
        layoutShifts: allLayoutShifts,
        lcp,
        jsHeapUsedMb,
        jsHeapTotalMb,
      },
    };
  }

  cleanup(): void {
    for (const unsub of this._responseListeners) unsub();
    this._responseListeners.length = 0;
  }

  private async _harvestPage(page: Page): Promise<PagePerfData> {
    try {
      return await page.evaluate(() => {
        const s = (window as Record<string, unknown>).__PERF_SAMPLES as PagePerfData | undefined;
        return s ?? { longTasks: [], layoutShifts: [], lcpValue: null, frameSamples: [] };
      });
    } catch {
      return { longTasks: [], layoutShifts: [], lcpValue: null, frameSamples: [] };
    }
  }

  private async _harvestMemory(page: Page): Promise<{ used: number; total: number }> {
    try {
      return await page.evaluate(() => {
        const mem = (performance as Record<string, unknown>).memory as
          { usedJSHeapSize: number; totalJSHeapSize: number } | undefined;
        if (!mem) return { used: 0, total: 0 };
        return {
          used: Math.round(mem.usedJSHeapSize / (1024 * 1024)),
          total: Math.round(mem.totalJSHeapSize / (1024 * 1024)),
        };
      });
    } catch {
      return { used: 0, total: 0 };
    }
  }

  private _parseNetLogs(consoleLogs: ConsoleEntry[]): PerfSnapshot['network']['observed'] {
    const rttValues: number[] = [];
    for (const entry of consoleLogs) {
      if (!entry.text.includes('[NET]')) continue;
      const rttMatch = entry.text.match(/RTT[=:]?\s*(\d+)/i);
      if (rttMatch) rttValues.push(parseInt(rttMatch[1], 10));
    }
    const sorted = [...rttValues].sort((a, b) => a - b);
    const sum = rttValues.reduce((a, b) => a + b, 0);

    return {
      messagesRelayed: rttValues.length,
      messagesDropped: 0,
      actualLossRate: 0,
      avgDeliveryMs: rttValues.length > 0 ? Math.round(sum / rttValues.length) : 0,
      p95DeliveryMs: computePercentile(sorted, 95),
      maxDeliveryMs: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
      bandwidthSamples: this._computeBandwidthSamples(),
    };
  }

  private _computeBandwidthSamples(): [number, number][] | null {
    if (this._bandwidth.length === 0) return null;
    // Bucket by second
    const buckets = new Map<number, number>();
    for (const entry of this._bandwidth) {
      const sec = Math.floor(entry.ts / 1000);
      buckets.set(sec, (buckets.get(sec) ?? 0) + entry.bytes);
    }
    return [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  }
}
