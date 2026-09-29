---
name: verify-bug:luminal
description: Write a test to reproduce and verify a bug, then track it through fix and verification. Auto-activates on "verify bug", "reproduce bug", "write a bug test", "confirm the bug".
user_invocable: true
---

> **Convention:** Follow the ref system in `.claude/skills/_conventions/ref-system.md`. Bugs get `BUG-N` refs. Commits use `fix: BUG-N description`.

# Verify Bug

Write a targeted test to reproduce a reported bug, confirm it fails, track the fix through the admin panel, and verify the fix passes. Chooses the right test tier automatically based on the bug's nature.

## Invocation

- `/verify-bug <description>` — full workflow (classify, write test, confirm, track)
- `/verify-bug --check <id>` — re-run an existing bug verification test by ID
- `/verify-bug --list` — show all tracked bug tests and their status

## Workflow

### Step 0: Parse & Classify

Read the bug description. Classify into one of these tiers:

| Bug Domain | Test Tier | When to Use |
|-----------|-----------|-------------|
| **sim** | Unit (Vitest + jsdom) | Physics, collision, grind, meter, speed, game state math |
| **net** | Headless E2E (ScenarioRunner) | Desync, hash mismatch, lockstep timing, disconnect recovery |
| **flow** | Browser E2E (Playwright + emulators) | Lobby, auth, matchmaking, UI flows, button interactions |
| **visual** | Browser screenshot (Playwright) | CSS bugs, layout, responsive, visual regressions |

**Classification signals:**
- Mentions "desync", "hash", "lockstep", "out of sync", "packet" → `net`
- Mentions "lobby", "matchmaking", "login", "auth", "queue", "disconnect" → `flow`
- Mentions "CSS", "layout", "responsive", "overlapping", "z-index", "position" → `visual`
- Mentions physics, speed, collision, grind, meter, boost, trail, death → `sim`
- When in doubt, prefer the simpler tier (sim > net > flow > visual)

### Step 1: Admin Session

Check admin health and create a bugfix session:

```bash
curl -s http://localhost:5175/__admin_exec/status
```

If admin is up, create session:
```bash
curl -s -X POST http://localhost:5175/__admin_session \
  -H 'Content-Type: application/json' \
  -d '{"summary":"Bug: <short description>","type":"bugfix","status":"active","section":"current-stack","phases":["reproduce","fix","verify"],"plan":"<full bug description + verification criteria>"}'
```

Save the session ID.

### Step 2: Write the Failing Test

Write a test file based on the classified tier. The test MUST:
1. Set up the exact conditions described in the bug
2. Assert the EXPECTED (correct) behavior
3. FAIL in the current codebase (proving the bug exists)
4. Include clear comments explaining what the bug is and what correct behavior looks like

**File locations by tier:**

| Tier | Directory | Naming |
|------|-----------|--------|
| sim | `src/core/__tests__/bugs/` | `<bug-slug>.test.ts` |
| net | `src/e2e/__tests__/bugs/` | `<bug-slug>.e2e.test.ts` |
| flow | `src/e2e/browser/online-emulator/bugs/` | `<bug-slug>.test.ts` |
| visual | `src/e2e/browser/bugs/` | `<bug-slug>.test.ts` |

Create the `bugs/` subdirectory if it doesn't exist.

#### Sim Test Template

```typescript
// src/core/__tests__/bugs/<slug>.test.ts
// Bug: <description>
// Verification: <what passing means>

import { describe, it, expect } from 'vitest';
// import relevant modules...

describe('Bug: <short description>', () => {
  it('should <expected correct behavior>', () => {
    // Setup: recreate the exact conditions
    // Act: trigger the buggy behavior
    // Assert: what SHOULD happen (test fails until bug is fixed)
  });
});
```

#### Net Test Template

```typescript
// src/e2e/__tests__/bugs/<slug>.e2e.test.ts
// Bug: <description>
// Verification: <what passing means>

import { describe, it, expect } from 'vitest';
import { ScenarioRunner } from '../../scenarioRunner';
import { ScriptedInputDriver } from '../../inputDrivers/scriptedInputDriver';
// ... other imports

describe('Bug: <short description>', () => {
  it('should <expected correct behavior>', async () => {
    const runner = new ScenarioRunner({
      name: 'bug-<slug>',
      // configure scenario to reproduce the bug
    });
    const result = await runner.run();
    // Assert correct behavior
  });
});
```

#### Flow Test Template

Use the patterns from the `write-online-test` skill. Key imports:

```typescript
import { createMatchFlow } from '../online/matchFlow';
import { startEmulators, resetEmulatorState, stopEmulators } from '../online/emulator';
import { startRelay, stopRelay } from '../online/relay';
import { capturePages } from '../helpers/captureOnFailure';
```

#### Visual Test Template

