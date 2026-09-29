// ── Simulation Property-Based Tests ───────────────────────
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  createSimState,
  serializeSimState,
  deserializeSimState,
  hashSimState,
  simStep,
  isOutOfBounds,
  setArenaShape,
  ARENA_HALF,
  MAX_TRAIL_POINTS,
  TRAIL_TICK_INTERVAL,
  type PlayerSpawn,
  type InputFrame,
  type SimState,
} from './simulation';
import { BIKE_PHYSICS } from '../vehicleConfig';

// ── Helpers ──────────────────────────────────────────────

/** Arbitrary spawn inside the arena (with margin so players don't immediately die). */
const arbSpawn: fc.Arbitrary<PlayerSpawn> = fc.record({
  x: fc.double({ min: -ARENA_HALF + 20, max: ARENA_HALF - 20, noNaN: true }),
  z: fc.double({ min: -ARENA_HALF + 20, max: ARENA_HALF - 20, noNaN: true }),
  angle: fc.double({ min: 0, max: Math.PI * 2, noNaN: true }),
  baseSpeed: fc.double({ min: 30, max: 60, noNaN: true }),
});

const arbInput: fc.Arbitrary<InputFrame> = fc.record({
  tick: fc.integer({ min: 0, max: 100_000 }),
  turnDir: fc.integer({ min: -1, max: 1 }),
  accelerate: fc.boolean(),
  dash: fc.boolean(),
  brake: fc.boolean(),
});

function neutralInput(tick: number): InputFrame {
  return { tick, turnDir: 0, accelerate: false, dash: false, brake: false };
}

