import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from './rateLimit.js';

describe('RateLimiter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('allows messages under the limit', () => {
    const limiter = new RateLimiter(60);
    for (let i = 0; i < 60; i++) expect(limiter.check()).toBe(true);
  });

  it('rejects exceeding the limit', () => {
    const limiter = new RateLimiter(5);
    for (let i = 0; i < 5; i++) limiter.check();
    expect(limiter.check()).toBe(false);
  });

  it('resets after window', () => {
    const limiter = new RateLimiter(5);
    for (let i = 0; i < 5; i++) limiter.check();
    expect(limiter.check()).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(limiter.check()).toBe(true);
  });
});