```typescript
import { test, expect } from '@playwright/test';

test('Bug: <description>', async ({ page }) => {
  await page.goto('http://localhost:5173');
  // Navigate to the buggy screen
  // Take screenshot and assert visual state
  const screenshot = await page.screenshot();
  // or check specific element properties
  const el = page.locator('<selector>');
  await expect(el).toBeVisible();
  // Assert CSS properties, position, etc.
});
```

### Step 3: Run the Test

Run ONLY the bug test file (not the full suite):

| Tier | Command |
|------|---------|
| sim | `npx vitest run src/core/__tests__/bugs/<slug>.test.ts` |
| net | `npx vitest run --config vitest.e2e.config.ts src/e2e/__tests__/bugs/<slug>.e2e.test.ts` |
| flow | `npx vitest run --config vitest.online.config.ts src/e2e/browser/online-emulator/bugs/<slug>.test.ts` |
| visual | `npx playwright test src/e2e/browser/bugs/<slug>.test.ts` |

**Expected outcome:** The test SHOULD FAIL. This confirms the bug is real and reproducible.

### Step 4: Record in Admin

Save the bug test to `admin/data/bug-tests.json`:

```bash
curl -s http://localhost:5175/__admin_save?file=bug-tests.json \
  -H 'Content-Type: application/json' \
  -d '<updated bug-tests.json content>'
```

**Bug test entry format:**
```json
{
  "id": "bug_<timestamp>",
  "slug": "<slug>",
  "description": "<full bug description>",
  "criteria": "<what passing means>",
  "tier": "sim|net|flow|visual",
  "testFile": "<path to test file>",
  "sessionId": "<admin session ID>",
  "status": "confirmed|fixed|wont-fix|cannot-reproduce",
  "created": "<ISO 8601>",
  "confirmedAt": "<ISO 8601 or null>",
  "fixedAt": null,
  "lastRun": "<ISO 8601>",
  "lastResult": "fail|pass"
}
```

**Status transitions:**
- `confirmed` — test written and fails (bug is real)
- `cannot-reproduce` — test was written but passes (bug not reproducible)
- `fixed` — test now passes after code changes
- `wont-fix` — acknowledged but not fixing

Update the session with a note:

```bash
curl -s -X POST http://localhost:5175/__admin_session/note \
  -H 'Content-Type: application/json' \
  -d '{"id":"<session-id>","text":"Bug confirmed: test <slug> fails as expected. File: <path>"}'
```

Mark the reproduce phase done:
```bash
curl -s -X PATCH http://localhost:5175/__admin_session/phase \
  -H 'Content-Type: application/json' \
  -d '{"id":"<session-id>","index":0,"done":true}'
```

### Step 5: Report to User

Report the findings:

```
Bug confirmed: <description>

Test: <file path>
Tier: <sim|net|flow|visual>
Status: FAILING (bug reproduced)
Session: <session ID>

Verification criteria: <what passing means>

The test is tracked in the admin panel. When you fix the bug,
run `/verify-bug --check <id>` to confirm the fix.
```

**If the test PASSES** (bug cannot be reproduced):

```
Bug NOT reproduced: <description>

The test I wrote passes, meaning the described behavior doesn't
occur under the conditions I tested. Possible explanations:
- The bug is intermittent / race condition
- The reproduction steps need refinement
- The bug was already fixed

Test file: <path> (kept for reference, status: cannot-reproduce)
```

### Step 6: Autonomous Mode

If the user said "proceed autonomously" or "fix it":

1. After confirming the bug (Step 4), immediately investigate the root cause
2. Read the relevant source code, trace the bug
3. Implement the fix
4. Re-run the bug test — it should now PASS
5. Run the full test suite for that tier to check for regressions
6. Update the bug-tests.json entry: `status: "fixed"`, `fixedAt: <now>`, `lastResult: "pass"`
7. Update session: mark fix phase done, add note with fix description
8. Commit with `fix(<scope>): <description>`

## Re-checking a Bug Test

`/verify-bug --check <id>`

1. Load bug-tests.json, find entry by ID
2. Run the test file
3. If PASS: update status to "fixed", set fixedAt, update lastResult
4. If FAIL: update lastRun/lastResult, report still failing
5. Update session note

## Listing Bug Tests

`/verify-bug --list`

1. Load bug-tests.json
2. Display table: ID | Description | Tier | Status | Last Result | Last Run

## Conventions

1. **One bug = one test file** in the `bugs/` subdirectory
2. **Test names start with "Bug:"** for easy grep identification
3. **Comments explain the bug** — future developers should understand what was wrong
4. **Tests are permanent** — even after fixing, the test stays as a regression guard
5. **Minimal scope** — test ONLY the buggy behavior, don't test surrounding features
6. **Import from existing helpers** — use mockGame, mockFirebase, setupDom, MatchFlow etc.
7. **No new dependencies** — use Vitest (unit/e2e) or Playwright (browser) only