describe('simulation property-based tests', () => {
  beforeEach(() => {
    // Reset to default square arena
    setArenaShape(false, ARENA_HALF);
  });

  // ── Serialize / Deserialize roundtrip ──────────────────

  describe('serialize/deserialize roundtrip', () => {
    it('hash is preserved through serialization roundtrip', () => {
      fc.assert(
        fc.property(
          fc.array(arbSpawn, { minLength: 1, maxLength: 4 }),
          (spawns) => {
            const state = createSimState(0, spawns);
            const serialized = serializeSimState(state);
            const deserialized = deserializeSimState(serialized);
            // Serialize both sides to normalize precision before hashing
            const reserializedOriginal = serializeSimState(state);
            const reserializedRoundtrip = serializeSimState(deserialized);
            const hashOriginal = hashSimState(deserializeSimState(reserializedOriginal));
            const hashRoundtrip = hashSimState(deserializeSimState(reserializedRoundtrip));
            expect(hashRoundtrip).toBe(hashOriginal);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('tick is preserved exactly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100_000 }),
          fc.array(arbSpawn, { minLength: 1, maxLength: 4 }),
          (tick, spawns) => {
            const state = createSimState(tick, spawns);
            const roundtripped = deserializeSimState(serializeSimState(state));
            expect(roundtripped.tick).toBe(tick);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('player count is preserved', () => {
      fc.assert(
        fc.property(
          fc.array(arbSpawn, { minLength: 1, maxLength: 6 }),
          (spawns) => {
            const state = createSimState(0, spawns);
            const roundtripped = deserializeSimState(serializeSimState(state));
            expect(roundtripped.players.length).toBe(spawns.length);
            expect(roundtripped.trails.length).toBe(spawns.length);
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  // ── Determinism ────────────────────────────────────────

  describe('determinism', () => {
    it('same spawns + same inputs produce identical hash after N steps', () => {
      fc.assert(
        fc.property(
          fc.array(arbSpawn, { minLength: 2, maxLength: 2 }),
          fc.integer({ min: 1, max: 30 }),
          (spawns, steps) => {
            const cfgs = spawns.map(() => BIKE_PHYSICS);

            let stateA = createSimState(0, spawns);
            let stateB = createSimState(0, spawns);

            for (let t = 1; t <= steps; t++) {
              const inputs = spawns.map(() => neutralInput(t));
              stateA = simStep(stateA, inputs, cfgs);
              stateB = simStep(stateB, inputs, cfgs);
            }

            expect(hashSimState(stateA)).toBe(hashSimState(stateB));
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  // ── Dead players never revive ──────────────────────────

  describe('dead players never revive', () => {
    it('once alive=false, no simStep sets it back to true', () => {
      fc.assert(
        fc.property(
          fc.array(arbSpawn, { minLength: 2, maxLength: 2 }),
          fc.integer({ min: 5, max: 60 }),
          (spawns, steps) => {
            const cfgs = spawns.map(() => BIKE_PHYSICS);
            let state = createSimState(0, spawns);
            const deadSet = new Set<number>();

            for (let t = 1; t <= steps; t++) {
              const inputs = spawns.map(() => neutralInput(t));
              state = simStep(state, inputs, cfgs);

              for (let i = 0; i < state.players.length; i++) {
                if (!state.players[i].alive) {
                  deadSet.add(i);
                }
                if (deadSet.has(i)) {
                  expect(state.players[i].alive).toBe(false);
                }
              }
            }
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  // ── Trail length monotonically increases ───────────────

  describe('trail length', () => {
    it('trail length never decreases unless at MAX_TRAIL_POINTS', () => {
      fc.assert(
        fc.property(
          fc.array(arbSpawn, { minLength: 1, maxLength: 2 }),
          fc.integer({ min: 5, max: 60 }),
          (spawns, steps) => {
            const cfgs = spawns.map(() => BIKE_PHYSICS);
            let state = createSimState(0, spawns);
            const prevLens = spawns.map(() => 0);

            for (let t = 1; t <= steps; t++) {
              const inputs = spawns.map(() => neutralInput(t));
              state = simStep(state, inputs, cfgs);

              for (let i = 0; i < state.trails.length; i++) {
                const curLen = state.trails[i].length;
                // Trail can only grow by 0 or 1, unless it was at MAX_TRAIL_POINTS
                // (where old points are shifted out to maintain the cap)
                if (prevLens[i] < MAX_TRAIL_POINTS) {
                  expect(curLen).toBeGreaterThanOrEqual(prevLens[i]);
                  expect(curLen - prevLens[i]).toBeLessThanOrEqual(1);
                } else {
                  // At cap: length stays the same (shift out old, add new)
                  expect(curLen).toBeLessThanOrEqual(MAX_TRAIL_POINTS);
                }
                prevLens[i] = curLen;
              }
            }
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  // ── isOutOfBounds symmetry ─────────────────────────────

  describe('isOutOfBounds symmetry', () => {
    it('isOutOfBounds(x, z) === isOutOfBounds(-x, -z) for square arena', () => {
      fc.assert(
        fc.property(
          fc.double({ min: -300, max: 300, noNaN: true }),
          fc.double({ min: -300, max: 300, noNaN: true }),
          (x, z) => {
            expect(isOutOfBounds(x, z)).toBe(isOutOfBounds(-x, -z));
          },
        ),
        { numRuns: 200 },
      );
    });

    it('isOutOfBounds(x, z) === isOutOfBounds(-x, -z) for circular arena', () => {
      setArenaShape(true, ARENA_HALF);
      fc.assert(
        fc.property(
          fc.double({ min: -300, max: 300, noNaN: true }),
          fc.double({ min: -300, max: 300, noNaN: true }),
          (x, z) => {
            expect(isOutOfBounds(x, z)).toBe(isOutOfBounds(-x, -z));
          },
        ),
        { numRuns: 200 },
      );
    });

    it('origin is never out of bounds', () => {
      expect(isOutOfBounds(0, 0)).toBe(false);
      setArenaShape(true, ARENA_HALF);
      expect(isOutOfBounds(0, 0)).toBe(false);
    });

    it('far-away points are always out of bounds', () => {
      fc.assert(
        fc.property(
          fc.double({ min: ARENA_HALF + 1, max: 10000, noNaN: true }),
          fc.double({ min: ARENA_HALF + 1, max: 10000, noNaN: true }),
          (x, z) => {
            expect(isOutOfBounds(x, z)).toBe(true);
            expect(isOutOfBounds(-x, -z)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
