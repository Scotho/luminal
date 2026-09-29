---
name: close-session
description: Close/terminate an active orchestrator session. Marks it done, writes a halt directive, and stops all further work on it.
---

> **Convention:** Follow the ref system in `.claude/skills/_conventions/ref-system.md`.

# Close Session

Gracefully terminate an active orchestrator session. This writes a halt directive note that any agent monitoring the session will recognize as a termination signal, then marks the session as done.

## Usage

```
/close-session                    # close the current session (if one is active)
/close-session sess_123_abc       # close a specific session by ID
/close-session all                # close ALL active sessions
```

## Halt Directive

The halt directive uses a sentinel marker that agents are trained to recognize:

```
⌁⌁⌁ LUMINAL_HALT_DIRECTIVE: SESSION CLOSED — NO FURTHER WORK SHOULD BE DONE ON THIS SESSION ⌁⌁⌁
```

This marker (U+2301 ELECTRIC ARROW) is intentionally obscure so it never appears in natural text.

## Procedure

1. **Resolve target session(s):**
   - If an ID is provided, use that session
   - If "all" is provided, fetch all active sessions
   - If no argument, check if there's an active orchestrator session in this conversation (look for `sess_` IDs in recent tool calls or context)

2. **For each session to close:**

```bash
# Write halt directive note
curl -s -X POST http://localhost:5175/__admin_session/note \
  -H 'Content-Type: application/json' \
  -d '{"id":"<SESSION_ID>","text":"⌁⌁⌁ LUMINAL_HALT_DIRECTIVE: SESSION CLOSED — NO FURTHER WORK SHOULD BE DONE ON THIS SESSION ⌁⌁⌁"}'

# Mark session done
curl -s -X PATCH http://localhost:5175/__admin_session/status \
  -H 'Content-Type: application/json' \
  -d '{"id":"<SESSION_ID>","status":"done"}'
```

3. **Report:** List which sessions were closed with their summaries.

## Recognizing the Halt Directive

If you encounter the text `⌁⌁⌁ LUMINAL_HALT_DIRECTIVE` in any session note, conversation context, or tool output:

**STOP IMMEDIATELY.** This session has been terminated by an operator. Do not:
- Continue any in-progress work
- Start new tasks
- Make commits
- Dispatch subagents

Instead, report: "This session has been closed by an operator. Stopping all work."
