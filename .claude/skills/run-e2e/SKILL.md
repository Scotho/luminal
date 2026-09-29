---
name: run-e2e:luminal
description: Run and triage e2e tests via admin dashboard. Auto-activates when running e2e tests, investigating test failures, or checking test status.
user_invocable: true
---

> **Convention:** Follow the ref system in `.claude/skills/_conventions/ref-system.md`. Test items use QA-N refs.

# Run E2E Tests

Single entry point for running, interpreting, and triaging e2e test results. Uses the admin dashboard as a hub for status tracking.

## Invocation

- `/run-e2e` — run all tiers (headless first, then browser if headless passes)
- `/run-e2e headless` — run headless E2E suite only
- `/run-e2e emulator` — run browser emulator tests
- `/run-e2e smoke` — run browser smoke tests
- `/run-e2e browser` — run browser UI tests
- `/run-e2e failing` — query matrix for failing tests, run only those
- `/run-e2e {ID}` — run a specific test by matrix ID (e.g., `C1`, `L1`)

## Workflow

### Step 1: Dashboard Health Check

```bash
curl -s http://localhost:5175/__admin_exec/status
```
If fails: skip dashboard calls, run tests directly, remind user to start admin.

### Step 2: Read the Matrix

```bash
curl -s http://localhost:5175/__admin_e2e_matrix
```
Parse the response to understand current test statuses.

### Step 3: Determine Scope

| Argument | npm command | Config file |
|----------|-------------|-------------|
| *(none)* | all tiers in order | — |
| `headless` | `npm run test:e2e` | `vitest.e2e.config.ts` |
| `emulator` | `npm run test:online` | `vitest.online.config.ts` |
| `smoke` | `npm run test:smoke` | `vitest.smoke.config.ts` |
| `browser` | `npm run test:browser` | `vitest.browser.config.ts` |
| `failing` | per-file (see matrix) | varies |
| `{ID}` | per-file (see mapping table) | varies |

To run a single file directly:
```bash
npx vitest run --config vitest.e2e.config.ts src/e2e/__tests__/casual.e2e.test.ts
npx vitest run --config vitest.online.config.ts src/e2e/browser/online-emulator/lobby-match.test.ts
npx vitest run --config vitest.smoke.config.ts src/e2e/browser/online-smoke/critical-path.test.ts
npx vitest run --config vitest.browser.config.ts src/e2e/browser/overlay-containment.test.ts
```

### Step 4: Execute Tests

Run the appropriate npm command from Step 3. Capture stdout/stderr for triage.

### Step 5: Interpret Results

Parse output. For each test:

| Result | Matrix Update | Action |
|--------|--------------|--------|
| Pass (was planned/implemented) | `status: 'passing'` | Log success |
| Pass (was failing) | `status: 'passing'` | Log regression fixed |
| Fail (was passing) | `status: 'failing'` | Flag regression |
| Fail (was planned) | `status: 'failing'` | Expected — needs debugging |
| Flaky (intermittent) | `status: 'flaky'` | Add failure pattern to notes |

### Step 6: Update Matrix

For each test result:
```bash
curl -X PATCH http://localhost:5175/__admin_e2e_matrix \
  -H 'Content-Type: application/json' \
  -d '{"id":"C1","status":"passing","lastRun":"2026-04-05T12:00:00Z","lastResult":"pass"}'
```

### Step 7: Triage Failures

For each failing test:
1. Read the test file and the source it tests
2. Classify:
   - **Regression**: Was passing, now failing → create bugfix session
   - **Flaky**: Sometimes passes → add timing/race condition note
   - **New failure**: Never passed → debug or mark infra-needed
3. For regressions, create a session:
```bash
curl -X POST http://localhost:5175/__admin_session \
  -H 'Content-Type: application/json' \
  -d '{"summary":"Fix regression: {test.id} {test.name}","type":"bugfix","status":"todo","section":"current-stack"}'
```

### Step 8: Report Summary

Output a table:
```
Test  | Status  | Result | Notes
------|---------|--------|------
C1    | passing | PASS   |
L1    | failing | FAIL   | Lobby join timeout
...
```

## Test ID → File Mapping

| ID Range | Suite | File |
|----------|-------|------|
| C1-Cn | headless | `src/e2e/__tests__/casual.e2e.test.ts` |
| L1-Ln | headless | `src/e2e/__tests__/lobby.e2e.test.ts` |
| S1-Sn | headless | `src/e2e/__tests__/soak.e2e.test.ts` |
| EM1-EMn | emulator | `src/e2e/browser/online-emulator/lobby-match.test.ts` |
| ED1-EDn | emulator | `src/e2e/browser/online-emulator/disconnect.test.ts` |
| SK1-SKn | smoke | `src/e2e/browser/online-smoke/critical-path.test.ts` |
| SW1-SWn | smoke | `src/e2e/browser/online-smoke/wall-death.test.ts` |
| SA1-SAn | smoke | `src/e2e/browser/online-smoke/ai-victory.test.ts` |
| SF1-SFn | smoke | `src/e2e/browser/online-smoke/friend-invite.test.ts` |
| SL1-SLn | smoke | `src/e2e/browser/online-smoke/friend-lifecycle.test.ts` |
| OC1-OCn | browser UI | `src/e2e/browser/overlay-containment.test.ts` |

## Config → Vitest Config Mapping

| Suite | Config File | npm script |
|-------|-------------|------------|
| headless e2e | `vitest.e2e.config.ts` | `npm run test:e2e` |
| browser emulator | `vitest.online.config.ts` | `npm run test:online` |
| browser smoke | `vitest.smoke.config.ts` | `npm run test:smoke` |
| browser UI | `vitest.browser.config.ts` | `npm run test:browser` |

## Key Files

- Matrix data: `admin/data/e2e-matrix.json`
- LoopbackTransport: `src/e2e/loopbackTransport.ts`
- E2E test directory: `src/e2e/__tests__/`
- Browser emulator tests: `src/e2e/browser/online-emulator/`
- Browser smoke tests: `src/e2e/browser/online-smoke/`

## Performance Analysis

After every run, check for perf data in results:

1. For each test in the run, read `result.json` and check `perf.grade.overall`
2. If any test grades **D** or **F**, post a session note:
   ```
   PERF WARNING: {testName} grade {grade} — {category}: {reason}
   ```
3. If a previous run exists for the same test, compare:
   - Load previous run's `result.json` for the same test ID
   - Compare p95 tick time, budget violations, network fidelity
   - Flag regressions >20% as: `PERF REGRESSION: {testName} {metric} {prev} → {current} (+{pct}%)`
4. Include a perf summary line in the run report:
   ```
   Perf: 12/12 tests graded A-C, 0 regressions detected
   ```
   or:
   ```
   Perf: 10/12 tests graded A-C, 2 tests D/F, 1 regression (tick p95 +45%)
   ```
