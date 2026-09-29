// Deterministic PRNG (mulberry32) — shared utility for online determinism

/** Callable PRNG with exposed state for serialization/snapshot recovery. */
export interface SeededRng {
  (): number;
  /** Original seed used to create this RNG. */
  readonly originalSeed: number;
  /** Number of times this RNG has been called. */
  readonly callCount: number;
}

export function seededRandom(seed: number): SeededRng {
  const originalSeed = seed;
  let callCount = 0;

  const fn = function (): number {
    callCount++;
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t: number = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  } as SeededRng;

  Object.defineProperty(fn, 'originalSeed', { get: () => originalSeed });
  Object.defineProperty(fn, 'callCount', { get: () => callCount });

  return fn;
}

/** Recreate an RNG at the exact state it was in after N calls. */
export function recreateRng(originalSeed: number, calls: number): SeededRng {
  const rng = seededRandom(originalSeed);
  for (let i = 0; i < calls; i++) rng();
  return rng;
}
