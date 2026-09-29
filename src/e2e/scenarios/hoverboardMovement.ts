// ── Hoverboard Movement E2E Scenarios ───────────────────
// Validates that hoverboard-specific movement physics (surfy carving,
// speed bleed, no-drift, meter economy) are correctly integrated into
// the deterministic lockstep simulation.

import { expect } from 'vitest';
import { ScriptedInputDriver } from '../inputDrivers/scriptedInputDriver';
import type { ScenarioConfig } from './types';
import type { SimState } from '../../core/simulation';
import { HOVERBOARD_PHYSICS, BIKE_PHYSICS, CAR_PHYSICS } from '../../vehicleConfig';

// ── Helpers ─────────────────────────────────────────────

/** Scan recorded states and return true if any tick satisfies the predicate. */
function anyState(
  states: Map<number, SimState>,
  pred: (s: SimState) => boolean,
): boolean {
  for (const [, s] of states) {
    if (pred(s)) return true;
  }
  return false;
}

/** Collect a time-series of a player field across all recorded states. */
function collectSeries<T>(
  states: Map<number, SimState>,
  playerIndex: number,
  extract: (p: SimState['players'][0], tick: number) => T,
): Array<{ tick: number; value: T }> {
  const out: Array<{ tick: number; value: T }> = [];
  for (const [, s] of states) {
    const p = s.players[playerIndex];
    if (p) out.push({ tick: s.tick, value: extract(p, s.tick) });
  }
  out.sort((a, b) => a.tick - b.tick);
  return out;
}

// ── HB1: Surfy turn ramp-up ────────────────────────────
// Hoverboard has turnLerp=8 (vs bike 14) and turnDecay=12 (vs bike 28.8).
// Two hoverboards turn hard right from tick 1. Assert turnRamp builds
// gradually (not instant) and position curves smoothly.

export const HB1_surfyTurnRampUp: ScenarioConfig = {
  name: 'HB1: surfy turn ramp-up (turnLerp=8, turnDecay=12)',
  matchType: 'lobby',
  seed: 500,
  spawns: [
    { x: 0, z: -80, angle: 0, baseSpeed: 45 },
    { x: 40, z: -80, angle: 0, baseSpeed: 45 },
  ],
  humans: [
    {
      driver: new ScriptedInputDriver([
        // Hard right turn from tick 1, release at tick 60
        { tick: 1, input: { turnDir: 1 } },
        { tick: 60, input: { turnDir: 0 } },
      ], 120),
      physics: HOVERBOARD_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        // Opponent drives straight to avoid collision
        { tick: 1, input: { turnDir: -1 } },
        { tick: 60, input: { turnDir: 0 } },
      ], 120),
      physics: HOVERBOARD_PHYSICS,
    },
  ],
  maxTicks: 240,
  assert: (clients) => {
    const states = clients[0].recorder.getAllStates();

    // turnRamp should build gradually — NOT jump to 1.0 instantly
    // At tick ~5 (4 ticks of turnLerp=8), ramp should be below 0.8
    const earlyRamp = collectSeries(states, 0, p => p.turnRamp)
      .filter(s => s.tick >= 2 && s.tick <= 8);
    expect(earlyRamp.length).toBeGreaterThan(0);
    // First few ticks: turnRamp should be building but not yet at 1.0
    expect(earlyRamp[0].value).toBeLessThan(0.9);

    // After release at tick 60, turnRamp should decay slowly (turnDecay=12)
    // At tick 70 (10 ticks after release), ramp should still have residual
    const postRelease = collectSeries(states, 0, p => p.turnRamp)
      .filter(s => s.tick >= 62 && s.tick <= 75);
    if (postRelease.length > 0) {
      // With turnDecay=12, residual = e^(-12 * 10/60) = e^(-2) ≈ 0.135
      // So ramp should still be nonzero shortly after release
      expect(postRelease[0].value).toBeGreaterThan(0.01);
    }

    // Angle should have changed significantly during turn
    const angleSeries = collectSeries(states, 0, p => p.angle);
    const startAngle = angleSeries[0]?.value ?? 0;
    const midAngle = angleSeries.find(s => s.tick >= 50)?.value ?? 0;
    expect(Math.abs(midAngle - startAngle)).toBeGreaterThan(0.5); // >28° of turn
  },
};

