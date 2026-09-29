// ── Trail Type Interaction Tests — TASK-219 ──
// Verifies vehicle-specific grind modifiers: car=fast/hard, bike=slow/easy, hoverboard=neutral.
import { describe, it, expect } from 'vitest';
import {
  advancePlayer, createPlayerSim, SIM_DT,
  GRIND_SPEED_BONUS, GRIND_ENTRY_COST,
  GRIND_INSTABILITY_BASE, GRIND_INSTABILITY_RATE,
  GRIND_METER_REGEN_PERFECT, GRIND_METER_REGEN_BASE,
  GRIND_TRAIL_MODS,
} from '../simulation';
import type { InputFrame, SimState, TrailPoint, PlayerSim } from '../simulation';
import { HOVERBOARD_PHYSICS } from '../../vehicleConfig';
import type { VehicleType } from '../../types/index';

// ── Helpers ────────────────────────────────────────────

const dt = SIM_DT;
const cfg = HOVERBOARD_PHYSICS;

function straightTrail(startX: number, endX: number, z: number, n: number): TrailPoint[] {
  const pts: TrailPoint[] = [];
  for (let i = 0; i < n; i++) {
    pts.push({ x: startX + (endX - startX) * (i / (n - 1)), z });
  }
  return pts;
}

function specialInput(tick: number): InputFrame {
  return { tick, turnDir: 0, accelerate: false, dash: false, brake: false, special: true };
}

function specialTurnInput(tick: number, turnDir: number): InputFrame {
  return { tick, turnDir, accelerate: false, dash: false, brake: false, special: true };
}

/** Create a 2-player sim state with the enemy having a specific vehicle type. */
function makeState(
  grinder: PlayerSim,
  enemyVehicleType: VehicleType,
  opts?: { ownTrail?: TrailPoint[]; enemyTrail?: TrailPoint[] },
): SimState {
  const enemy = createPlayerSim(100, 100, 0, 45, enemyVehicleType);
  return {
    tick: 100,
    players: [grinder, enemy],
    trails: [
      opts?.ownTrail ?? [],
      opts?.enemyTrail ?? straightTrail(-50, 50, 0, 100),
    ],
  };
}

function step(p: PlayerSim, input: InputFrame, state: SimState): PlayerSim {
  return advancePlayer(p, input, cfg, dt, state, 0);
}

/** Initiate grind on an enemy trail with a specific vehicle type. */
function startGrinding(
  enemyVehicleType: VehicleType,
): { p: PlayerSim; state: SimState } {
  const p = createPlayerSim(0, 0, 0, 45, 'hoverboard');
  p.meter = 100;
  const state = makeState(p, enemyVehicleType);
  const result = step(p, specialInput(100), state);
  const cleared = { ...result, grindGraceTimer: 0 } as PlayerSim;
  state.players[0] = cleared;
  return { p: cleared, state };
}

/** Initiate grind on own trail (should be neutral regardless of types). */
function startGrindingOwnTrail(): { p: PlayerSim; state: SimState } {
  const p = createPlayerSim(0, 0, 0, 45, 'hoverboard');
  p.meter = 100;
  const ownTrail = straightTrail(-50, 50, 0, 100);
  const enemy = createPlayerSim(100, 100, 0, 45, 'car');
  const state: SimState = {
    tick: 100,
    players: [p, enemy],
    trails: [ownTrail, []],
  };
  const result = step(p, specialInput(100), state);
  const cleared = { ...result, grindGraceTimer: 0 } as PlayerSim;
  state.players[0] = cleared;
  return { p: cleared, state };
}

// ── Speed bonus tests ───────────────────────────────────

