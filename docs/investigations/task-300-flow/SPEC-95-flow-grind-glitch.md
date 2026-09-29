# SPEC-95: VECTOR Grind Glitch Effect

> Part of TASK-300 FLOW system. Depends on SPEC-89 (flow state) + SPEC-90 (HUD counter). DOM-based glitch effect on the FLOW counter while VECTOR is grinding.

## Summary

While VECTOR is actively grinding, the FLOW counter gains a "glitch" effect: number digits fragment and recombine, with sustained subtle oscillation that intensifies with grind duration. Also drives the trick banking animation for grind-sourced pending banks (disintegration → reassembly collapse). Implementation is **CSS + DOM manipulation**, not a shader — the FLOW counter is a DOM element and glitch effects are cheap in CSS.

## File layout

```
src/effects/grindGlitch.ts         # DOM effect driver (new, ~150 lines)
src/styles/screens/hud.css         # extend with .flow-glitch rules
src/ui/flowHUD.ts                  # hook into setFlowHudCharacterState
src/ui/__tests__/grindGlitch.test.ts
```

## Visual design

Two layered effects:

1. **Sustained oscillation** — while grinding, the FLOW counter number digits pulse and shift very slightly with per-digit phase offsets. Low-amplitude, always present during grind.

2. **Fragment/recombine on bank** — when a grind "pending bank" tally is spawned (SPEC-89/90), instead of the standard "collapse into counter" animation, digits of the banked value fragment outward, rotate, and recombine into the main counter.

3. **Intensity scaling** — as grind duration grows, oscillation amplitude increases subtly. Tied to `grindDuration` uniform from game state.

## CSS implementation (hud.css extension)

```css
/* ── VECTOR glitch sustained oscillation ────────────────────── */

.flow-hud--vector .flow-hud__value {
  /* Per-digit glitch via pseudo-elements stacked with clip-path */
  position: relative;
}

.flow-hud--vector .flow-hud__value::before,
.flow-hud--vector .flow-hud__value::after {
  content: attr(data-value);
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  font-variant-numeric: tabular-nums;
}

.flow-hud--vector .flow-hud__value::before {
  color: #ff4488;
  text-shadow: 0 0 6px rgba(255, 80, 150, 0.8);
  clip-path: polygon(0 0, 100% 0, 100% 45%, 0 45%);
  animation: vector-glitch-top var(--vector-glitch-speed, 3s) steps(1) infinite;
  opacity: var(--vector-glitch-amp, 0.4);
}

.flow-hud--vector .flow-hud__value::after {
  color: #44ccff;
  text-shadow: 0 0 6px rgba(80, 200, 255, 0.8);
  clip-path: polygon(0 55%, 100% 55%, 100% 100%, 0 100%);
  animation: vector-glitch-bottom var(--vector-glitch-speed, 2.6s) steps(1) infinite;
  opacity: var(--vector-glitch-amp, 0.4);
}

@keyframes vector-glitch-top {
  0%, 92%, 100% { transform: translateX(0); }
  93%  { transform: translateX(-2px); }
  94%  { transform: translateX(3px); }
  95%  { transform: translateX(-1px); }
  96%  { transform: translateX(2px); }
  97%  { transform: translateX(0); }
}

@keyframes vector-glitch-bottom {
  0%, 88%, 100% { transform: translateX(0); }
  89%  { transform: translateX(2px); }
  90%  { transform: translateX(-3px); }
  91%  { transform: translateX(1px); }
  92%  { transform: translateX(-2px); }
  93%  { transform: translateX(0); }
}

/* Sustained low-amplitude jitter on the main number */
.flow-hud--vector .flow-hud__value {
  animation: vector-main-jitter 240ms steps(6) infinite;
  animation-play-state: var(--vector-glitch-running, running);
}
@keyframes vector-main-jitter {
  0%, 100% { transform: translate(0, 0); }
  16% { transform: translate(0.3px, -0.1px); }
  33% { transform: translate(-0.2px, 0.2px); }
  50% { transform: translate(0.1px, 0.3px); }
  66% { transform: translate(-0.3px, -0.1px); }
  83% { transform: translate(0.2px, 0.2px); }
}

/* ── Fragment/recombine bank animation ──────────────────────── */

.flow-bank--grind {
  display: flex;
  gap: 0;
  /* Digits will be wrapped in <span> children by JS */
}
.flow-bank--grind > span {
  display: inline-block;
  animation: grind-bank-fragment 600ms cubic-bezier(0.3, 0.1, 0.4, 1) forwards;
  animation-delay: calc(var(--digit-index, 0) * 60ms);
  color: #ffcc44;
  text-shadow: 0 0 8px rgba(255, 200, 60, 0.9);
}
@keyframes grind-bank-fragment {
  0% {
    transform: translate(var(--burst-x, 0), var(--burst-y, 0)) rotate(var(--burst-rot, 0));
    opacity: 1;
  }
  55% {
    transform: translate(calc(var(--burst-x, 0) * 1.5), calc(var(--burst-y, 0) * 1.5 - 6px)) rotate(var(--burst-rot, 0));
    opacity: 0.9;
  }
  100% {
    transform: translate(0, 12px) rotate(0);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .flow-hud--vector .flow-hud__value::before,
  .flow-hud--vector .flow-hud__value::after,
  .flow-hud--vector .flow-hud__value,
  .flow-bank--grind > span {
    animation: none !important;
  }
}
```

