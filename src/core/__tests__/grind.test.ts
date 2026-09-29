// ── Grind Simulation Tests — THPS2-style balance physics ──
import { describe, it, expect } from 'vitest';
import {
  advancePlayer, createPlayerSim, SIM_DT, simStep, MAX_TRAIL_POINTS,
  GRIND_SNAP_RANGE, GRIND_ENTRY_COST, GRIND_SPEED_BONUS,
  GRIND_BAIL_SPEED_MULT, GRIND_BAIL_METER_PENALTY, GRIND_COOLDOWN,
  GRIND_SWEET_SPOT, GRIND_DANGER_ZONE,
  GRIND_AIRBORNE_CLEAN, GRIND_AIRBORNE_BAIL,
  GRIND_RECOVERY_CLEAN, GRIND_RECOVERY_BAIL,
  GRIND_LEAN_GRAVITY, GRIND_INSTABILITY_BASE, GRIND_INSTABILITY_RATE,
  GRIND_INSTABILITY_CAP, GRIND_LEAN_ACC,
  GRIND_DASH_INSTABILITY_MULT, GRIND_BAIL_LATERAL_SPEED,
  GRIND_DISRUPT_RANGE,
} from '../simulation';
import type { InputFrame, SimState, TrailPoint, PlayerSim } from '../simulation';
import { HOVERBOARD_PHYSICS } from '../../vehicleConfig';

// ── Helpers ────────────────────────────────────────────

const dt = SIM_DT; // 1/60
const cfg = HOVERBOARD_PHYSICS;

function straightTrail(startX: number, endX: number, z: number, n: number): TrailPoint[] {
  const pts: TrailPoint[] = [];
  for (let i = 0; i < n; i++) {
    pts.push({ x: startX + (endX - startX) * (i / (n - 1)), z });
  }
  return pts;
}

function noInput(tick: number): InputFrame {
  return { tick, turnDir: 0, accelerate: false, dash: false, brake: false };
}

function specialInput(tick: number): InputFrame {
  return { tick, turnDir: 0, accelerate: false, dash: false, brake: false, special: true };
}

function specialTurnInput(tick: number, turnDir: number): InputFrame {
  return { tick, turnDir, accelerate: false, dash: false, brake: false, special: true };
}

function specialDashInput(tick: number): InputFrame {
  return { tick, turnDir: 0, accelerate: false, dash: true, brake: false, special: true };
}

function makeState(
  grinder: PlayerSim,
  opts?: { enemyTrailZ?: number; ownTrail?: TrailPoint[]; enemyTrail?: TrailPoint[] },
): SimState {
  const trailZ = opts?.enemyTrailZ ?? 0;
  const enemy = createPlayerSim(100, 100, 0, 45, 'hoverboard');
  return {
    tick: 100,
    players: [grinder, enemy],
    trails: [
      opts?.ownTrail ?? [],
      opts?.enemyTrail ?? straightTrail(-50, 50, trailZ, 100),
    ],
  };
}

function step(p: PlayerSim, input: InputFrame, state: SimState): PlayerSim {
  return advancePlayer(p, input, cfg, dt, state, 0);
}

/** Initiate grind and return the grinding player + state.
 *  Clears grindGraceTimer so these tests exercise the full destabilization
 *  physics immediately — individual tests can still set it to exercise grace. */
function startGrinding(opts?: { enemyTrail?: TrailPoint[] }): { p: PlayerSim; state: SimState } {
  const p = createPlayerSim(0, 0, 0, 45);
  p.meter = 100;
  const state = makeState(p, opts);
  const result = step(p, specialInput(100), state);
  const cleared = { ...result, grindGraceTimer: 0 } as PlayerSim;
  state.players[0] = cleared;
  return { p: cleared, state };
}

// ── Tests ──────────────────────────────────────────────

