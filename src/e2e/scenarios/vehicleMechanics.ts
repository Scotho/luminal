// ── Vehicle Mechanics E2E Scenarios ─────────────────────
// Drift (car) and slipstream (bike) physics verification.
// Run via LoopbackTransport (no real network).

import { expect } from 'vitest';
import { ScriptedInputDriver } from '../inputDrivers/scriptedInputDriver';
import type { ScenarioConfig } from './types';
import type { SimState } from '../../core/simulation';
import { CAR_PHYSICS } from '../../vehicleConfig';

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

// ── D1: Drift entry + slip angle ────────────────────────
// Car brakes with turn from tick 1. Assert drift activates and slip builds.
export const D1_driftEntry: ScenarioConfig = {
  name: 'D1: drift entry + slip angle',
  matchType: 'casual',
  seed: 301,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 1, input: { brake: true, turnDir: 1 } },
      ], 120),
      physics: CAR_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 1 } },
      ], 120),
      physics: CAR_PHYSICS,
    },
  ],
  maxTicks: 180,
  assert: (clients) => {
    const states = clients[0].recorder.getAllStates();

    // Drift activated
    expect(anyState(states, s => s.players[0].drifting)).toBe(true);

    // Slip angle built beyond trivial threshold (0.05 rad ≈ 2.9°)
    expect(anyState(states, s => Math.abs(s.players[0].slipAngle) > 0.05)).toBe(true);
  },
};

// ── D2: Drift meter regen ───────────────────────────────
// Car dashes briefly to drain meter, then drifts to verify regen.
export const D2_driftMeterRegen: ScenarioConfig = {
  name: 'D2: drift meter regen',
  matchType: 'casual',
  seed: 302,
  humans: [
    {
      driver: new ScriptedInputDriver([
        // Dash briefly to drain meter, then drift to regen
        { tick: 1, input: { accelerate: true, dash: true } },
        { tick: 30, input: { accelerate: false, dash: false, brake: true, turnDir: 1 } },
      ], 180),
      physics: CAR_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 1 } },
      ], 180),
      physics: CAR_PHYSICS,
    },
  ],
  maxTicks: 240,
  assert: (clients) => {
    const states = clients[0].recorder.getAllStates();

    // Find meter at tick 30 (post-dash, pre-drift) and at a later tick during drift
    let meterAtDriftStart = 100;
    let meterDuringDrift = 0;
    for (const [, s] of states) {
      const p = s.players[0];
      if (s.tick >= 30 && s.tick <= 35 && !p.drifting) {
        meterAtDriftStart = Math.min(meterAtDriftStart, p.meter);
      }
      if (p.drifting && s.tick > 90) {
        meterDuringDrift = Math.max(meterDuringDrift, p.meter);
      }
    }

    // Meter should have drained below max from dashing
    expect(meterAtDriftStart).toBeLessThan(100);
    // Meter should have regenerated during drift
    expect(meterDuringDrift).toBeGreaterThan(meterAtDriftStart);
  },
};

// ── D3: Drift exit on brake release ─────────────────────
// Car drifts for 60 ticks, then releases brake. Drift should end.
export const D3_driftExit: ScenarioConfig = {
  name: 'D3: drift exit on brake release',
  matchType: 'casual',
  seed: 303,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 1, input: { brake: true, turnDir: 1 } },
        // Release brake at tick 60, go straight
        { tick: 60, input: { brake: false, turnDir: 0, accelerate: true } },
      ], 180),
      physics: CAR_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 1 } },
      ], 180),
      physics: CAR_PHYSICS,
    },
  ],
  maxTicks: 240,
  assert: (clients) => {
    const states = clients[0].recorder.getAllStates();

    // Was drifting before release
    expect(anyState(states, s => s.tick < 60 && s.players[0].drifting)).toBe(true);
    // Eventually stopped drifting after release
    expect(anyState(states, s => s.tick > 80 && !s.players[0].drifting && !s.players[0].snapRecovery)).toBe(true);
  },
};