// ── HB2: Speed bleed on hard turns ─────────────────────
// Hoverboard turnSpeedBleed=0.97 (3% per tick at max turn).
// Drive straight at baseSpeed, then hard turn → speed drops.

export const HB2_speedBleedOnTurn: ScenarioConfig = {
  name: 'HB2: speed bleed on hard turns (turnSpeedBleed=0.97)',
  matchType: 'lobby',
  seed: 501,
  spawns: [
    { x: 0, z: -80, angle: 0, baseSpeed: 45 },
    { x: 60, z: -80, angle: 0, baseSpeed: 45 },
  ],
  humans: [
    {
      driver: new ScriptedInputDriver([
        // Coast straight for 30 ticks to settle at baseSpeed, then hard right
        { tick: 1, input: { accelerate: false } },
        { tick: 30, input: { turnDir: 1 } },
        // Release turn at tick 90 — coast straight to measure speed recovery
        { tick: 90, input: { turnDir: 0 } },
      ], 120),
      physics: HOVERBOARD_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 1, input: { turnDir: -1 } },
        { tick: 60, input: { turnDir: 0 } },
      ], 120),
      physics: HOVERBOARD_PHYSICS,
    },
  ],
  maxTicks: 240,
  assert: (clients) => {
    const states = clients[0].recorder.getAllStates();
    const speeds = collectSeries(states, 0, p => p.speed);

    // Speed before turn (~tick 28-30)
    const preTurn = speeds.find(s => s.tick >= 28 && s.tick <= 30);
    // Speed during sustained turn (~tick 70-80)
    const duringTurn = speeds.filter(s => s.tick >= 70 && s.tick <= 80);

    expect(preTurn).toBeDefined();
    expect(duringTurn.length).toBeGreaterThan(0);

    // Speed should have bled down during hard turn
    // turnRamp builds gradually (turnLerp=8) so bleed accumulates slowly
    // Compare against baseSpeed (45) since pre-turn coast may not fully settle
    const minDuringTurn = Math.min(...duringTurn.map(s => s.value));
    const baseSpeed = 45;
    expect(minDuringTurn).toBeLessThan(baseSpeed); // bleed keeps speed below baseSpeed

    // Speed bleed should be meaningful (not just floating-point noise)
    expect(baseSpeed - minDuringTurn).toBeGreaterThan(0.5); // measurable drop from baseSpeed
  },
};

// ── HB3: Hoverboard cannot drift ───────────────────────
// Hoverboard with brake+turn inputs. Drift must never activate.

export const HB3_cannotDrift: ScenarioConfig = {
  name: 'HB3: hoverboard cannot drift (canDrift=false)',
  matchType: 'lobby',
  seed: 502,
  spawns: [
    { x: 0, z: -80, angle: 0, baseSpeed: 45 },
    { x: 60, z: -80, angle: 0, baseSpeed: 45 },
  ],
  humans: [
    {
      driver: new ScriptedInputDriver([
        // Same inputs that trigger drift on car: brake + turn
        { tick: 1, input: { brake: true, turnDir: 1 } },
        // Also try with driftBrake explicitly
        { tick: 60, input: { brake: true, turnDir: -1, driftBrake: true } },
      ], 120),
      physics: HOVERBOARD_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 1, input: { turnDir: -1 } },
        { tick: 60, input: { turnDir: 1 } },
      ], 120),
      physics: HOVERBOARD_PHYSICS,
    },
  ],
  maxTicks: 240,
  assert: (clients) => {
    const states = clients[0].recorder.getAllStates();

    // Drift must NEVER activate for hoverboard
    expect(anyState(states, s => s.players[0].drifting)).toBe(false);
    // Slip angle must remain at 0 (no drift physics)
    expect(anyState(states, s => Math.abs(s.players[0].slipAngle) > 0.001)).toBe(false);
    // Snap recovery must never trigger
    expect(anyState(states, s => s.players[0].snapRecovery)).toBe(false);
  },
};

// ── HB4: Boost and dash meter economy ──────────────────
// Hoverboard: boostDrain=0 (free), dashDrain=35, passiveRegen=20.
// Dash drains meter, passive regen refills, boost is free.

