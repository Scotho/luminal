// Regression fence for the Perlin + Alea port.
// The synthcity procedural layout is pinned to specific noise outputs from
// seed 4217 — in particular, the mega_03 ziggurat at (976, 2800) only exists
// because the noise at that location rounds to a particular subtypeNoise
// bucket. If any of these values drift, the curated world changes.
//
// Fixtures were captured by running the original proc-noise.js + alea.js
// through Node and recording the output to 15 significant digits.
import { describe, it, expect } from 'vitest';
import { Perlin } from '../perlin';

describe('Perlin (seed 4217, noiseDetail(8, 0.5))', () => {
  function makeNoise(): Perlin {
    const p = new Perlin(4217);
    p.noiseDetail(8, 0.5);
    return p;
  }

  // Each fixture: [x, y, z, expectedNoise] — captured from the reference
  // proc-noise.js running under Node.
  const fixtures: Array<[number, number, number, number]> = [
    [0,         0,         0,     0.212349788425854],
    [0.5,       0.5,       0,     0.566053326416938],
    [1.234,     5.678,     0,     0.424297244739782],
    [1.5504,    4.651199999999999, 0, 0.240619153889759],
    [1.6592,    4.76,      0,     0.279825256708364],
    [4880,      14000,     0,     0.284044435820761],
    [-100.5,    200.75,    3.14,  0.692161784845995],
  ];

  for (const [x, y, z, expected] of fixtures) {
    it(`noise(${x}, ${y}, ${z}) matches reference`, () => {
      const p = makeNoise();
      const actual = p.noise(x, y, z);
      expect(actual).toBeCloseTo(expected, 12);
    });
  }

  it('primes perlinArray lazily on first call', () => {
    const p = makeNoise();
    // First call triggers the internal array build; should not throw.
    expect(() => p.noise(0.1, 0.2, 0.3)).not.toThrow();
  });

  it('noiseDetail changes octave count', () => {
    const p = new Perlin(4217);
    p.noiseDetail(1, 0.5);
    const lowOctave = p.noise(1.234, 5.678, 0);
    const p2 = new Perlin(4217);
    p2.noiseDetail(8, 0.5);
    const highOctave = p2.noise(1.234, 5.678, 0);
    // Different octave counts produce different values.
    expect(lowOctave).not.toBeCloseTo(highOctave, 6);
  });

  it('same seed produces same sequence across instances', () => {
    const a = makeNoise();
    const b = makeNoise();
    const av = a.noise(42.5, 17.3, 0);
    const bv = b.noise(42.5, 17.3, 0);
    expect(av).toBe(bv);
  });
});
