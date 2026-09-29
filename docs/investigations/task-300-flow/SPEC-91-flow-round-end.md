# SPEC-91: FLOW Round-End Presentation

> Part of TASK-300 FLOW system. Depends on SPEC-89 (core state/RoundResult), extends existing `roundResultFlow.ts` infrastructure.

## Summary

A choreographed reveal that plays on the result screen: trick log entries pop in sequentially, subtotal + multiplier reveal, then the final FLOW amount lands with a scale/glow impact moment. On death, shows a crossed-out tally and fast-forwards. Integrates with existing result screen without replacing its structure.

## File layout

```
src/partials/gameplay.html        # add #flow-reveal block inside #result .content
src/styles/screens/results.css    # .flow-reveal styles
src/ui/flowReveal.ts              # orchestration + DOM animations (new)
src/modes/roundResultFlow.ts      # call playFlowReveal() in waterfall sequence
src/ui/__tests__/flowReveal.test.ts
```

## DOM structure (gameplay.html)

Inserted inside `#result .content`, immediately after `#result-text`:

```html
<div id="flow-reveal" class="flow-reveal hidden">
  <div class="flow-reveal__trick-log" id="flow-reveal-log"></div>
  <div class="flow-reveal__subtotal">
    <span class="flow-reveal__subtotal-label">SUBTOTAL</span>
    <span class="flow-reveal__subtotal-value" id="flow-reveal-subtotal">0</span>
  </div>
  <div class="flow-reveal__mult hidden" id="flow-reveal-mult">
    <span class="flow-reveal__mult-streak" id="flow-reveal-mult-streak">3+ STREAK</span>
    <span class="flow-reveal__mult-x" id="flow-reveal-mult-x">×3</span>
  </div>
  <div class="flow-reveal__total">
    <span class="flow-reveal__total-label">FLOW</span>
    <span class="flow-reveal__total-value" id="flow-reveal-total">0</span>
  </div>
</div>
```

On death (`died=true`), the parent gains `.flow-reveal--died` which renders a diagonal strike-through on subtotal/total.

## CSS (results.css additions)

