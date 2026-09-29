// src/e2e/perfAnalyzer.ts — Pure-function grading, comparison, and summary engine
import type {
  PerfSnapshot,
  PerfGrade,
  PerfBudget,
  PerfRegression,
  GradeBreakdown,
  LetterGrade,
} from './perfTypes';
import { createRequire } from 'module';
import { resolve } from 'path';

// ── Budget loading ────────────────────────────────────────────────────────────

const DEFAULT_BUDGET: Required<PerfBudget> = {
  tickCost:        { A: 500,  B: 1000, C: 2000, D: 5000 },
  frameBudget:     { A: 0,    B: 0.01, C: 0.05, D: 0.10 },
  networkFidelity: { A: 1.1,  B: 1.3,  C: 1.5,  D: 2.0  },
  deliveryJitter:  { A: 1.5,  B: 2.0,  C: 3.0,  D: 5.0  },
  longTasks:       { A: 0,    B: 2,    C: 5,    D: 10   },
  layoutStability: { A: 0.01, B: 0.05, C: 0.1,  D: 0.25 },
  memory:          { A: 50,   B: 100,  C: 150,  D: 200  },
};

let _budgetCache: Required<PerfBudget> | null = null;

/** Reset the cached budget — used in tests to get a fresh load. */
export function _resetBudgetCache(): void {
  _budgetCache = null;
}

function loadBudget(): Required<PerfBudget> {
  if (_budgetCache) return _budgetCache;

  try {
    const requireFn = createRequire(import.meta.url);
    const budgetPath = resolve(process.cwd(), 'perf-budget.json');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loaded = requireFn(budgetPath) as any;
    _budgetCache = {
      tickCost:        loaded.tickCost        ?? DEFAULT_BUDGET.tickCost,
      frameBudget:     loaded.frameBudget     ?? DEFAULT_BUDGET.frameBudget,
      networkFidelity: loaded.networkFidelity ?? DEFAULT_BUDGET.networkFidelity,
      deliveryJitter:  loaded.deliveryJitter  ?? DEFAULT_BUDGET.deliveryJitter,
      longTasks:       loaded.longTasks       ?? DEFAULT_BUDGET.longTasks,
      layoutStability: loaded.layoutStability ?? DEFAULT_BUDGET.layoutStability,
      memory:          loaded.memory          ?? DEFAULT_BUDGET.memory,
    };
  } catch {
    _budgetCache = { ...DEFAULT_BUDGET };
  }

  return _budgetCache;
}

// ── Grading helpers ───────────────────────────────────────────────────────────

type Thresholds = { A: number; B: number; C: number; D: number };

function gradeValue(value: number, thresholds: Thresholds): LetterGrade {
  if (value <= thresholds.A) return 'A';
  if (value <= thresholds.B) return 'B';
  if (value <= thresholds.C) return 'C';
  if (value <= thresholds.D) return 'D';
  return 'F';
}

const GRADE_POINTS: Record<LetterGrade, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
const POINTS_TO_GRADE: [number, LetterGrade][] = [
  [3.5, 'A'],
  [2.5, 'B'],
  [1.5, 'C'],
  [0.5, 'D'],
  [0,   'F'],
];

function pointsToLetter(points: number): LetterGrade {
  for (const [threshold, letter] of POINTS_TO_GRADE) {
    if (points >= threshold) return letter;
  }
  return 'F';
}

// ── analyze ───────────────────────────────────────────────────────────────────

/**
 * Grade a PerfSnapshot against the loaded budget thresholds.
 * Returns a PerfGrade with an overall letter and per-category breakdown.
 */
