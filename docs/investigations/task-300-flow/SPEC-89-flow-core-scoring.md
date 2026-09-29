# SPEC-89: FLOW Core Scoring & State

> Part of TASK-300 FLOW system. Sibling specs: SPEC-90 (HUD counter), SPEC-91 (round-end), SPEC-92 (persistence), SPEC-93 (slipstream VFX), SPEC-94 (tire streaks), SPEC-95 (grind glitch).

## Summary

A pure-logic module that accumulates in-match FLOW, applies a streak multiplier tier at round end, enforces caps, and exposes state for the HUD/round-end UI. No DOM, no Firebase — those live in sibling specs. This module must be fully unit-testable with deterministic output.

## File layout

```
src/flow/
  flowState.ts        # core accumulator + API (this spec)
  flowTuning.ts       # all tunable constants (passive rates, bonuses, caps)
  flowMultiplier.ts   # streak → multiplier tier mapping
  flowTypes.ts        # shared types
  __tests__/
    flowState.test.ts
    flowMultiplier.test.ts
```

Co-locating in `src/flow/` keeps the module under 400 lines per file and lets unit tests import without pulling in DOM/game code.

## Public API (flowState.ts)

```typescript
export interface FlowSnapshot {
  active: number;         // current accumulated FLOW this round
  passiveSubtotal: number;
  bonusSubtotal: number;
  tierIndex: 0 | 1 | 2 | 3;
  multiplier: number;     // 1 | 3 | 5 | 10
  capState: 'open' | 'soft' | 'hard';
  lastGainAmount: number; // for HUD burst scale
  lastGainAt: number;     // performance.now() when last gain
  pendingBanks: PendingBank[]; // unbanked trick tallies
}

export interface PendingBank {
  id: number;
  amount: number;
  source: 'drift' | 'slipstream' | 'grind';
  spawnedAt: number;
}

export interface TrickLogEntry {
  kind: 'drift' | 'slipstream' | 'grind' | 'elimination' | 'boost' | 'survival';
  amount: number;
  count?: number; // for fold-up (e.g. "3 eliminations")
}

export interface RoundResult {
  passiveSubtotal: number;
  bonusSubtotal: number;
  subtotal: number;
  multiplier: number;
  tierIndex: number;
  awarded: number;       // floor((passive + bonus) * multiplier), 0 if died
  capApplied: 'none' | 'soft' | 'hard';
  died: boolean;
  trickLog: TrickLogEntry[];
}

export function createFlowState(): FlowState;
export function beginRound(state: FlowState, matchStreakTier: 0|1|2|3, now: number): void;
export function tickPassive(state: FlowState, source: 'slipstream' | 'grind' | 'drift-low' | 'drift-med' | 'drift-high', now: number): void;
export function tickSurvival(state: FlowState, dtSec: number, now: number): void;
export function tickBoost(state: FlowState, dtSec: number, now: number): void;
export function awardElimination(state: FlowState, now: number): void;
export function awardNearMiss(state: FlowState, now: number): void;
export function spawnPendingBank(state: FlowState, source: 'drift' | 'slipstream' | 'grind', amount: number, now: number): number;
export function commitPendingBank(state: FlowState, id: number, now: number): void;
export function endRound(state: FlowState, outcome: 'won' | 'died'): RoundResult;
export function getSnapshot(state: FlowState): Readonly<FlowSnapshot>;
export function _resetForTesting(state: FlowState): void;
```

The `_resetForTesting` hook follows the existing pattern from `src/ui/__tests__/helpers/`.

## Tuning constants (flowTuning.ts)

