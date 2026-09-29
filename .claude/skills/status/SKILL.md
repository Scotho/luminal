---
name: status
description: Use when the user wants a quick system status report — CC usage, server health, player count, current version, open matches, git state. Triggers on "status", "how's things", "system check", "what's running".
user_invocable: true
---

> **Convention:** Follow the ref system in `.claude/skills/_conventions/ref-system.md`.

# Status Report

Generate a terse system status report. Gather data, format as a compact text block, optionally send to Discord.

## Data Collection

Run these in parallel where possible:

### 1. CC Usage
```bash
curl -s http://localhost:5175/__admin_exec/claude-usage
```
Report: `available` (true/false), and if available show rate limit info.

### 2. Admin Server Health
```bash
curl -s http://localhost:5175/__admin_exec/status
```
Report: running (true/false), number of active agents.

### 3. Current Version
```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)"
```
Cross-reference with the environments memory file for live/test versions.

### 4. Git State
```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain | wc -l
git log --oneline -1
git rev-list --count origin/main..HEAD 2>/dev/null || echo "0"
```
Report: branch, dirty file count, last commit, commits ahead of origin.

### 5. Open Matches / Players (if admin is up)
```bash
curl -s http://localhost:5175/__admin_exec/script?name=activity-digest -X POST
```
If admin is down, skip — note "admin offline" in report.

### 6. Open Sessions
```bash
curl -s "http://localhost:5175/__admin_session?id=all" 2>/dev/null
```
Count sessions by status (active, blocked, todo).

## Output Format

Format as a compact status block:

```
── LUMINAL STATUS ──────────────────────
Version    v1.0.8 (live) / v1.0.7 (test)
Branch     feature/map-carousel-voting (+3 dirty, 2 ahead)
Last Commit abc1234 feat(lobby): add map voting
Admin      ● online (0 agents running)
CC Usage   ● available (85% remaining)
Sessions   2 active, 1 blocked, 0 todo
Players    — (admin offline / no data)
────────────────────────────────────────
```

Use `●` for online/good, `○` for offline/degraded, `✗` for errors.

## Discord Output

After printing the report, ask the user if they want it sent to Discord. If yes (or if `--discord` was passed as an argument):

```bash
node scripts/discord-notify.js report "Luminal Status" "$(cat <<'EOF'
<paste the formatted report here>
EOF
)"
```

## Notes

- If admin dashboard is down, still report git state, version, CC usage from file
- Keep output under 15 lines — this is a glance, not a deep dive
- If the user asks follow-up questions, expand on the relevant section
