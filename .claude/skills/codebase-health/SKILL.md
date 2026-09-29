---
name: codebase-health
description: Use when the user wants a code quality audit — lint warnings, TypeScript strictness, as-any casts, empty catches, large files, dependency health. Triggers on "codebase health", "code quality", "tech debt", "code smells", "how clean is the code".
user_invocable: true
---

# Codebase Health Report

Generate a terse code quality metrics report.

## Data Collection

Run in parallel:

### 1. TypeScript Strictness
```bash
npx tsc --noEmit 2>&1 | tail -3
```
Report: error count. 0 = strict clean.

### 2. ESLint
```bash
npx eslint src/ --max-warnings 999 --format compact 2>&1 | tail -5
```
Report: warning count, error count.

### 3. Code Smell Counts
```bash
grep -r "as any" src/ --include="*.ts" -l | wc -l
grep -r "as any" src/ --include="*.ts" | wc -l
grep -rP "catch\s*(\([^)]*\))?\s*\{[\s]*\}" src/ --include="*.ts" | wc -l
grep -rP "// ?TODO" src/ --include="*.ts" | wc -l
```
Report: `as any` (files + occurrences), empty catches, TODOs.

### 4. Large Files (>300 lines)
```bash
find src/ -name "*.ts" -exec wc -l {} + | sort -rn | head -10
```
Flag any file over 400 lines.

### 5. Test Coverage
```bash
npx vitest run --coverage --reporter=json 2>/dev/null | tail -5
```
Or use the test-health script if admin is up:
```bash
curl -s -X POST "http://localhost:5175/__admin_exec/script?name=test-health" 2>/dev/null
```

### 6. Dependency Freshness
```bash
npm outdated --json 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(Object.keys(d).length+' outdated')"
```

## Output Format

```
── CODEBASE HEALTH ─────────────────────
TypeScript   ● strict clean (0 errors)
ESLint       ⚠ 287 warnings, 0 errors
─── Code Smells ────────────────────────
as any       36 in 22 files          ⚠ (target: <20)
empty catch  10 occurrences          ⚠ (target: 0)
TODOs        14 remaining
─── File Sizes ─────────────────────────
src/game.ts              512 lines   ✗ (>400)
src/onlineMatch.class.ts 389 lines
src/ui/lobby/lobbyContext.ts 342 lines
─── Dependencies ───────────────────────
Outdated     3 packages (0 major, 2 minor, 1 patch)
─── Coverage ───────────────────────────
Statements   78%                     ● (>75%)
────────────────────────────────────────
```

Thresholds:
- `as any` < 20 = `●`, < 40 = `⚠`, >= 40 = `✗`
- empty catches: 0 = `●`, < 10 = `⚠`, >= 10 = `✗`
- File > 400 lines = `✗`, > 300 = `⚠`
- Coverage > 75% = `●`, > 50% = `⚠`, < 50% = `✗`
- Lint warnings > 300 = `⚠`, > 400 = `✗`

## Discord Output

After printing, offer Discord send. If yes or `--discord` passed:

```bash
node scripts/discord-notify.js report "Codebase Health" "$(cat <<'EOF'
<report text>
EOF
)"
```

## Trend Tracking

If previous report data exists in `admin/data/health-snapshot.json`, compare and show deltas:
```
as any       36 (+2 since last check)
```
After generating the report, save current metrics to `admin/data/health-snapshot.json` for next comparison.

## Notes

- Keep output under 20 lines for the summary view
- If user asks for details on a specific metric, expand that section
- The code review memory tracks known issues: touch accel, empty catches (10), as-any (36)