```typescript
// Tick cadence
export const FLOW_TICK_INTERVAL_SEC = 0.25;

// Passive rates (per second)
export const FLOW_PASSIVE_RATE = {
  slipstream: 20,  // SPECTRE
  grind: 20,       // VECTOR
  driftLow: 12,    // SLINGSHOT low intensity
  driftMed: 15,    // SLINGSHOT med intensity
  driftHigh: 18,   // SLINGSHOT high intensity
} as const;

// Per-tick values (derived: rate * FLOW_TICK_INTERVAL_SEC)
// 20/sec → 5, 12/sec → 3, 15/sec → 4, 18/sec → 5 (rounded toward spec values)
export const FLOW_TICK_AMOUNT = {
  slipstream: 5,
  grind: 5,
  'drift-low': 3,
  'drift-med': 4,
  'drift-high': 5,
} as const;

// Bonus flow
export const FLOW_BONUS = {
  elimination: 125,
  survivalPerSec: 3,
  boostPerSec: 8,
  nearMiss: 40,
} as const;

// Caps
export const FLOW_SOFT_CAP = 2000;
export const FLOW_HARD_CAP = 2500;
// Above soft cap, apply √ compression until hard cap.
// Above hard cap, all further gains are zeroed.
```

A single `flowTuning.ts` file means the game-feel pass can touch one file to re-balance everything.

## Soft/hard cap implementation

```
if (active + gain <= SOFT_CAP) {
  active += gain;
} else if (active < HARD_CAP) {
  const over = (active + gain) - SOFT_CAP;
  const compressed = Math.sqrt(over * (HARD_CAP - SOFT_CAP));
  active = Math.min(HARD_CAP, SOFT_CAP + compressed);
} else {
  // hard cap — gain is lost
}
```

Compression means high performers still feel progress, but comically long runs can't snowball past 2500.

## Streak multiplier tiers (flowMultiplier.ts)

The existing match-streak system uses breakpoints `3 / 5 / 10 / 20` in `src/streak.ts`. Map these to FLOW multipliers:

| Streak range | Tier index | Multiplier | UI label |
|--------------|-----------|------------|----------|
| 0–2          | 0         | 1x         | `1+ STREAK` |
| 3–4          | 1         | 3x         | `3+ STREAK` |
| 5–9          | 2         | 5x         | `5+ STREAK` |
| 10+          | 3         | 10x        | `10+ STREAK` |

The existing 20-streak tier (STREAK_TIER_4) is absorbed into the 10x bucket — FLOW multipliers cap at 10x. That's intentional: the spec locks the ladder at four values.

```typescript
export function getFlowMultiplier(matchStreak: number): { tier: 0|1|2|3; multiplier: number } {
  if (matchStreak >= 10) return { tier: 3, multiplier: 10 };
  if (matchStreak >= 5)  return { tier: 2, multiplier: 5 };
  if (matchStreak >= 3)  return { tier: 1, multiplier: 3 };
  return { tier: 0, multiplier: 1 };
}
```

**Streak snapshot timing**: Tier is locked in at `beginRound()` using the player's current match-win streak. It does NOT update mid-match if the player wins/loses a round within a best-of series. This keeps the round-end reveal deterministic.

**Reset semantics**: `beginRound()` re-reads the streak, so losing a match naturally drops the tier for the next match. Within a best-of-N match, per-round deaths don't change tier — they just zero that round's FLOW.

## Round lifecycle

```
game.startRound() ──► beginRound(state, currentStreakTier, now)
                        ├─► clears passiveSubtotal / bonusSubtotal
                        ├─► clears pendingBanks
                        ├─► reads current match streak → locks multiplier
                        └─► emits event for HUD reset

per frame ──► sim hooks call:
              tickPassive(...)  // from simulation.ts character hooks
              tickSurvival(...) // every frame while alive
              tickBoost(...)    // every frame while dashing
              awardElimination(...) // on kill detection
              spawnPendingBank(...) // when a drift/slipstream/grind ends

game.endRound(result) ──► endRound(state, result)
                            ├─► if died → return RoundResult with awarded=0, died=true
                            └─► else → floor((passive + bonus) * multiplier), apply cap
```

## Passive tick accounting

Passive ticks use an accumulator + delta to avoid double-counting or drift:

```typescript
let passiveAccum = 0; // seconds since last tick
// per frame while in state
passiveAccum += dtSec;
while (passiveAccum >= FLOW_TICK_INTERVAL_SEC) {
  passiveAccum -= FLOW_TICK_INTERVAL_SEC;
  applyTick(state, source);
}
```