```css
.flow-reveal {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin: 18px 0;
  min-width: 360px;
  font-family: 'Orbitron', sans-serif;
}

.flow-reveal.hidden { display: none; }

/* Trick log — sequential pop-in */
.flow-reveal__trick-log {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.flow-reveal__log-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 4px 12px;
  background: rgba(20, 40, 60, 0.4);
  border-left: 2px solid rgba(120, 220, 255, 0.6);
  opacity: 0;
  transform: translateX(-12px);
  animation: flow-log-pop 280ms cubic-bezier(0.2, 0.9, 0.3, 1.2) forwards;
  font-variant-numeric: tabular-nums;
}

.flow-reveal__log-label {
  font-size: 12px;
  letter-spacing: 3px;
  color: rgba(200, 230, 255, 0.75);
}
.flow-reveal__log-value {
  font-size: 14px;
  color: #cceeff;
}
.flow-reveal__log-row[data-kind="elimination"] { border-left-color: #ff6644; }
.flow-reveal__log-row[data-kind="drift"]       { border-left-color: #ff88ee; }
.flow-reveal__log-row[data-kind="slipstream"]  { border-left-color: #88ccff; }
.flow-reveal__log-row[data-kind="grind"]       { border-left-color: #ffcc44; }

@keyframes flow-log-pop {
  to { opacity: 1; transform: translateX(0); }
}

/* Subtotal */
.flow-reveal__subtotal {
  display: flex;
  gap: 12px;
  align-items: baseline;
  font-size: 18px;
  opacity: 0;
  transition: opacity 300ms ease-out;
}
.flow-reveal__subtotal.visible { opacity: 1; }
.flow-reveal__subtotal-label { letter-spacing: 4px; color: rgba(180, 210, 230, 0.7); }
.flow-reveal__subtotal-value { color: #dff2ff; font-variant-numeric: tabular-nums; }

/* Multiplier reveal */
.flow-reveal__mult {
  display: flex;
  gap: 16px;
  font-size: 22px;
  letter-spacing: 3px;
  opacity: 0;
  transform: scale(0.6);
  animation: flow-mult-impact 500ms cubic-bezier(0.2, 0.9, 0.3, 1.3) forwards;
}
.flow-reveal__mult.hidden { display: none; }
.flow-reveal__mult-streak { color: #ffcc66; text-shadow: 0 0 12px rgba(255, 200, 80, 0.8); }
.flow-reveal__mult-x      { color: #ff8844; text-shadow: 0 0 16px rgba(255, 140, 60, 1); }
.flow-reveal__mult.tier-3 .flow-reveal__mult-x { color: #ff4488; text-shadow: 0 0 20px rgba(255, 80, 160, 1); }

@keyframes flow-mult-impact {
  0% { opacity: 0; transform: scale(0.6); }
  50% { opacity: 1; transform: scale(1.25); }
  100% { opacity: 1; transform: scale(1); }
}

/* Final total */
.flow-reveal__total {
  display: flex;
  gap: 18px;
  align-items: baseline;
  font-size: 42px;
  letter-spacing: 4px;
  opacity: 0;
  transform: scale(0.7);
}
.flow-reveal__total.revealed {
  animation: flow-total-impact 700ms cubic-bezier(0.15, 0.8, 0.3, 1.2) forwards;
}
.flow-reveal__total-label { font-size: 24px; color: rgba(180, 220, 255, 0.7); letter-spacing: 6px; }
.flow-reveal__total-value {
  color: #88ffcc;
  font-weight: 600;
  text-shadow:
    0 0 14px rgba(120, 255, 200, 0.8),
    0 0 32px rgba(80, 220, 160, 0.5);
  font-variant-numeric: tabular-nums;
}

@keyframes flow-total-impact {
  0%   { opacity: 0; transform: scale(0.7); filter: brightness(0.7); }
  40%  { opacity: 1; transform: scale(1.5); filter: brightness(2); }
  65%  { transform: scale(0.95); }
  80%  { transform: scale(1.08); }
  100% { opacity: 1; transform: scale(1); filter: brightness(1); }
}

/* Death state */
.flow-reveal--died .flow-reveal__subtotal-value,
.flow-reveal--died .flow-reveal__total-value {
  color: rgba(200, 200, 200, 0.4);
  text-decoration: line-through;
  text-decoration-thickness: 3px;
  text-decoration-color: #ff4444;
  text-shadow: none;
}
.flow-reveal--died .flow-reveal__mult { display: none; }

@media (prefers-reduced-motion: reduce) {
  .flow-reveal * { animation: none !important; transition: none !important; opacity: 1 !important; transform: none !important; }
}
```

## Orchestration (flowReveal.ts)

```typescript
export interface FlowRevealTiming {
  logStagger: number;   // ms between trick log rows
  logToSubtotal: number;
  subtotalToMult: number;
  multToTotal: number;
  totalHold: number;
  dieTotal: number;     // total duration in died fast-forward mode
}

export const FLOW_REVEAL_TIMING_WIN: FlowRevealTiming = {
  logStagger: 140,
  logToSubtotal: 260,
  subtotalToMult: 420,
  multToTotal: 560,
  totalHold: 900,
  dieTotal: 0,
};

export const FLOW_REVEAL_TIMING_DEATH: FlowRevealTiming = {
  logStagger: 40,
  logToSubtotal: 80,
  subtotalToMult: 0,
  multToTotal: 80,
  totalHold: 200,
  dieTotal: 600,
};

export function playFlowReveal(result: RoundResult, bankedPre: number, bankedPost: number): Promise<void>;
export function resetFlowReveal(): void;
```

### Sequence (won)

```
t=0        show container, clear log
t=0        begin log pop sequence:
             each trick log row emitted with stagger=140ms
             row text format: "SLIPSTREAM  +240" etc.
t=N*140    log complete, wait logToSubtotal (260ms)
t=+260     fade in subtotal, count up from 0 → passiveSubtotal + bonusSubtotal
           (counter animates over 400ms)
t=+420     show multiplier reveal (cubic elastic scale-in)
           if multiplier === 1, SKIP this step
t=+560     show final total, begin flow-total-impact animation
           final value counts up from 0 → awarded in 500ms with easing
t=+900     hold on final value, allow existing result buttons to receive focus
```

