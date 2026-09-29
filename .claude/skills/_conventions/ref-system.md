# Ref System Convention

All work items use typed human-readable references. This convention MUST be followed by all skills that create sessions, tasks, commits, or notes.

## Ref Types

| Type | Use For | Examples |
|------|---------|---------|
| `TASK` | Features, code-hygiene, chores, dashboard work, infra | `TASK-12` |
| `BUG` | Defects, regressions, broken behavior | `BUG-3` |
| `QA` | Test coverage, e2e scenarios, test infrastructure | `QA-7` |
| `SPEC` | Design documents in `docs/superpowers/specs/` | `SPEC-28` |

## Getting a New Ref

```bash
curl -s -X POST http://localhost:5175/__admin_ref/next \
  -H 'Content-Type: application/json' \
  -d '{"type":"TASK"}'
# Returns: { "ref": "TASK-49", "counter": 49 }
```

Call this when creating new work items. The counter auto-increments atomically.

## Session Summary Format

Start every session summary with the primary ref:

```
TASK-47: Chassis Menu — testbed mockup
BUG-3: Fix grindSegT missing from trail-shift exit
```

Include `refs` array in session creation for machine queries:

```json
{ "summary": "TASK-47: Chassis Menu — testbed mockup", "refs": ["TASK-47"], ... }
```

## Commit Message Format

Place the ref after the conventional commit scope, before the description:

```
fix(sim): TASK-24 adjust grindSegIdx when trail shifts
feat(sfx): TASK-25 wire grind SFX triggers
test(grind): QA-7 add determinism test
fix(grind): BUG-3 missing grindSegT reset
```

## Dashboard Notes

Include refs in session notes:

```
Task 1/5 done: TASK-24 determinism test (spec: pass, quality: pass)
```

## Type Determination

- Building or improving something → `TASK`
- Something is broken → `BUG`
- Writing or expanding tests → `QA`
- Writing a design/spec document → `SPEC`

## Cross-References

Any item can reference any other via `refs: ["TASK-12", "SPEC-8"]`. A session working on a task refs that task. A bug found during a task refs that task.

## Spec File Naming

Spec files use their ref as prefix: `docs/superpowers/specs/SPEC-28-chassis-menu-wrapper-design.md`
