// ── Grind Score Accumulation Tests — SPEC-82 Task 2 ──
import { describe, it, expect } from 'vitest';
import {
  advancePlayer,
  createPlayerSim,
  createSimState,
  SIM_DT,
  GRIND_SCORE_BASE_PER_SEGMENT,
  GRIND_SCORE_SWEET_MULT,
  GRIND_SCORE_DASH_MULT,
  GRIND_SWEET_SPOT,
  GRIND_DANGER_ZONE,
  GRIND_SCORE_MULT_CAP,
  GRIND_SCORE_MILESTONE_MULT_ADD,
  GRIND_SCORE_TRICK_MULT_ADD,
  finalizeGrindCashOut,
  consumeGrindBustScore,
} from '../simulation';
import type { InputFrame, SimState, PlayerSim } from '../simulation';
import { HOVERBOARD_PHYSICS } from '../../vehicleConfig';

const dt = SIM_DT;
const cfg = HOVERBOARD_PHYSICS;

function noInput(tick: number): InputFrame {
  return { tick, turnDir: 0, accelerate: false, dash: false, brake: false };
}

function dashInput(tick: number): InputFrame {
  return { tick, turnDir: 0, accelerate: false, dash: true, brake: false };
}

function step(p: PlayerSim, input: InputFrame, state: SimState): PlayerSim {
  return advancePlayer(p, input, cfg, dt, state, 0);
}

/**
 * Build a state with a straight enemy trail and player manually snapped into grinding.
 *
 * Trail segments are 100 units long so a single tick at grindSpeed=60 crosses
 * grindSegT += (60/100) * (1/60) = 0.01/frame. With grindSegT starting at 0.99
 * the player crosses the boundary in the very first tick — before balance physics
 * can accumulate more than a negligible amount. grindLeanDir=0 and grindRngState=42
 * (nonzero to avoid mulberry32(0) edge-case) keep the perturbation tiny.
 */
function setupGrindingPlayer(balance: number = 0.0): { state: SimState; p: PlayerSim } {
  // 32-point trail with segments spaced 100 units apart
  const enemyTrail = Array.from({ length: 32 }, (_, i) => ({ x: i * 100, z: 0 }));

  const state: SimState = {
    tick: 100,
    players: [
      createPlayerSim(0, 0, 0, 45, 'hoverboard'),
      createPlayerSim(10000, 10000, 0, 45, 'hoverboard'),
    ],
    trails: [[], enemyTrail],
  };

  const p = state.players[0];
  // Manually put player into mid-grind state (past grace, past first segment)
  p.grinding = true;
  p.grindTrailOwner = 1;
  p.grindSegIdx = 4;
  // Start at 0.99 so the very next tick crosses the segment boundary
  p.grindSegT = 0.99;
  p.grindBalance = balance;
  p.grindLeanDir = 0;
  p.grindGraceTimer = 0;
  p.grindDuration = 0.5;
  p.grindDirection = 1;
  // grindSpeed must produce grindSegT increment > 0.01/frame at segLen=100
  // (60 / 100) * (1/60) = 0.01 → crosses on frame 1
  p.grindSpeed = 60;
  p.grindRngState = 42; // nonzero seed for mulberry32
  p.grindOwnTrail = false;
  p.grindTrailVehicleType = state.players[1].vehicleType;
  p.grindRunActive = true;
  p.grindMultiplier = 1.0;
  p.grindScore = 0;
  p.grindStreakCount = 0;
  p.grindStreakBroken = false;
  p.meter = 80;

  state.players[0] = p;
  return { state, p };
}

/** Advance until grindStreakCount increases by 1, then return the mutated player. */
function advanceOneSegment(
  state: SimState,
  inputFn: (tick: number) => InputFrame,
  maxFrames = 120,
): PlayerSim {
  const p = state.players[0];
  const startStreak = p.grindStreakCount;
  for (let i = 0; i < maxFrames; i++) {
    if (!p.grinding) break;
    const next = step(p, inputFn(100 + i), state);
    Object.assign(p, next);
    state.players[0] = p;
    if (p.grindStreakCount !== startStreak) break;
  }
  return p;
}

// ── Tests ───────────────────────────────────────────────

