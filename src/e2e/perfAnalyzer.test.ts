// src/e2e/perfAnalyzer.test.ts — Tests for perfAnalyzer grading, comparison, and summary engine
import { describe, it, expect, beforeEach } from 'vitest';
import { analyze, compareTo, formatSummary, _resetBudgetCache } from './perfAnalyzer';
import type { PerfSnapshot } from './perfTypes';

function makeSnapshot(overrides?: Partial<PerfSnapshot>): PerfSnapshot {
  return {
    tier: 'T1',
    timing: {
      totalMs: 5000,
      tickSamples: Array.from({ length: 100 }, (_, i) => [i, 200] as [number, number]),
      tickStats: { avg: 200, p50: 200, p95: 200, p99: 200, max: 200, count: 100 },
      budgetViolations: 0,
    },
    network: {
      configured: { latencyMs: 50, packetLossRate: 0.05 },
      observed: {
        messagesRelayed: 100, messagesDropped: 5, actualLossRate: 0.05,
        avgDeliveryMs: 50, p95DeliveryMs: 55, maxDeliveryMs: 60, bandwidthSamples: null,
      },
    },
    ...overrides,
  };
}

describe('perfAnalyzer', () => {
  beforeEach(() => {
    _resetBudgetCache();
  });

  // ── analyze ───────────────────────────────────────────────────────

  describe('analyze', () => {
    it('returns grade A for excellent metrics', () => {
      const snap = makeSnapshot({
        timing: {
          totalMs: 5000,
          tickSamples: [],
          tickStats: { avg: 100, p50: 90, p95: 200, p99: 200, max: 250, count: 100 },
          budgetViolations: 0,
        },
        network: {
          configured: { latencyMs: 50, packetLossRate: 0.05 },
          observed: {
            messagesRelayed: 100, messagesDropped: 5, actualLossRate: 0.05,
            avgDeliveryMs: 50, p95DeliveryMs: 52, maxDeliveryMs: 60, bandwidthSamples: null,
          },
        },
      });
      const grade = analyze(snap);
      expect(grade.overall).toBe('A');
    });

    it('grades Tick Cost as D when p95 is 3000 (range 2000-5000, i.e. <=5000 = D)', () => {
      const snap = makeSnapshot({
        timing: {
          totalMs: 5000,
          tickSamples: [],
          tickStats: { avg: 2000, p50: 2000, p95: 3000, p99: 3500, max: 4000, count: 100 },
          budgetViolations: 0,
        },
      });
      const grade = analyze(snap);
      const tickBreakdown = grade.breakdown.find(b => b.category === 'Tick Cost');
      expect(tickBreakdown).toBeDefined();
      // p95=3000 <= D threshold (5000) → D
      expect(tickBreakdown!.grade).toBe('D');
    });

    it('grades Frame Budget as D when violations is 8% (range 5-10%)', () => {
      // 8 violations out of 100 ticks = 8%
      const snap = makeSnapshot({
        timing: {
          totalMs: 5000,
          tickSamples: [],
          tickStats: { avg: 200, p50: 200, p95: 200, p99: 200, max: 200, count: 100 },
          budgetViolations: 8,
        },
      });
      const grade = analyze(snap);
      const frameBreakdown = grade.breakdown.find(b => b.category === 'Frame Budget');
      expect(frameBreakdown).toBeDefined();
      expect(frameBreakdown!.grade).toBe('D');
    });

    it('grades Network Fidelity as F when ratio >= 2.6x (above D threshold of 2.0)', () => {
      // configured loss = 0.1, observed loss = 0.26 → ratio = 2.6
      const snap = makeSnapshot({
        network: {
          configured: { latencyMs: 50, packetLossRate: 0.1 },
          observed: {
            messagesRelayed: 74, messagesDropped: 26, actualLossRate: 0.26,
            avgDeliveryMs: 50, p95DeliveryMs: 55, maxDeliveryMs: 60, bandwidthSamples: null,
          },
        },
      });
      const grade = analyze(snap);
      const netBreakdown = grade.breakdown.find(b => b.category === 'Network Fidelity');
      expect(netBreakdown).toBeDefined();
      expect(netBreakdown!.grade).toBe('F');
    });

    it('grades Delivery Jitter as C when ratio is 2.4 (< 3.0 C threshold)', () => {
      // p95 = 120, avg = 50 → ratio = 2.4
      const snap = makeSnapshot({
        network: {
          configured: { latencyMs: 50, packetLossRate: 0.05 },
          observed: {
            messagesRelayed: 100, messagesDropped: 5, actualLossRate: 0.05,
            avgDeliveryMs: 50, p95DeliveryMs: 120, maxDeliveryMs: 200, bandwidthSamples: null,
          },
        },
      });
      const grade = analyze(snap);
      const jitterBreakdown = grade.breakdown.find(b => b.category === 'Delivery Jitter');
      expect(jitterBreakdown).toBeDefined();
      expect(jitterBreakdown!.grade).toBe('C');
    });

    it('includes browser grades for T2 snapshots', () => {
      const snap = makeSnapshot({
        tier: 'T2',
        browser: {
          longTasks: [{ startTime: 100, duration: 200 }, { startTime: 300, duration: 150 }],
          layoutShifts: [{ startTime: 200, value: 0.02 }],
          jsHeapUsedMb: 60,
        },
      });
      const grade = analyze(snap);
      const longTasksBreakdown = grade.breakdown.find(b => b.category === 'Long Tasks');
      const memoryBreakdown = grade.breakdown.find(b => b.category === 'Memory');
      expect(longTasksBreakdown).toBeDefined();
      expect(memoryBreakdown).toBeDefined();
    });

    it('skips browser grades for T1 snapshots', () => {
      const snap = makeSnapshot({ tier: 'T1' });
      const grade = analyze(snap);
      const longTasksBreakdown = grade.breakdown.find(b => b.category === 'Long Tasks');
      expect(longTasksBreakdown).toBeUndefined();
    });

    it('handles Network Fidelity with configured loss=0 and observed loss=0 (ratio=1, grade A)', () => {
      const snap = makeSnapshot({
        network: {
          configured: { latencyMs: 50, packetLossRate: 0 },
          observed: {
            messagesRelayed: 100, messagesDropped: 0, actualLossRate: 0,
            avgDeliveryMs: 50, p95DeliveryMs: 52, maxDeliveryMs: 60, bandwidthSamples: null,
          },
        },
      });
      const grade = analyze(snap);
      const netBreakdown = grade.breakdown.find(b => b.category === 'Network Fidelity');
      expect(netBreakdown).toBeDefined();
      expect(netBreakdown!.grade).toBe('A');
    });

    it('handles Network Fidelity with configured loss=0 and observed loss>0 (worst case ratio=10, grade F)', () => {
      const snap = makeSnapshot({
        network: {
          configured: { latencyMs: 50, packetLossRate: 0 },
          observed: {
            messagesRelayed: 95, messagesDropped: 5, actualLossRate: 0.05,
            avgDeliveryMs: 50, p95DeliveryMs: 55, maxDeliveryMs: 60, bandwidthSamples: null,
          },
        },
      });
      const grade = analyze(snap);
      const netBreakdown = grade.breakdown.find(b => b.category === 'Network Fidelity');
      expect(netBreakdown).toBeDefined();
      expect(netBreakdown!.grade).toBe('F');
    });

    it('handles Delivery Jitter with avg=0 and p95=0 (ratio=1, grade A)', () => {
      const snap = makeSnapshot({
        network: {
          configured: { latencyMs: 0, packetLossRate: 0 },
          observed: {
            messagesRelayed: 100, messagesDropped: 0, actualLossRate: 0,
            avgDeliveryMs: 0, p95DeliveryMs: 0, maxDeliveryMs: 0, bandwidthSamples: null,
          },
        },
      });
      const grade = analyze(snap);
      const jitterBreakdown = grade.breakdown.find(b => b.category === 'Delivery Jitter');
      expect(jitterBreakdown).toBeDefined();
      expect(jitterBreakdown!.grade).toBe('A');
    });

    it('handles Delivery Jitter with avg=0 and p95>0 (worst case ratio=10, grade F)', () => {
      const snap = makeSnapshot({
        network: {
          configured: { latencyMs: 0, packetLossRate: 0 },
          observed: {
            messagesRelayed: 100, messagesDropped: 0, actualLossRate: 0,
            avgDeliveryMs: 0, p95DeliveryMs: 100, maxDeliveryMs: 200, bandwidthSamples: null,
          },
        },
      });
      const grade = analyze(snap);
      const jitterBreakdown = grade.breakdown.find(b => b.category === 'Delivery Jitter');
      expect(jitterBreakdown).toBeDefined();
      expect(jitterBreakdown!.grade).toBe('F');
    });

    it('grades Layout Stability from browser layoutShifts', () => {
      const snap = makeSnapshot({
        tier: 'T2',
        browser: {
          longTasks: [],
          layoutShifts: [{ startTime: 100, value: 0.08 }, { startTime: 200, value: 0.06 }],
          jsHeapUsedMb: 40,
        },
      });
      const grade = analyze(snap);
      // CLS sum = 0.14, which is > 0.1 (C threshold) but <= 0.25 (D threshold) → D
      const stabilityBreakdown = grade.breakdown.find(b => b.category === 'Layout Stability');
      expect(stabilityBreakdown).toBeDefined();
      expect(stabilityBreakdown!.grade).toBe('D');
    });
  });

  // ── compareTo ─────────────────────────────────────────────────────

  describe('compareTo', () => {
    it('returns empty array when no regressions', () => {
      const current = makeSnapshot();
      const baseline = makeSnapshot();
      const regressions = compareTo(current, baseline);
      expect(regressions).toHaveLength(0);
    });

    it('detects tick p95 regression with correct severity', () => {
      const baseline = makeSnapshot({
        timing: {
          totalMs: 5000,
          tickSamples: [],
          tickStats: { avg: 200, p50: 200, p95: 500, p99: 600, max: 700, count: 100 },
          budgetViolations: 0,
        },
      });
      const current = makeSnapshot({
        timing: {
          totalMs: 5000,
          tickSamples: [],
          tickStats: { avg: 400, p50: 400, p95: 800, p99: 900, max: 1000, count: 100 },
          budgetViolations: 0,
        },
      });
      // 800/500 = 1.6 → 60% regression → major (50-100% range)
      const regressions = compareTo(current, baseline);
      const tickReg = regressions.find(r => r.metric === 'tickP95');
      expect(tickReg).toBeDefined();
      expect(tickReg!.severity).toBe('major');
      expect(tickReg!.current).toBe(800);
      expect(tickReg!.previous).toBe(500);
    });

    it('classifies minor severity for 20-50% change', () => {
      const baseline = makeSnapshot({
        timing: {
          totalMs: 5000,
          tickSamples: [],
          tickStats: { avg: 200, p50: 200, p95: 500, p99: 600, max: 700, count: 100 },
          budgetViolations: 0,
        },
      });
      const current = makeSnapshot({
        timing: {
          totalMs: 5000,
          tickSamples: [],
          tickStats: { avg: 250, p50: 250, p95: 625, p99: 750, max: 850, count: 100 },
          budgetViolations: 0,
        },
      });
      // 625/500 = 1.25 → 25% regression → minor
      const regressions = compareTo(current, baseline);
      const tickReg = regressions.find(r => r.metric === 'tickP95');
      expect(tickReg).toBeDefined();
      expect(tickReg!.severity).toBe('minor');
    });

    it('classifies critical severity for >100% change', () => {
      const baseline = makeSnapshot({
        timing: {
          totalMs: 5000,
          tickSamples: [],
          tickStats: { avg: 200, p50: 200, p95: 300, p99: 400, max: 500, count: 100 },
          budgetViolations: 0,
        },
      });
      const current = makeSnapshot({
        timing: {
          totalMs: 5000,
          tickSamples: [],
          tickStats: { avg: 600, p50: 600, p95: 700, p99: 800, max: 1000, count: 100 },
          budgetViolations: 0,
        },
      });
      // 700/300 = 2.33 → 133% regression → critical
      const regressions = compareTo(current, baseline);
      const tickReg = regressions.find(r => r.metric === 'tickP95');
      expect(tickReg).toBeDefined();
      expect(tickReg!.severity).toBe('critical');
    });

    it('skips comparison when both values are 0', () => {
      const baseline = makeSnapshot({
        timing: {
          totalMs: 5000,
          tickSamples: [],
          tickStats: { avg: 200, p50: 200, p95: 200, p99: 200, max: 200, count: 100 },
          budgetViolations: 0,
        },
      });
      const current = makeSnapshot({
        timing: {
          totalMs: 5000,
          tickSamples: [],
          tickStats: { avg: 200, p50: 200, p95: 200, p99: 200, max: 200, count: 100 },
          budgetViolations: 0,
        },
      });
      // Both budgetViolations are 0 — should not appear in regressions
      const regressions = compareTo(current, baseline);
      const violationReg = regressions.find(r => r.metric === 'budgetViolations');
      expect(violationReg).toBeUndefined();
    });

    it('does not flag improvements (decreases)', () => {
      const baseline = makeSnapshot({
        timing: {
          totalMs: 5000,
          tickSamples: [],
          tickStats: { avg: 500, p50: 500, p95: 1000, p99: 1200, max: 1500, count: 100 },
          budgetViolations: 0,
        },
      });
      const current = makeSnapshot({
        timing: {
          totalMs: 5000,
          tickSamples: [],
          tickStats: { avg: 200, p50: 200, p95: 200, p99: 250, max: 300, count: 100 },
          budgetViolations: 0,
        },
      });
      // p95 went from 1000 → 200, an improvement, should not be flagged
      const regressions = compareTo(current, baseline);
      expect(regressions).toHaveLength(0);
    });

    it('detects network loss rate regression', () => {
      const baseline = makeSnapshot({
        network: {
          configured: { latencyMs: 50, packetLossRate: 0.05 },
          observed: {
            messagesRelayed: 95, messagesDropped: 5, actualLossRate: 0.05,
            avgDeliveryMs: 50, p95DeliveryMs: 55, maxDeliveryMs: 60, bandwidthSamples: null,
          },
        },
      });
      const current = makeSnapshot({
        network: {
          configured: { latencyMs: 50, packetLossRate: 0.05 },
          observed: {
            messagesRelayed: 85, messagesDropped: 15, actualLossRate: 0.15,
            avgDeliveryMs: 50, p95DeliveryMs: 55, maxDeliveryMs: 60, bandwidthSamples: null,
          },
        },
      });
      // 0.15/0.05 = 3.0 → 200% regression → critical
      const regressions = compareTo(current, baseline);
      const lossReg = regressions.find(r => r.metric === 'networkLossRate');
      expect(lossReg).toBeDefined();
      expect(lossReg!.severity).toBe('critical');
    });
  });

  // ── formatSummary ─────────────────────────────────────────────────

  describe('formatSummary', () => {
    it('produces a string containing the overall grade letter', () => {
      const snap = makeSnapshot();
      const grade = analyze(snap);
      const summary = formatSummary(grade);
      expect(typeof summary).toBe('string');
      expect(summary.length).toBeGreaterThan(0);
      expect(summary).toContain(grade.overall);
    });

    it('includes breakdown categories in summary', () => {
      const snap = makeSnapshot();
      const grade = analyze(snap);
      const summary = formatSummary(grade);
      expect(summary).toContain('Tick Cost');
    });

    it('produces different summaries for different grades', () => {
      const goodSnap = makeSnapshot();
      const badSnap = makeSnapshot({
        timing: {
          totalMs: 5000,
          tickSamples: [],
          tickStats: { avg: 4000, p50: 4000, p95: 8000, p99: 9000, max: 10000, count: 100 },
          budgetViolations: 50,
        },
      });
      const goodGrade = analyze(goodSnap);
      const badGrade = analyze(badSnap);
      expect(formatSummary(goodGrade)).not.toBe(formatSummary(badGrade));
    });
  });
});
