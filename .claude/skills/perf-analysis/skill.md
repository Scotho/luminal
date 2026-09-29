---
name: perf-analysis:luminal
description: Analyze e2e test performance data, diagnose bottlenecks, detect regressions. Triggers on "analyze perf", "perf regression", "why is this test slow".
user_invocable: true
---

# Performance Analysis

Autonomous triage of performance data from e2e test results.

## Triggers

- "analyze perf", "perf regression", "why is this test slow"
- "check perf for {test}", "perf report"

## Workflow

### Step 1: Locate test results

```bash
ls test-results/e2e/ | sort -r | head -5
```

Pick the latest run, or the run specified by the user.

### Step 2: Read perf data

For each test in the run:

```bash
cat test-results/e2e/{runId}/{testId}/result.json
```

Look for the `perf` block. If missing, the test predates perf collection — note this and skip.

### Step 3: Check grades

For each test with perf data:

- `perf.grade.overall` — the headline grade
- `perf.grade.breakdown[]` — per-category grades and reasons
- Flag any **D** or **F** grades

### Step 4: Diagnose D/F categories

Use this category-to-code mapping:

| Category | Where to look | Common causes |
|---|---|---|
| Tick Cost | `src/core/simulation.ts`, `src/vehicleConfig.ts` | Expensive physics, large player count |
| Frame Budget | render loop, postprocessing pipeline | GC pauses, shader compilation |
| Network Fidelity | `src/e2e/loopbackTransport.ts`, hub timer accuracy | Timer drift under load, GC during relay |
| Delivery Jitter | Same as Network Fidelity | Burst loss, degradeOverTime config |
| Long Tasks | Browser init, asset loading, DOM manipulation | Synchronous file loads, layout thrash |
| Layout Stability | CSS transitions, DOM insertions during gameplay | Overlay animations, score updates |
| Memory | Texture allocation, geometry retention | Missing dispose() calls, leak in pools |

### Step 5: Compare to baseline

If a previous run exists:

1. Read both run's result.json for the same test
2. Compare: p95 tick, budget violations, network loss rate, delivery p95
3. Flag regressions >20% with severity:
   - 20-50%: minor
   - 50-100%: major
   - >100%: critical

### Step 6: Report

Post findings to the active session:

```bash
curl -s -X POST http://localhost:5175/__admin_session/note \
  -H 'Content-Type: application/json' \
  -d '{"id":"<session-id>","text":"[Perf Analysis] <findings summary>"}'
```

Include: overall grade distribution, any D/F categories with root cause pointers, any regressions with severity.

## Thresholds

Thresholds are configured in `perf-budget.json` at project root. Read it to understand what "good" means for each category. The analyzer in `src/e2e/perfAnalyzer.ts` uses these thresholds.
