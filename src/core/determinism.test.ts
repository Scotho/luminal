// ── Simulation Determinism Test Harness ────────────────────
// Runs two independent sim copies through 600+ ticks with identical inputs,
// applying the same pre-step proximity/meter computation and per-tick
// quantization as the real lockstep manager. Catches non-determinism
// without needing two browser tabs.

import { describe, it, expect } from 'vitest';
import {
  simStep, createSimState, cloneSimState, hashSimState, quantizePlayers, quantizeSimState,
  serializeSimState, deserializeSimState,
  SIM_DT, type SimState, type InputFrame, type PlayerSpawn,
} from './simulation';
import {
  computeTrailDistances, computeProximityBoost, computeMeterRecharge,
  QUANTIZE_INTERVAL,
} from './lockstepManager';
import { BIKE_PHYSICS, CAR_PHYSICS } from '../vehicleConfig';
import type { VehiclePhysics } from '../vehicleConfig';
import { seededRandom, recreateRng } from './seededRandom';
import { createAIState, cloneAIState, getAIInputSim } from '../ai';
import { SimSpatialGrid } from './simSpatialGrid';

// ── Constants matching lockstepManager ──────────────────────
const HASH_INTERVAL = 60;
const TOTAL_TICKS = 600;

// ── Helpers ────────────────────────────────────────────────

function spawn2(): PlayerSpawn[] {
  return [
    { x: -50, z: 0, angle: 0, baseSpeed: 40 },
    { x: 50, z: 0, angle: Math.PI, baseSpeed: 40 },
  ];
}

function spawnClose(): PlayerSpawn[] {
  return [
    { x: -10, z: 0, angle: 0, baseSpeed: 40 },
    { x: 10, z: 0, angle: Math.PI, baseSpeed: 40 },
  ];
}

/** Replicate _computeProximityAndMeter from LockstepManager. */
function applyProximityAndMeter(state: SimState): void {
  const playerCount = state.players.length;
  for (let i = 0; i < playerCount; i++) {
    const p = state.players[i];
    if (!p.alive) continue;

    let minDist = Infinity;
    let minEnemyDist = Infinity;

    for (let j = 0; j < state.trails.length; j++) {
      if (j === i) continue;
      const result = computeTrailDistances(p.x, p.z, state.trails[i], state.trails[j]);
      minDist = Math.min(minDist, result.minDist);
      minEnemyDist = Math.min(minEnemyDist, result.minEnemyDist);
    }

    state.players[i] = {
      ...p,
      proximityBoost: computeProximityBoost(minDist, p.proximityBoost, SIM_DT),
    };
    const newMeter = computeMeterRecharge(
      p.x, p.z, minEnemyDist, state.players[i].meter, state.players[i].dashing, SIM_DT,
    );
    state.players[i] = { ...state.players[i], meter: newMeter };
  }
}

/** Apply per-tick quantization matching the real lockstep manager. */
function applyQuantization(state: SimState): SimState {
  if (state.tick % QUANTIZE_INTERVAL === 0) {
    return quantizeSimState(state);
  }
  return quantizePlayers(state);
}

type InputPattern = 'straight' | 'zigzag' | 'drift' | 'dash' | 'brake';

function generateInput(tick: number, pattern: InputPattern): InputFrame {
  switch (pattern) {
    case 'straight':
      return { tick, turnDir: 0, accelerate: true, dash: false, brake: false };
    case 'zigzag':
      return { tick, turnDir: (Math.floor(tick / 30) % 2 === 0 ? 1 : -1) as 1 | -1, accelerate: true, dash: false, brake: false };
    case 'drift':
      return { tick, turnDir: 1, accelerate: true, dash: false, brake: tick >= 60 && tick < 120, driftBrake: tick >= 60 && tick < 120 };
    case 'dash':
      return { tick, turnDir: 0, accelerate: true, dash: tick % 120 < 30, brake: false };
    case 'brake':
      return { tick, turnDir: 0, accelerate: false, dash: false, brake: true };
  }
}

interface SimRun {
  hashes: Map<number, number>;
  finalState: SimState;
}

/** Run a full simulation with proximity/meter pre-step and quantization. */
function runSim(
  spawns: PlayerSpawn[],
  cfgs: VehiclePhysics[],
  inputPatterns: InputPattern[],
  ticks: number,
): SimRun {
  let state = createSimState(0, spawns);
  const hashes = new Map<number, number>();
  let hashCounter = 0;

  for (let t = 1; t <= ticks; t++) {
    const inputs = inputPatterns.map((pattern, i) => generateInput(t, pattern));

    // Pre-step: proximity and meter (matches lockstep _simTick ordering)
    applyProximityAndMeter(state);

    // Advance
    state = simStep(state, inputs, cfgs);

    // Quantization (matches lockstep exactly)
    state = applyQuantization(state);

    // Hash at intervals (matches lockstep exactly)
    hashCounter++;
    if (hashCounter >= HASH_INTERVAL) {
      hashCounter = 0;
      hashes.set(state.tick, hashSimState(state));
    }
  }

  return { hashes, finalState: state };
}