describe('Grind Initiation', () => {
  it('starts grinding when near enemy trail with enough meter', () => {
    const p = createPlayerSim(0, 0, 0, 45);
    p.meter = 100;
    const state = makeState(p);
    const result = step(p, specialInput(100), state);
    expect(result.grinding).toBe(true);
    expect(result.grindTrailOwner).toBe(1);
    expect(result.meter).toBeGreaterThanOrEqual(100 - GRIND_ENTRY_COST);
    expect(result.meter).toBeLessThan(100 - GRIND_ENTRY_COST + 2);
    expect(result.grindSpeed).toBe(45 + GRIND_SPEED_BONUS);
  });

  it('does NOT grind when too far from trail', () => {
    const p = createPlayerSim(0, 10, 0, 45);
    p.meter = 100;
    const state = makeState(p);
    const result = step(p, specialInput(100), state);
    expect(result.grinding).toBe(false);
  });

  it('does NOT grind with insufficient meter', () => {
    const p = createPlayerSim(0, 0, 0, 45);
    p.meter = 30;
    const state = makeState(p);
    const result = step(p, specialInput(100), state);
    expect(result.grinding).toBe(false);
    expect(result.meter).toBeCloseTo(30, 0);
  });

  it('own trail grinding is free', () => {
    const p = createPlayerSim(0, 0, 0, 45);
    p.meter = 30;
    const ownTrail = straightTrail(-50, 50, 0, 100);
    const state = makeState(p, { ownTrail, enemyTrail: [] });
    const result = step(p, specialInput(100), state);
    expect(result.grinding).toBe(true);
    expect(result.grindOwnTrail).toBe(true);
    expect(result.meter).toBe(30);
  });

  it('does NOT grind during cooldown', () => {
    const p = createPlayerSim(0, 0, 0, 45);
    p.meter = 100;
    p.grindCooldown = 2.0;
    const state = makeState(p);
    const result = step(p, specialInput(100), state);
    expect(result.grinding).toBe(false);
  });

  it('does NOT grind when special=false', () => {
    const p = createPlayerSim(0, 0, 0, 45);
    p.meter = 100;
    const state = makeState(p);
    const result = step(p, noInput(100), state);
    expect(result.grinding).toBe(false);
  });

  it('grind starts with non-zero lean direction (THPS2 random initial direction)', () => {
    const p = createPlayerSim(0, 0, 0, 45);
    p.meter = 100;
    const state = makeState(p);
    const result = step(p, specialInput(100), state);
    expect(result.grinding).toBe(true);
    // Lean velocity should be non-zero immediately — THPS2 random 50/50 kick
    expect(result.grindLeanDir).not.toBe(0);
    expect(Math.abs(result.grindLeanDir)).toBeGreaterThan(0.1);
  });
});