// ── D4: Snap recovery ───────────────────────────────────
// Car drifts hard (brake + full turn) to build high slip, then releases
// brake. At slip > snapExitSlipThreshold (0.35 rad), snap recovery triggers.
export const D4_snapRecovery: ScenarioConfig = {
  name: 'D4: snap recovery',
  matchType: 'casual',
  seed: 304,
  humans: [
    {
      driver: new ScriptedInputDriver([
        // Heavy drift to build slip angle
        { tick: 1, input: { brake: true, turnDir: 1, accelerate: true } },
        // Release brake at tick 90 — slip should be above 0.35 by now
        { tick: 90, input: { brake: false, turnDir: 0, accelerate: true } },
      ], 120),
      physics: CAR_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 1 } },
      ], 120),
      physics: CAR_PHYSICS,
    },
  ],
  maxTicks: 240,
  assert: (clients) => {
    const states = clients[0].recorder.getAllStates();

    // Built meaningful slip during drift (> 0.20 rad ≈ 11.5°)
    expect(anyState(states, s =>
      s.players[0].drifting && Math.abs(s.players[0].slipAngle) > 0.20,
    )).toBe(true);

    // Snap recovery triggered after brake release
    expect(anyState(states, s => s.players[0].snapRecovery)).toBe(true);
  },
};

// ── D5: Bike cannot drift ───────────────────────────────
// Bike with identical brake+turn inputs. Drift must never activate.
export const D5_bikeCannotDrift: ScenarioConfig = {
  name: 'D5: bike cannot drift',
  matchType: 'casual',
  seed: 305,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 1, input: { brake: true, turnDir: 1 } },
      ], 120),
      // BIKE_PHYSICS is default (canDrift: false)
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 1 } },
      ], 120),
    },
  ],
  maxTicks: 180,
  assert: (clients) => {
    const states = clients[0].recorder.getAllStates();

    // Drift must NEVER activate for bike
    expect(anyState(states, s => s.players[0].drifting)).toBe(false);
  },
};

// ── SL1: Slipstream boost activation (bike) ────────────
// Two bikes spawned 5 units apart, same heading. Both go straight.
// Player 1 runs parallel to player 0's trail → proximityBoost > 0.
export const SL1_slipstreamActivation: ScenarioConfig = {
  name: 'SL1: slipstream boost activation',
  matchType: 'casual',
  seed: 306,
  spawns: [
    { x: 0, z: -60, angle: 0, baseSpeed: 45 },   // P0 heading +z
    { x: 5, z: -60, angle: 0, baseSpeed: 45 },   // P1 5 units right, same heading
  ],
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 1, input: { accelerate: true } },
      ], 180),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 1, input: { accelerate: true } },
      ], 180),
    },
  ],
  maxTicks: 240,
  assert: (clients) => {
    const states = clients[0].recorder.getAllStates();

    // At least one player got proximity boost (both should, since trails are mutual)
    const p0Boosted = anyState(states, s =>
      s.tick > 30 && s.players[0].proximityBoost > 0.01,
    );
    const p1Boosted = anyState(states, s =>
      s.tick > 30 && s.players[1].proximityBoost > 0.01,
    );
    expect(p0Boosted || p1Boosted).toBe(true);

    // Boosted player's speed exceeded base speed at some point
    // (bike baseSpeed=45, with 15% max boost → up to ~51.75)
    const speedBoosted = anyState(states, s => {
      for (const p of s.players) {
        if (p.proximityBoost > 0.01 && p.speed > 45) return true;
      }
      return false;
    });
    expect(speedBoosted).toBe(true);
  },
};

// ── SL2: Car proximity boost does not multiply speed ────
// Two cars spawned 5 units apart, same heading. Both go straight.
// proximityBoost is computed (nonzero), but speed is NOT multiplied
// because `!cfg.canDrift` is false for car.
export const SL2_carNoSlipstreamSpeed: ScenarioConfig = {
  name: 'SL2: car proximity computed but speed not boosted',
  matchType: 'casual',
  seed: 307,
  spawns: [
    { x: 0, z: -60, angle: 0, baseSpeed: 48 },
    { x: 5, z: -60, angle: 0, baseSpeed: 48 },
  ],
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 1, input: { accelerate: true } },
      ], 180),
      physics: CAR_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 1, input: { accelerate: true } },
      ], 180),
      physics: CAR_PHYSICS,
    },
  ],
  maxTicks: 240,
  assert: (clients) => {
    const states = clients[0].recorder.getAllStates();

    // proximityBoost IS computed (nonzero)
    expect(anyState(states, s =>
      s.tick > 30 && (s.players[0].proximityBoost > 0.01 || s.players[1].proximityBoost > 0.01),
    )).toBe(true);

    // Speed never exceeds car boostSpeed (62) — proximity doesn't inflate it
    // (with W held car approaches boostSpeed=62 via accelLerp, but proximity
    // would push it to 62 * 1.15 ≈ 71.3 if applied — well above boostSpeed)
    for (const [, s] of states) {
      for (const p of s.players) {
        if (p.alive) {
          expect(p.speed).toBeLessThanOrEqual(63); // small tolerance above boostSpeed
        }
      }
    }
  },
};
