# SPEC-93: SPECTRE Slipstream Visual Phases

> Part of TASK-300 FLOW system. Depends on SPEC-89 (flow state) + SPEC-90 (HUD character hooks). Visual and control changes for SPECTRE's slipstream state.

## Summary

Introduces phased visual/audio ramp-up for SPECTRE's slipstream state: entry (0–0.3s, speed lines + UI glow + slight audio mute), lock-in (0.3–1.0s, tunnel effect + chromatic aberration + audio low-pass), activation (1.0s+, FLOW begins accumulating). Also introduces control changes: magnetic alignment to trail direction, wall repulsion disabled, exit snap-back. Reuses existing infrastructure wherever possible (`setAmbientDampen`, `playerVFX.createSpeedLines`, `pmndrs/postprocessing`).

## File layout

```
src/effects/slipstreamVFX.ts       # phase manager (new)
src/effects/chromaticAberration.ts # new pmndrs effect pass
src/shaders/slipstreamTunnel.ts    # tunnel shader (new)
src/core/simulation.ts             # wire slipstream phase to existing proximity
src/audio.ts                       # extend setAmbientDampen to support slipstream profile
src/ui/__tests__/slipstreamVFX.test.ts
```

## Phase state machine

```
IDLE
  │
  │ proximityBoost > threshold (0.3)
  ▼
ENTRY (0–0.3s)  ← phase start timestamp tracked
  │ dt >= 0.3s and still in proximity
  ▼
LOCK_IN (0.3–1.0s)
  │ dt >= 1.0s and still in proximity
  ▼
ACTIVE (FLOW ticks begin)
  │
  │ proximityBoost < threshold
  ▼
EXIT (0.15–0.25s)  ← magnetic alignment still active, resistance period
  │ dt > resistance window
  ▼
IDLE (snap-back fires once)
```

Implementation in `src/effects/slipstreamVFX.ts`:

```typescript
type SlipstreamPhase = 'idle' | 'entry' | 'lockIn' | 'active' | 'exit';

export interface SlipstreamPhaseState {
  phase: SlipstreamPhase;
  phaseStart: number;  // performance.now()
  proximityBoost: number;
  active: boolean;     // true if phase === 'active'
}

export function createSlipstreamPhaseState(): SlipstreamPhaseState;
export function updateSlipstreamPhase(
  state: SlipstreamPhaseState,
  proximityBoost: number,
  now: number
): SlipstreamPhase; // returns new phase
```

## Phase→effect mapping

| Phase    | Visual                                       | Audio                              | Control                            | FLOW |
|----------|----------------------------------------------|------------------------------------|------------------------------------|------|
| `idle`   | none                                         | normal                             | normal                             | no   |
| `entry`  | speed lines intensify, UI glow fade-in       | slight volume duck (−4dB)          | normal                             | no   |
| `lockIn` | speed lines peak, tunnel pulse, chromatic on | low-pass from 22050Hz → 2000Hz     | magnetic alignment ramps (0 → 1)   | no   |
| `active` | tunnel steady, chromatic steady, UI glow max | low-pass steady at 2000Hz          | magnetic alignment full, walls off | YES  |
| `exit`   | visuals decay (250ms), low-pass recovers     | low-pass 2000Hz → 22050Hz over 250 | magnetic alignment 1 → 0, walls on | no   |

## 1. Speed lines (existing, extended)

**Existing**: `src/playerVFX.ts` exports `SpeedLineSystem` with `createSpeedLines()` and `updateSpeedLines()`. Currently wired to dash state.

**Change**: Add an `intensity` multiplier to `updateSpeedLines()` so slipstream phase can drive it:

```typescript
export function updateSpeedLines(
  system: SpeedLineSystem,
  player: Player,
  dt: number,
  intensity: number = 1 // NEW — 0 during idle, 1 during lockIn/active
): void;
```

`slipstreamVFX.ts` computes intensity from phase (0 → 0.6 during entry → 1.0 during lockIn → 1.0 active → 0.5 during exit).

**Do NOT** create a second speed-line system. Extend the existing one.

## 2. UI glow overlay

**File**: `src/styles/screens/slipstream.css` (already exists — extend).

Add a body-level class `.slipstream-phase-entry`, `.slipstream-phase-lockin`, `.slipstream-phase-active`, toggled from `slipstreamVFX.ts`:

```css
body.slipstream-phase-entry   .screen-ingame { filter: drop-shadow(0 0 2px rgba(120, 220, 255, 0.3)); }
body.slipstream-phase-lockin  .screen-ingame { filter: drop-shadow(0 0 8px rgba(120, 220, 255, 0.6)); }
body.slipstream-phase-active  .screen-ingame { filter: drop-shadow(0 0 14px rgba(120, 220, 255, 1.0)); }

body.slipstream-phase-active  #flow-hud { 
  --slipstream-pulse: 1;
}
```

**Concern**: `filter: drop-shadow` on the entire game screen is expensive. **Alternative**: apply only to HUD overlay (cheaper, still visible). Defer to playtest.

Existing `slipstream.css` provides a body overlay for the old passive slipstream — inspect to decide whether to extend or replace.

## 3. Tunnel shader effect

**New file**: `src/shaders/slipstreamTunnel.ts` — a custom pmndrs Effect subclass.

Visual: a full-screen fragment shader that darkens screen corners, applies radial streaks, and modulates with time. Think "warp speed tunnel".

```typescript
import { Effect } from 'postprocessing';

const FRAGMENT_SHADER = `
  uniform float uStrength; // 0..1, driven by phase
  uniform float uTime;
  
  void mainImage(in vec4 inputColor, in vec2 uv, out vec4 outputColor) {
    vec2 center = uv - 0.5;
    float dist = length(center);
    float vignette = smoothstep(0.3, 0.8, dist);
    
    // Radial streaks
    float angle = atan(center.y, center.x);
    float streaks = sin(angle * 24.0 + uTime * 8.0) * 0.5 + 0.5;
    streaks *= smoothstep(0.15, 0.45, dist);
    
    vec3 tunnelColor = vec3(0.3, 0.8, 1.2) * streaks * 0.4 * uStrength;
    vec3 darkening = mix(vec3(1.0), vec3(0.4, 0.6, 0.9), vignette * uStrength);
    
    outputColor = vec4(inputColor.rgb * darkening + tunnelColor, inputColor.a);
  }
`;

export class SlipstreamTunnelEffect extends Effect {
  constructor() {
    super('SlipstreamTunnelEffect', FRAGMENT_SHADER, {
      uniforms: new Map([
        ['uStrength', new Uniform(0)],
        ['uTime', new Uniform(0)],
      ]),
    });
  }
  update(_renderer, _inputBuffer, delta) {
    this.uniforms.get('uTime').value += delta;
  }
}
```

Added to EffectComposer in `src/scene.ts` AFTER bloom. Strength uniform driven per-frame by slipstream phase state.

## 4. Chromatic aberration

**New file**: `src/effects/chromaticAberration.ts` — thin wrapper around pmndrs's `ChromaticAberrationEffect` for controlled lifetime.

```typescript
import { ChromaticAberrationEffect } from 'postprocessing';
import { Vector2 } from 'three';

export function createSlipstreamChromaticEffect(): ChromaticAberrationEffect {
  return new ChromaticAberrationEffect({
    offset: new Vector2(0, 0),  // starts zero, ramped up by phase
    radialModulation: true,
    modulationOffset: 0.15,
  });
}

export function setChromaticStrength(effect: ChromaticAberrationEffect, strength: number): void {
  effect.offset.set(strength * 0.004, strength * 0.004);
}
```

Strength driven by phase: 0 during idle/entry, ramped 0→1 during lockIn, steady 1 during active, ramped 1→0 during exit.

Package.json already has `postprocessing` as a dep (confirmed by investigation) — no new dependency.

## 5. Audio mute / low-pass

**Existing**: `src/audioAmbient.ts` has `setAmbientDampen(on: boolean)` that modulates a BiquadFilter.

**Extension**: Add a `setSlipstreamAudio(phase: SlipstreamPhase)` helper:

```typescript
// src/audioAmbient.ts (extended)
export function setSlipstreamAudio(phase: SlipstreamPhase, elapsed: number): void {
  const { filterNode, masterGain } = getAmbientState();
  if (!filterNode || !masterGain) return;
  const now = audioCtx.currentTime;
  
  switch (phase) {
    case 'entry':
      // Volume duck
      masterGain.gain.linearRampToValueAtTime(0.7, now + 0.2);
      break;
    case 'lockIn':
      // Ramp low-pass from 22050 → 2000 over 0.7s
      filterNode.frequency.linearRampToValueAtTime(2000, now + 0.6);
      masterGain.gain.linearRampToValueAtTime(0.6, now + 0.2);
      break;
    case 'active':
      // Steady low-pass
      filterNode.frequency.setTargetAtTime(2000, now, 0.1);
      break;
    case 'exit':
      // Recover to normal over 0.25s
      filterNode.frequency.linearRampToValueAtTime(22050, now + 0.25);
      masterGain.gain.linearRampToValueAtTime(1.0, now + 0.25);
      break;
    case 'idle':
      // Ensure normal
      filterNode.frequency.setTargetAtTime(22050, now, 0.05);
      masterGain.gain.setTargetAtTime(1.0, now, 0.05);
      break;
  }
}
```