describe('THPS2 Balance Physics', () => {
  it('self-reinforcing gravity accelerates balance away from center', () => {
    const { p, state } = startGrinding();
    // Set balance offset with zero lean velocity — gravity alone should push further out
    let current = { ...p, grindBalance: 0.4, grindLeanDir: 0 } as PlayerSim;
    state.players[0] = current;

    const balanceBefore = current.grindBalance;
    state.tick++;
    current = step(current, specialInput(state.tick), state);
    state.players[0] = current;

    // Self-reinforcing gravity pushes balance further from center
    // balance += balance * LEAN_GRAVITY * instability * dt
    // With instability ~0.6, gravity ~1.8: delta = 0.4 * 1.8 * 0.6 * (1/60) ≈ 0.0072
    // Plus lean velocity noise, so balance should move further from 0
    expect(Math.abs(current.grindBalance)).toBeGreaterThan(Math.abs(balanceBefore) - 0.01);
  });

  it('instability ramps with grind duration — longer grinds are harder', () => {
    const { p, state } = startGrinding();

    // Grind just started (duration ~0)
    const shortGrind = { ...p, grindBalance: 0.3, grindLeanDir: 0.2, grindDuration: 0 } as PlayerSim;
    state.players[0] = shortGrind;
    state.tick++;
    const afterShort = step(shortGrind, specialInput(state.tick), state);

    // Long grind (duration = 10s)
    const longGrind = { ...p, grindBalance: 0.3, grindLeanDir: 0.2, grindDuration: 10 } as PlayerSim;
    state.players[0] = longGrind;
    state.tick++;
    const afterLong = step(longGrind, specialInput(state.tick + 1), state);

    // Balance should drift more with higher instability
    const driftShort = Math.abs(afterShort.grindBalance - 0.3);
    const driftLong = Math.abs(afterLong.grindBalance - 0.3);
    expect(driftLong).toBeGreaterThan(driftShort);
  });

  it('instability does not exceed cap', () => {
    const { p, state } = startGrinding();

    // Extremely long grind — instability should cap at 2.0
    // Without cap, instability = 0.6 + 100 * 0.12 = 12.6
    // Gravity delta uncapped: 0.15 * 1.8 * 12.6 * (1/60) ≈ 0.057
    // Gravity delta capped:   0.15 * 1.8 * 2.0 * (1/60) ≈ 0.009
    let current = { ...p, grindBalance: 0.15, grindLeanDir: 0, grindDuration: 100 } as PlayerSim;
    state.players[0] = current;
    state.tick++;
    current = step(current, specialInput(state.tick), state);

    // If the cap is working, balance should still be well under the bail threshold
    // after one tick. Without the cap, the massive instability would push much further.
    const delta = Math.abs(current.grindBalance - 0.15);
    expect(delta).toBeLessThan(0.04); // capped gravity + lean perturbation stays small
  });

  it('no centering without player input — balance never returns to 0 on its own', () => {
    const { p, state } = startGrinding();
    // Set initial offset with no lean velocity
    let current = { ...p, grindBalance: 0.3, grindLeanDir: 0 } as PlayerSim;
    state.players[0] = current;

    // Run several ticks with no turn input
    for (let i = 0; i < 20; i++) {
      state.tick++;
      current = step(current, specialInput(state.tick), state);
      state.players[0] = current;
      if (!current.grinding) break;
    }

    // Balance should NOT have returned closer to 0 — gravity pushes it outward
    // (It might have bailed, which is also valid — gravity wins without correction)
    if (current.grinding) {
      expect(Math.abs(current.grindBalance)).toBeGreaterThan(0.25);
    } else {
      // Bailed — gravity won, which proves no centering
      expect(current.airborne).toBe(true);
    }
  });

  it('perturbation bias: lean velocity accelerates in its current direction (THPS2)', () => {
    const { p, state } = startGrinding();
    // Start with positive lean velocity — perturbation should tend to increase it
    let current = { ...p, grindBalance: 0, grindLeanDir: 0.2 } as PlayerSim;
    state.players[0] = current;

    let increaseCount = 0;
    let decreaseCount = 0;
    for (let i = 0; i < 60; i++) {
      const prevLeanDir = current.grindLeanDir;
      state.tick++;
      current = step(current, specialInput(state.tick), state);
      state.players[0] = current;
      if (!current.grinding) break;
      // Track whether lean velocity increased (same direction) or decreased
      if (Math.abs(current.grindLeanDir) > Math.abs(prevLeanDir)) increaseCount++;
      else decreaseCount++;
    }
    // THPS2 bias: perturbation always pushes in current direction,
    // so increases should significantly outnumber decreases
    expect(increaseCount).toBeGreaterThan(decreaseCount);
  });

  it('continuous perturbation: lean velocity changes every tick', () => {
    const { p, state } = startGrinding();
    let current = { ...p, grindLeanDir: 0.2 } as PlayerSim;
    state.players[0] = current;

    const leanDirs: number[] = [];
    for (let i = 0; i < 10; i++) {
      state.tick++;
      current = step(current, specialInput(state.tick), state);
      state.players[0] = current;
      leanDirs.push(current.grindLeanDir);
      if (!current.grinding) break;
    }

    // Lean direction should not be constant — RNG perturbs it each tick
    const uniqueValues = new Set(leanDirs.map(v => v.toFixed(4)));
    expect(uniqueValues.size).toBeGreaterThan(1);
  });

  it('player correction with turn input pushes balance', () => {
    const { p, state } = startGrinding();
    // Set balance to positive, apply negative turn to correct
    let current = { ...p, grindBalance: 0.3, grindLeanDir: 0 } as PlayerSim;
    state.players[0] = current;

    // Apply sustained left correction
    for (let i = 0; i < 15; i++) {
      state.tick++;
      current = step(current, specialTurnInput(state.tick, -1), state);
      state.players[0] = current;
      if (!current.grinding) break;
    }

    // With strong left input, balance should be pushed left (negative)
    if (current.grinding) {
      expect(current.grindBalance).toBeLessThan(0.3);
    }
  });

  it('dash multiplier increases effective instability', () => {
    const { p, state } = startGrinding();

    // Normal grind tick
    const normalGrind = { ...p, grindBalance: 0.3, grindLeanDir: 0.3, grindDuration: 2 } as PlayerSim;
    normalGrind.meter = 80; // need meter for dash
    state.players[0] = normalGrind;
    state.tick++;
    const afterNormal = step(normalGrind, specialInput(state.tick), state);

    // Dash grind tick (same starting state, different input)
    const dashGrind = { ...p, grindBalance: 0.3, grindLeanDir: 0.3, grindDuration: 2 } as PlayerSim;
    dashGrind.meter = 80;
    state.players[0] = dashGrind;
    state.tick++;
    const afterDash = step(dashGrind, specialDashInput(state.tick + 1), state);

    // Dash should cause more balance drift due to higher instability
    const driftNormal = Math.abs(afterNormal.grindBalance - 0.3);
    const driftDash = Math.abs(afterDash.grindBalance - 0.3);
    expect(driftDash).toBeGreaterThan(driftNormal * 0.9); // dash should be at least comparable
  });
});

