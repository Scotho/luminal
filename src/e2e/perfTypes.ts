// src/e2e/perfTypes.ts — Shared perf data types for collection, analysis, and UI

export type LetterGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface TickStats {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  count: number;
}

export interface PerfSnapshot {
  tier: 'T1' | 'T2';

  timing: {
    totalMs: number;
    /** [tick, durationMicros][] */
    tickSamples: [number, number][];
    tickStats: TickStats;
    /** Count of ticks exceeding 16.6ms */
    budgetViolations: number;
  };

  network: {
    configured: {
      latencyMs: number;
      packetLossRate: number;
      jitterMs?: number;
    };
    observed: {
      messagesRelayed: number;
      messagesDropped: number;
      actualLossRate: number;
      avgDeliveryMs: number;
      p95DeliveryMs: number;
      maxDeliveryMs: number;
      /** [tick, bytesPerSec][] — T2 only, null for T1 */
      bandwidthSamples: [number, number][] | null;
    };
  };

  /** T2-only: browser performance entries */
  browser?: {
    longTasks: { startTime: number; duration: number }[];
    layoutShifts: { startTime: number; value: number }[];
    lcp?: number;
    jsHeapUsedMb?: number;
    jsHeapTotalMb?: number;
  };

  /** Filled by perfAnalyzer after collection */
  grade?: PerfGrade;
}

export interface GradeBreakdown {
  category: string;
  grade: LetterGrade;
  reason: string;
  value: number;
  threshold: number;
}

export interface PerfGrade {
  overall: LetterGrade;
  breakdown: GradeBreakdown[];
  summary: string;
}

export interface PerfRegression {
  metric: string;
  previous: number;
  current: number;
  changePercent: number;
  severity: 'minor' | 'major' | 'critical';
}

export interface HubStats {
  messagesRelayed: number;
  messagesDropped: number;
  deliveryDelays: number[];
}

export interface PerfBudget {
  tickCost?: { A: number; B: number; C: number; D: number };
  frameBudget?: { A: number; B: number; C: number; D: number };
  networkFidelity?: { A: number; B: number; C: number; D: number };
  deliveryJitter?: { A: number; B: number; C: number; D: number };
  longTasks?: { A: number; B: number; C: number; D: number };
  layoutStability?: { A: number; B: number; C: number; D: number };
  memory?: { A: number; B: number; C: number; D: number };
}
