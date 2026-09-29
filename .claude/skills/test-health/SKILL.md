---
name: test-health
description: Use when the user wants a test health report, task status, or bug/session overview. Triggers on "test health", "how are tests", "task report", "bug status", "what's broken", "test status".
user_invocable: true
---

> **Convention:** Follow the ref system in `.claude/skills/_conventions/ref-system.md`. Reference TASK/QA/BUG refs in reports.

# Test Health & Task Report

Generate a terse report on test suite health, open tasks, sessions, and bugs.

## Data Collection

Run in parallel where possible:

### 1. Unit Test Summary
```bash
npx vitest run --reporter=verbose 2>&1 | tail -20
```
Extract: total, passed, failed, skipped counts and duration.

### 2. TypeScript Errors
```bash
npx tsc --noEmit 2>&1 | tail -5
```
Extract: error count (0 = clean).

### 3. Lint Warnings
```bash
npx eslint src/ --max-warnings 999 --format compact 2>&1 | tail -3
```
Extract: warning count, error count.

### 4. E2E Matrix (if admin is up)
```bash
curl -s http://localhost:5175/__admin_e2e_matrix 2>/dev/null
```
Count tests by status: passing, failing, planned, flaky.

### 5. Open Tasks & Sessions (if admin is up)
```bash
curl -s "http://localhost:5175/__admin_session?id=all" 2>/dev/null
```
Count sessions by status. List any blocked sessions with their blocker note.

### 6. Known Code Smells
```bash
grep -r "as any" src/ --include="*.ts" | wc -l
grep -r "catch\s*{" src/ --include="*.ts" -P | wc -l
```
Report: `as any` count, empty catch count.

## Output Format

```
── TEST HEALTH ─────────────────────────
Unit Tests   143 passed, 0 failed, 2 skipped (9.2s)
TypeScript   ● clean (0 errors)
ESLint       ● 287 warnings, 0 errors
E2E Matrix   12 passing, 3 planned, 1 failing
─── Code Smells ────────────────────────
as any       36 occurrences
empty catch  10 occurrences
─── Tasks & Sessions ───────────────────
Sessions     2 active, 1 blocked
  BLOCKED    "Map carousel — waiting on asset PR"
Bugs         0 open reports
────────────────────────────────────────
```

Use `●` for clean/good, `⚠` for warning thresholds, `✗` for failures.

Thresholds:
- Lint warnings > 300 = `⚠`, > 400 = `✗`
- `as any` > 40 = `⚠`, > 60 = `✗`
- Any test failure = `✗`

## Discord Output

After printing, ask user if they want it sent to Discord. If yes or `--discord` passed:

```bash
node scripts/discord-notify.js report "Test Health" "$(cat <<'EOF'
<report text>
EOF
)"
```

## Notes

- If admin is down, skip e2e matrix and sessions — note "admin offline"
- If tests take too long, use `npx vitest run --reporter=json` and parse counts from JSON
- Failed tests: list the first 3 failures by name if any exist