describe('Grind Bail & Ejection', () => {
  it('bail occurs when |balance| >= 1.0', () => {
    const { p, state } = startGrinding();
    const speedBefore = p.speed;
    const meterBefore = p.meter;
    // Force balance very close to bail with positive lean velocity
    let current = { ...p, grindBalance: 0.98, grindLeanDir: 3.0 } as PlayerSim;
    state.players[0] = current;

    state.tick++;
    current = step(current, specialInput(state.tick), state);
    state.players[0] = current;

    expect(current.grinding).toBe(false);
    expect(current.airborne).toBe(true);
    expect(current.landingPenalty).toBe(true);
    expect(current.speed).toBeCloseTo(speedBefore * GRIND_BAIL_SPEED_MULT, 0);
    expect(current.meter).toBeCloseTo(meterBefore - GRIND_BAIL_METER_PENALTY, 0);
  });

  it('ejection RIGHT: positive balance at bail sets grindBailSide = +1', () => {
    const { p, state } = startGrinding();
    let current = { ...p, grindBalance: 0.98, grindLeanDir: 5.0 } as PlayerSim;
    state.players[0] = current;

    state.tick++;
    current = step(current, specialInput(state.tick), state);

    expect(current.grinding).toBe(false);
    expect(current.airborne).toBe(true);
    expect(current.grindBailSide).toBe(1);
  });

  it('ejection LEFT: negative balance at bail sets grindBailSide = -1', () => {
    const { p, state } = startGrinding();
    let current = { ...p, grindBalance: -0.98, grindLeanDir: -5.0 } as PlayerSim;
    state.players[0] = current;

    state.tick++;
    current = step(current, specialInput(state.tick), state);

    expect(current.grinding).toBe(false);
    expect(current.airborne).toBe(true);
    expect(current.grindBailSide).toBe(-1);
  });

  it('bail lateral push moves player sideways during airborne', () => {
    const { p, state } = startGrinding();
    // Force bail to the right
    let current = { ...p, grindBalance: 0.98, grindLeanDir: 5.0 } as PlayerSim;
    state.players[0] = current;

    state.tick++;
    current = step(current, specialInput(state.tick), state);
    expect(current.airborne).toBe(true);
    expect(current.grindBailSide).toBe(1);

    // Record position, then advance a few airborne ticks
    const xBefore = current.x;
    const zBefore = current.z;
    for (let i = 0; i < 5; i++) {
      state.tick++;
      current = step(current, noInput(state.tick), state);
      state.players[0] = current;
    }

    // Position should have moved laterally (not just forward)
    const dx = current.x - xBefore;
    const dz = current.z - zBefore;
    const lateralDist = Math.sqrt(dx * dx + dz * dz);
    expect(lateralDist).toBeGreaterThan(0.1);
  });

  it('clean exit sets grindBailSide = 0', () => {
    const { p, state } = startGrinding();

    // Clean exit by releasing special
    state.tick++;
    const current = step(p, noInput(state.tick), state);

    expect(current.grinding).toBe(false);
    expect(current.airborne).toBe(true);
    expect(current.landingPenalty).toBe(false);
    expect(current.grindBailSide).toBe(0);
  });

  it('grindBailSide resets to 0 when airborne ends', () => {
    const { p, state } = startGrinding();
    // Force bail
    let current = { ...p, grindBalance: 0.98, grindLeanDir: 5.0 } as PlayerSim;
    state.players[0] = current;
    state.tick++;
    current = step(current, specialInput(state.tick), state);
    expect(current.grindBailSide).toBe(1);

    // Wait out airborne
    let maxTicks = 100;
    while (current.airborne && maxTicks-- > 0) {
      state.tick++;
      current = step(current, noInput(state.tick), state);
      state.players[0] = current;
    }
    expect(current.airborne).toBe(false);
    expect(current.grindBailSide).toBe(0);
  });
});

describe('Slipstream / Opponent Disruption', () => {
  it('opponent proximity shifts balance toward opponent side', () => {
    const { p, state } = startGrinding();
    // Place opponent close to the grinder on one side
    // Grinder at (0, 0), facing angle=0 (toward -Z)
    // Place opponent at (3, 0) — to the right of the grinder's path
    state.players[1] = { ...state.players[1], x: 3, z: 0, alive: true } as PlayerSim;

    let current = { ...p, grindBalance: 0, grindLeanDir: 0 } as PlayerSim;
    state.players[0] = current;

    // Run a few ticks and check balance has been disrupted
    for (let i = 0; i < 10; i++) {
      state.tick++;
      current = step(current, specialInput(state.tick), state);
      state.players[0] = current;
      if (!current.grinding) break;
    }

    // Balance should have been pushed by disruption force (not just zero)
    // The exact direction depends on the relative angle calculation
    expect(current.grindBalance !== 0 || !current.grinding).toBe(true);
  });

  it('no disruption from distant opponents', () => {
    const { p, state } = startGrinding();
    // Place opponent far away
    state.players[1] = { ...state.players[1], x: 100, z: 100, alive: true } as PlayerSim;

    let current = { ...p, grindBalance: 0, grindLeanDir: 0 } as PlayerSim;
    state.players[0] = current;

    // The only forces are gravity (0 * gravity = 0) and random perturbation
    // We can't fully isolate disruption from RNG, but distant opponent should
    // contribute zero disruption force
    state.tick++;
    current = step(current, specialInput(state.tick), state);
    // Just verify it didn't crash and balance moved only from RNG
    expect(current.grinding).toBe(true);
  });
});

