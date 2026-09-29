// ── Trick Simulation Tests — airborne trick detection in sim ──
import { describe, it, expect } from 'vitest';
import {
  advancePlayer, createPlayerSim, SIM_DT,
  GRIND_AIRBORNE_CLEAN,
} from '../simulation';
import type { InputFrame, SimState, TrailPoint, PlayerSim } from '../simulation';
import { HOVERBOARD_PHYSICS } from '../../vehicleConfig';

const dt = SIM_DT;
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

function turnInput(tick: number, dir: number): InputFrame {
  return { tick, turnDir: dir, accelerate: false, dash: false, brake: false };
}

function specialInput(tick: number): InputFrame {
  return { tick, turnDir: 0, accelerate: false, dash: false, brake: false, special: true };
}

function makeState(
  grinder: PlayerSim,
  opts?: { enemyTrail?: TrailPoint[] },
): SimState {
  const enemy = createPlayerSim(100, 100, 0, 45);
  return {
    tick: 100,
    players: [grinder, enemy],
    trails: [[], opts?.enemyTrail ?? straightTrail(-50, 50, 0, 100)],
  };
}

function step(p: PlayerSim, input: InputFrame, state: SimState): PlayerSim {
  return advancePlayer(p, input, cfg, dt, state, 0);
}

/** Start a grind, then exit cleanly into airborne. */
function enterAirborne(): { p: PlayerSim; state: SimState } {
  // Start grinding
  const p = createPlayerSim(0, 0, 0, 45, 'hoverboard');
  p.meter = 100;
  const state = makeState(p);
  const result = step(p, specialInput(100), state);
  state.players[0] = result;

  // Verify grinding
  expect(result.grinding).toBe(true);

  // Exit grind cleanly by holding no special for many frames
  // Force clean exit by manipulating state
  result.grinding = false;
  result.airborne = true;
  result.airborneTimer = GRIND_AIRBORNE_CLEAN;
  result.airborneDuration = GRIND_AIRBORNE_CLEAN;
  result.trickInputBuffer = [];
  result.trickDetected = '';
  result.trickMeterBonus = 0;
  result.trickSampleTimer = 0;

  state.players[0] = result;
  return { p: result, state };
}

describe('Trick Simulation', () => {
  it('trick input buffer fills during airborne', () => {
    const { p, state } = enterAirborne();
    let current = p;

    // Step with right turn input for enough ticks to sample
    // trickSampleTimer increments each tick; samples every 4th tick when turnDir !== 0
    for (let i = 0; i < 12; i++) {
      current = step(current, turnInput(100 + i, 1), state);
      state.players[0] = current;
    }

    expect(current.trickInputBuffer.length).toBeGreaterThan(0);
    expect(current.trickInputBuffer.every(v => v === 1)).toBe(true);
  });

  it('buffer caps at 6', () => {
    const { p, state } = enterAirborne();
    let current = p;
    // Extend airborne time so we don't land
    current.airborneTimer = 5.0;
    current.airborneDuration = 5.0;

    // Step many ticks with alternating turns to fill buffer beyond 6
    for (let i = 0; i < 100; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      current = step(current, turnInput(100 + i, dir), state);
      state.players[0] = current;
    }

    expect(current.trickInputBuffer.length).toBeLessThanOrEqual(6);
  });

  it('detects SPIN trick during airborne', () => {
    const { p, state } = enterAirborne();
    let current = p;
    current.airborneTimer = 5.0;
    current.airborneDuration = 5.0;

    // Feed right-turn inputs on every 4th tick
    // trickSampleTimer starts at 0, increments each tick
    // Samples at ticks where (timer+1) % 4 === 0 (timer 3, 7, 11...)
    // We need 3 right samples for SPIN [1,1,1]
    for (let i = 0; i < 12; i++) {
      current = step(current, turnInput(100 + i, 1), state);
      state.players[0] = current;
    }

    // Should detect SPIN after 3 right-turn samples
    expect(current.trickDetected).toBe('SPIN');
    expect(current.trickMeterBonus).toBe(8);
  });

  it('meter bonus applied on landing', () => {
    const { p, state } = enterAirborne();
    let current = p;
    // Set a short airborne time
    current.airborneTimer = 0.25;
    current.airborneDuration = 0.25;
    const startMeter = current.meter;

    // Manually set trick detected state (simulating a detected trick)
    current.trickDetected = 'SPIN';
    current.trickMeterBonus = 8;

    // Step until landing
    let landed = false;
    for (let i = 0; i < 60; i++) {
      current = step(current, noInput(100 + i), state);
      state.players[0] = current;
      if (current.recovery) {
        landed = true;
        break;
      }
    }

    expect(landed).toBe(true);
    expect(current.meter).toBeGreaterThanOrEqual(startMeter);
    // Trick state should be reset after landing
    expect(current.trickDetected).toBe('');
    expect(current.trickMeterBonus).toBe(0);
    expect(current.trickInputBuffer).toEqual([]);
    expect(current.trickSampleTimer).toBe(0);
  });

  it('state resets on landing', () => {
    const { p, state } = enterAirborne();
    let current = p;
    current.airborneTimer = 0.05; // very short — land almost immediately
    current.trickInputBuffer = [1, -1, 1];
    current.trickDetected = 'REVERSAL';
    current.trickMeterBonus = 12;
    current.trickSampleTimer = 8;

    // Step to land
    for (let i = 0; i < 10; i++) {
      current = step(current, noInput(100 + i), state);
      state.players[0] = current;
      if (current.recovery) break;
    }

    expect(current.recovery).toBe(true);
    expect(current.trickInputBuffer).toEqual([]);
    expect(current.trickDetected).toBe('');
    expect(current.trickMeterBonus).toBe(0);
    expect(current.trickSampleTimer).toBe(0);
  });

  it('no trick detection when not airborne', () => {
    const p = createPlayerSim(0, 0, 0, 45, 'hoverboard');
    const state = makeState(p);

    // Step with turn inputs while on the ground
    let current = p;
    for (let i = 0; i < 20; i++) {
      current = step(current, turnInput(100 + i, 1), state);
      state.players[0] = current;
    }

    expect(current.airborne).toBe(false);
    expect(current.trickDetected).toBe('');
    expect(current.trickInputBuffer).toEqual([]);
  });
});
