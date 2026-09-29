# TASK-300: FLOW System Implementation Plan

> Master plan for the FLOW system. Links: [SPEC-89](./SPEC-89-flow-core-scoring.md) · [SPEC-90](./SPEC-90-flow-hud-counter.md) · [SPEC-91](./SPEC-91-flow-round-end.md) · [SPEC-92](./SPEC-92-flow-persistence.md) · [SPEC-93](./SPEC-93-flow-slipstream-vfx.md) · [SPEC-94](./SPEC-94-flow-tire-streaks.md) · [SPEC-95](./SPEC-95-flow-grind-glitch.md)

## Scope recap

Replace per-character special scoring with a **unified FLOW system** that:
- accumulates in-match (SPEC-89 + SPEC-90)
- is presented at round end (SPEC-91)
- banks to a persistent account currency (SPEC-92)
- has character-specific VFX (SPEC-93/94/95)
- feeds a new leaderboard category (SPEC-92)
- is cosmetic-only (no pay-to-win) — pricing spec deferred

## Dependency graph

```
         ┌──────────────────┐
         │ SPEC-89 flowState│  (pure logic, no deps)
         └────────┬─────────┘
                  │
        ┌─────────┼─────────────────┐
        ▼         ▼                 ▼
 SPEC-90 HUD  SPEC-91 round-end  SPEC-92 persistence
        │         │                 │
        │         │                 │
        ▼         ▼                 │
 ┌──────────────────────────┐       │
 │ SPEC-93 slipstream       │       │
 │ SPEC-94 tire streaks     │       │
 │ SPEC-95 grind glitch     │       │
 └──────────────────────────┘       │
        │                           │
        └───────────┬───────────────┘
                    ▼
              verification + commit
```

## Execution phases

### Phase 1 — Foundation (serial, must be first)

1. **FOUND-1: Scoring module** (SPEC-89)
   - `src/flow/flowState.ts`, `flowTuning.ts`, `flowMultiplier.ts`, `flowTypes.ts`
   - Vitest unit tests (10 tests in SPEC-89 testing plan)
   - No game integration yet — pure logic
   - **Blocks**: everything else

2. **FOUND-2: HUD shell** (SPEC-90 without animations)
   - DOM element in `hud.html`
   - Base CSS (no elastic scaling yet)
   - `flowHUD.ts` stub with `updateFlowHUD` that just writes text
   - Game loop wiring: `game._updateHUD` calls `updateFlowHUD(snapshot)`
   - **Blocks**: HUD animation polish, character VFX hooks

### Phase 2 — Core gameplay integration (serial after Phase 1)

3. **CORE-1: Sim hooks for passive FLOW**
   - Extend `simDrift.ts` + `simGrind.ts` + `lockstepProximity.ts` to call `tickPassive`
   - 0.25s tick cadence via per-player accumulator
   - Verify in dev: all 3 characters generate FLOW at spec rates

4. **CORE-2: Bonus flow hooks**
   - Elimination: hook in `gameCollisions.ts` kill path
   - Survival: per-frame tick in `game._updateHUD`
   - Boost: per-frame tick when `player._dashing`
   - Near-miss: deferred (optional per SPEC-89)

5. **CORE-3: Round lifecycle**
   - Hook `beginRound` / `endRound` into existing round start/end
   - Read current match streak for multiplier snapshot
   - Clear flow state between rounds

### Phase 3 — Presentation (partially parallel after CORE)

These can run in parallel after Phase 2 because they touch different files:

6. **PRES-1: HUD polish** (SPEC-90 complete)
   - Elastic scale animation
   - Glow pulse states
   - Bank spawn layer with collapse animations
   - `setFlowHudCharacterState` switcher
   - Mobile responsive rules

7. **PRES-2: Round-end reveal** (SPEC-91)
   - `flowReveal.ts` orchestration
   - CSS keyframes for log/subtotal/mult/total
   - Insertion into `roundResultFlow.ts` waterfall
   - Skip/fast-forward logic
   - Died state crossed-out styling

### Phase 4 — Character VFX (fully parallel after Phase 3)

8. **VFX-SPECTRE: Slipstream phases** (SPEC-93)
   - Phase state machine
   - Chromatic aberration effect pass
   - Tunnel shader effect
   - Audio low-pass integration
   - Magnetic alignment control changes

9. **VFX-SLINGSHOT: Tire streaks** (SPEC-94)
   - `tireStreaks.ts` InstancedMesh system
   - `tireStreakShader.ts` custom shader
   - Drift intensity detection
   - Spawn hook in `simDrift.ts`
   - Cleanup on round/match transitions

10. **VFX-VECTOR: Grind glitch** (SPEC-95)
    - CSS glitch layer rules
    - `grindGlitch.ts` DOM driver
    - Bank fragment/recombine animation
    - Wired via `setFlowHudCharacterState('vector')`

