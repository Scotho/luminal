import { describe, it, expect } from 'vitest';
import { computeWheelWinner, computeWheelRotation } from '../mapWheel';

describe('computeWheelWinner', () => {
  it('returns a valid index for 2 candidates', () => {
    const idx = computeWheelWinner(12345, 2);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(2);
  });

  it('is deterministic — same seed same result', () => {
    const a = computeWheelWinner(99999, 2);
    const b = computeWheelWinner(99999, 2);
    expect(a).toBe(b);
  });

  it('different seeds can produce different results', () => {
    const results = new Set<number>();
    for (let s = 0; s < 100; s++) {
      results.add(computeWheelWinner(s, 2));
    }
    expect(results.size).toBe(2);
  });

  it('works with 3 candidates', () => {
    const results = new Set<number>();
    for (let s = 0; s < 200; s++) {
      const idx = computeWheelWinner(s, 3);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(3);
      results.add(idx);
    }
    expect(results.size).toBe(3);
  });

  it('works with 5 candidates', () => {
    const idx = computeWheelWinner(42, 5);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(5);
  });
});

describe('computeWheelRotation', () => {
  it('returns total degrees that land on the winning slice', () => {
    const winnerIndex = 0;
    const numSlices = 2;
    const deg = computeWheelRotation(winnerIndex, numSlices);
    expect(deg).toBeGreaterThanOrEqual(1080);
    const pointer = ((360 - (deg % 360)) % 360 + 360) % 360;
    const sliceSize = 360 / numSlices;
    const sliceStart = winnerIndex * sliceSize;
    const sliceEnd = sliceStart + sliceSize;
    expect(pointer).toBeGreaterThanOrEqual(sliceStart);
    expect(pointer).toBeLessThan(sliceEnd);
  });

  it('targets center of winning slice for N=3', () => {
    const deg = computeWheelRotation(1, 3);
    const pointer = ((360 - (deg % 360)) % 360 + 360) % 360;
    const sliceSize = 360 / 3;
    const sliceStart = 1 * sliceSize;
    const sliceEnd = sliceStart + sliceSize;
    expect(pointer).toBeGreaterThanOrEqual(sliceStart);
    expect(pointer).toBeLessThan(sliceEnd);
  });
});
