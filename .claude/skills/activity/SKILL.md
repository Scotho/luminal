---
name: activity
description: Use when the user wants a recent activity digest — git log, branch status, hot modules, worktrees, recent sessions. Triggers on "activity", "what happened", "recent changes", "digest", "what's new".
user_invocable: true
---

> **Convention:** Follow the ref system in `.claude/skills/_conventions/ref-system.md`. Show refs alongside session/task summaries.

# Activity Digest

Generate a terse summary of recent project activity.

## Data Collection

Run in parallel:

### 1. Recent Commits (last 24h or last 10)
```bash
git log --oneline --since="24 hours ago" --no-merges
```
If empty, fall back to:
```bash
git log --oneline -10 --no-merges
```

### 2. Branch Status
```bash
git branch -vv --no-color | head -20
```
Identify: current branch, branches ahead/behind origin, stale branches.

### 3. Hot Modules (30-day churn)
```bash
git log --since="30 days ago" --pretty=format: --name-only | sort | uniq -c | sort -rn | head -10
```
List top 10 most-changed files with commit counts.

### 4. Active Worktrees
```bash
git worktree list
```

### 5. Recent Sessions (if admin is up)
```bash
curl -s "http://localhost:5175/__admin_session?id=all" 2>/dev/null
```
Show last 5 completed/active sessions with summary and status.

### 6. CI Status (if admin is up)
```bash
curl -s http://localhost:5175/__admin_ci/runs 2>/dev/null
```
Show last 3 workflow runs with pass/fail.

## Output Format

```
── ACTIVITY (last 24h) ─────────────────
Commits (7):
  abc1234 feat(lobby): add map voting carousel
  def5678 fix(netcode): desync on round transition
  ghi9012 test(e2e): vehicle selection flow
  ... +4 more

Hot Modules (30d):
  src/game.ts              42 commits
  src/ui/lobby/lobbyContext.ts  31 commits
  src/modes/roundFlow.ts   28 commits

Branches:
  ● feature/map-carousel-voting  +3 ahead
  ● develop                      up to date
    fix/trail-flicker            5 behind (stale?)

Worktrees: 1 active (feature/map-carousel-voting)

Sessions:
  ✓ "Lockstep netcode" — done
  ● "Map carousel voting" — active (implement phase)

CI: last 3 runs ✓ ✓ ✗
────────────────────────────────────────
```

## Discord Output

After printing, offer Discord send. If yes or `--discord` passed:

```bash
node scripts/discord-notify.js report "Activity Digest" "$(cat <<'EOF'
<report text>
EOF
)"
```

## Notes

- Default window is 24h. User can pass a timeframe: `/activity 7d`, `/activity this week`
- Keep output scannable — truncate commit lists at 5, hot modules at 5 unless asked
- If admin is down, skip sessions and CI — note "admin offline"