### Phase 5 — Persistence (parallel to Phase 4, no overlap)

11. **PERSIST-1: Profile schema** (SPEC-92)
    - Extend `UserProfile` interface
    - Update `fetchProfile()` defaults
    - Firestore rules lockdown for flow fields

12. **PERSIST-2: Cloud Function award** (SPEC-92)
    - New `functions/src/flowAward.ts`
    - Extend `updateLeaderboard()` to call it
    - Rate limiting + bounds checking
    - AI/offline reconciliation via `claimLocalFlow` callable

13. **PERSIST-3: Client reporting** (SPEC-92)
    - `src/flow/flowSubmit.ts` → `onlineMatches/{matchId}/flowReports/{uid}`
    - Hook into `matchSubmit.ts`
    - Local mode: localStorage fallback

14. **PERSIST-4: Leaderboard metric** (SPEC-92)
    - Extend `LeaderboardEntry` type
    - `LB_METRIC_HEADERS` + query support
    - New stats pill in `stats.html`
    - `leaderboardUI.ts` click handler
    - Firestore index added

15. **PERSIST-5: User dropdown** (SPEC-92)
    - DOM entries in `topbar.html`
    - CSS styles
    - `updateAccountFlowDisplay()` helper
    - Called on profile refresh + match end

### Phase 6 — Verification

16. **VERIFY-1: Unit tests pass** — `npm test`
17. **VERIFY-2: Lint clean** — `npm run lint`
18. **VERIFY-3: TypeScript build** — `npm run build`
19. **VERIFY-4: Manual playthrough** — all 3 characters, verify FLOW accumulates/banks/shows up in leaderboard
20. **VERIFY-5: Existing tests not regressed** — scene.test.ts, gridArena.test.ts, etc.

### Phase 7 — Finish

21. **FINISH-1: Conventional commits** — grouped per phase
22. **FINISH-2: Session closure** — update admin, post completion note

## Parallelization strategy

Phases 1 and 2 are **serial** — they define the foundation.

Phases 3, 4, 5 can run in **parallel** via subagent dispatch:
- Track A: PRES-1 + PRES-2 (HUD polish + round-end reveal)
- Track B: VFX-SPECTRE + VFX-SLINGSHOT + VFX-VECTOR (three independent subagents)
- Track C: PERSIST-1→5 (persistence stack, mostly independent of game code)

Phase 6 is serial aggregation.

The `superpowers:dispatching-parallel-agents` skill is appropriate for Phases 3-5 since each task touches distinct files with minimal overlap.

## Risk register

| Risk | Mitigation |
|------|------------|
| Grind combo HUD + FLOW counter overlap visually | Spec: grindComboHUD stays but shows "trick chain" only; FLOW is the scoring authority |
| Slipstream control changes break existing muscle memory | P1 keeps current passive boost; new phased ability *adds* instead of replaces — revisit after playtest |
| Tire streak material conflicts with floor reflector | Render tire streaks AFTER reflector pass, disable reflection contribution |
| Cloud Function trust boundary — client reports FLOW amounts | Hard cap per round, participant verification, rate limiting — all in SPEC-92 |
| Existing SPEC-82 grind score diverges from FLOW | Keep grind score → meter regen (unchanged). Add FLOW as parallel accumulator. No conflict because they bank to different systems. |
| `filter: drop-shadow` perf cost for slipstream glow | Fallback: apply filter only to HUD overlay, not full screen |
| Mobile layout regressions on new FLOW counter | Use clamp() pattern matching existing #meter-bar responsive rules |

## Acceptance criteria

- [ ] All 7 specs referenced and implemented
- [ ] `npm test`, `npm run lint`, `npm run build` pass
- [ ] New tests in `src/flow/__tests__/` cover flowState (>90% line coverage)
- [ ] New tests for flowHUD, flowReveal, tireStreaks, grindGlitch (smoke + behavior)
- [ ] No new `as any` casts introduced
- [ ] All files under 400 lines
- [ ] Conventional commits with SPEC-89..95 refs in commit messages
- [ ] Admin session phase progression visible in dashboard
- [ ] Manual playthrough confirms:
  - FLOW counter visible in match
  - Accumulates at correct rates per character
  - Elimination adds 125 FLOW
  - Multiplier applies at round-end
  - Banked FLOW appears in user dropdown
  - Leaderboard "LIFETIME FLOW" tab functional

## Deferred follow-ups

- Cosmetic shop / pricing spec (next in pipeline)
- Near-miss detection and +40 bonus
- Seasonal reset mechanism (schema reserved)
- Replay-based server-side FLOW re-simulation (current: bounded client trust)
- Offline AI match reconciliation beyond basic `claimLocalFlow`
- FLOW refund/credit on disconnect