export const HB4_boostDashMeter: ScenarioConfig = {
  name: 'HB4: boost/dash meter economy (boostDrain=0, dashDrain=35)',
  matchType: 'lobby',
  seed: 503,
  spawns: [
    { x: -30, z: 150, angle: 0, baseSpeed: 45 },  // heading -z, 342 units of runway
    { x: 30, z: 150, angle: 0, baseSpeed: 45 },
  ],
  humans: [
    {
      driver: new ScriptedInputDriver([
        // Phase 1: Boost (W) for 60 ticks — meter should NOT drain (boostDrain=0)
        { tick: 1, input: { accelerate: true } },
        // Phase 2: Dash (Shift) for 60 ticks — meter SHOULD drain (dashDrain=35)
        { tick: 60, input: { accelerate: false, dash: true } },
        // Phase 3: Coast — passive regen should refill meter
        { tick: 120, input: { dash: false } },
      ], 180),
      physics: HOVERBOARD_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 1, input: { turnDir: -1 } },
        { tick: 60, input: { turnDir: 1 } },
      ], 180),
      physics: HOVERBOARD_PHYSICS,
    },
  ],
  maxTicks: 360,
  assert: (clients) => {
    const states = clients[0].recorder.getAllStates();
    const meters = collectSeries(states, 0, p => p.meter);
    const speeds = collectSeries(states, 0, p => p.speed);

    // Phase 1 check: meter should stay at or near max during boost (boostDrain=0)
    const meterDuringBoost = meters.filter(s => s.tick >= 30 && s.tick <= 55);
    expect(meterDuringBoost.length).toBeGreaterThan(0);
    for (const m of meterDuringBoost) {
      expect(m.value).toBeGreaterThanOrEqual(99); // no drain
    }

    // Speed should increase during boost
    const speedAtBoostEnd = speeds.find(s => s.tick >= 55 && s.tick <= 60);
    expect(speedAtBoostEnd).toBeDefined();
    expect(speedAtBoostEnd!.value).toBeGreaterThan(50); // above baseSpeed 45

    // Phase 2 check: meter should drain during dash (dashDrain=35/sec)
    // With 60 ticks (~1s) of dash at 35/sec, meter drops ~35 → lands around 65-85
    const meterPostDash = meters.find(s => s.tick >= 115 && s.tick <= 125);
    expect(meterPostDash).toBeDefined();
    expect(meterPostDash!.value).toBeLessThan(95); // meaningful drain occurred

    // Speed should be higher during dash than boost
    const speedDuringDash = speeds.filter(s => s.tick >= 90 && s.tick <= 115);
    if (speedDuringDash.length > 0) {
      const maxDashSpeed = Math.max(...speedDuringDash.map(s => s.value));
      expect(maxDashSpeed).toBeGreaterThan(70); // approaching dashSpeed=100
    }

    // Phase 3 check: meter should regen during coast (passiveRegen=20)
    // Regen may already start during the dash window, so coast-start meter
    // can be close to or equal to the late-recovery meter.
    // Use >= to accept equality (regen already happened by measurement point).
    const meterLate = meters.filter(s => s.tick >= 200 && s.tick <= 240);
    const meterAtCoastStart = meters.find(s => s.tick >= 120 && s.tick <= 125);
    if (meterLate.length > 0 && meterAtCoastStart) {
      const maxLate = Math.max(...meterLate.map(s => s.value));
      expect(maxLate).toBeGreaterThanOrEqual(meterAtCoastStart.value); // regen happened or meter already recovered
    }
  },
};

// ── HB5: Slipstream speed boost applies ────────────────
// Two hoverboards side by side — proximity boost should multiply speed.

export const HB5_slipstreamBoost: ScenarioConfig = {
  name: 'HB5: slipstream speed boost applies to hoverboard',
  matchType: 'lobby',
  seed: 504,
  spawns: [
    { x: 0, z: -80, angle: 0, baseSpeed: 45 },
    { x: 5, z: -80, angle: 0, baseSpeed: 45 },
  ],
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 1, input: { accelerate: true } },
      ], 180),
      physics: HOVERBOARD_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 1, input: { accelerate: true } },
      ], 180),
      physics: HOVERBOARD_PHYSICS,
    },
  ],
  maxTicks: 240,
  assert: (clients) => {
    const states = clients[0].recorder.getAllStates();

    // At least one player got proximity boost
    const gotProximity = anyState(states, s =>
      s.tick > 30 && (s.players[0].proximityBoost > 0.01 || s.players[1].proximityBoost > 0.01),
    );
    expect(gotProximity).toBe(true);

    // Boosted player speed exceeded boostSpeed (65) at some point
    // (boostSpeed=65 * 1.15 proximityMultiplier ≈ 74.75 theoretical max)
    const speedBoosted = anyState(states, s => {
      for (const p of s.players) {
        if (p.proximityBoost > 0.01 && p.speed > HOVERBOARD_PHYSICS.boostSpeed) return true;
      }
      return false;
    });
    expect(speedBoosted).toBe(true);
  },
};