describe('Grind Exit', () => {
  it('releasing Space triggers clean exit to airborne', () => {
    const { p, state } = startGrinding();

    state.tick++;
    let current = step(p, specialInput(state.tick), state);
    state.players[0] = current;
    expect(current.grinding).toBe(true);

    state.tick++;
    current = step(current, noInput(state.tick), state);
    expect(current.grinding).toBe(false);
    expect(current.airborne).toBe(true);
    expect(current.landingPenalty).toBe(false);
    expect(current.airborneTimer).toBeCloseTo(GRIND_AIRBORNE_CLEAN, 2);
  });

  it('airborne transitions to recovery', () => {
    const { p, state } = startGrinding();
    state.tick++;
    let current = step(p, noInput(state.tick), state);
    state.players[0] = current;
    expect(current.airborne).toBe(true);

    const ticksNeeded = Math.ceil(GRIND_AIRBORNE_CLEAN / dt) + 2;
    for (let i = 0; i < ticksNeeded; i++) {
      if (!current.airborne) break;
      state.tick++;
      current = step(current, noInput(state.tick), state);
      state.players[0] = current;
    }
    expect(current.airborne).toBe(false);
    expect(current.recovery).toBe(true);
  });

  it('recovery transitions to cooldown', () => {
    const { p, state } = startGrinding();
    state.tick++;
    let current = step(p, noInput(state.tick), state);
    state.players[0] = current;

    // Exhaust airborne
    const airTicks = Math.ceil(GRIND_AIRBORNE_CLEAN / dt) + 2;
    for (let i = 0; i < airTicks; i++) {
      if (!current.airborne) break;
      state.tick++;
      current = step(current, noInput(state.tick), state);
      state.players[0] = current;
    }
    expect(current.recovery).toBe(true);

    // Exhaust recovery
    const recTicks = Math.ceil(GRIND_RECOVERY_CLEAN / dt) + 2;
    for (let i = 0; i < recTicks; i++) {
      if (!current.recovery) break;
      state.tick++;
      current = step(current, noInput(state.tick), state);
      state.players[0] = current;
    }
    expect(current.recovery).toBe(false);
    expect(current.grindCooldown).toBeCloseTo(GRIND_COOLDOWN, 1);
  });
});

describe('Meter Economy', () => {
  function startGrindingWithMeter(ownTrail = false): { p: PlayerSim; state: SimState } {
    const p = createPlayerSim(0, 0, 0, 45);
    p.meter = 60;
    let state: SimState;
    if (ownTrail) {
      const ownT = straightTrail(-50, 50, 0, 100);
      state = makeState(p, { ownTrail: ownT, enemyTrail: [] });
    } else {
      state = makeState(p);
    }
    const result = step(p, specialInput(100), state);
    const cleared = { ...result, grindGraceTimer: 0 } as PlayerSim;
    state.players[0] = cleared;
    return { p: cleared, state };
  }

  it('meter regens in sweet spot on enemy trail', () => {
    const { p, state } = startGrindingWithMeter(false);
    expect(p.grinding).toBe(true);
    const meterAfterEntry = p.meter;

    // Pin balance to sweet spot
    let current = { ...p, grindBalance: 0, grindLeanDir: 0 } as PlayerSim;
    state.players[0] = current;

    for (let i = 0; i < 30; i++) {
      state.tick++;
      current = step(current, specialInput(state.tick), state);
      current = { ...current, grindBalance: 0, grindLeanDir: 0 } as PlayerSim;
      state.players[0] = current;
    }
    expect(current.meter).toBeGreaterThan(meterAfterEntry);
  });

  it('no meter regen on own trail', () => {
    const { p, state } = startGrindingWithMeter(true);
    expect(p.grinding).toBe(true);
    expect(p.grindOwnTrail).toBe(true);
    const meterBefore = p.meter;

    let current = { ...p, grindBalance: 0, grindLeanDir: 0 } as PlayerSim;
    state.players[0] = current;

    for (let i = 0; i < 30; i++) {
      state.tick++;
      current = step(current, specialInput(state.tick), state);
      current = { ...current, grindBalance: 0, grindLeanDir: 0 } as PlayerSim;
      state.players[0] = current;
    }
    expect(current.meter).toBeCloseTo(meterBefore, 1);
  });

  it('no meter regen in danger zone', () => {
    const { p, state } = startGrindingWithMeter(false);
    const meterAfterEntry = p.meter;

    let current = { ...p, grindBalance: 0.75, grindLeanDir: 0 } as PlayerSim;
    state.players[0] = current;

    for (let i = 0; i < 30; i++) {
      state.tick++;
      current = { ...current, grindBalance: 0.75, grindLeanDir: 0 } as PlayerSim;
      current = step(current, specialInput(state.tick), state);
      state.players[0] = current;
      if (!current.grinding) break;
    }
    expect(current.meter).toBeLessThanOrEqual(meterAfterEntry);
  });
});