### Sequence (died)

```
t=0   show container with .flow-reveal--died class
t=0   render all log rows at once (no stagger)
t=80  show crossed-out subtotal immediately
t=160 show crossed-out "FLOW 0" final
t=600 reveal complete, existing result flow proceeds
```

This respects the spec's **skip logic**: death fast-forwards, win gets full animation.

## Integration with roundResultFlow.ts

Current flow (simplified):

```
showResultScreen() {
  frame1: show text + duration
  frame2: show streak + radar + buttons
  frame3: start background replay
}
```

New insertion point: between frame1 and frame2 of the existing waterfall, OR as a parallel element. **Preferred**: wedge `playFlowReveal()` after frame1 fade-in completes and before frame2 streak/radar — this matches the dramatic pacing.

```typescript
// roundResultFlow.ts — showResultScreenWaterfall()
await showFrame1();
await playFlowReveal(roundResult, bankedBefore, bankedAfter);
await showFrame2();
await showFrame3();
```

If `playFlowReveal` rejects or throws, fall back to `resetFlowReveal()` + immediate frame2 (logged as a warning — never block the result screen on FLOW).

## Trick log ordering & consolidation

From `RoundResult.trickLog`, order rows as:
1. Eliminations (if any) — e.g. `ELIMINATION x3  +375`
2. Slipstream total (if > 0)
3. Drift total (if > 0)
4. Grind total (if > 0)
5. Boost total (if > 0)
6. Survival (always shown last)

Rows with amount=0 are suppressed. Eliminations with count=1 display as `ELIMINATION  +125`.

## Banked FLOW teaser (optional)

After the total lands, show a small transient row:

```
BANKED FLOW  12,340 → 13,040   (+700)
```

This is a **nice-to-have**, not required. Gated behind `FLOW_REVEAL_SHOW_BANK_TEASER` constant in `flowTuning.ts` — defaults to false, can be enabled if it feels right in playtest.

## Input handling

- During `playFlowReveal`, user input on "continue" button is buffered (button is `disabled` until totalHold completes).
- If the player presses the universal "skip/continue" action mid-reveal (Enter/Space/Gamepad A), the reveal fast-forwards to final state (clears all timeouts, shows final total immediately).

```typescript
// Inside flowReveal.ts
let skipRequested = false;
export function requestSkipFlowReveal() { skipRequested = true; }
```

The existing result screen continue button should call `requestSkipFlowReveal()` first. On death, reveal is already fast; this mostly matters for wins.

## Audio cues (optional)

- Log row pop: reuse existing UI tick (short cyan ping)
- Multiplier impact: reuse "charge-up" cue
- Final total: reuse "score flash" or existing victory sub-cue

All gated behind audio preference — reuse existing `playUISound()` helper. Do NOT ship new audio assets in P1.

## Testing plan

Unit tests (jsdom, mocked timers):

1. `playFlowReveal(winResult)` → eventually sets final value text correctly.
2. `playFlowReveal(deathResult)` → container gets `.flow-reveal--died`, no multiplier shown.
3. `requestSkipFlowReveal()` mid-sequence → final state realized within 1 frame.
4. Multiplier = 1 → multiplier element never shown.
5. Empty trick log → no rows rendered, but subtotal + total still play.
6. `resetFlowReveal()` → container hidden, classes cleared.

Integration test: simulate full round → roundResultFlow.ts → playFlowReveal → assert DOM has final total element visible.

## Performance

- Trick log spawns O(6) DOM nodes max. No concern.
- Animations use CSS transitions/keyframes, not JS raf loops.
- Count-up on subtotal/total uses a single rAF-driven lerp (lightweight).

## What this spec does NOT cover

- Scoring math → SPEC-89
- In-match HUD counter → SPEC-90
- Persistence → SPEC-92
- Character VFX → SPEC-93/94/95