describe('grind score accumulation (SPEC-82)', () => {
  it('defaults to 0 on fresh player sim', () => {
    const p = createPlayerSim(0, 0, 0, 30);
    expect(p.grindScore).toBe(0);
    expect(p.grindMultiplier).toBe(1.0);
    expect(p.grindChain).toEqual([]);
    expect(p.grindRunActive).toBe(false);
  });

  it('increments by base × sweet mult per segment in sweet spot', () => {
    const sweetBalance = 0.0; // dead center — well inside GRIND_SWEET_SPOT
    expect(sweetBalance).toBeLessThan(GRIND_SWEET_SPOT);
    const { state, p } = setupGrindingPlayer(sweetBalance);
    advanceOneSegment(state, noInput);
    expect(p.grindScore).toBe(GRIND_SCORE_BASE_PER_SEGMENT * GRIND_SCORE_SWEET_MULT);
  });

  it('increments by base × 1.0 per segment in normal zone', () => {
    // Normal zone: GRIND_SWEET_SPOT <= abs(balance) < GRIND_DANGER_ZONE
    const normalBalance = (GRIND_SWEET_SPOT + GRIND_DANGER_ZONE) / 2;
    const { state, p } = setupGrindingPlayer(normalBalance);
    advanceOneSegment(state, noInput);
    expect(p.grindScore).toBe(GRIND_SCORE_BASE_PER_SEGMENT);
  });

  it('does not increment in danger zone', () => {
    // Danger zone: abs(balance) >= GRIND_DANGER_ZONE
    const dangerBalance = GRIND_DANGER_ZONE + 0.05;
    const { state, p } = setupGrindingPlayer(dangerBalance);
    const prevScore = p.grindScore;
    // Run until bail or 120 frames
    for (let i = 0; i < 120; i++) {
      if (!p.grinding) break;
      const next = step(p, noInput(100 + i), state);
      Object.assign(p, next);
      state.players[0] = p;
    }
    expect(p.grindScore).toBe(prevScore);
  });

  it('applies dash factor on top of sweet spot score', () => {
    const sweetBalance = 0.0;
    const { state, p } = setupGrindingPlayer(sweetBalance);
    advanceOneSegment(state, dashInput);
    const expected = GRIND_SCORE_BASE_PER_SEGMENT * GRIND_SCORE_SWEET_MULT * GRIND_SCORE_DASH_MULT;
    expect(p.grindScore).toBe(expected);
  });

  it('applies dash factor on top of normal zone score', () => {
    const normalBalance = (GRIND_SWEET_SPOT + GRIND_DANGER_ZONE) / 2;
    const { state, p } = setupGrindingPlayer(normalBalance);
    advanceOneSegment(state, dashInput);
    const expected = GRIND_SCORE_BASE_PER_SEGMENT * GRIND_SCORE_DASH_MULT;
    expect(p.grindScore).toBe(expected);
  });

  it('scales by current multiplier (sweet spot)', () => {
    const sweetBalance = 0.0;
    const { state, p } = setupGrindingPlayer(sweetBalance);
    p.grindMultiplier = 3.0;
    state.players[0] = p;
    advanceOneSegment(state, noInput);
    expect(p.grindScore).toBe(GRIND_SCORE_BASE_PER_SEGMENT * GRIND_SCORE_SWEET_MULT * 3.0);
  });

  it('scales by current multiplier (normal zone)', () => {
    const normalBalance = (GRIND_SWEET_SPOT + GRIND_DANGER_ZONE) / 2;
    const { state, p } = setupGrindingPlayer(normalBalance);
    p.grindMultiplier = 3.0;
    state.players[0] = p;
    advanceOneSegment(state, noInput);
    expect(p.grindScore).toBe(GRIND_SCORE_BASE_PER_SEGMENT * 3.0);
  });

  it('own-trail grinds earn no score', () => {
    const { state, p } = setupGrindingPlayer(0.0);
    p.grindOwnTrail = true;
    // Redirect trail to player's own (index 0)
    p.grindTrailOwner = 0;
    state.trails[0] = Array.from({ length: 32 }, (_, i) => ({ x: i * 2, z: 0 }));
    p.grindSegIdx = 4;
    state.players[0] = p;
    advanceOneSegment(state, noInput);
    expect(p.grindScore).toBe(0);
  });

  it('score accumulates across multiple segments', () => {
    const { state, p } = setupGrindingPlayer(0.0);
    const expectedPerSeg = GRIND_SCORE_BASE_PER_SEGMENT * GRIND_SCORE_SWEET_MULT;

    // Force 3 segment crossings by re-entering grind state each iteration.
    // This exercises that grindScore is not cleared on re-entry (that's Task 5).
    // For now we just confirm each crossing adds the correct amount.
    let totalScore = 0;
    for (let seg = 0; seg < 3; seg++) {
      // Fully restore grinding state before each crossing
      Object.assign(p, {
        grinding: true,
        airborne: false,
        recovery: false,
        grindTrailOwner: 1,
        grindSegIdx: 4 + seg,
        grindSegT: 0.99,
        grindBalance: 0.0,
        grindLeanDir: 0,
        grindGraceTimer: 0,
        grindDuration: 0.5,
        grindDirection: 1,
        grindSpeed: 60,
        grindRngState: 42,
        grindOwnTrail: false,
        grindTrailVehicleType: state.players[1].vehicleType,
        grindRunActive: true,
        grindStreakCount: seg,
        grindStreakBroken: false,
        meter: 80,
        // Keep accumulated score
        grindScore: totalScore,
        grindMultiplier: 1.0,
      });
      state.players[0] = p;

      for (let i = 0; i < 10; i++) {
        const next = step(p, noInput(100 + seg * 10 + i), state);
        Object.assign(p, next);
        state.players[0] = p;
        if (p.grindScore > totalScore) break;
        if (!p.grinding) break;
      }
      totalScore = p.grindScore;
    }

    // 3 crossings each adding expectedPerSeg
    expect(p.grindScore).toBe(expectedPerSeg * 3);
  });
});

