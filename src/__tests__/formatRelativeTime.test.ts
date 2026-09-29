import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '../utils';

describe('formatRelativeTime', () => {
  const NOW = 1_700_000_000_000;

  it('returns "just now" for under 60 seconds', () => {
    expect(formatRelativeTime(NOW - 0, NOW)).toBe('just now');
    expect(formatRelativeTime(NOW - 59_000, NOW)).toBe('just now');
  });

  it('returns minutes with singular/plural', () => {
    expect(formatRelativeTime(NOW - 60_000, NOW)).toBe('1 minute ago');
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5 minutes ago');
    expect(formatRelativeTime(NOW - 59 * 60_000, NOW)).toBe('59 minutes ago');
  });

  it('returns hours with singular/plural', () => {
    expect(formatRelativeTime(NOW - 60 * 60_000, NOW)).toBe('1 hour ago');
    expect(formatRelativeTime(NOW - 23 * 60 * 60_000, NOW)).toBe('23 hours ago');
  });

  it('returns days with singular/plural', () => {
    expect(formatRelativeTime(NOW - 24 * 60 * 60_000, NOW)).toBe('1 day ago');
    expect(formatRelativeTime(NOW - 29 * 24 * 60 * 60_000, NOW)).toBe('29 days ago');
  });

  it('returns months with singular/plural', () => {
    expect(formatRelativeTime(NOW - 30 * 24 * 60 * 60_000, NOW)).toBe('1 month ago');
    expect(formatRelativeTime(NOW - 11 * 30 * 24 * 60 * 60_000, NOW)).toBe('11 months ago');
  });

  it('returns years with singular/plural', () => {
    expect(formatRelativeTime(NOW - 12 * 30 * 24 * 60 * 60_000, NOW)).toBe('1 year ago');
    expect(formatRelativeTime(NOW - 5 * 12 * 30 * 24 * 60 * 60_000, NOW)).toBe('5 years ago');
  });

  it('clamps future timestamps to "just now"', () => {
    expect(formatRelativeTime(NOW + 10_000, NOW)).toBe('just now');
  });
});
