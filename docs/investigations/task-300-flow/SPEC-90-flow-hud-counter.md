# SPEC-90: FLOW HUD Counter

> Part of TASK-300 FLOW system. Depends on SPEC-89 (core state). Consumed by SPEC-93/94/95 (character effects that modulate the counter).

## Summary

A persistent in-match HUD element that displays active FLOW, positioned directly above the boost/drift meter. It dynamically scales 1.0x–2.0x with elastic ease-out based on gain bursts, emits glow pulses on medium/high gains, and hosts character-specific trick-banking animations. Mobile-responsive; matches existing HUD conventions.

## File layout

```
src/partials/hud.html          # add #flow-hud element above #meter-wrap
src/styles/screens/hud.css     # extend with .flow-hud rules
src/ui/flowHUD.ts              # new — update function called from game._updateHUD
src/ui/__tests__/flowHUD.test.ts  # unit tests
src/game.ts                    # cache _elFlowHud, _elFlowValue; call updateFlowHUD
```

## DOM structure

Added to `src/partials/hud.html` immediately BEFORE `#meter-wrap`:

```html
<div id="flow-hud" class="flow-hud menu-hidden" aria-label="FLOW counter">
  <div class="flow-hud__label">FLOW</div>
  <div class="flow-hud__value-wrap">
    <div class="flow-hud__value" id="flow-hud-value">0</div>
    <div class="flow-hud__mult" id="flow-hud-mult"></div>
  </div>
  <div class="flow-hud__bank-layer" id="flow-hud-bank-layer"></div>
</div>
```

- `#flow-hud` — positioned fixed, bottom just above `#meter-wrap`
- `#flow-hud-value` — the number, swapped imperatively by `flowHUD.ts`
- `#flow-hud-mult` — shows current multiplier (`×3`, `×5`, `×10`) when non-1x
- `#flow-hud-bank-layer` — absolute overlay for floating `+X FLOW` tallies

## CSS (hud.css additions)

```css
/* FLOW HUD — positioned directly above #meter-wrap */
#flow-hud {
  position: fixed;
  left: 50%;
  bottom: 58px; /* #meter-wrap bottom:28px + bar 12px + label 12px + margin 6px */
  transform: translateX(-50%) scale(var(--ui-scale));
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
  font-family: 'Orbitron', sans-serif;
  --flow-scale: 1; /* JS-driven burst scale 1.0 → 2.0 */
  --flow-glow: 0;  /* JS-driven glow intensity 0 → 1 */
}

.flow-hud__label {
  font-size: 11px;
  letter-spacing: 4px;
  color: rgba(180, 240, 255, 0.6);
  margin-bottom: 2px;
  text-shadow: 0 0 6px rgba(120, 220, 255, calc(0.3 + var(--flow-glow) * 0.7));
}

.flow-hud__value-wrap {
  position: relative;
  display: flex;
  align-items: baseline;
  gap: 8px;
  transform: scale(var(--flow-scale));
  transform-origin: center bottom;
  transition: transform 280ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
}

.flow-hud__value {
  font-size: 28px;
  font-weight: 600;
  color: #c9f5ff;
  letter-spacing: 2px;
  text-shadow:
    0 0 8px rgba(120, 220, 255, calc(0.5 + var(--flow-glow) * 0.5)),
    0 0 20px rgba(80, 200, 255, calc(0.2 + var(--flow-glow) * 0.6));
  font-variant-numeric: tabular-nums;
}

.flow-hud__mult {
  font-size: 14px;
  color: #ffcc66;
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity 220ms ease-out;
  text-shadow: 0 0 8px rgba(255, 180, 60, 0.7);
}
.flow-hud__mult.active { opacity: 1; }
.flow-hud__mult.tier-3 { color: #ff7744; text-shadow: 0 0 12px rgba(255, 100, 40, 0.9); }
.flow-hud__mult.tier-10 { color: #ff3388; text-shadow: 0 0 14px rgba(255, 60, 140, 1); }

/* Bank layer — floating +X FLOW tallies */
.flow-hud__bank-layer {
  position: absolute;
  left: 50%;
  top: -30px;
  transform: translateX(-50%);
  pointer-events: none;
}

.flow-bank {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 18px;
  font-weight: 600;
  color: #88ffcc;
  letter-spacing: 1px;
  text-shadow: 0 0 10px rgba(100, 255, 180, 0.8);
  animation: flow-bank-collapse 520ms cubic-bezier(0.3, 0, 0.6, 1) forwards;
}

.flow-bank--drift   { color: #ff88ee; text-shadow: 0 0 10px rgba(255, 120, 220, 0.8); }
.flow-bank--slipstream { color: #88ccff; text-shadow: 0 0 10px rgba(100, 180, 255, 0.8); }
.flow-bank--grind   { color: #ffcc44; text-shadow: 0 0 10px rgba(255, 200, 60, 0.8); }

@keyframes flow-bank-collapse {
  0%   { transform: translate(-50%, -8px) scale(1);    opacity: 1; }
  60%  { transform: translate(-50%, 10px) scale(1.1);  opacity: 1; }
  100% { transform: translate(-50%, 24px) scale(0.6);  opacity: 0; }
}

/* Mobile scaling — follows #meter-bar pattern */
@media (max-width: 600px) {
  #flow-hud { bottom: 52px; }
  .flow-hud__value { font-size: clamp(18px, 5vw, 24px); }
  .flow-hud__label { font-size: clamp(9px, 2vw, 10px); }
}
```

The `cubic-bezier(0.2, 0.9, 0.3, 1.2)` matches existing grindComboHUD easing for a consistent elastic overshoot.

