// ── Seeded Random Tests ───────────────────────────────────
import { describe, it, expect } from 'vitest';
import { seededRandom } from './seededRandom';

describe('seededRandom (mulberry32)', () => {
  it('is deterministic — same seed produces same sequence', () => {
    const rng1 = seededRandom(42);
    const rng2 = seededRandom(42);
    for (let i = 0; i < 100; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it('different seeds produce different sequences', () => {
    const rng1 = seededRandom(1);
    const rng2 = seededRandom(2);
    // At least one of the first 10 values should differ
    let allSame = true;
    for (let i = 0; i < 10; i++) {
      if (rng1() !== rng2()) allSame = false;
    }
    expect(allSame).toBe(false);
  });

  it('all values in [0, 1) over 10000 samples', () => {
    const rng = seededRandom(12345);
    for (let i = 0; i < 10000; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('distribution is roughly uniform (bucket test)', () => {
    const rng = seededRandom(9999);
    const buckets = new Array(10).fill(0);
    const N = 10000;
    for (let i = 0; i < N; i++) {
      const bucket = Math.floor(rng() * 10);
      buckets[bucket]++;
    }
    const expected = N / 10;
    for (const count of buckets) {
      // Each bucket should be within 30% of expected
      expect(count).toBeGreaterThan(expected * 0.7);
      expect(count).toBeLessThan(expected * 1.3);
    }
  });

  it('handles seed = 0', () => {
    const rng = seededRandom(0);
    const val = rng();
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThan(1);
  });

  it('handles negative seeds', () => {
    const rng = seededRandom(-42);
    const val = rng();
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThan(1);
  });

  it('handles large seeds', () => {
    const rng = seededRandom(2147483647);
    const val = rng();
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThan(1);
  });

  it('sequence diverges after first different call', () => {
    const rng1 = seededRandom(100);
    const rng2 = seededRandom(100);
    // Consume one value from rng1 to put them out of sync
    rng1();
    // Now they should produce different values
    expect(rng1()).not.toBe(rng2());
  });
});
