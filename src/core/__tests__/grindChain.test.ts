// ── Grind Chain Accumulation + Boundary Tests — SPEC-82 Task 4 ──
import { describe, it, expect } from 'vitest';
import {
  advancePlayer,
  createPlayerSim,
  createSimState,
  SIM_DT,
  GRIND_CHAIN_MAX_LENGTH,
} from '../simulation';
import type { InputFrame, SimState, PlayerSim } from '../simulation';
import { HOVERBOARD_PHYSICS } from '../../vehicleConfig';

const dt = SIM_DT;
const cfg = HOVERBOARD_PHYSICS;

function noInput(tick: number): InputFrame {
  return { tick, turnDir: 0, accelerate: false, dash: false, brake: false };
}

function step(p: PlayerSim, input: InputFrame, state: SimState): PlayerSim {
  return advancePlayer(p, input, cfg, dt, state, 0);
}

/**
 * Build a state with a player in the airborne→landing moment with a detected trick.
 * airborneTimer=0 means the landing branch fires on the very first advance.
 */
function airborneWithTrick(name: string): { state: SimState; p: PlayerSim } {
  const enemyTrail = Array.from({ length: 32 }, (_, i) => ({ x: i * 100, z: 0 }));

  const state: SimState = {
    tick: 100,
    players: [
      createPlayerSim(0, 0, 0, 30),
      createPlayerSim(10000, 10000, 0, 30),
    ],
    trails: [[], enemyTrail],
  };

  const p = state.players[0];
  p.grindRunActive = true;
  p.grindMultiplier = 1.0;
  p.grindChain = [];
  p.grindChainDirty = 0;
  p.trickDetected = name;
  p.trickMeterBonus = 8;
  p.airborne = true;
  p.airborneTimer = 0; // triggers landing transition this frame
  p.recovery = false;
  p.landingPenalty = false;
  p.meter = 50;
  state.players[0] = p;

  return { state, p };
}

// ── Tests ───────────────────────────────────────────────

describe('grind chain accumulation (SPEC-82)', () => {
  it('pushes trick name on landing', () => {
    const { state, p } = airborneWithTrick('CORKSCREW');
    const next = step(p, noInput(100), state);
    Object.assign(p, next);

    expect(p.grindChain).toContain('CORKSCREW');
  });

  it('truncates oldest when array is at GRIND_CHAIN_MAX_LENGTH and a new trick lands', () => {
    const { state, p } = airborneWithTrick('NEW');
    p.grindChain = Array(GRIND_CHAIN_MAX_LENGTH).fill('OLD');
    state.players[0] = p;

    const next = step(p, noInput(100), state);
    Object.assign(p, next);

    expect(p.grindChain.length).toBe(GRIND_CHAIN_MAX_LENGTH);
    // First 'OLD' got shifted out; 'NEW' should be at the end
    expect(p.grindChain[GRIND_CHAIN_MAX_LENGTH - 1]).toBe('NEW');
    // Positions 0..MAX-2 should still be 'OLD'
    for (let i = 0; i < GRIND_CHAIN_MAX_LENGTH - 1; i++) {
      expect(p.grindChain[i]).toBe('OLD');
    }
  });

  it('never exceeds GRIND_CHAIN_MAX_LENGTH even at the exact boundary', () => {
    // Pre-fill with MAX-1 items, then land one trick. Chain should go to MAX exactly.
    const { state: state1, p: p1 } = airborneWithTrick('A');
    p1.grindChain = Array(GRIND_CHAIN_MAX_LENGTH - 1).fill('X');
    state1.players[0] = p1;

    const next1 = step(p1, noInput(100), state1);
    Object.assign(p1, next1);

    expect(p1.grindChain.length).toBe(GRIND_CHAIN_MAX_LENGTH);
    expect(p1.grindChain[GRIND_CHAIN_MAX_LENGTH - 1]).toBe('A');

    // Now pre-fill with MAX items, land another. Chain stays at MAX.
    const { state: state2, p: p2 } = airborneWithTrick('B');
    p2.grindChain = Array(GRIND_CHAIN_MAX_LENGTH).fill('Y');
    state2.players[0] = p2;

    const next2 = step(p2, noInput(100), state2);
    Object.assign(p2, next2);

    expect(p2.grindChain.length).toBe(GRIND_CHAIN_MAX_LENGTH);
    expect(p2.grindChain[GRIND_CHAIN_MAX_LENGTH - 1]).toBe('B');
  });

  it('increments grindChainDirty on push', () => {
    const { state, p } = airborneWithTrick('SPIN');
    const before = p.grindChainDirty;

    const next = step(p, noInput(100), state);
    Object.assign(p, next);

    expect(p.grindChainDirty).toBe(before + 1);
  });

  it('does NOT push when grindRunActive is false', () => {
    const { state, p } = airborneWithTrick('SPIN');
    p.grindRunActive = false;
    state.players[0] = p;

    const next = step(p, noInput(100), state);
    Object.assign(p, next);

    expect(p.grindChain).toEqual([]);
  });

  it('does NOT push when trickDetected is empty string', () => {
    const { state, p } = airborneWithTrick('');

    const next = step(p, noInput(100), state);
    Object.assign(p, next);

    expect(p.grindChain).toEqual([]);
  });
});