## JS driver (grindGlitch.ts)

```typescript
export interface GrindGlitchState {
  isActive: boolean;
  duration: number; // seconds grinding continuously
}

export function enterGrindGlitch(flowHudWrap: HTMLElement): void {
  flowHudWrap.classList.add('flow-hud--vector');
}

export function exitGrindGlitch(flowHudWrap: HTMLElement): void {
  flowHudWrap.classList.remove('flow-hud--vector');
}

export function updateGrindGlitchIntensity(
  flowHudWrap: HTMLElement,
  duration: number
): void {
  // 0s grind → amp 0.35
  // 10s grind → amp 0.7
  // 20s+ → amp cap 0.9
  const amp = Math.min(0.9, 0.35 + duration * 0.027);
  flowHudWrap.style.setProperty('--vector-glitch-amp', amp.toFixed(2));
  // Speed gets faster with duration too
  const speed = Math.max(1.4, 3 - duration * 0.08);
  flowHudWrap.style.setProperty('--vector-glitch-speed', `${speed.toFixed(2)}s`);
}

// Value sync: the pseudo-elements use attr(data-value), so the main updater
// must keep data-value in sync with textContent.
// This is handled by flowHUD.ts writing both simultaneously.
```

The `::before` and `::after` read from `data-value` attribute, so the render path needs to write that attribute whenever it writes `textContent`:

```typescript
// In flowHUD.ts update loop
value.textContent = formatted;
value.setAttribute('data-value', formatted);
```

Both pseudo-element layers then reflect the same current number with clip-path offset bands.

## Fragment bank animation

When a grind bank spawns with source='grind', `flowHUD.ts` creates the `.flow-bank--grind` element and populates it with one `<span>` per digit. Each span gets CSS variables for a random burst vector:

```typescript
function createGrindBankElement(amount: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flow-bank flow-bank--grind';
  const text = '+' + amount.toLocaleString();
  for (let i = 0; i < text.length; i++) {
    const span = document.createElement('span');
    span.textContent = text[i];
    span.style.setProperty('--digit-index', String(i));
    // Random burst direction per digit
    const angle = (Math.random() - 0.5) * Math.PI; // -90° to +90°
    const radius = 18 + Math.random() * 12;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius - 10;
    span.style.setProperty('--burst-x', `${x.toFixed(1)}px`);
    span.style.setProperty('--burst-y', `${y.toFixed(1)}px`);
    span.style.setProperty('--burst-rot', `${(Math.random() - 0.5) * 20}deg`);
    wrap.appendChild(span);
  }
  return wrap;
}
```

Each digit fragments in its own direction, holds briefly, then collapses back toward the counter center — a "disassemble → reassemble" feel. Total duration: ~600ms.

## Integration with flowHUD.ts

```typescript
// flowHUD.ts — when character changes to vector
if (character === 'vector') {
  wrap.classList.add('flow-hud--vector');
} else {
  wrap.classList.remove('flow-hud--vector');
}

// Per frame
if (gameState.isGrinding) {
  updateGrindGlitchIntensity(wrap, gameState.grindDuration);
}

// When bank of source='grind' spawns
if (bank.source === 'grind') {
  bankLayer.appendChild(createGrindBankElement(bank.amount));
} else {
  bankLayer.appendChild(createStandardBankElement(bank));
}
```

## Game state feed

`game.ts` exposes `grindDuration` (seconds) from the grind sim state. Read from `player._grindTimer` or similar — check current naming in `simGrind.ts`.

## Accessibility

- `@media (prefers-reduced-motion: reduce)` disables all glitch animations (defined inline above).
- Screen readers continue to receive the primary text content (pseudo-elements are decorative and ignored).
- Color contrast: the pseudo-element layers use distinct hues but the main number remains high-contrast against the background.

## Performance

- Pure CSS animations — zero JS overhead per frame.
- Pseudo-elements: 2 extra per counter (fixed cost).
- No new textures or shaders.
- Bank fragment animation: ≤10 extra DOM nodes, lifetime 600ms. Negligible.

## Testing plan

Unit tests (`grindGlitch.test.ts`, jsdom):

1. `enterGrindGlitch(wrap)` → `.flow-hud--vector` class added.
2. `exitGrindGlitch(wrap)` → class removed.
3. `updateGrindGlitchIntensity(wrap, 0)` → `--vector-glitch-amp: 0.35`.
4. `updateGrindGlitchIntensity(wrap, 20)` → `--vector-glitch-amp: 0.89`.
5. Grind-source bank creates `.flow-bank--grind` with N child spans for N-character amount.
6. Each span has `--digit-index` and burst vector CSS variables set.

Manual:

1. Play as VECTOR, grind → FLOW counter gains glitch layer.
2. Sustained grind → glitch amplitude visibly increases.
3. End grind → glitch stops, counter returns to normal styling.
4. Bank spawn on grind end → digits fragment and collapse.

## What this spec does NOT cover

- Scoring → SPEC-89
- Main HUD counter layout → SPEC-90
- Round-end presentation → SPEC-91
- Persistence → SPEC-92
- Slipstream VFX → SPEC-93
- Tire streaks → SPEC-94
