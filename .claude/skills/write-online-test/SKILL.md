---
name: write-online-test:luminal
description: Write online browser tests for LUMINAL multiplayer. Auto-activates when creating tests for lobby, match, matchmaking, disconnect, or auth flows.
user_invocable: true
---

> **Convention:** Follow the ref system in `.claude/skills/_conventions/ref-system.md`. Test items use QA-N refs.

# Write Online Browser Test

Use when creating or modifying Playwright-based online multiplayer tests for LUMINAL.

**Triggers:** "online test", "browser e2e", "multiplayer test", "add a test for", "test scenario", "write a test"

## Helper API

### Auth — `src/e2e/browser/online/testAccounts.ts`

| Export | Signature | Notes |
|--------|-----------|-------|
| `TEST_ACCOUNTS` | `{ host, guest, spectator }` | Each has `email`, `password`, `username` |
| `signIn(page, role?)` | `(Page, TestRole?) => Promise<string>` | role defaults to `'host'`; returns username |
| `waitForAuth(page, timeoutMs?)` | `(Page, number?) => Promise<string>` | Waits for anon or real auth to settle |

### MatchFlow — `src/e2e/browser/online/matchFlow.ts`

The primary orchestration object for two-browser tests. Create one per test, call `setup()` then drive the scenario.

```typescript
const match = await createMatchFlow({ baseUrl: BASE_URL });
```

**Config** (`MatchFlowConfig`):
- `baseUrl` — `'http://localhost:5173'` (emulator) or `'https://luminal-game.web.app'` (live)
- `viewport?` — from `VIEWPORTS` (default: `desktop`)
- `seriesLength?` — number of rounds

**Object properties:**
- `match.hostPage` / `match.guestPage` — Playwright `Page` handles
- `match.hostCtx` / `match.guestCtx` — `BrowserContext` handles
- `match.browser` — host's `Browser` instance
- `match.lobbyId` — 6-char lobby code (populated after `setup()`)
- `match.consoleLogs` — all captured console entries from both browsers

**Methods:**

| Method | Returns | What It Does |
|--------|---------|-------------|
| `setup()` | `Promise<void>` | Launches two headed browsers, signs in host + guest, creates and joins lobby, waits for START to be enabled |
| `startMatch()` | `Promise<void>` | Host clicks START, waits for gameplay on both sides (up to 90s) |
| `waitForResult(timeoutMs?)` | `Promise<void>` | Drives host into wall, waits for commitRoundEnd or result screen (default 60s) |
| `getResultText()` | `Promise<{ host: string; guest: string }>` | Returns result text from both pages (falls back to NET log) |
| `clickRematch()` | `Promise<void>` | Both click rematch, waits for new countdown on both |
| `clickReturnToLobby()` | `Promise<void>` | Host clicks return, waits for lobby overlay + player list on both |
| `clickForfeit(page)` | `Promise<void>` | Opens pause (Escape) on given page, clicks forfeit, waits for result on both |
| `waitForDisconnectBanner(page, timeoutMs?)` | `Promise<void>` | Waits for disconnect banner visible (default 35s) |
| `getNetLogs()` | `ConsoleEntry[]` | Filters consoleLogs to `[NET]` entries only |
| `getNetcodeDiagnostics()` | `NetcodeDiagnostics` | Parses NET logs: winners agree, desync, hash mismatches, phase report |
| `dumpLogs()` | `void` | Prints all consoleLogs to stdout — call in catch block |
| `cleanup()` | `Promise<void>` | Closes all browsers/contexts |

### Infrastructure

```typescript
import { startEmulators, resetEmulatorState, stopEmulators } from '../online/emulator';
import { startRelay, stopRelay } from '../online/relay';
```

- `startEmulators()` — starts Firebase emulators (60s timeout)
- `resetEmulatorState()` — wipes emulator data between tests
- `stopEmulators()` / `startRelay()` / `stopRelay()` — lifecycle management

### Failure Capture — `src/e2e/browser/helpers/captureOnFailure.ts`

```typescript
import { capturePages } from '../helpers/captureOnFailure.js';

// In catch block:
await capturePages(
  [{ page: match.hostPage, label: 'host' }, { page: match.guestPage, label: 'guest' }],
  'test-name-for-filename',
);
```

Also exports `setupFailureCapture(getPage, getContext?)` for single-page suites (returns `{ before, after }` hooks).

### Bug Reporting — `src/e2e/browser/online/bugReporter.ts`

Optional — integrates with local admin dashboard when running.

```typescript
import { startTestSession, endTestSession, reportBug } from '../online/bugReporter';
```

- `startTestSession(suiteName)` — creates a session in admin dashboard (no-ops if dashboard not running)
- `endTestSession(hasFailures)` — marks session done
- `reportBug(report)` — posts failure note to dashboard + Firebase RTDB; always safe to call

## Selector Registry

All selectors live in `src/e2e/browser/online/actions/selectors.ts`. **Never hardcode a selector in a test file.** When UI changes, update `selectors.ts` — all tests auto-update.

## Checklist: Adding a New Test

0. **Health check** — Run `curl -sf http://localhost:5175/__admin_exec/status > /dev/null`. If unreachable, skip dashboard calls.
1. **Choose suite:**
   - Emulator: `src/e2e/browser/online-emulator/<name>.test.ts`
   - Live smoke: `src/e2e/browser/online-smoke/<name>.test.ts`
2. **Scaffold with `createMatchFlow()`** — see template below
3. **Call `setup()` → `startMatch()` → scenario actions → assertions**
4. **Always wrap the test body in try/catch** — call `match.dumpLogs()` and `capturePages()` before re-throwing
5. **New selector needed?** Add to `selectors.ts` first
6. **Run:** `npm run test:online` (emulator) or `npm run test:smoke` (live)

