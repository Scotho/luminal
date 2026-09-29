---
name: e2e-audit:luminal
description: Audit e2e test coverage against the coverage matrix. Identifies gaps, stale tests, and missing scenarios. Use when reviewing test health or planning test expansion.
user_invocable: true
---

> **Convention:** Follow the ref system in `.claude/skills/_conventions/ref-system.md`. Test items use QA-N refs.

# E2E Coverage Audit

Periodic audit skill for assessing e2e test health and recommending next actions. Uses the e2e coverage matrix in the admin dashboard as the source of truth.

## When to Use

- Periodic health check (weekly or after major feature work)
- Before a release/deploy to assess test confidence
- After rapid iteration to identify new gaps
- When the matrix has many `planned` entries and you need to prioritize

## Workflow

### Step 0: Health Check

- Check admin dashboard: `curl -sf http://localhost:5175/__admin_exec/status > /dev/null`. If unreachable, skip all dashboard calls and work from file reads only.

### Step 1: Read Current Matrix State

```bash
curl -s http://localhost:5175/__admin_e2e_matrix
```

Parse and summarize: how many planned, passing, failing, flaky?

### Step 2: Cross-Reference TEST_CATALOG

Read `admin/src/sections/testRunnerHelpers.ts` and extract the `TEST_CATALOG` array. This is what the Test Center UI displays.

For each catalog entry:
1. Resolve the `file` glob against the actual filesystem
2. Flag any entry whose file does not exist — catalog is out of sync
3. Flag any test file in `src/e2e/` that has no catalog entry — invisible to the UI

```bash
# List all test files the configs cover
grep -r "include" vitest.e2e.config.ts vitest.online.config.ts vitest.smoke.config.ts vitest.browser.config.ts
```

### Step 3: Scan Recent Codebase Changes

```bash
git log --oneline --since="7 days ago" -- src/
```

Identify files that changed significantly. Focus on:
- `src/ui/` — UI flow changes
- `src/net/` — Network/transport changes
- `src/core/` — Simulation changes
- `src/modes/` — Game mode changes
- `src/lobby.ts`, `src/matchmaking.ts`, `src/onlineMatch.ts` — Multiplayer changes
- `src/auth.ts` — Auth changes

### Step 4: Cross-Reference Coverage

For each significantly changed file:
1. Check if any matrix test covers that file's functionality
2. Check if the test is passing
3. If no test exists, flag as a gap

### Step 5: Identify Priority Gaps

Score each gap:
- **Impact** (1-5): How many users are affected if this breaks?
  - 5: Auth, matchmaking, lobby join — blocks all users
  - 4: Match lifecycle, disconnect handling — breaks active gameplay
  - 3: UI persistence, settings, replay — degrades experience
  - 2: Leaderboard, stats, profile — informational features
  - 1: Visual/layout, admin-only features
- **Likelihood** (1-5): How likely is this to break during iteration?
  - 5: File changed >5 times this week
  - 4: File changed 3-4 times
  - 3: File changed 1-2 times
  - 2: File adjacent to changed files
  - 1: File stable/unchanged

**Risk Score** = Impact × Likelihood. Prioritize highest scores.

### Step 6: Check for Stale Tests

A test is stale if:
- The source file it tests has been significantly refactored
- The test references selectors/functions that no longer exist
- The test has been flaky for >7 days without investigation

Check selectors by scanning `src/e2e/browser/online/actions/selectors.ts` for any IDs that no longer appear in the game source.

### Step 7: Generate Report

Output format:
```
## E2E Coverage Audit — {date}

### Summary
- Matrix: {total} tests ({passing} passing, {failing} failing, {flaky} flaky, {planned} planned)
- Changed files (7d): {count}
- New gaps found: {count}
- Catalog sync issues: {count missing files} missing, {count unlisted} unlisted

### Top Priority Gaps
| Rank | Area | Risk Score | Source File | Suggested Test |
|------|------|------------|-------------|----------------|
| 1    | ...  | 20         | ...         | ...            |

### Stale Tests
| ID | Name | Issue |
|----|------|-------|

### Catalog Sync Issues
| Entry | Issue |
|-------|-------|

### Recommendations
1. Implement test {ID} — highest risk score
2. Stabilize flaky test {ID} — failing intermittently
3. Add test for {new flow} — not in matrix yet
4. Update TEST_CATALOG for {file} — not visible in Test Center
```

### Step 8: Update Matrix

For newly identified gaps, add entries:
```bash
# Read current matrix, add new entry, write back
```

For stale tests, update notes:
```bash
curl -X PATCH http://localhost:5175/__admin_e2e_matrix \
  -H 'Content-Type: application/json' \
  -d '{"id":"X1","notes":"Stale: selector #foo removed in commit abc123"}'
```

## Key Files

- Matrix data: `admin/data/e2e-matrix.json`
- Test catalog (Test Center UI): `admin/src/sections/testRunnerHelpers.ts` — `TEST_CATALOG` array
- Unit/integration tests: `src/e2e/__tests__/`
- Browser smoke tests: `src/e2e/browser/online-smoke/`
- Browser emulator tests: `src/e2e/browser/online-emulator/`
- Overlay tests: `src/e2e/browser/overlay-containment.test.ts`
- Online helpers: `src/e2e/browser/online/testAccounts.ts`, `matchFlow.ts`, `bugReporter.ts`, `emulator.ts`, `relay.ts`
- Browser helpers: `src/e2e/browser/helpers/launch.ts`, `captureOnFailure.ts`, `viewports.ts`, `domUtils.ts`
- Selector registry: `src/e2e/browser/online/actions/selectors.ts`
- Vitest configs: `vitest.config.ts`, `vitest.e2e.config.ts`, `vitest.online.config.ts`, `vitest.smoke.config.ts`, `vitest.browser.config.ts`
- Game feature surface: `src/ui/`, `src/modes/`, `src/net/`, `src/core/`

## Integration with Other Skills

- After audit, hand off to `/write-online-test` for implementation
- After implementation, hand off to `/run-e2e` for verification
- Via `/orchestrate`: creates a session with `e2e-expansion` phases

## Catalog Sync

The Test Center UI uses `TEST_CATALOG` in `admin/src/sections/testRunnerHelpers.ts`.
When adding or removing test files, update this catalog to keep the UI in sync.
Each entry has: id, config, name, description, file (glob path), group.