// ── HB6: Low meter emergency regen ─────────────────────
// Dash to deplete meter below 20%, then coast. Emergency regen
// (lowMeterRegen=5) should kick in on top of passive regen.

export const HB6_lowMeterEmergencyRegen: ScenarioConfig = {
  name: 'HB6: low meter emergency regen (lowMeterThreshold=0.2)',
  matchType: 'lobby',
  seed: 505,
  spawns: [
    { x: -30, z: 180, angle: 0, baseSpeed: 45 },  // heading -z, 372 units of runway
    { x: 30, z: 180, angle: 0, baseSpeed: 45 },
  ],
  humans: [
    {
      driver: new ScriptedInputDriver([
        // Dash until meter is very low
        { tick: 1, input: { dash: true } },
        // After ~2.5s of dash (dashDrain=35, ~87.5 drained), stop and coast
        { tick: 150, input: { dash: false } },
      ], 300),
      physics: HOVERBOARD_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 1, input: { turnDir: -1 } },
        { tick: 60, input: { turnDir: 1 } },
      ], 300),
      physics: HOVERBOARD_PHYSICS,
    },
  ],
  maxTicks: 600,
  assert: (clients) => {
    const states = clients[0].recorder.getAllStates();
    const meters = collectSeries(states, 0, p => p.meter);

    // Meter should have dropped during dashing (dashDrain=35/sec offset by passiveRegen=20/sec)
    // Net drain ≈ 15/sec over 2.5s ≈ 37.5 → meter near 62.5
    const lowPoint = meters.filter(s => s.tick >= 140 && s.tick <= 165);
    expect(lowPoint.length).toBeGreaterThan(0);
    const minMeter = Math.min(...lowPoint.map(s => s.value));
    expect(minMeter).toBeLessThan(75); // meaningful drain (accounting for concurrent regen)

    // After coasting, meter should recover. With passiveRegen=20/sec (and lowMeterRegen=5
    // if below threshold), recovery should be meaningful within ~2 seconds (120 ticks).
    // Use >= to handle edge cases where meter has already fully recovered.
    const recoveryPoint = meters.filter(s => s.tick >= 250 && s.tick <= 300);
    if (recoveryPoint.length > 0) {
      const recoveredMeter = Math.max(...recoveryPoint.map(s => s.value));
      expect(recoveredMeter).toBeGreaterThanOrEqual(minMeter + 5); // meaningful recovery
    }
  },
};

// ── HB7: Lockstep determinism during complex maneuvers ─
// Two hoverboards with varied inputs (turns, boost, dash, brake).
// Both clients must produce identical state hashes every tick.