**Do NOT** call `setAmbientDampen(true)` — that's for pause state. Use a dedicated slipstream path to avoid fighting pause state.

## 6. Magnetic alignment control

**File**: `src/core/simulation.ts` — extend the per-frame player update.

**Current**: Bike proximity gives a passive speed boost. Turn constraints and wall repulsion work normally.

**Change**: When `SlipstreamPhaseState.phase === 'active'` or `'lockIn'`:

```typescript
// Inside simulation per-player update
if (vehicle === 'bike' && slipstreamPhase === 'active') {
  // 1. Magnetic alignment to nearest trail direction
  const trailDir = getNearestTrailDirection(player, world);
  if (trailDir) {
    const alignStrength = 0.6; // 60% pull toward trail direction
    player.heading = lerpAngle(player.heading, Math.atan2(trailDir.y, trailDir.x), alignStrength * dt * 8);
  }
  
  // 2. Ignore turn constraints
  // (existing turn-rate clamp bypassed when flag set)
  
  // 3. Wall repulsion disabled
  // (existing wall-repulsion force skipped when flag set)
}
```

New helper `getNearestTrailDirection()` reuses the proximity detection already implemented in `src/core/lockstepProximity.ts`.

## 7. Exit snap-back

When slipstream exits (player moves out of proximity or input breaks it):

```
phase = 'exit'
duration: 0.15s (fast) | 0.25s (slow) — pick based on velocity at exit

During exit:
  - Magnetic alignment decays 1.0 → 0 over the window
  - If player inputs a turn > 45° in opposite direction, snap instantly (skip gradual decay)
  - Visuals decay in parallel
```

The "snap-back" refers to control feel, not a visual snap. The player regains full control smoothly but with a small resistance period.

## 8. Integration with FLOW state

`slipstreamVFX.ts` exports a selector:

```typescript
export function shouldGeneratePassiveFlow(state: SlipstreamPhaseState): boolean {
  return state.phase === 'active';
}
```

The simulation loop calls:

```typescript
if (shouldGeneratePassiveFlow(slipstreamPhase)) {
  tickPassive(flowState, 'slipstream', now);
}
```

No FLOW during entry/lockIn/exit — only in active. This enforces the spec's "FLOW begins after 1.0s" rule.

## Performance considerations

- Tunnel shader: one full-screen pass, ~0.3ms on mid hardware. Budget: fine.
- Chromatic aberration: pmndrs implementation is heavily optimized. Budget: fine.
- Speed lines: existing system, no change to count.
- Audio filter modulation: browser-native, near-zero cost.

**Mobile cutoff**: Drop tunnel + chromatic on mobile (detect via `gfxSettings.tier === 'low'`). Keep speed lines + UI glow + audio.

## Quality tier gating

```typescript
const slipstreamQuality = gfxSettings.tier === 'low' ? 'minimal' : 
                          gfxSettings.tier === 'medium' ? 'standard' : 'full';
```

| Quality   | Speed lines | UI glow | Tunnel | Chromatic | Audio |
|-----------|-------------|---------|--------|-----------|-------|
| minimal   | ✓           | ✓       | ✗      | ✗         | ✓     |
| standard  | ✓           | ✓       | ✓      | ✗         | ✓     |
| full      | ✓           | ✓       | ✓      | ✓         | ✓     |

## Testing plan

Unit tests (`slipstreamVFX.test.ts`, jsdom):

1. Phase transitions with controlled time: idle → entry → lockIn → active → exit → idle.
2. Proximity lost during entry → direct to exit (respects resistance window).
3. `shouldGeneratePassiveFlow` only true in active.
4. Audio context mocked, verify setSlipstreamAudio calls don't throw.

Integration (manual):

1. Play as SPECTRE, enter slipstream range → observe 1s ramp before FLOW counter increments.
2. Verify tunnel + chromatic visible on full quality, absent on minimal.
3. Low-pass audio engages/disengages cleanly without clicks.
4. Magnetic alignment feels intentional, not broken.

## What this spec does NOT cover

- Scoring → SPEC-89
- HUD counter → SPEC-90
- Round-end presentation → SPEC-91
- Persistence → SPEC-92
- Tire streaks → SPEC-94
- Grind glitch → SPEC-95
