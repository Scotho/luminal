# SPEC-94: SLINGSHOT Tire Streak System

> Part of TASK-300 FLOW system. Depends on SPEC-89 (drift intensity tiers) + SPEC-90 (HUD character hooks). Floor-level VFX for SLINGSHOT drift state.

## Summary

Persistent "floor streak" decals painted behind the SLINGSHOT bike during drift, with three glow stages matching drift intensity (low/med/high). Streaks fade after 1–2 seconds and clean up on drift end, round end, or match transition. Must appear as real floor decals that reflect lighting — not UI overlays.

Implementation approach: **instanced floor-plane mesh mirroring the existing trail InstancedMesh fade pattern** (`src/trail.ts:603-649`), but rendered on the floor plane instead of the wall plane, with an emissive MeshStandardMaterial so it responds to the scene lighting and bloom pass.

## File layout

```
src/effects/tireStreaks.ts          # InstancedMesh manager (new, ~300 lines)
src/shaders/tireStreakShader.ts     # optional custom shader (new, ~150 lines)
src/core/simDrift.ts                # hook to spawn streak segments each tick
src/game.ts                         # init/cleanup on round transitions
src/__tests__/tireStreaks.test.ts
```

## Architecture

Mirror the trail system but simpler:

```
TireStreakSystem (one per player, instantiated on character select)
├── InstancedMesh (2048 instances max, floor plane geometry)
├── Free-list of instance indices
├── Age array for fade tracking
├── Stage array (0=low, 1=med, 2=high) per instance
├── spawnStreak(position, heading, driftIntensity)
├── tickFade(dt) ← called per frame
└── clear() ← on round end / match transition
```

**Key difference from trail**: trail segments connect end-to-end to form a wall. Tire streaks are **discrete quads**, each placed individually at the player's rear-wheel position during drift.

## Instance geometry

Each instance is a small flat quad on the ground plane (Y=0.01 to avoid z-fighting):

```typescript
const width = 0.35;   // cross-track width
const length = 1.2;   // along-heading length
const geometry = new PlaneGeometry(width, length);
geometry.rotateX(-Math.PI / 2); // flat on ground
```

Instance transforms carry:
- Position (XZ from rear-wheel sample)
- Rotation around Y-axis (aligned to heading)
- Scale (uniform)

## Spawn rate

Drift produces streak samples at ~50 Hz while active:

```typescript
// In simDrift.ts, per frame while drifting:
if (drift.isActive) {
  this._streakAccum += dt;
  const interval = 1 / 50; // 50 Hz
  while (this._streakAccum >= interval) {
    this._streakAccum -= interval;
    const samplePos = getRearWheelPos(player);
    const intensity = getDriftIntensity(player); // returns 'low' | 'med' | 'high'
    tireStreaks.spawnStreak(samplePos, player.heading, intensity, performance.now());
  }
}
```

50 Hz = 1 streak per ~2cm at 100 units/sec. Feels continuous.

## Three glow stages

Drift intensity derived from drift speed + angle (matching the spec):

```typescript
// In simDrift.ts or helper
export function getDriftIntensity(player: Player): 'low' | 'med' | 'high' {
  const slipAngle = Math.abs(player._driftSlipAngle); // radians
  const speedNorm = player.speed / player.maxSpeed;   // 0..1
  const score = slipAngle * speedNorm; // rough quality metric
  if (score > 0.45) return 'high';
  if (score > 0.25) return 'med';
  return 'low';
}
```

Each stage maps to a different emissive color and intensity:

| Stage | Color              | Emissive intensity | Notes |
|-------|--------------------|--------------------| ------|
| low   | `#ff88dd` (dim)    | 0.6                | subtle streak |
| med   | `#ff66ee` (bright) | 1.2                | visible glow |
| high  | `#ff22ff` (hot)    | 2.0                | max saturation, bloom picks up |

Stored per-instance as a `Float32Array` of `[r, g, b, intensity]` consumed by the shader. Alternatively use `instanceColor` InstancedBufferAttribute and modulate in the shader.

## Material

Option A — **MeshStandardMaterial** with emissive map:

```typescript
const material = new MeshStandardMaterial({
  color: 0x000000,       // base unlit
  emissive: 0xff88ee,    // modulated per instance
  emissiveIntensity: 1,  // modulated per instance
  transparent: true,
  opacity: 1,            // modulated per instance (age-based)
  blending: AdditiveBlending,
  depthWrite: false,
});
```

Pros: simple, gets bloom + deferred lighting for free.
Cons: emissiveIntensity is per-material, not per-instance. Workaround: encode intensity in instance color scale.

Option B — **Custom shader** (`tireStreakShader.ts`):

```typescript
const vertexShader = `
  attribute vec4 instanceColor; // rgb + intensity
  attribute float instanceAge;   // 0..1 faded
  varying vec3 vColor;
  varying float vAge;
  void main() {
    vColor = instanceColor.rgb * instanceColor.a;
    vAge = instanceAge;
    vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPos;
    // pass UV
  }
`;

const fragmentShader = `
  uniform sampler2D uStreakMask;
  varying vec3 vColor;
  varying float vAge;
  varying vec2 vUv;
  void main() {
    float mask = texture2D(uStreakMask, vUv).r;
    float fade = 1.0 - smoothstep(0.0, 1.0, vAge);
    vec3 col = vColor * mask * fade;
    gl_FragColor = vec4(col, mask * fade);
  }
`;
```

**Recommendation**: start with **Option B** (custom shader) but reuse the existing `getSharedStreakMask()` from `trail.ts` for the streak mask texture — same aesthetic, consistent with trails, free per-instance control.