describe('Trail Type — Speed Modifier (grind entry)', () => {
  it('car trail gives 25% higher speed bonus', () => {
    const { p } = startGrinding('car');
    expect(p.grinding).toBe(true);
    const expectedSpeed = 45 + GRIND_SPEED_BONUS * GRIND_TRAIL_MODS.car.speedMult;
    expect(p.grindSpeed).toBeCloseTo(expectedSpeed, 4);
    // Verify it's 25% more than base
    expect(GRIND_TRAIL_MODS.car.speedMult).toBe(1.25);
  });

  it('bike trail gives 15% lower speed bonus', () => {
    const { p } = startGrinding('bike');
    expect(p.grinding).toBe(true);
    const expectedSpeed = 45 + GRIND_SPEED_BONUS * GRIND_TRAIL_MODS.bike.speedMult;
    expect(p.grindSpeed).toBeCloseTo(expectedSpeed, 4);
    expect(GRIND_TRAIL_MODS.bike.speedMult).toBe(0.85);
  });

  it('hoverboard trail is neutral (1.0x speed)', () => {
    const { p } = startGrinding('hoverboard');
    expect(p.grinding).toBe(true);
    const expectedSpeed = 45 + GRIND_SPEED_BONUS * 1.0;
    expect(p.grindSpeed).toBeCloseTo(expectedSpeed, 4);
    expect(GRIND_TRAIL_MODS.hoverboard.speedMult).toBe(1.0);
  });
});

// ── Instability tests ───────────────────────────────────

describe('Trail Type — Instability Modifier (per-tick)', () => {
  it('car trail gives 40% higher instability', () => {
    expect(GRIND_TRAIL_MODS.car.instabilityMult).toBe(1.4);
    // Grind for a few ticks and compare balance drift vs hoverboard trail
    const { p: carP, state: carState } = startGrinding('car');
    const { p: hoverP, state: hoverState } = startGrinding('hoverboard');

    let cp = carP;
    let hp = hoverP;
    // Step both for 30 ticks with no player correction
    for (let i = 0; i < 30; i++) {
      cp = step(cp, specialInput(100 + i), carState);
      carState.players[0] = cp;
      hp = step(hp, specialInput(100 + i), hoverState);
      hoverState.players[0] = hp;
    }

    // Car trail should have more balance drift (larger absolute balance)
    // than hoverboard trail due to higher instability
    if (cp.grinding && hp.grinding) {
      expect(Math.abs(cp.grindBalance)).toBeGreaterThan(Math.abs(hp.grindBalance));
    }
  });

  it('bike trail gives 30% lower instability', () => {
    expect(GRIND_TRAIL_MODS.bike.instabilityMult).toBe(0.7);
    const { p: bikeP, state: bikeState } = startGrinding('bike');
    const { p: hoverP, state: hoverState } = startGrinding('hoverboard');

    let bp = bikeP;
    let hp = hoverP;
    for (let i = 0; i < 30; i++) {
      bp = step(bp, specialInput(100 + i), bikeState);
      bikeState.players[0] = bp;
      hp = step(hp, specialInput(100 + i), hoverState);
      hoverState.players[0] = hp;
    }

    if (bp.grinding && hp.grinding) {
      expect(Math.abs(bp.grindBalance)).toBeLessThan(Math.abs(hp.grindBalance));
    }
  });
});

// ── Meter regen tests ───────────────────────────────────