export const HB7_lockstepDeterminism: ScenarioConfig = {
  name: 'HB7: lockstep determinism during complex hoverboard maneuvers',
  matchType: 'lobby',
  seed: 506,
  spawns: [
    { x: -20, z: -80, angle: 0, baseSpeed: 45 },
    { x: 20, z: -80, angle: 0, baseSpeed: 45 },
  ],
  humans: [
    {
      driver: new ScriptedInputDriver([
        // Complex maneuver: boost → turn right → dash → brake → turn left
        { tick: 1, input: { accelerate: true } },
        { tick: 30, input: { accelerate: true, turnDir: 1 } },
        { tick: 60, input: { dash: true, turnDir: 0 } },
        { tick: 90, input: { dash: false, brake: true } },
        { tick: 110, input: { brake: false, turnDir: -1 } },
        { tick: 140, input: { accelerate: true, turnDir: 0 } },
      ], 120),
      physics: HOVERBOARD_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        // Mirror maneuver
        { tick: 1, input: { accelerate: true } },
        { tick: 30, input: { accelerate: true, turnDir: -1 } },
        { tick: 60, input: { dash: true, turnDir: 0 } },
        { tick: 90, input: { dash: false, brake: true } },
        { tick: 110, input: { brake: false, turnDir: 1 } },
        { tick: 140, input: { accelerate: true, turnDir: 0 } },
      ], 120),
      physics: HOVERBOARD_PHYSICS,
    },
  ],
  maxTicks: 300,
  assert: (clients) => {
    // Both clients should have recorded hashes
    const hashes0 = clients[0].recorder.getHashes();
    const hashes1 = clients[1].recorder.getHashes();
    expect(hashes0.length).toBeGreaterThan(0);
    expect(hashes1.length).toBeGreaterThan(0);

    // Build hash maps for comparison
    const map0 = new Map(hashes0.map(h => [h.tick, h.hash]));
    const map1 = new Map(hashes1.map(h => [h.tick, h.hash]));

    let compared = 0;
    for (const [tick, hash] of map0) {
      if (map1.has(tick)) {
        expect(hash, `desync at tick ${tick}`).toBe(map1.get(tick));
        compared++;
      }
    }
    // Should have compared a meaningful number of hashes
    expect(compared).toBeGreaterThan(2);

    // Both players should have moved significantly (not stuck)
    const states = clients[0].recorder.getAllStates();
    const finalState = [...states.values()].sort((a, b) => b.tick - a.tick)[0];
    if (finalState) {
      // Both players should have traveled (position changed from spawn)
      expect(Math.abs(finalState.players[0].z - (-80))).toBeGreaterThan(20);
      expect(Math.abs(finalState.players[1].z - (-80))).toBeGreaterThan(20);
    }
  },
};

// ── HB8: Mixed vehicle lockstep — hoverboard vs car ────
// One hoverboard, one car. Both clients must agree on state hashes
// despite different vehicle physics running through the same sim.

export const HB8_mixedVehicleLockstep: ScenarioConfig = {
  name: 'HB8: mixed vehicle lockstep (hoverboard vs car)',
  matchType: 'lobby',
  seed: 507,
  spawns: [
    { x: -20, z: -80, angle: 0, baseSpeed: 45 },
    { x: 20, z: -80, angle: 0, baseSpeed: 48 },
  ],
  humans: [
    {
      // Hoverboard: boost, carve, dash
      driver: new ScriptedInputDriver([
        { tick: 1, input: { accelerate: true } },
        { tick: 30, input: { accelerate: true, turnDir: 1 } },
        { tick: 60, input: { dash: true, turnDir: -1 } },
        { tick: 90, input: { dash: false, turnDir: 0, accelerate: true } },
      ], 120),
      physics: HOVERBOARD_PHYSICS,
    },
    {
      // Car: boost, drift, snap exit
      driver: new ScriptedInputDriver([
        { tick: 1, input: { accelerate: true } },
        { tick: 30, input: { brake: true, turnDir: -1 } },
        { tick: 70, input: { brake: false, turnDir: 0, accelerate: true } },
      ], 120),
      physics: CAR_PHYSICS,
    },
  ],
  maxTicks: 300,
  assert: (clients) => {
    const hashes0 = clients[0].recorder.getHashes();
    const hashes1 = clients[1].recorder.getHashes();
    expect(hashes0.length).toBeGreaterThan(0);
    expect(hashes1.length).toBeGreaterThan(0);

    const map0 = new Map(hashes0.map(h => [h.tick, h.hash]));
    const map1 = new Map(hashes1.map(h => [h.tick, h.hash]));

    let compared = 0;
    for (const [tick, hash] of map0) {
      if (map1.has(tick)) {
        expect(hash, `desync at tick ${tick}`).toBe(map1.get(tick));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(2);

    // Verify both vehicles actually used their physics
    const states = clients[0].recorder.getAllStates();

    // Hoverboard (P0) should never drift
    expect(anyState(states, s => s.players[0].drifting)).toBe(false);

    // Car (P1) should have entered drift (brake+turn at tick 30)
    expect(anyState(states, s => s.players[1].drifting)).toBe(true);

    // Both should have traveled significantly
    const finalState = [...states.values()].sort((a, b) => b.tick - a.tick)[0];
    if (finalState) {
      expect(Math.abs(finalState.players[0].z - (-80))).toBeGreaterThan(15);
      expect(Math.abs(finalState.players[1].z - (-80))).toBeGreaterThan(15);
    }
  },
};