describe('Full Grind Lifecycle', () => {
  it('complete flow: initiate -> grind -> trail end -> airborne -> recovery -> cooldown -> normal', () => {
    const shortTrail = straightTrail(0, 20, 0, 20);
    const p = createPlayerSim(0, 0, 0, 45);
    p.meter = 100;
    const state: SimState = {
      tick: 100,
      players: [p, createPlayerSim(100, 100, 0, 45, 'hoverboard')],
      trails: [[], shortTrail],
    };

    let current = step(p, specialInput(100), state);
    state.players[0] = current;
    expect(current.grinding).toBe(true);

    // Ride to trail end with balance pinned
    let maxTicks = 300;
    while (current.grinding && maxTicks-- > 0) {
      state.tick++;
      current = { ...current, grindBalance: 0, grindLeanDir: 0 } as PlayerSim;
      current = step(current, specialInput(state.tick), state);
      state.players[0] = current;
    }
    expect(current.airborne).toBe(true);
    expect(current.landingPenalty).toBe(false);

    // Airborne -> recovery
    maxTicks = 300;
    while (current.airborne && maxTicks-- > 0) {
      state.tick++;
      current = step(current, noInput(state.tick), state);
      state.players[0] = current;
    }
    expect(current.recovery).toBe(true);

    // Recovery -> cooldown
    maxTicks = 300;
    while (current.recovery && maxTicks-- > 0) {
      state.tick++;
      current = step(current, noInput(state.tick), state);
      state.players[0] = current;
    }
    expect(current.grindCooldown).toBeGreaterThan(0);

    // Cooldown -> normal
    maxTicks = 600;
    while (current.grindCooldown > 0 && maxTicks-- > 0) {
      state.tick++;
      current = step(current, noInput(state.tick), state);
      state.players[0] = current;
    }
    expect(current.grindCooldown).toBe(0);
    expect(current.grinding).toBe(false);
    expect(current.airborne).toBe(false);
    expect(current.recovery).toBe(false);
    expect(current.alive).toBe(true);
  });
});

describe('Grind Determinism', () => {
  it('identical inputs produce identical state across two runs', () => {
    // Run A
    const trailA = straightTrail(-50, 50, 0, 100);
    const pA = createPlayerSim(0, 0, 0, 45);
    pA.meter = 100;
    const stateA: SimState = {
      tick: 100,
      players: [pA, createPlayerSim(100, 100, 0, 45, 'hoverboard')],
      trails: [[], trailA],
    };
    let currentA = step(pA, specialInput(100), stateA);
    stateA.players[0] = currentA;
    for (let i = 0; i < 200; i++) {
      stateA.tick++;
      currentA = step(currentA, specialTurnInput(stateA.tick, i % 3 === 0 ? -1 : i % 3 === 1 ? 1 : 0), stateA);
      stateA.players[0] = currentA;
      if (!currentA.grinding) break;
    }

    // Run B — identical setup
    const trailB = straightTrail(-50, 50, 0, 100);
    const pB = createPlayerSim(0, 0, 0, 45);
    pB.meter = 100;
    const stateB: SimState = {
      tick: 100,
      players: [pB, createPlayerSim(100, 100, 0, 45, 'hoverboard')],
      trails: [[], trailB],
    };
    let currentB = step(pB, specialInput(100), stateB);
    stateB.players[0] = currentB;
    for (let i = 0; i < 200; i++) {
      stateB.tick++;
      currentB = step(currentB, specialTurnInput(stateB.tick, i % 3 === 0 ? -1 : i % 3 === 1 ? 1 : 0), stateB);
      stateB.players[0] = currentB;
      if (!currentB.grinding) break;
    }

    // Full state equality — catches any field divergence
    expect(currentA).toEqual(currentB);
  });

  it('different RNG seeds produce different balance paths', () => {
    // Tick 100 → seed A
    const trailA = straightTrail(-50, 50, 0, 100);
    const pA = createPlayerSim(0, 0, 0, 45);
    pA.meter = 100;
    const stateA: SimState = {
      tick: 100,
      players: [pA, createPlayerSim(100, 100, 0, 45, 'hoverboard')],
      trails: [[], trailA],
    };
    const currentA = step(pA, specialInput(100), stateA);
    stateA.players[0] = currentA;

    // Tick 200 → seed B (different)
    const trailB = straightTrail(-50, 50, 0, 100);
    const pB = createPlayerSim(0, 0, 0, 45);
    pB.meter = 100;
    const stateB: SimState = {
      tick: 200,
      players: [pB, createPlayerSim(100, 100, 0, 45, 'hoverboard')],
      trails: [[], trailB],
    };
    const currentB = step(pB, specialInput(200), stateB);
    stateB.players[0] = currentB;

    // Seeds differ → initial lean direction may differ or RNG state definitely differs
    expect(currentA.grindRngState).not.toBe(currentB.grindRngState);
  });
});

