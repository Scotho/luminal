// ── Grind Full Lifecycle Integration Tests ───────────────
import { describe, it, expect } from 'vitest';
import {
  advancePlayer, createPlayerSim, SIM_DT,
  GRIND_ENTRY_COST, GRIND_COOLDOWN,
  GRIND_BAIL_SPEED_MULT, GRIND_BAIL_METER_PENALTY,
  GRIND_AIRBORNE_CLEAN, GRIND_AIRBORNE_BAIL,
  GRIND_RECOVERY_CLEAN, GRIND_RECOVERY_BAIL,
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

function step(p: PlayerSim, input: InputFrame, state: SimState): PlayerSim {
  return advancePlayer(p, input, cfg, dt, state, 0);
}

// ── Tests ──────────────────────────────────────────────

describe('grind full lifecycle', () => {
  it('initiate -> grind -> ride to end -> airborne -> recovery -> cooldown -> normal', () => {
    const shortTrail = straightTrail(0, 15, 0, 20);
    const p = createPlayerSim(0, 0, 0, 45);
    p.meter = 100;
    const state: SimState = {
      tick: 0,
      players: [p, createPlayerSim(200, 200, 0, 45, 'hoverboard')],
      trails: [[], shortTrail],
    };

    // 1. Initiate grind
    let current = step(p, specialInput(state.tick), state);
    state.players[0] = current;
    expect(current.grinding).toBe(true);
    expect(current.grindTrailOwner).toBe(1);
    expect(current.meter).toBeGreaterThanOrEqual(100 - GRIND_ENTRY_COST);

    // 2. Grind until trail end — pin balance to sweet spot
    let maxTicks = 500;
    while (current.grinding && maxTicks-- > 0) {
      state.tick++;
      current = { ...current, grindBalance: 0, grindLeanDir: 0 } as PlayerSim;
      current = step(current, specialInput(state.tick), state);
      state.players[0] = current;
    }
    expect(maxTicks).toBeGreaterThan(0);

    // 3. Verify clean airborne
    expect(current.grinding).toBe(false);
    expect(current.airborne).toBe(true);
    expect(current.landingPenalty).toBe(false);

    // 4. Wait out airborne
    maxTicks = 300;
    while (current.airborne && maxTicks-- > 0) {
      state.tick++;
      current = step(current, noInput(state.tick), state);
      state.players[0] = current;
    }
    expect(current.airborne).toBe(false);
    expect(current.recovery).toBe(true);

    // 5. Wait out recovery
    maxTicks = 300;
    while (current.recovery && maxTicks-- > 0) {
      state.tick++;
      current = step(current, noInput(state.tick), state);
      state.players[0] = current;
    }
    expect(current.recovery).toBe(false);
    expect(current.grindCooldown).toBeGreaterThan(0);

    // 6. Wait out cooldown
    maxTicks = 1000;
    while (current.grindCooldown > 0 && maxTicks-- > 0) {
      state.tick++;
      current = step(current, noInput(state.tick), state);
      state.players[0] = current;
    }
    expect(current.grindCooldown).toBe(0);

    // 7. Fully normal
    expect(current.grinding).toBe(false);
    expect(current.airborne).toBe(false);
    expect(current.recovery).toBe(false);
    expect(current.alive).toBe(true);

    // 8. Meter gained from sweet-spot grinding
    expect(current.meter).toBeGreaterThan(100 - GRIND_ENTRY_COST);
  });

  it('bail lifecycle: initiate -> grind -> bail -> harsh airborne -> harsh recovery', () => {
    const trail = straightTrail(-50, 50, 0, 100);
    const p = createPlayerSim(0, 0, 0, 45);
    p.meter = 100;
    const state: SimState = {
      tick: 0,
      players: [p, createPlayerSim(200, 200, 0, 45, 'hoverboard')],
      trails: [[], trail],
    };

    // 1. Initiate grind
    let current = step(p, specialInput(state.tick), state);
    state.players[0] = current;
    expect(current.grinding).toBe(true);

    const speedAfterEntry = current.speed;
    const meterAfterEntry = current.meter;

    // 2. Force bail — high positive lean velocity pushes past 1.0
    //    Clear grindGraceTimer so destabilization physics run this tick.
    current = { ...current, grindBalance: 0.98, grindLeanDir: 5.0, grindGraceTimer: 0 } as PlayerSim;
    state.players[0] = current;
    state.tick++;
    current = step(current, specialInput(state.tick), state);
    state.players[0] = current;

    // 3. Verify bail penalties
    expect(current.grinding).toBe(false);
    expect(current.airborne).toBe(true);
    expect(current.landingPenalty).toBe(true);
    expect(current.speed).toBeCloseTo(speedAfterEntry * GRIND_BAIL_SPEED_MULT, 0);
    expect(current.meter).toBeCloseTo(meterAfterEntry - GRIND_BAIL_METER_PENALTY, 0);
    expect(current.airborneTimer).toBeCloseTo(GRIND_AIRBORNE_BAIL, 2);
    expect(current.grindBailSide).toBe(1); // bailed to the right

    // 4. Wait through bail airborne
    let airTicks = 0;
    while (current.airborne && airTicks < 300) {
      state.tick++;
      current = step(current, noInput(state.tick), state);
      state.players[0] = current;
      airTicks++;
    }
    expect(current.airborne).toBe(false);
    expect(current.recovery).toBe(true);
    expect(current.recoveryTimer).toBeCloseTo(GRIND_RECOVERY_BAIL, 1);

    // 5. Wait through bail recovery
    let recTicks = 0;
    while (current.recovery && recTicks < 300) {
      state.tick++;
      current = step(current, noInput(state.tick), state);
      state.players[0] = current;
      recTicks++;
    }
    expect(current.recovery).toBe(false);
    expect(current.grindCooldown).toBeCloseTo(GRIND_COOLDOWN, 1);
  });

  it('own trail grind gives no meter regen', () => {
    const ownTrail = straightTrail(-50, 50, 0, 100);
    const p = createPlayerSim(0, 0, 0, 45);
    const startMeter = 80;
    p.meter = startMeter;

    const state: SimState = {
      tick: 0,
      players: [p, createPlayerSim(200, 200, 0, 45, 'hoverboard')],
      trails: [ownTrail, []],
    };

    // 1. Initiate own-trail grind
    let current = step(p, specialInput(state.tick), state);
    state.players[0] = current;
    expect(current.grinding).toBe(true);
    expect(current.grindOwnTrail).toBe(true);
    expect(current.meter).toBe(startMeter);

    // 2. Grind with balance pinned to sweet spot
    for (let i = 0; i < 30; i++) {
      state.tick++;
      current = { ...current, grindBalance: 0, grindLeanDir: 0 } as PlayerSim;
      current = step(current, specialInput(state.tick), state);
      state.players[0] = current;
      expect(current.meter).toBe(startMeter);
      if (!current.grinding) break;
    }
    expect(current.meter).toBe(startMeter);
  });
});
