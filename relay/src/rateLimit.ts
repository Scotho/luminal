// ── Per-Socket Rate Limiter ──────────────────────────────
// Sliding window counter — counts messages per 1-second window.

export class RateLimiter {
  private _maxPerSecond: number;
  private _count = 0;
  private _windowStart: number;

  constructor(maxPerSecond: number) {
    this._maxPerSecond = maxPerSecond;
    this._windowStart = Date.now();
  }

  /** Returns true if this message is allowed, false if rate-limited. */
  check(): boolean {
    const now = Date.now();
    if (now - this._windowStart >= 1000) {
      this._count = 0;
      this._windowStart = now;
    }
    if (this._count >= this._maxPerSecond) return false;
    this._count++;
    return true;
  }
}