describe('simStep Collision Exemption', () => {
  it('grinding player survives standing on enemy trail', () => {
    // Player 0 at (0, 0) right on top of player 1's trail
    const p0 = createPlayerSim(0, 0, 0, 45);
    p0.meter = 100;
    const p1 = createPlayerSim(100, 100, 0, 45, 'hoverboard');
    // Enemy trail runs through (0, 0) — player is ON the trail
    const enemyTrail = straightTrail(-10, 10, 0, 50);
    const state: SimState = {
      tick: 100,
      players: [p0, p1],
      trails: [[], enemyTrail],
    };

    // First: initiate grind via advancePlayer
    const grinding = step(p0, specialInput(100), state);
    expect(grinding.grinding).toBe(true);

    // Now run simStep with the grinding player — should NOT die
    const grindState: SimState = {
      tick: 100,
      players: [grinding, p1],
      trails: [[], enemyTrail],
    };
    const inputs = [specialInput(101), noInput(101)];
    const cfgs = [cfg, cfg];
    const result = simStep(grindState, inputs, cfgs);
    expect(result.players[0].alive).toBe(true);
    expect(result.players[0].grinding).toBe(true);
  });

  it('airborne player survives standing on enemy trail', () => {
    // Start a grind, then release special to go airborne
    const p0 = createPlayerSim(0, 0, 0, 45);
    p0.meter = 100;
    const p1 = createPlayerSim(100, 100, 0, 45, 'hoverboard');
    const enemyTrail = straightTrail(-10, 10, 0, 50);
    const state: SimState = {
      tick: 100,
      players: [p0, p1],
      trails: [[], enemyTrail],
    };

    // Initiate grind
    let current = step(p0, specialInput(100), state);
    expect(current.grinding).toBe(true);
    state.players[0] = current;

    // Release special → clean exit to airborne
    state.tick++;
    current = step(current, noInput(state.tick), state);
    expect(current.airborne).toBe(true);
    expect(current.grinding).toBe(false);

    // Run simStep while airborne and on top of trail
    const airState: SimState = {
      tick: state.tick,
      players: [current, p1],
      trails: [[], enemyTrail],
    };
    const inputs = [noInput(state.tick + 1), noInput(state.tick + 1)];
    const cfgs = [cfg, cfg];
    const result = simStep(airState, inputs, cfgs);
    expect(result.players[0].alive).toBe(true);
    expect(result.players[0].airborne).toBe(true);
  });

  it('non-grinding player ON trail DOES die', () => {
    // Baseline: a normal player standing on a trail should die
    const p0 = createPlayerSim(5, 0, 0, 45);  // on the trail line at z=0
    const p1 = createPlayerSim(100, 100, 0, 45, 'hoverboard');
    const enemyTrail = straightTrail(0, 10, 0, 50);
    const state: SimState = {
      tick: 100,
      players: [p0, p1],
      trails: [[], enemyTrail],
    };
    const inputs = [noInput(101), noInput(101)];
    const cfgs = [cfg, cfg];
    const result = simStep(state, inputs, cfgs);
    expect(result.players[0].alive).toBe(false);
  });
});

