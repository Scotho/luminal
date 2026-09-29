---
name: overseer-log
description: Log results to the OVERSEER system after completing an investigation dispatched by the OVERSEER monitoring daemon
---

# OVERSEER Log Skill

When you have been dispatched by the OVERSEER monitoring system (the prompt will mention "OVERSEER" and contain finding details), you MUST log your results when done.

## When to Use

- After completing any investigation dispatched by OVERSEER
- After applying a fix for an OVERSEER-detected issue
- After determining a finding is a false positive

## How to Log

POST to the admin overseer log endpoint:

```bash
curl -s -X POST http://localhost:5175/__admin_overseer/log \
  -H 'Content-Type: application/json' \
  -d '{
    "domain": "<domain from the finding>",
    "action": "<claude-completed|auto-fixed>",
    "summary": "<what you found or fixed — under 200 characters>",
    "ref": "<ref from finding, e.g. BUG-14>",
    "incidentId": "<incident ID if provided>",
    "model": "claude-opus-4-6"
  }'
```

## Actions

- `claude-completed` — investigation done, findings reported, no code change
- `auto-fixed` — code fix applied on a branch

## Rules

- Always include the `ref` if one was provided in the dispatch
- Keep `summary` under 200 characters
- Include the branch name in `summary` if you created a fix branch