## Fade cycle

Each instance lives ~1.5 seconds (mid-point of spec's 1–2s range):

```typescript
const FADE_DURATION_MS = 1500;

// Per frame
for (const idx of activeIndices) {
  ages[idx] += dtMs;
  const t = ages[idx] / FADE_DURATION_MS;
  if (t >= 1) {
    releaseInstance(idx); // return to free list
  } else {
    instanceAgeAttribute.setX(idx, t);
  }
}
instanceAgeAttribute.needsUpdate = true;
```

Fade curve: smoothstep(0, 1, age) for ease-out. Alpha drops sub-linearly, so streaks visually persist longer than linear decay would give.

## Cleanup hooks

```typescript
// In game.ts round lifecycle:
game.onRoundStart(() => {
  tireStreakSystem.clear();
});
game.onRoundEnd(() => {
  // Let existing streaks fade naturally; optional: fast-fade them
  tireStreakSystem.fastFade(300); // 300ms fade-out
});
game.onMatchTransition(() => {
  tireStreakSystem.clear();
});
```

**Decision**: let streaks persist through round-end presentation so they're visible in background replays, but fast-fade during the menu transition.

## Floor plane positioning

Tire streaks need to sit ON the arena floor. Arena floor is at Y=0 in most maps (confirmed by investigation of `arena/arenaTheme.ts`).

**Y-offset**: `0.01` units above floor to avoid z-fighting with floor reflector.

**Reflector integration**: Floor reflector renders reflection. Tire streaks drawn after the reflector pass appear "on top of" the reflection. If streak reflections are desired, tire streaks need to be rendered into the reflector's scene capture too. **Decision**: tire streaks are NOT reflected (simpler, cheap, looks fine because they're emissive and low-contrast).

Code path:
```typescript
// In scene init
const tireStreakSystem = new TireStreakSystem(2048);
scene.add(tireStreakSystem.instancedMesh);
// Not added to reflector sampling scene.
```

## Instance pool management

Pool size: **2048** max instances per system. One system per player is overkill — **one shared system per scene, keyed by player index** via instance attribute.

```typescript
// Shared single system
class TireStreakSystem {
  private mesh: InstancedMesh;
  private activeIndices: number[] = [];
  private freeList: number[] = [];
  // ...
}
```

2048 instances × 50 Hz × 1.5s fade = max ~150 concurrent. 2048 is way above ceiling — choose a tighter cap of **512** to save GPU upload bandwidth. Drop oldest when full.

## Drift intensity wiring

**File**: `src/core/simDrift.ts` — currently computes slip angle. Extend to also expose `getDriftIntensity()` for VFX consumption.

**File**: `src/player.ts` — expose `_driftIntensity` field (updated by simDrift each frame).

## FLOW tick hook

`simDrift.ts` currently drives the drift state machine. SPEC-89 requires calling `tickPassive` with the appropriate drift-low/med/high tag:

```typescript
// In simDrift.ts per frame while drifting
const intensity = getDriftIntensity(player);
const tickSource = intensity === 'high' ? 'drift-high' : 
                   intensity === 'med'  ? 'drift-med'  : 'drift-low';
// call flowState tick with accum pattern
```

This is the same place that spawns tire streak samples — one code path, two effects.

## Lighting reflection

Spec: "Must reflect lighting". Since tire streaks use emissive material (or shader), they emit their own light visually. For "reflect" to mean **affected by scene lights**:

- Use `MeshStandardMaterial` with a low base color and non-zero emissive → scene lights add to the base color while emissive provides the glow.
- Alternative: custom shader samples scene IBL probe for a rim contribution.

For P1: **simpler shader with additive blending + emissive color**. "Reflect lighting" in practice means "the bloom pass picks them up and they glow in the environment", which the emissive approach already achieves.

## Performance budget

- 512 instances × 2 triangles = 1024 tris. Rounding error.
- One draw call (InstancedMesh).
- Per-frame instance attribute update: 512 × 16 bytes = 8KB. Rounding error.
- Total budget: <0.2ms/frame on mid hardware.

## Testing plan

Unit tests (`tireStreaks.test.ts`, vitest, no DOM needed):

1. Fresh system → 0 active instances, 512 free.
2. `spawnStreak` × 10 → 10 active, 502 free.
3. `tickFade(1500)` → 0 active, 512 free.
4. `clear()` → 0 active, 512 free, instance matrices zeroed.
5. Spawn past cap → oldest instance reclaimed.
6. Age interpolation correct at t=0.5 → attribute value 0.5.

Integration (manual):

1. Play as SLINGSHOT, drift → visible streaks behind car.
2. Stop drifting → streaks fade over ~1.5s, no leak.
3. Transition round → streaks cleared.
4. Transition match → streaks cleared.
5. Drift quality feedback: high intensity visibly brighter than low.

## Quality tier gating

| Tier     | Max instances | Fade duration | Shader |
|----------|---------------|---------------|--------|
| low      | 0 (disabled)  | —             | —      |
| medium   | 256           | 1000ms        | simple |
| high     | 512           | 1500ms        | custom |
| ultra    | 512           | 1500ms        | custom + bloom boost |

On `low` tier, tire streaks are fully disabled — players still get the drift scoring, just no visual trail on the floor.

## What this spec does NOT cover

- FLOW scoring → SPEC-89
- HUD counter → SPEC-90
- Round-end presentation → SPEC-91
- Persistence → SPEC-92
- Slipstream VFX → SPEC-93
- Grind glitch → SPEC-95