// ── Grind Multiplier Growth Tests — SPEC-82 Task 3 ────────────────────────────

describe('grind multiplier growth (SPEC-82)', () => {
  it('grows by +0.5 when a streak milestone is crossed', () => {
    const { state, p } = setupGrindingPlayer();
    p.grindBalance = 0.5; // inside normal zone (GRIND_SWEET_SPOT~0.3, GRIND_DANGER_ZONE~0.7)
    p.grindStreakCount = 9; // one segment away from milestone 10
    p.grindMultiplier = 1.0;
    state.players[0] = p;

    // Advance until streakCount reaches 10
    for (let i = 0; i < 60 && p.grindStreakCount < 10; i++) {
      const next = step(p, noInput(100 + i), state);
      Object.assign(p, next);
      state.players[0] = p;
    }

    expect(p.grindMultiplier).toBeCloseTo(1.0 + GRIND_SCORE_MILESTONE_MULT_ADD, 5);
    expect(p.grindChainDirty).toBeGreaterThan(0);
  });

  it('caps multiplier at GRIND_SCORE_MULT_CAP (10.0)', () => {
    const { state, p } = setupGrindingPlayer();
    p.grindBalance = 0.5;
    p.grindMultiplier = 9.8;
    p.grindStreakCount = 9;
    state.players[0] = p;

    for (let i = 0; i < 60 && p.grindStreakCount < 10; i++) {
      const next = step(p, noInput(100 + i), state);
      Object.assign(p, next);
      state.players[0] = p;
    }

    expect(p.grindMultiplier).toBe(GRIND_SCORE_MULT_CAP);
  });

  it('grows by +0.5 on trick landing when run is active', () => {
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
    p.trickDetected = 'SPIN';
    p.trickMeterBonus = 8;
    p.airborne = true;
    p.airborneTimer = 0; // triggers landing transition this frame
    p.recovery = false;
    p.landingPenalty = false;
    p.meter = 50;
    state.players[0] = p;

    const next = step(p, noInput(100), state);
    Object.assign(p, next);

    expect(p.grindChain).toContain('SPIN');
    expect(p.grindMultiplier).toBeCloseTo(1.0 + GRIND_SCORE_TRICK_MULT_ADD, 5);
    expect(p.grindChainDirty).toBeGreaterThan(0);
  });

  it('does NOT push to chain or grow multiplier when run is inactive', () => {
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
    p.grindRunActive = false;
    p.grindMultiplier = 1.0;
    p.grindChain = [];
    p.grindChainDirty = 0;
    p.trickDetected = 'SPIN';
    p.airborne = true;
    p.airborneTimer = 0;
    p.recovery = false;
    p.landingPenalty = false;
    p.meter = 50;
    state.players[0] = p;

    const next = step(p, noInput(100), state);
    Object.assign(p, next);

    expect(p.grindChain).toEqual([]);
    expect(p.grindMultiplier).toBe(1.0);
  });
});

// ── Grind Run Lifecycle Tests — SPEC-82 Task 5 ────────────────────────────

