# Subagent Context Injection Template

When dispatching a subagent (via `superpowers:subagent-driven-development` or `superpowers:dispatching-parallel-agents`), the controller MUST construct a rich context package. Subagents start with zero conversation history — every piece of context they need must be in the prompt.

## Template

Paste the sections below into the Agent prompt, filling in the bracketed fields. Omit sections that genuinely don't apply, but err on the side of including too much.

```markdown
## Project Context

You are working on Luminal, a multiplayer Tron browser game (TypeScript strict, Vitest, Firebase).

### Plan Summary
[1-3 sentences: what the overall plan is trying to accomplish and WHY. Not just "implement X" — why X matters, what user problem it solves, what architectural goal it serves.]

### Your Task
[Full task text from the plan — paste it, don't make the agent read a file.]

### How This Task Fits
[Which task number is this? What tasks came before? What depends on this task completing? What will the next agent need from your output?]

## Architectural Notes

[Include ONLY patterns the agent will encounter. Pick from this list:]

- Navigation uses stack-based routing in src/ui/navigation.ts (598 lines, load-bearing order)
- Lobby uses a 10-phase update pipeline in src/ui/lobby/lobbyUIUpdate.ts — phase order matters
- LobbyContext interface (src/ui/lobby/lobbyContext.ts) coordinates 12+ sub-modules via dependency injection
- DisposableBag pattern used in 82 files for listener cleanup — always use it for new listeners
- Auth has 20 module-level state variables in src/ui/authUIFlows.ts — 8 implicit screen states
- CSS follows BEM naming (.block, .block--modifier, .block__element)
- HTML partials assembled at build time via <!-- @include --> in index.html
- Screen visibility toggled via .hidden class (display: none !important)
- Game HUD (flowHUD, grindHUD) runs at 60 FPS — never add framework overhead here
- [Add any pattern-specific notes for this task]

## File Boundaries

### Files You MAY Modify
[Explicit allowlist — only files this task needs to touch]

### Files You MUST NOT Modify
[Files owned by other parallel agents, or files outside task scope]

### Files to Read for Context (Don't Modify)
[Files the agent should read to understand patterns but not change]

## Known Issues (Don't Fix These)

[Pre-existing problems the agent will encounter but should NOT attempt to fix:]

- [List any known TS build errors with file:line]
- [List any known test failures with test file names]
- [List any known lint warnings]

These exist outside your task scope. If they block your work, report BLOCKED.

## Design Intent

[From the brainstorm or user conversation — what "good" looks like:]

- [UX expectations: "the color picker should feel instant, no loading states"]
- [Visual expectations: "match the existing BEM pattern, no new CSS methodology"]
- [Behavioral expectations: "must work with keyboard nav, not just mouse"]
- [What the user specifically cares about for this feature]

## User Preferences

- Conventional commits with refs: feat(scope): TASK-N description
- Commit locally, do not push to remote
- TypeScript strict — no new `as any` casts
- Write changelogs when bumping versions
- "task list" refers to admin/data/tasks.json, not CC tasks
- [Add any conversation-specific preferences]

## Admin Dashboard

If running (check: curl -s http://localhost:5175/__admin_exec/status), post completion notes:

    curl -s -X POST http://localhost:5175/__admin_session/note \
      -H 'Content-Type: application/json' \
      -d '{"id":"SESSION_ID","text":"[Auto] Agent completed: <summary>"}'

Session ID: [paste the active session ID]
```

## What to Omit

- Don't paste the entire plan — just the summary + this task's full text
- Don't include architectural notes for systems the task won't touch
- Don't include file boundaries if the task is the only parallel agent (sequential execution)
- Don't include known issues if there are none

## What to Always Include

Even if it seems obvious:
- **Plan rationale** (why, not just what)
- **File allowlist** (for parallel dispatch)
- **Design intent** (what "good" looks like)
- **User preferences** (agents don't have memory access)
- **Session ID** (so the agent can report back to the dashboard)