export function analyze(snapshot: PerfSnapshot): PerfGrade {
  const budget = loadBudget();
  const breakdown: GradeBreakdown[] = [];

  // Tick Cost (p95 μs)
  const tickP95 = snapshot.timing.tickStats.p95;
  const tickGrade = gradeValue(tickP95, budget.tickCost);
  breakdown.push({
    category: 'Tick Cost',
    grade: tickGrade,
    reason: `p95 tick = ${tickP95.toFixed(0)} μs`,
    value: tickP95,
    threshold: budget.tickCost[tickGrade === 'F' ? 'D' : tickGrade],
  });

  // Frame Budget (violation %)
  const totalTicks = snapshot.timing.tickStats.count || 1;
  const violationPct = snapshot.timing.budgetViolations / totalTicks;
  const frameGrade = gradeValue(violationPct, budget.frameBudget);
  breakdown.push({
    category: 'Frame Budget',
    grade: frameGrade,
    reason: `${(violationPct * 100).toFixed(1)}% budget violations (${snapshot.timing.budgetViolations}/${totalTicks})`,
    value: violationPct,
    threshold: budget.frameBudget[frameGrade === 'F' ? 'D' : frameGrade],
  });

  // Network Fidelity (actual/configured loss ratio)
  const configuredLoss = snapshot.network.configured.packetLossRate;
  const observedLoss = snapshot.network.observed.actualLossRate;
  let fidelityRatio: number;
  if (configuredLoss === 0) {
    fidelityRatio = observedLoss > 0 ? 10 : 1;
  } else {
    fidelityRatio = observedLoss / configuredLoss;
  }
  const fidelityGrade = gradeValue(fidelityRatio, budget.networkFidelity);
  breakdown.push({
    category: 'Network Fidelity',
    grade: fidelityGrade,
    reason: `loss ratio = ${fidelityRatio.toFixed(2)}x (observed ${(observedLoss * 100).toFixed(1)}% / configured ${(configuredLoss * 100).toFixed(1)}%)`,
    value: fidelityRatio,
    threshold: budget.networkFidelity[fidelityGrade === 'F' ? 'D' : fidelityGrade],
  });

  // Delivery Jitter (p95/avg delivery ratio)
  const avgDelivery = snapshot.network.observed.avgDeliveryMs;
  const p95Delivery = snapshot.network.observed.p95DeliveryMs;
  let jitterRatio: number;
  if (avgDelivery === 0) {
    jitterRatio = p95Delivery > 0 ? 10 : 1;
  } else {
    jitterRatio = p95Delivery / avgDelivery;
  }
  const jitterGrade = gradeValue(jitterRatio, budget.deliveryJitter);
  breakdown.push({
    category: 'Delivery Jitter',
    grade: jitterGrade,
    reason: `jitter ratio = ${jitterRatio.toFixed(2)}x (p95 ${p95Delivery}ms / avg ${avgDelivery}ms)`,
    value: jitterRatio,
    threshold: budget.deliveryJitter[jitterGrade === 'F' ? 'D' : jitterGrade],
  });

  // Browser-only categories (T2 snapshots)
  if (snapshot.tier === 'T2' && snapshot.browser) {
    const { longTasks, layoutShifts, jsHeapUsedMb } = snapshot.browser;

    // Long Tasks (count)
    const longTaskCount = longTasks.length;
    const longTaskGrade = gradeValue(longTaskCount, budget.longTasks);
    breakdown.push({
      category: 'Long Tasks',
      grade: longTaskGrade,
      reason: `${longTaskCount} long tasks`,
      value: longTaskCount,
      threshold: budget.longTasks[longTaskGrade === 'F' ? 'D' : longTaskGrade],
    });

    // Layout Stability (CLS sum)
    const clsSum = layoutShifts.reduce((acc, s) => acc + s.value, 0);
    const stabilityGrade = gradeValue(clsSum, budget.layoutStability);
    breakdown.push({
      category: 'Layout Stability',
      grade: stabilityGrade,
      reason: `CLS sum = ${clsSum.toFixed(4)}`,
      value: clsSum,
      threshold: budget.layoutStability[stabilityGrade === 'F' ? 'D' : stabilityGrade],
    });

    // Memory (heap MB)
    if (jsHeapUsedMb !== undefined) {
      const memGrade = gradeValue(jsHeapUsedMb, budget.memory);
      breakdown.push({
        category: 'Memory',
        grade: memGrade,
        reason: `heap = ${jsHeapUsedMb.toFixed(1)} MB`,
        value: jsHeapUsedMb,
        threshold: budget.memory[memGrade === 'F' ? 'D' : memGrade],
      });
    }
  }

  // Weighted overall grade
  // Weights: Tick Cost 30%, Frame Budget 25%, Network Fidelity 20%, Delivery Jitter 15%, browser 10%
  const isBrowser = snapshot.tier === 'T2' && snapshot.browser !== undefined;

  const coreWeights: Record<string, number> = {
    'Tick Cost':        0.30,
    'Frame Budget':     0.25,
    'Network Fidelity': 0.20,
    'Delivery Jitter':  0.15,
  };

  const browserCategories = new Set(['Long Tasks', 'Layout Stability', 'Memory']);

  let weightedSum = 0;
  let totalWeight = 0;

  for (const item of breakdown) {
    const isBrowserCat = browserCategories.has(item.category);
    let weight: number;

    if (isBrowserCat) {
      if (!isBrowser) continue;
      weight = 0.10 / Math.max(1, breakdown.filter(b => browserCategories.has(b.category)).length);
    } else {
      weight = coreWeights[item.category] ?? 0;
    }

    weightedSum += GRADE_POINTS[item.grade] * weight;
    totalWeight += weight;
  }

  const normalizedPoints = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const overall = pointsToLetter(normalizedPoints);

  const summary = formatSummary({ overall, breakdown, summary: '' });

  return { overall, breakdown, summary };
}