## Test File Template (Emulator)

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startEmulators, resetEmulatorState, stopEmulators } from '../online/emulator';
import { startRelay, stopRelay } from '../online/relay';
import { createMatchFlow, type MatchFlow } from '../online/matchFlow';
import { capturePages } from '../helpers/captureOnFailure.js';

const BASE_URL = 'http://localhost:5173';

describe('emulator: <scenario name>', () => {
  let match: MatchFlow;

  beforeAll(async () => {
    await startEmulators();
    await startRelay();
  }, 60_000);

  afterAll(async () => {
    await match?.cleanup();
    await stopRelay();
    await stopEmulators();
  });

  it('<test description>', async () => {
    await resetEmulatorState();
    match = await createMatchFlow({ baseUrl: BASE_URL });

    try {
      await match.setup();
      expect(match.lobbyId).toBeTruthy();

      await match.startMatch();
      await match.waitForResult();

      const result = await match.getResultText();
      expect(result.host).toBeTruthy();

      // Add scenario-specific assertions here

    } catch (err) {
      match.dumpLogs();
      await capturePages(
        [{ page: match.hostPage, label: 'host' }, { page: match.guestPage, label: 'guest' }],
        'emulator-<scenario-name>',
      );
      throw err;
    }
  });
});
```

## Promoting to Live Smoke

1. Copy to `src/e2e/browser/online-smoke/<name>.test.ts`
2. Remove `startEmulators`, `resetEmulatorState`, `stopEmulators`, `startRelay`, `stopRelay` imports + hooks
3. Change `BASE_URL` to `process.env.SMOKE_TARGET_URL ?? 'https://luminal-game.web.app'`
4. Run with `npm run test:smoke`

## Painful Lessons (Regression Rules)

These rules are derived from 13+ production bugs. Tests that violate these patterns historically broke in production.

1. **Never delete shared RTDB parent nodes from client code** — use server-side cleanup
2. **Collision detection for remote players must use their authoritative state** — not interpolated positions
3. **Multi-client reconciliation must use deterministic tie-breaking** — lexicographic UID, not insertion order
4. **Near-simultaneous events need debounce windows** — 300ms grace for draw detection
5. **Auth state must propagate to ALL auth types** — anonymous users included
6. **Stale listeners require 3-layer defense** — teardown + mode guards + callback guards
7. **Permission errors in cleanup paths cause silent desyncs** — validate all write rules
8. **Input delay recalculated between rounds only** — never mid-round
9. **Cleanup ownership: lexicographically smallest UID only** — prevents race conditions
10. **Heartbeat must mirror to RTDB** — Cloud Functions read heartbeat staleness from RTDB
11. **Imported functions must be called** — dead imports hide bugs
12. **DI failures should throw immediately** — not silently become undefined
13. **Vote reconciliation needs explicit deterministic sorting** — never rely on object iteration order

## Matrix-Aware Test Writing

When writing a test from the E2E coverage matrix (`admin/data/e2e-matrix.json`):

1. **Read matrix** — `curl -s http://localhost:5175/__admin_e2e_matrix` to find the test entry
2. **Check infra** — Does the test need new helpers?
3. **Write test** following the template above
4. **Run test** — `npx vitest run {file}`
5. **Update matrix** on success:
```bash
curl -X PATCH http://localhost:5175/__admin_e2e_matrix \
  -H 'Content-Type: application/json' \
  -d '{"id":"{ID}","status":"passing","lastRun":"'$(date -u +%FT%TZ)'","lastResult":"pass"}'
```
6. **Post note** to active session if one exists:
```bash
curl -X POST http://localhost:5175/__admin_session/note \
  -H 'Content-Type: application/json' \
  -d '{"id":"{sessionId}","text":"Implemented {ID}: {name} — passing"}'
```

### Post-Match Actions (MatchFlow methods)

| Action | Signature | What It Does |
|--------|-----------|-------------|
| `clickRematch()` | `Promise<void>` | Both players click rematch, waits for new countdown |
| `clickReturnToLobby()` | `Promise<void>` | Both return to lobby, verifies lobby state |
| `clickForfeit(page)` | `Promise<void>` | Player forfeits, waits for result on both |
| `waitForDisconnectBanner(page, timeoutMs?)` | `Promise<void>` | Waits for disconnect banner (default 35s) |

### Network Degradation (T1 Headless Only)

Available on `LoopbackTransport` for headless lockstep tests:

| Method | Signature | Effect |
|--------|-----------|--------|
| `setBurstLoss(count, intervalMs?)` | Drop N consecutive packets | Simulates burst packet loss |
| `setAsymmetricLatency(aToB, bToA)` | Different latency per direction | Tests asymmetric network |
| `setJitter(base, variance)` | base ± random(variance) per packet | Tests unstable connection |
| `degradeOverTime(start, end, ticks)` | Linear ramp over duration | Tests progressive degradation |

## Run Commands

```bash
npm run test:online              # Full emulator suite
npm run test:smoke               # Live smoke suite
npx vitest run src/e2e/browser/online-emulator/<file>.test.ts  # Single file
```

## Performance Collection

All online tests using `createMatchFlow()` automatically collect perf data via `BrowserPerfCollector`.

### Harvesting perf data

After `waitForResult()`, call:

```typescript
const perf = await flow.getPerfData();
```

The returned `PerfSnapshot` contains timing, network, and browser metrics.

### Asserting perf quality

For tests focused on performance, assert against the grade:

```typescript
import { analyze } from '../../perfAnalyzer';

const perf = await flow.getPerfData();
const grade = analyze(perf);
expect(grade.overall).not.toBe('F');
```

### Including perf in results

When writing custom result files, include the perf snapshot:

```typescript
const result = {
  // ...existing fields...
  perf,
};
```
