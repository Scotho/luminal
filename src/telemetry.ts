// ── Telemetry Utilities ──────────────────────────────────
// Shared percentile computation for lockstepManager and perfStats.
// Ring buffer for O(1) push in rolling sample windows (replaces push/shift).

/** Fixed-capacity ring buffer — O(1) push, no Array.shift() copies. */
export class RingBuffer<T> {
  private readonly _buf: T[];
  private _head = 0;
  private _size = 0;
  private readonly _cap: number;

  constructor(capacity: number) {
    this._cap = capacity;
    this._buf = new Array<T>(capacity);
  }

  get length(): number { return this._size; }

  push(value: T): void {
    this._buf[this._head] = value;
    this._head = (this._head + 1) % this._cap;
    if (this._size < this._cap) this._size++;
  }

  /** O(1) indexed access in insertion order (0 = oldest). */
  get(index: number): T {
    const start = this._size < this._cap ? 0 : this._head;
    return this._buf[(start + index) % this._cap];
  }

  /** Returns elements in insertion order (oldest first). */
  toArray(): T[] {
    if (this._size < this._cap) return this._buf.slice(0, this._size);
    return [...this._buf.slice(this._head), ...this._buf.slice(0, this._head)];
  }

  reduce<U>(fn: (acc: U, val: T) => U, init: U): U {
    let acc = init;
    const start = this._size < this._cap ? 0 : this._head;
    for (let i = 0; i < this._size; i++) {
      acc = fn(acc, this._buf[(start + i) % this._cap]);
    }
    return acc;
  }

  clear(): void {
    this._head = 0;
    this._size = 0;
  }
}

/** Compute a percentile (0–100) from a sorted-ascending array. */
function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Compute percentiles from an unsorted sample array or ring buffer. Returns { p50, p95, p99 }. */
export function computePercentiles(samples: number[] | RingBuffer<number>): { p50: number; p95: number; p99: number } {
  if (samples.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const arr = Array.isArray(samples) ? samples : samples.toArray();
  const sorted = arr.slice().sort((a, b) => a - b);
  return {
    p50: Math.round(percentileSorted(sorted, 50) * 100) / 100,
    p95: Math.round(percentileSorted(sorted, 95) * 100) / 100,
    p99: Math.round(percentileSorted(sorted, 99) * 100) / 100,
  };
}