The caller owns `passiveAccum` and resets it when the state changes (e.g. exiting grind). One accumulator per source, so switching drift-low → drift-high mid-drift doesn't lose the partial tick.

## Bonus event handling

| Event | Handler | Amount source | Fires from |
|-------|---------|---------------|------------|
| Enemy elimination | `awardElimination` | `FLOW_BONUS.elimination` | `gameCollisions.ts` kill hook |
| Survival tick | `tickSurvival` | `FLOW_BONUS.survivalPerSec * dtSec` | `game.ts` `_updateHUD` |
| Boost tick | `tickBoost` | `FLOW_BONUS.boostPerSec * dtSec` | `game.ts` while player is dashing |
| Near miss (optional) | `awardNearMiss` | `FLOW_BONUS.nearMiss` | NOT wired in P1 — flagged as follow-up |

Near-miss detection requires new proximity-to-wall tracking — deferred to a follow-up task.

## Pending bank (trick banking)

When a special ends (drift released, slipstream exited, grind ended), the accumulated passive FLOW from that special is split:
- **Already counted**: the tick-based passive already landed in `active` during the special. We do NOT double-count.
- **Bank presentation**: `spawnPendingBank(source, tallyForThisStretch)` returns an ID. The HUD (SPEC-90) shows a floating `+X FLOW` for that tally with a character-specific animation. The HUD calls `commitPendingBank(id)` once the animation completes.

Because the tick already credited `active`, the "bank" is purely a *visual replay* of what was earned — it doesn't double-add to `active`. This avoids scoring bugs while still giving the satisfying `+X FLOW → counter pop` feedback loop.

**Alternative considered**: Defer all tick accounting until bank-commit. Rejected because it creates a visible lag between player input and counter updates, which violates principle #1 (responsiveness).

## Trick log accumulation

`endRound()` builds the trick log by walking the round's event history:

- Drift ticks → one entry per drift stretch with total
- Slipstream ticks → same
- Grind ticks → same
- Eliminations → fold into a single entry with `count`
- Boost seconds → one entry total
- Survival seconds → one entry total

The log is ordered roughly by spec order (drift/slipstream/grind/elim/boost/survival) for consistent round-end presentation. Individual events keep a timestamp for debug/replay but aren't exposed in the trick log.

## Testing plan

Unit tests (`flowState.test.ts`):

1. Fresh state → all subtotals zero, multiplier 1x.
2. `tickPassive('slipstream')` 4 times → active=20, passiveSubtotal=20.
3. 100 slipstream ticks with multiplier 5x → endRound(won) yields `floor((500+0)*5) = 2500` → hard cap applies: `awarded = HARD_CAP`.
4. Drift-low vs drift-high ticks have correct relative magnitudes.
5. `awardElimination` x3 → bonusSubtotal = 375.
6. Died mid-round → endRound returns `awarded=0`, `died=true`, subtotals preserved for crossed-out display.
7. Multiplier tier snapshot: `beginRound(state, 5)` → multiplier=5, unchanged by later streak changes.
8. Soft cap compression: gains past 2000 scale sub-linearly but don't exceed 2500.
9. Bank commit doesn't double-add to active.
10. `_resetForTesting` zeroes everything.

## What this spec does NOT cover

- DOM/HUD rendering → SPEC-90
- Round-end presentation UI → SPEC-91
- Firebase banked/lifetime persistence → SPEC-92
- Slipstream visual phases → SPEC-93
- Tire streaks → SPEC-94
- Grind glitch effect → SPEC-95
- Cosmetic pricing/shop → separate future spec

## Open questions (flagged for user review)

1. Should boost FLOW generate while the player also has slipstream/grind/drift active (double-dip), or only when those are not? Defaulting to **double-dip allowed** — it rewards combos.
2. Should match-end also award a "series win" bonus? Spec doesn't mention one. Defaulting to **no** — round totals feed the total.
3. Is the 20-streak tier genuinely absorbed into 10x, or should the ladder be extended? Defaulting to **absorbed** — spec locks 4 values.