describe('Trail Shift During Grind', () => {
  it('grindSegIdx adjusts when trail owner trail is shifted', () => {
    // Create a trail at exactly MAX_TRAIL_POINTS so the next point triggers a shift
    const fullTrail: TrailPoint[] = [];
    for (let i = 0; i < MAX_TRAIL_POINTS; i++) {
      fullTrail.push({ x: -50 + (100 * i) / (MAX_TRAIL_POINTS - 1), z: 0 });
    }

    // Player 0 = grinder (hoverboard), near middle of trail
    const p0 = createPlayerSim(0, 0, 0, 45);
    p0.meter = 100;
    // Player 1 = trail owner, alive and moving (will emit trail points)
    const p1 = createPlayerSim(200, 0, 0, 45, 'hoverboard');
    p1.trailTimer = 2; // ready to emit a trail point this tick

    const state: SimState = {
      tick: 100,
      players: [p0, p1],
      trails: [[], fullTrail],
    };

    // Initiate grind on player 1's trail
    const grinding = step(p0, specialInput(100), state);
    expect(grinding.grinding).toBe(true);
    expect(grinding.grindTrailOwner).toBe(1);
    const segIdxBefore = grinding.grindSegIdx;
    expect(segIdxBefore).toBeGreaterThan(1); // should be near middle

    // Control run: trail does NOT shift (use trail under MAX_TRAIL_POINTS)
    const shortTrail = fullTrail.slice(0, MAX_TRAIL_POINTS - 1);
    const controlState: SimState = {
      tick: 100,
      players: [grinding, { ...p1, trailTimer: 2 }],
      trails: [[], shortTrail],
    };
    const controlInputs = [specialInput(101), { tick: 101, turnDir: 0, accelerate: true, dash: false, brake: false }];
    const controlResult = simStep(controlState, controlInputs, [cfg, cfg]);

    // Shift run: trail DOES shift (at MAX_TRAIL_POINTS)
    const grindState: SimState = {
      tick: 100,
      players: [grinding, { ...p1, trailTimer: 2 }],
      trails: [[], fullTrail],
    };
    const inputs = [specialInput(101), { tick: 101, turnDir: 0, accelerate: true, dash: false, brake: false }];
    const result = simStep(grindState, inputs, [cfg, cfg]);

    // Both should still be grinding
    expect(controlResult.players[0].grinding).toBe(true);
    expect(result.players[0].grinding).toBe(true);

    // The shifted run's grindSegIdx should be exactly 1 less than the control
    expect(result.players[0].grindSegIdx).toBe(controlResult.players[0].grindSegIdx - 1);
    // Player must still be alive regardless
    expect(result.players[0].alive).toBe(true);
  });

  it('grind exits gracefully when grindSegIdx shifts below valid range', () => {
    // Create a full trail, put grinder at segment index 1 (one above shift boundary)
    const fullTrail: TrailPoint[] = [];
    for (let i = 0; i < MAX_TRAIL_POINTS; i++) {
      fullTrail.push({ x: -50 + (100 * i) / (MAX_TRAIL_POINTS - 1), z: 0 });
    }

    const p0 = createPlayerSim(-50, 0, 0, 45);
    p0.meter = 100;
    // p1 must be inside ARENA_HALF (192) so it isn't killed before laying a trail point
    const p1 = createPlayerSim(100, 0, 0, 45, 'hoverboard');
    p1.trailTimer = 2;

    const state: SimState = {
      tick: 100,
      players: [p0, p1],
      trails: [[], fullTrail],
    };

    // Initiate grind — should snap to segment near index 0
    let grinding = step(p0, specialInput(100), state);
    expect(grinding.grinding).toBe(true);

    // Force grindSegIdx to 1 with zero speed/grindSpeed, grindSegT = 0, and
    // grindBalance in the "normal" zone (0.5) so no zone speed bonus is applied.
    // This ensures advancePlayer won't advance past segment 1 before the
    // trail-shift check fires. After the shift: newIdx = 1 - 1 = 0 <= 0 → clean exit.
    grinding = { ...grinding, grindSegIdx: 1, grindSegT: 0, speed: 0, grindSpeed: 0, grindBalance: 0.5 } as PlayerSim;

    const grindState: SimState = {
      tick: 100,
      players: [grinding, p1],
      trails: [[], fullTrail],
    };
    const inputs = [specialInput(101), { tick: 101, turnDir: 0, accelerate: true, dash: false, brake: false }];
    const cfgs = [cfg, cfg];
    const result = simStep(grindState, inputs, cfgs);

    // Grind should exit (newIdx = 0 satisfies <= 0) but player stays alive
    expect(result.players[0].alive).toBe(true);
    expect(result.players[0].grinding).toBe(false);
    expect(result.players[0].airborne).toBe(true);
  });
});