## Behavior (flowHUD.ts)

```typescript
interface FlowHudElements {
  wrap: HTMLElement;
  value: HTMLElement;
  mult: HTMLElement;
  bankLayer: HTMLElement;
}

interface FlowHudLocal {
  displayedValue: number;
  targetValue: number;
  scaleAnim: number;  // 1.0 base
  glowAnim: number;   // 0 base
  lastTier: 0 | 1 | 2 | 3;
  spawnedBankIds: Set<number>;
}

export function initFlowHUD(els: FlowHudElements): void;
export function updateFlowHUD(snapshot: FlowSnapshot, dtMs: number): void;
export function resetFlowHUD(): void;
```

### Update loop (called every frame from `game._updateHUD`)

```
1. Compute tween: displayedValue → targetValue (lerp k=0.25 per frame)
2. Write `value.textContent = Math.round(displayedValue).toLocaleString()`
3. If snapshot.lastGainAt > 0 and (now - lastGainAt) < 600ms:
     burstAmount = snapshot.lastGainAmount
     if burstAmount >= 80 → target scale 1.8, glow 1.0 (HIGH)
     else if burstAmount >= 25 → target scale 1.4, glow 0.6 (MEDIUM)
     else → target scale 1.1, glow 0.3 (PASSIVE)
   Otherwise scale → 1.0, glow → 0 (decay at 6/sec)
4. Write CSS variables: --flow-scale, --flow-glow
5. Multiplier display:
     if snapshot.multiplier > 1:
       mult.textContent = '×' + snapshot.multiplier
       mult.className = 'flow-hud__mult active' + tier class
     else:
       remove .active
6. Process pending banks:
     for each pending bank in snapshot.pendingBanks not in spawnedBankIds:
       spawn .flow-bank child with +X text, class based on source
       remove after 520ms animation end
       mark spawnedBankIds
```

### State flow diagram

```
sim tick → flowState.tick...() → updates active, lastGainAmount, lastGainAt
             │
game._updateHUD() each frame:
  snapshot = flowState.getSnapshot()
  updateFlowHUD(snapshot, dtMs)
             │
             ├─► lerp displayedValue toward snapshot.active
             ├─► compute burst scale/glow from lastGainAmount
             ├─► render new pendingBanks as floating elements
             └─► trigger commit on each bank after animation ends
```

## Character-specific HUD behavior

The HUD itself is character-agnostic. Character-specific styling is a set of flags passed in the snapshot (or read from `game.state.character`):

- **SPECTRE active slipstream**: HUD gains a subtle horizontal speed-line decoration (pseudo-element with `::after`). See SPEC-93 for slipstream phase styling.
- **SLINGSHOT active drift**: Bank spawns use `.flow-bank--drift` class (magenta), collapse animation gets a slight horizontal slide (spec: "tick-down/slide").
- **VECTOR active grind**: The main value element gains class `.flow-glitch` that triggers the SPEC-95 glitch shader effect. Bank collapse is a "glitch disintegration".

`flowHUD.ts` exposes:

```typescript
export function setFlowHudCharacterState(kind: 'spectre' | 'slingshot' | 'vector' | null): void;
```

called by game when round starts with the current character.

## Game integration points

In `src/game.ts`:

1. Cache DOM refs in constructor:
```typescript
this._elFlowHud = document.getElementById('flow-hud')!;
this._elFlowValue = document.getElementById('flow-hud-value')!;
this._elFlowMult = document.getElementById('flow-hud-mult')!;
this._elFlowBankLayer = document.getElementById('flow-hud-bank-layer')!;
initFlowHUD({ wrap: this._elFlowHud, value: this._elFlowValue, mult: this._elFlowMult, bankLayer: this._elFlowBankLayer });
```

2. In `_updateHUD()` (line ~645):
```typescript
updateFlowHUD(getSnapshot(this._flowState), dtMs);
```

3. In round start hook:
```typescript
resetFlowHUD();
setFlowHudCharacterState(vehicleKindToCharacter(currentVehicle));
```

## Visibility rules

- Hidden during menus, character select, result screen (via `.menu-hidden` class, follows existing #meter-wrap pattern).
- Shown when match is active, at round start.
- Hidden immediately on death (crossed-out presentation is in the round-end screen, not the in-match HUD).
- Spectator mode: shown with `opacity: 0.5` to avoid implying the spectator can earn FLOW.

## Testing plan

Unit tests (jsdom):

1. `initFlowHUD` caches refs without error.
2. `updateFlowHUD` with snapshot{active:100} → value textContent becomes "100".
3. Large gain (80+) within 600ms → scale var becomes >= 1.8.
4. Snapshot with multiplier 5 → mult element gets `.active`, `.tier-3` classes.
5. Pending bank appears → child `.flow-bank` element created.
6. `resetFlowHUD` → displayedValue goes to 0, bank layer cleared.
7. Decay: no gain for 600ms → scale returns to 1.0, glow to 0.

## Accessibility

- `aria-label="FLOW counter"` on `#flow-hud`
- `role="status"` so screen readers announce value changes on tier-up only (too frequent otherwise)
- Reduced motion: `@media (prefers-reduced-motion: reduce)` clamps scale to 1.0, disables burst animation, keeps numeric updates.

## What this spec does NOT cover

- Scoring math → SPEC-89
- Round end presentation → SPEC-91
- Persistence → SPEC-92
- SPECTRE-specific phase overlays → SPEC-93
- Tire streak VFX → SPEC-94
- Glitch shader details → SPEC-95