/** Assert two runs produced identical hashes at every check point. */
function assertHashesMatch(a: SimRun, b: SimRun): void {
  expect(a.hashes.size).toBeGreaterThan(0);
  expect(a.hashes.size).toBe(b.hashes.size);
  for (const [tick, hashA] of a.hashes) {
    const hashB = b.hashes.get(tick);
    expect(hashB).toBeDefined();
    if (hashA !== hashB) {
      // Find first diverging field for debugging
      const sa = a.finalState;
      const sb = b.finalState;
      const fields = sa.players.map((p, i) => {
        const q = sb.players[i];
        const diffs: string[] = [];
        for (const key of Object.keys(p) as (keyof typeof p)[]) {
          if (p[key] !== q[key]) diffs.push(`${key}: ${p[key]} vs ${q[key]}`);
        }
        return diffs.length ? `p${i}: ${diffs.join(', ')}` : null;
      }).filter(Boolean);
      throw new Error(
        `Hash mismatch at tick ${tick}: 0x${hashA.toString(16)} vs 0x${hashB!.toString(16)}\n` +
        `Final state diffs: ${fields.length ? fields.join('; ') : 'none (trail difference?)'}`,
      );
    }
  }
}

// ── Tests ──────────────────────────────────────────────────

describe('Simulation Determinism', () => {
  it('baseline: straight-line bikes produce identical hashes over 600 ticks', () => {
    const a = runSim(spawn2(), [BIKE_PHYSICS, BIKE_PHYSICS], ['straight', 'straight'], TOTAL_TICKS);
    const b = runSim(spawn2(), [BIKE_PHYSICS, BIKE_PHYSICS], ['straight', 'straight'], TOTAL_TICKS);
    assertHashesMatch(a, b);
  });

  it('turning inputs: zigzag bikes produce identical hashes', () => {
    const a = runSim(spawn2(), [BIKE_PHYSICS, BIKE_PHYSICS], ['zigzag', 'zigzag'], TOTAL_TICKS);
    const b = runSim(spawn2(), [BIKE_PHYSICS, BIKE_PHYSICS], ['zigzag', 'zigzag'], TOTAL_TICKS);
    assertHashesMatch(a, b);
  });

  it('car drift: brake-triggered drift produces identical hashes', () => {
    const a = runSim(spawn2(), [CAR_PHYSICS, CAR_PHYSICS], ['drift', 'drift'], TOTAL_TICKS);
    const b = runSim(spawn2(), [CAR_PHYSICS, CAR_PHYSICS], ['drift', 'drift'], TOTAL_TICKS);
    assertHashesMatch(a, b);
  });

  it('mixed vehicles: bike vs car produce identical hashes', () => {
    const a = runSim(spawn2(), [BIKE_PHYSICS, CAR_PHYSICS], ['zigzag', 'drift'], TOTAL_TICKS);
    const b = runSim(spawn2(), [BIKE_PHYSICS, CAR_PHYSICS], ['zigzag', 'drift'], TOTAL_TICKS);
    assertHashesMatch(a, b);
  });

  it('proximity boost: close-spawned players produce identical hashes', () => {
    const a = runSim(spawnClose(), [BIKE_PHYSICS, BIKE_PHYSICS], ['straight', 'straight'], TOTAL_TICKS);
    const b = runSim(spawnClose(), [BIKE_PHYSICS, BIKE_PHYSICS], ['straight', 'straight'], TOTAL_TICKS);
    assertHashesMatch(a, b);
  });

  it('dash inputs: periodic dashing produces identical hashes', () => {
    const a = runSim(spawn2(), [BIKE_PHYSICS, BIKE_PHYSICS], ['dash', 'zigzag'], TOTAL_TICKS);
    const b = runSim(spawn2(), [BIKE_PHYSICS, BIKE_PHYSICS], ['dash', 'zigzag'], TOTAL_TICKS);
    assertHashesMatch(a, b);
  });

  it('post-recovery: serialize at tick 100, deserialize, continue 500 ticks', () => {
    // Run first 100 ticks
    const initial = runSim(spawn2(), [CAR_PHYSICS, CAR_PHYSICS], ['drift', 'zigzag'], 100);

    // Simulate recovery: serialize + deserialize the state
    const serialized = serializeSimState(initial.finalState);
    const recoveredA = deserializeSimState(serialized);
    const recoveredB = deserializeSimState(serialized);

    // Continue both from recovered state for 500 more ticks
    let stateA = recoveredA;
    let stateB = recoveredB;
    const hashesA = new Map<number, number>();
    const hashesB = new Map<number, number>();
    let hashCounter = 0;

    for (let t = initial.finalState.tick + 1; t <= initial.finalState.tick + 500; t++) {
      const inputs = [generateInput(t, 'drift'), generateInput(t, 'zigzag')];
      const cfgs = [CAR_PHYSICS, CAR_PHYSICS];

      applyProximityAndMeter(stateA);
      stateA = simStep(stateA, inputs, cfgs);
      stateA = applyQuantization(stateA);

      applyProximityAndMeter(stateB);
      stateB = simStep(stateB, inputs, cfgs);
      stateB = applyQuantization(stateB);

      hashCounter++;
      if (hashCounter >= HASH_INTERVAL) {
        hashCounter = 0;
        hashesA.set(stateA.tick, hashSimState(stateA));
        hashesB.set(stateB.tick, hashSimState(stateB));
      }
    }

    // All hashes must match
    expect(hashesA.size).toBeGreaterThan(0);
    for (const [tick, hashA] of hashesA) {
      expect(hashesB.get(tick)).toBe(hashA);
    }
  });

  it('quantization necessity: without quantization, same-process runs still match', () => {
    // This test verifies that simStep itself is deterministic within a single process
    // (no quantization). If this fails, simStep has internal non-determinism.
    let stateA = createSimState(0, spawn2());
    let stateB = createSimState(0, spawn2());
    const cfgs = [CAR_PHYSICS, CAR_PHYSICS];

    for (let t = 1; t <= TOTAL_TICKS; t++) {
      const inputs = [generateInput(t, 'drift'), generateInput(t, 'zigzag')];

      applyProximityAndMeter(stateA);
      stateA = simStep(stateA, inputs, cfgs);

      applyProximityAndMeter(stateB);
      stateB = simStep(stateB, inputs, cfgs);

      // Check every 60 ticks
      if (t % HASH_INTERVAL === 0) {
        const hashA = hashSimState(stateA);
        const hashB = hashSimState(stateB);
        expect(hashA).toBe(hashB);
      }
    }
  });

  it('AI RNG rollback: restoring RNG state prevents divergence after rollback', () => {
    // Reproduces the desync bug: two identical sims with 1 human + 1 AI.
    // simA simulates a rollback at tick 80 (re-simulates ticks 75-80).
    // simB runs straight through with no rollback.
    // Without RNG restore, the rollback consumes extra RNG values → divergence.
    // With RNG restore, both sims stay identical.

    const seed = 42;
    const spawns: PlayerSpawn[] = [
      { x: -50, z: 0, angle: 0, baseSpeed: 40 },   // human
      { x: 50, z: 0, angle: Math.PI, baseSpeed: 40 }, // AI
    ];
    const cfgs = [BIKE_PHYSICS, BIKE_PHYSICS];

    // Create matched AI states for both sims
    const aiStateA = createAIState(seededRandom(seed), 'medium');
    const aiStateB = createAIState(seededRandom(seed), 'medium');
    const simGrid = new SimSpatialGrid();

    // AI input provider (deterministic from state + tick + AI RNG)
    function aiInput(state: SimState, tick: number, aiState: ReturnType<typeof createAIState>): InputFrame {
      simGrid.rebuild(state.trails);
      const p = state.players[1];
      const result = getAIInputSim(p, 'bike', simGrid, 1, state.trails, SIM_DT, aiState, 0);
      return { tick, turnDir: result.turn, accelerate: result.accelerate, dash: result.dash, brake: result.brake };
    }

    // Tick helper: advance one step with proper proximity/meter/quantization
    function advanceTick(state: SimState, humanInput: InputFrame, aiFrame: InputFrame): SimState {
      applyProximityAndMeter(state);
      state = simStep(state, [humanInput, aiFrame], cfgs);
      return applyQuantization(state);
    }

    let stateA = createSimState(0, spawns);
    let stateB = createSimState(0, spawns);

    // -- Phase 1: run both sims identically to tick 80, snapshotting AI RNG at tick 74 --
    const ROLLBACK_START = 75;
    const ROLLBACK_END = 80;
    let snapshotState: SimState | null = null;
    let snapshotAiState: ReturnType<typeof cloneAIState> | null = null;

    for (let t = 1; t <= ROLLBACK_END; t++) {
      const humanInput = generateInput(t, 'zigzag');

      if (t === ROLLBACK_START) {
        // Snapshot BEFORE this tick's sim step (matches lockstep snapshot ordering)
        snapshotState = cloneSimState(stateA);
        snapshotAiState = cloneAIState(aiStateA);
      }

      stateA = advanceTick(stateA, humanInput, aiInput(stateA, t, aiStateA));
      stateB = advanceTick(stateB, humanInput, aiInput(stateB, t, aiStateB));
    }

    // Sanity: both sims should be identical before rollback
    expect(hashSimState(stateA)).toBe(hashSimState(stateB));

    // -- Phase 2: sim A "rolls back" to tick 75 and re-simulates 75-80 --
    // This is what happens when a client receives corrected remote input.
    // The key: ALL AI state (RNG + timers + maneuvers) must be restored.

    // Restore sim state from snapshot
    stateA = snapshotState!;

    // RESTORE full AI state (this is the fix)
    const restored = cloneAIState(snapshotAiState!);
    Object.assign(aiStateA, restored);
    aiStateA.rng = restored.rng;

    // Re-simulate ticks 75-80 with identical inputs
    for (let t = ROLLBACK_START; t <= ROLLBACK_END; t++) {
      const humanInput = generateInput(t, 'zigzag');
      stateA = advanceTick(stateA, humanInput, aiInput(stateA, t, aiStateA));
    }

    // After rollback with RNG restore, sims should still match
    expect(hashSimState(stateA)).toBe(hashSimState(stateB));

    // -- Phase 3: continue both sims for 200 more ticks to verify no drift --
    for (let t = ROLLBACK_END + 1; t <= ROLLBACK_END + 200; t++) {
      const humanInput = generateInput(t, 'zigzag');
      stateA = advanceTick(stateA, humanInput, aiInput(stateA, t, aiStateA));
      stateB = advanceTick(stateB, humanInput, aiInput(stateB, t, aiStateB));
    }

    expect(hashSimState(stateA)).toBe(hashSimState(stateB));
  });

  it('AI RNG rollback: WITHOUT restore, rollback causes divergence', () => {
    // Proves the bug exists: same setup, but skip the RNG restore during rollback.
    // The sims SHOULD diverge, confirming the fix is necessary.

    const seed = 42;
    const spawns: PlayerSpawn[] = [
      { x: -50, z: 0, angle: 0, baseSpeed: 40 },
      { x: 50, z: 0, angle: Math.PI, baseSpeed: 40 },
    ];
    const cfgs = [BIKE_PHYSICS, BIKE_PHYSICS];

    const aiStateA = createAIState(seededRandom(seed), 'medium');
    const aiStateB = createAIState(seededRandom(seed), 'medium');
    const simGrid = new SimSpatialGrid();

    function aiInput(state: SimState, tick: number, aiState: ReturnType<typeof createAIState>): InputFrame {
      simGrid.rebuild(state.trails);
      const p = state.players[1];
      const result = getAIInputSim(p, 'bike', simGrid, 1, state.trails, SIM_DT, aiState, 0);
      return { tick, turnDir: result.turn, accelerate: result.accelerate, dash: result.dash, brake: result.brake };
    }

    function advanceTick(state: SimState, humanInput: InputFrame, aiFrame: InputFrame): SimState {
      applyProximityAndMeter(state);
      state = simStep(state, [humanInput, aiFrame], cfgs);
      return applyQuantization(state);
    }

    let stateA = createSimState(0, spawns);
    let stateB = createSimState(0, spawns);

    const ROLLBACK_START = 75;
    const ROLLBACK_END = 80;
    let snapshotState: SimState | null = null;
    // Deliberately NOT saving AI RNG state

    for (let t = 1; t <= ROLLBACK_END; t++) {
      const humanInput = generateInput(t, 'zigzag');
      if (t === ROLLBACK_START) {
        snapshotState = cloneSimState(stateA);
      }
      stateA = advanceTick(stateA, humanInput, aiInput(stateA, t, aiStateA));
      stateB = advanceTick(stateB, humanInput, aiInput(stateB, t, aiStateB));
    }

    // Both match before rollback
    expect(hashSimState(stateA)).toBe(hashSimState(stateB));

    // Rollback WITHOUT restoring AI RNG
    stateA = snapshotState!;
    // aiStateA.rng is NOT restored — still advanced past tick 80

    for (let t = ROLLBACK_START; t <= ROLLBACK_END; t++) {
      const humanInput = generateInput(t, 'zigzag');
      stateA = advanceTick(stateA, humanInput, aiInput(stateA, t, aiStateA));
    }

    // After 200 more ticks, the divergence should be detectable
    for (let t = ROLLBACK_END + 1; t <= ROLLBACK_END + 200; t++) {
      const humanInput = generateInput(t, 'zigzag');
      stateA = advanceTick(stateA, humanInput, aiInput(stateA, t, aiStateA));
      stateB = advanceTick(stateB, humanInput, aiInput(stateB, t, aiStateB));
    }

    // These should NOT match — proving the bug
    expect(hashSimState(stateA)).not.toBe(hashSimState(stateB));
  });
});