describe('grind run lifecycle (SPEC-82)', () => {
  it('sets grindRunActive=true on fresh grind entry and resets stale score', () => {
    // Construct a player with stale run fields (as if a previous run wasn't cleaned up),
    // then manually simulate entry by setting grinding=true with grindRunActive=false.
    // The entry-reset block should fire on the first advancePlayer call.
    const enemyTrail = Array.from({ length: 32 }, (_, i) => ({ x: i * 100, z: 0 }));
    const state: SimState = {
      tick: 100,
      players: [
        createPlayerSim(0, 0, 0, 30, 'hoverboard'),
        createPlayerSim(10000, 10000, 0, 30, 'hoverboard'),
      ],
      trails: [[], enemyTrail],
    };

    const p = state.players[0];
    // Stale state from a prior run
    p.grindScore = 9999;
    p.grindMultiplier = 5.0;
    p.grindChain = ['SPIN', 'FLIP'];
    p.grindRunActive = false;   // ← not yet active
    p.grindBustScore = 0;
    // Put player into grinding but NOT active run yet (as entry-reset logic detects)
    p.grinding = true;
    p.grindTrailOwner = 1;
    p.grindSegIdx = 4;
    p.grindSegT = 0.5;
    p.grindBalance = 0;
    p.grindLeanDir = 0;
    p.grindGraceTimer = 0.3;
    p.grindDuration = 0;
    p.grindDirection = 1;
    p.grindSpeed = 60;
    p.grindRngState = 42;
    p.grindOwnTrail = false;
    p.grindTrailVehicleType = state.players[1].vehicleType;
    p.grindStreakCount = 0;
    p.grindStreakBroken = false;
    p.meter = 80;
    state.players[0] = p;

    // Step once — entry-reset should fire because grinding=true but grindRunActive=false
    const next = step(p, noInput(100), state);
    Object.assign(p, next);

    expect(p.grindRunActive).toBe(true);
    expect(p.grindScore).toBe(0);
    expect(p.grindMultiplier).toBe(1.0);
    expect(p.grindChain).toEqual([]);
    expect(p.grindBustScore).toBe(0);
  });

  it('snapshots score to grindBustScore and resets on bail', () => {
    const { state, p } = setupGrindingPlayer();
    p.grindScore = 1200;
    p.grindMultiplier = 3.5;
    p.grindChain = ['SPIN', 'FLIP'];
    p.grindRunActive = true;
    // Force bail: set balance past threshold, past grace
    p.grindBalance = 1.05;
    p.grindGraceTimer = 0;
    state.players[0] = p;

    // Step until exit
    for (let i = 0; i < 10; i++) {
      if (!p.grinding) break;
      const next = step(p, noInput(100 + i), state);
      Object.assign(p, next);
      state.players[0] = p;
    }

    expect(p.grinding).toBe(false);
    expect(p.grindBustScore).toBe(1200);
    expect(p.grindScore).toBe(0);
    expect(p.grindMultiplier).toBe(1.0);
    expect(p.grindChain).toEqual([]);
    expect(p.grindRunActive).toBe(false);
  });

  it('cashes out score to meter when player becomes fully grounded after a run', () => {
    // Build a player who just completed a grind run (grindRunActive=true,
    // grindScore=400, grinding=false, airborne=false, recovery=false, grindCooldown=0).
    // On the next step, cash-out should fire:
    //   meter += floor(400/20) = 20
    //   grindRunActive flips to false
    //   grindScore remains 400 for one-frame UI read
    const enemyTrail = Array.from({ length: 32 }, (_, i) => ({ x: i * 100, z: 0 }));
    const state: SimState = {
      tick: 100,
      players: [
        createPlayerSim(0, 0, 0, 30, 'hoverboard'),
        createPlayerSim(10000, 10000, 0, 30, 'hoverboard'),
      ],
      trails: [[], enemyTrail],
    };

    const p = state.players[0];
    p.grindScore = 400;
    p.meter = 30;
    p.grindRunActive = true;
    p.grinding = false;
    p.airborne = false;
    p.recovery = false;
    p.grindCooldown = 0;
    state.players[0] = p;

    const next = step(p, noInput(100), state);
    Object.assign(p, next);

    expect(p.meter).toBeCloseTo(50, 0);  // 30 + floor(400/20) = 30 + 20 = 50
    expect(p.grindRunActive).toBe(false);
    expect(p.grindScore).toBe(400);  // still intact for UI snapshot
  });

  it('finalizeGrindCashOut clears score/mult/chain and bumps dirty', () => {
    const p = createPlayerSim(0, 0, 0, 30);
    p.grindScore = 400;
    p.grindMultiplier = 3.0;
    p.grindChain = ['A', 'B'];
    const before = p.grindChainDirty;
    finalizeGrindCashOut(p);
    expect(p.grindScore).toBe(0);
    expect(p.grindMultiplier).toBe(1.0);
    expect(p.grindChain).toEqual([]);
    expect(p.grindChainDirty).toBe(before + 1);
  });

  it('consumeGrindBustScore returns and clears the bust score', () => {
    const p = createPlayerSim(0, 0, 0, 30);
    p.grindBustScore = 1200;
    expect(consumeGrindBustScore(p)).toBe(1200);
    expect(p.grindBustScore).toBe(0);
    expect(consumeGrindBustScore(p)).toBe(0);
  });
});
