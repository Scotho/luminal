# SPEC-92: FLOW Persistence, Leaderboard & Account UI

> Part of TASK-300 FLOW system. Depends on SPEC-89 (round result amount). Server-authoritative; extends existing `updateLeaderboard()` Cloud Function.

## Summary

Introduces `bankedFlow` and `lifetimeFlow` fields on user profiles, wires round-end awards through the **server-side** arbitration path (Cloud Functions only — clients cannot write these fields), adds a new "Lifetime Flow" leaderboard metric, and displays both values in the account dropdown. Security model mirrors existing MMR update path.

## User profile schema extensions

**File**: `src/profile.ts` — extend `UserProfile` interface.

```typescript
export interface UserProfile {
  // ... existing fields
  bankedFlow?: number;     // spendable FLOW currency (cosmetics only)
  lifetimeFlow?: number;   // never decreases, used for leaderboard
  flowSeason?: number;     // current season for seasonal resets (future)
}
```

Both fields default to `0` when absent (server-side backfill on next award). The `flowSeason` field is reserved for a future seasonal reset mechanism — not wired in P1 but included in schema to avoid a migration later.

**File**: `src/profile.ts` — extend `fetchProfile()` to read these fields:

```typescript
return {
  // ... existing fields
  bankedFlow: data.bankedFlow ?? 0,
  lifetimeFlow: data.lifetimeFlow ?? 0,
  flowSeason: data.flowSeason ?? 1,
};
```

`updateProfile()` does NOT gain write access to flow fields — clients cannot update these directly.

## Firestore security rules (firestore.rules)

**Current**: `/users/{uid}` — self-write allowed with some field restrictions.

**Change**: Deny client writes to `bankedFlow`, `lifetimeFlow`, `flowSeason`. These can only be written by Cloud Functions (admin SDK bypasses rules).

```javascript
match /users/{userId} {
  // ... existing rules
  allow update: if request.auth != null
                && request.auth.uid == userId
                && !('bankedFlow' in request.resource.data.diff(resource.data).affectedKeys())
                && !('lifetimeFlow' in request.resource.data.diff(resource.data).affectedKeys())
                && !('flowSeason' in request.resource.data.diff(resource.data).affectedKeys());
}
```

A client that tries to self-award FLOW will get a permission-denied error. The Cloud Function using `admin.firestore()` bypasses rules entirely.

## Server-side award (Cloud Function)

**File**: `functions/src/index.ts`, function `updateLeaderboard()` (currently line 171-303).

Round-by-round FLOW is **computed on the client** (SPEC-89) and **reported to the server at match end** via an `onlineMatches/{matchId}/flowReports/{uid}` write. The Cloud Function:

1. Reads each player's reported `roundResults[]` from `onlineMatches/{matchId}/flowReports/{uid}`.
2. Sanity-bounds each round: `awarded = min(reported, FLOW_HARD_CAP)`.
3. Sums into match total.
4. Inside the same Firestore transaction that writes the leaderboard entry, also updates the user doc with `bankedFlow += matchTotal`, `lifetimeFlow += matchTotal`.

```typescript
// New helper in functions/src/flowAward.ts
export async function computeAndAwardFlow(
  tx: FirebaseFirestore.Transaction,
  uid: string,
  matchId: string,
  reportedResults: Array<{ round: number; awarded: number; died: boolean }>,
  seriesMultiplier: number, // server-verified from arbitrated winner count
): Promise<number> {
  const userRef = admin.firestore().collection('users').doc(uid);
  const userDoc = await tx.get(userRef);
  if (!userDoc.exists) return 0;

  const currentBanked = (userDoc.data()?.bankedFlow ?? 0) as number;
  const currentLifetime = (userDoc.data()?.lifetimeFlow ?? 0) as number;

  let matchTotal = 0;
  for (const r of reportedResults) {
    if (r.died) continue;
    const bounded = Math.min(Math.max(0, r.awarded), HARD_CAP_CONSTANT);
    matchTotal += bounded;
  }

  tx.update(userRef, {
    bankedFlow: currentBanked + matchTotal,
    lifetimeFlow: currentLifetime + matchTotal,
  });
  return matchTotal;
}
```

`HARD_CAP_CONSTANT = 2500` (mirrors `flowTuning.ts` — duplicated to avoid TS→JS cross-package dependency).

### Anti-cheat posture

Client reports are **bounded** (capped per round) but **trusted for composition** (the passive/bonus breakdown is not re-simulated server-side). The attack surface:

- A client reports max cap every round → they earn at most `rounds × 2500`. Upper bound per match ≈ 12,500.
- A client reports 1M → clamped to 2500.
- A client reports for a match they lost → still bounded; losing clients still earn passive FLOW per spec.
- A client reports for a nonexistent match → Cloud Function reads `/onlineMatches/{matchId}` first, rejects if missing.

**Server-authoritative check added**: The Cloud Function verifies `request.auth.uid` participated in the match (via `onlineMatches/{matchId}/players`), then cross-references `roundEnd` records to confirm the reported round count matches the arbitrated winner count. Mismatch → reject.

**Deferred to future spec**: full server-side FLOW simulation from replay. For P1, bounded-trust is acceptable because FLOW is cosmetic-only (no pay-to-win, no competitive impact).

**Rate limiting**: Cloud Function checks `users/{uid}.lastFlowAwardAt` — minimum 30s between awards (prevents replay farming). Field added to user doc.

## Client-side match-end reporting

**File**: `src/ui/matchSubmit.ts` — extend `submitMatch()`.

New helper:

```typescript
// src/flow/flowSubmit.ts
export async function submitFlowReports(
  matchId: string,
  uid: string,
  reports: RoundResult[],
): Promise<void>;
```