// ── compareTo ─────────────────────────────────────────────────────────────────

type MetricExtractor = (snap: PerfSnapshot) => number;

const COMPARISON_METRICS: { key: string; extract: MetricExtractor }[] = [
  { key: 'tickP95',          extract: s => s.timing.tickStats.p95 },
  { key: 'tickMax',          extract: s => s.timing.tickStats.max },
  { key: 'budgetViolations', extract: s => s.timing.budgetViolations },
  { key: 'networkLossRate',  extract: s => s.network.observed.actualLossRate },
  { key: 'deliveryP95',      extract: s => s.network.observed.p95DeliveryMs },
];

function classifySeverity(changePct: number): PerfRegression['severity'] {
  if (changePct > 100) return 'critical';
  if (changePct > 50)  return 'major';
  return 'minor';
}

/**
 * Detect regressions between current and baseline snapshots.
 * Only flags increases (regressions) > 20%.
 */
export function compareTo(current: PerfSnapshot, baseline: PerfSnapshot): PerfRegression[] {
  const regressions: PerfRegression[] = [];

  for (const { key, extract } of COMPARISON_METRICS) {
    const prev = extract(baseline);
    const curr = extract(current);

    // Skip if both are zero
    if (prev === 0 && curr === 0) continue;

    // Only flag increases
    if (curr <= prev) continue;

    const changePercent = prev === 0
      ? (curr > 0 ? Infinity : 0)
      : ((curr - prev) / prev) * 100;

    // Only flag if > 20% worse
    if (changePercent <= 20) continue;

    regressions.push({
      metric: key,
      previous: prev,
      current: curr,
      changePercent,
      severity: classifySeverity(changePercent),
    });
  }

  return regressions;
}

// ── formatSummary ─────────────────────────────────────────────────────────────

/**
 * Produce a human-readable multi-line summary of a PerfGrade.
 */
export function formatSummary(grade: PerfGrade): string {
  const lines: string[] = [];
  lines.push(`Overall: ${grade.overall}`);
  lines.push('');
  lines.push('Breakdown:');

  for (const item of grade.breakdown) {
    lines.push(`  ${item.category}: ${item.grade} — ${item.reason}`);
  }

  return lines.join('\n');
}