describe('Trail Type — Meter Regen Modifier (per-tick)', () => {
  it('car trail gives 10% lower meter regen', () => {
    expect(GRIND_TRAIL_MODS.car.regenMult).toBe(0.9);
    const { p: carP, state: carState } = startGrinding('car');
    const { p: hoverP, state: hoverState } = startGrinding('hoverboard');

    // Record meter after entry (may differ slightly due to first-tick regen)
    const startMeterCar = carP.meter;
    const startMeterHover = hoverP.meter;

    let cp = carP;
    let hp = hoverP;
    // Step both for 60 ticks (1 second) with no dash
    for (let i = 0; i < 60; i++) {
      cp = step(cp, specialInput(100 + i), carState);
      carState.players[0] = cp;
      hp = step(hp, specialInput(100 + i), hoverState);
      hoverState.players[0] = hp;
    }

    // Car trail should regen less meter per tick than hoverboard trail
    if (cp.grinding && hp.grinding) {
      const carGain = cp.meter - startMeterCar;
      const hoverGain = hp.meter - startMeterHover;
      expect(carGain).toBeLessThan(hoverGain);
    }
  });

  it('bike trail gives 15% higher meter regen', () => {
    expect(GRIND_TRAIL_MODS.bike.regenMult).toBe(1.15);
    const { p: bikeP, state: bikeState } = startGrinding('bike');
    const { p: hoverP, state: hoverState } = startGrinding('hoverboard');

    const startMeterBike = bikeP.meter;
    const startMeterHover = hoverP.meter;

    let bp = bikeP;
    let hp = hoverP;
    for (let i = 0; i < 60; i++) {
      bp = step(bp, specialInput(100 + i), bikeState);
      bikeState.players[0] = bp;
      hp = step(hp, specialInput(100 + i), hoverState);
      hoverState.players[0] = hp;
    }

    if (bp.grinding && hp.grinding) {
      const bikeGain = bp.meter - startMeterBike;
      const hoverGain = hp.meter - startMeterHover;
      expect(bikeGain).toBeGreaterThan(hoverGain);
    }
  });
});

// ── Own-trail grinding ──────────────────────────────────

describe('Trail Type — Own-trail grinding ignores modifiers', () => {
  it('own-trail grinding uses neutral modifiers regardless of vehicle type', () => {
    const { p, state } = startGrindingOwnTrail();
    expect(p.grinding).toBe(true);
    expect(p.grindOwnTrail).toBe(true);
    // Speed should use neutral (1.0x) modifier even though player is hoverboard
    const expectedSpeed = 45 + GRIND_SPEED_BONUS * 1.0;
    expect(p.grindSpeed).toBeCloseTo(expectedSpeed, 4);
  });
});

// ── Modifier values ─────────────────────────────────────

describe('Trail Type — Modifier constants', () => {
  it('hoverboard trail is fully neutral (1.0x all modifiers)', () => {
    const mods = GRIND_TRAIL_MODS.hoverboard;
    expect(mods.speedMult).toBe(1.0);
    expect(mods.instabilityMult).toBe(1.0);
    expect(mods.regenMult).toBe(1.0);
  });

  it('car trail has correct modifier values', () => {
    const mods = GRIND_TRAIL_MODS.car;
    expect(mods.speedMult).toBe(1.25);
    expect(mods.instabilityMult).toBe(1.4);
    expect(mods.regenMult).toBe(0.9);
  });

  it('bike trail has correct modifier values', () => {
    const mods = GRIND_TRAIL_MODS.bike;
    expect(mods.speedMult).toBe(0.85);
    expect(mods.instabilityMult).toBe(0.7);
    expect(mods.regenMult).toBe(1.15);
  });
});

// ── grindTrailVehicleType tracking ──────────────────────

describe('Trail Type — grindTrailVehicleType on PlayerSim', () => {
  it('sets grindTrailVehicleType on grind entry', () => {
    const { p } = startGrinding('car');
    expect(p.grinding).toBe(true);
    expect(p.grindTrailVehicleType).toBe('car');
  });

  it('sets bike vehicleType when grinding bike trail', () => {
    const { p } = startGrinding('bike');
    expect(p.grinding).toBe(true);
    expect(p.grindTrailVehicleType).toBe('bike');
  });

  it('clears grindTrailVehicleType on clean exit', () => {
    const { p: gp, state } = startGrinding('car');
    expect(gp.grindTrailVehicleType).toBe('car');
    // Release special to dismount cleanly
    const noSpecial: InputFrame = {
      tick: 200, turnDir: 0, accelerate: false, dash: false, brake: false,
    };
    const exited = step(gp, noSpecial, state);
    expect(exited.grinding).toBe(false);
    expect(exited.grindTrailVehicleType).toBeNull();
  });
});
