// ── Seeded Random Property-Based Tests ────────────────────
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { seededRandom, recreateRng } from './seededRandom';

describe('seededRandom property-based tests', () => {
  // ── Determinism ────────────────────────────────────────

  describe('determinism', () => {
    it('same seed always produces the same sequence', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 2 ** 32 - 1 }),
          fc.integer({ min: 1, max: 200 }),
          (seed, len) => {
            const rng1 = seededRandom(seed);
            const rng2 = seededRandom(seed);
            for (let i = 0; i < len; i++) {
              expect(rng1()).toBe(rng2());
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('recreateRng at N calls matches direct N calls', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 2 ** 32 - 1 }),
          fc.integer({ min: 0, max: 100 }),
          fc.integer({ min: 1, max: 50 }),
          (seed, skip, len) => {
            const direct = seededRandom(seed);
            for (let i = 0; i < skip; i++) direct();

            const restored = recreateRng(seed, skip);

            for (let i = 0; i < len; i++) {
              expect(restored()).toBe(direct());
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ── Range ──────────────────────────────────────────────

  describe('range', () => {
    it('output is always in [0, 1)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 2 ** 32 - 1 }),
          fc.integer({ min: 1, max: 500 }),
          (seed, len) => {
            const rng = seededRandom(seed);
            for (let i = 0; i < len; i++) {
              const val = rng();
              expect(val).toBeGreaterThanOrEqual(0);
              expect(val).toBeLessThan(1);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ── Different seeds diverge ────────────────────────────

  describe('different seeds diverge', () => {
    it('two different seeds produce different sequences with high probability', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 2 ** 32 - 1 }),
          fc.integer({ min: 0, max: 2 ** 32 - 1 }),
          (seedA, seedB) => {
            fc.pre(seedA !== seedB);
            const rngA = seededRandom(seedA);
            const rngB = seededRandom(seedB);
            let allSame = true;
            for (let i = 0; i < 20; i++) {
              if (rngA() !== rngB()) allSame = false;
            }
            expect(allSame).toBe(false);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  // ── callCount tracking ─────────────────────────────────

  describe('callCount', () => {
    it('callCount increments correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 2 ** 32 - 1 }),
          fc.integer({ min: 1, max: 200 }),
          (seed, len) => {
            const rng = seededRandom(seed);
            expect(rng.callCount).toBe(0);
            for (let i = 1; i <= len; i++) {
              rng();
              expect(rng.callCount).toBe(i);
            }
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});