Writes to Firestore `onlineMatches/{matchId}/flowReports/{uid}`:

```json
{
  "reports": [
    { "round": 1, "awarded": 450, "died": false },
    { "round": 2, "awarded": 0,   "died": true  }
  ],
  "submittedAt": 1712345678901
}
```

This write happens BEFORE the Cloud Function `checkSeriesEnd` fires (which is what triggers `updateLeaderboard`). The Cloud Function reads `flowReports/` sub-collection as part of its work.

### Offline/AI matches

AI matches don't go through `onlineMatches/`. For offline:
- Client-side only: update localStorage `luminal-flow-local` with banked+lifetime (reconciles to server on next login).
- A cloud callable `claimLocalFlow` reconciles these at next sign-in with a max of 50K FLOW per claim to cap abuse.

**Deferred decision**: Should AI matches award server-persisted FLOW? The monetization memory flags this as plan-for-server-authoritative. For P1, **AI matches DO award FLOW** (reconciled via `claimLocalFlow`), but the per-day reconciliation cap is 10K to limit farming.

## New leaderboard metric: Lifetime Flow

**File**: `src/types/index.ts` — extend `LeaderboardEntry`:

```typescript
interface LeaderboardEntry {
  // ... existing fields
  lifetimeFlow?: number;
}
```

**File**: `src/leaderboard.ts` — extend `LB_METRIC_HEADERS`:

```typescript
export const LB_METRIC_HEADERS: Record<string, string> = {
  // ... existing
  lifetimeFlow: 'LIFETIME FLOW',
};
```

Add `lifetimeFlow` to valid metric types and extend `fetchLeaderboard()` to support it.

**Server-side**: `updateLeaderboard()` copies `lifetimeFlow` from the user doc into the leaderboard entry each match-end. This denormalization lets the leaderboard query sort by a single field without joins. Staleness is bounded to one match (acceptable).

**Firestore index**: new composite index on `leaderboard` collection:
```
series ASC, matchType ASC, lifetimeFlow DESC
```
added to `firestore.indexes.json`.

## UI: Stats metric pill

**File**: `src/partials/stats.html`:

```html
<span class="stats-metric-pill" data-metric="lifetimeFlow">LIFETIME FLOW</span>
```

Added to both `#stats-metric-pills` (desktop) and mobile metric list.

**File**: `src/ui/leaderboardUI.ts` — extend `initLeaderboardUI` to wire the new pill's click handler.

## UI: User dropdown entries

**File**: `src/partials/topbar.html` — add above sign-out:

```html
<div class="usm-item usm-item--flow-banked">
  <span class="usm-item-label">BANKED FLOW</span>
  <span class="usm-item-value" id="usm-banked-flow">—</span>
</div>
<div class="usm-item usm-item--flow-lifetime">
  <span class="usm-item-label">LIFETIME FLOW</span>
  <span class="usm-item-value" id="usm-lifetime-flow">—</span>
</div>
```

**File**: `src/styles/screens/topbar/user-menu.css` — styles for `.usm-item--flow-banked`, value alignment.

**Update helper**: `src/ui/topbarDropdown.ts` or new `src/ui/accountFlowDisplay.ts`:

```typescript
export function updateAccountFlowDisplay(banked: number, lifetime: number): void {
  const b = document.getElementById('usm-banked-flow');
  const l = document.getElementById('usm-lifetime-flow');
  if (b) b.textContent = banked.toLocaleString();
  if (l) l.textContent = lifetime.toLocaleString();
}
```

Called after any profile refresh (login, match end).

## Seasonal reset (forward-looking)

`flowSeason` field reserved for future use. P1 behavior: all users have `flowSeason: 1`, no reset logic. A future season bump will:
1. Archive current `lifetimeFlow` to `seasonArchive.season1.lifetimeFlow`.
2. Zero `bankedFlow` / `lifetimeFlow`.
3. Bump `flowSeason` to 2.

Not wired in P1 but schema accommodates it.

## Migration plan

- **No migration script needed**: `bankedFlow ?? 0` defaults handle missing fields.
- Existing users earn FLOW on their first post-deploy match.
- Leaderboard entries backfill `lifetimeFlow` on next update after deploy.

## Testing plan

**Unit tests**:
1. `fetchProfile()` with missing flow fields → returns 0 for both.
2. Leaderboard query with metric `lifetimeFlow` → includes field in result.
3. `updateAccountFlowDisplay(1234, 5678)` → DOM updated correctly.

**Cloud Function tests** (if harness exists):
1. Report with `awarded: 999999` → clamped to `HARD_CAP_CONSTANT`.
2. Report for nonexistent match → rejected.
3. Non-participant uid → rejected.
4. Rate limit: two awards within 30s → second rejected.

**Manual**:
1. Play a match → user doc shows new `bankedFlow` field.
2. Leaderboard Lifetime Flow pill → shows expected ordering.
3. Try to update `bankedFlow` via client SDK → rejected by rules.

## Firestore rules test

Add to `firestore-tests` (if it exists): attempt client write to `users/{uid}.bankedFlow` → should fail.

## Rollout plan

1. Deploy Cloud Functions first (no-op — clients aren't reporting yet).
2. Deploy firestore rules + indexes.
3. Deploy client that reports flow + reads flow.
4. First-match users see 0 until match completes.

## What this spec does NOT cover

- Cosmetic shop / spending mechanism — deferred to separate spec
- Seasonal reset mechanism — deferred
- Replay-based server-side FLOW simulation — deferred
- FLOW refund on match disconnect — punt to follow-up
