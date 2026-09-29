# TASK-36: Cloud Functions Scheduled Triggers Investigation

**Date:** 2026-04-07
**Status:** Resolved -- triggers ARE firing correctly

## Summary

Investigation into whether the 4 scheduled Cloud Functions are actually executing. **Finding: all 4 scheduled functions are deployed and firing on schedule.** The initial concern was unfounded.

## What Was Checked

### 1. Functions Deployment Status

Ran `firebase functions:list --project luminal-game`. All 4 scheduled functions are deployed:

| Function | Trigger | Region | Runtime |
|---|---|---|---|
| cleanupStaleLobbies | scheduled | us-central1 | nodejs20 |
| cleanupStaleMatches | scheduled | us-central1 | nodejs20 |
| monitorHealth | scheduled | us-central1 | nodejs20 |
| monitorPlayerCount | scheduled | us-central1 | nodejs20 |

Plus 11 other functions (callable, RTDB triggers, Firestore triggers).

### 2. Function Logs Confirm Execution

All 4 functions show consistent invocation logs:

- **cleanupStaleLobbies** -- firing every 10 minutes (confirmed entries from 00:22 through 04:42 UTC on 2026-04-07)
- **monitorHealth** -- firing every 5 minutes (confirmed entries from 03:01 through 05:16 UTC)
- **monitorPlayerCount** -- firing every 5 minutes (confirmed entries from 03:01 through 04:01 UTC)
- **cleanupStaleMatches** -- firing every 6 hours (confirmed entries at 06:15, 12:15, 18:15 on 2026-04-05, and 00:15 on 2026-04-06)

### 3. Source Code Review

`functions/src/index.ts` properly exports all 4 with valid `onSchedule` configs:

- `cleanupStaleLobbies`: `schedule: 'every 10 minutes'`, `timeoutSeconds: 120`
- `cleanupStaleMatches`: `schedule: 'every 6 hours'`, `timeoutSeconds: 300`
- `monitorHealth`: `schedule: 'every 5 minutes'`, `secrets: [discordBotToken]`
- `monitorPlayerCount`: `schedule: 'every 5 minutes'`, `secrets: [discordBotToken]`

### 4. Build Verification

`npm run build` in `functions/` completes cleanly. Build output in `functions/lib/` is current (dated 2026-04-07).

### 5. firebase.json Configuration

Functions config is present and correct:

```json
"functions": [{
  "source": "functions",
  "codebase": "default",
  "predeploy": ["npm --prefix \"$RESOURCE_DIR\" run build"]
}]
```

## Why Logs Appear Empty

The log entries for `cleanupStaleLobbies`, `monitorHealth`, and `monitorPlayerCount` show empty `I` (info) lines. This is because:

1. **cleanupStaleLobbies** -- only logs when it actually purges lobbies. When no stale lobbies exist, it returns silently.
2. **monitorHealth/monitorPlayerCount** -- both check `isOverseerActive()` first and return early if the OVERSEER system is active. They also only log/alert when thresholds are breached.
3. **cleanupStaleMatches** -- this one DOES log on every run (`"cleanupStaleMatches triggered"`) and shows actual cleanup counts, confirming it works as expected.

## Deploy Script Gap (Noted)

`scripts/deploy.js` only runs `firebase deploy --only hosting`. It does NOT deploy functions. Functions must be deployed separately via:

```bash
cd functions && npm run deploy
# or
firebase deploy --only functions --project luminal-game
```

This is worth noting but is not the cause of the reported issue since functions are clearly deployed and running.

## Recommendations

1. **Add structured logging to all scheduled functions** -- even no-op runs should log something like `{"message":"cleanupStaleLobbies: no stale lobbies found"}` so execution is clearly visible in Cloud Logging.
2. **Consider adding functions to the deploy script** -- or at minimum document the separate deploy step. The `firebase.json` already has the functions config with predeploy build.
3. **No action needed on triggers** -- they are working correctly.
