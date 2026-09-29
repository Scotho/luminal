import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ageColor, formatTokens, formatResetTime } from '../ui/statusBanner';

// ── ageColor ────────────────────────────────────────────

describe('ageColor', () => {
  it('returns green for deployment < 24h ago', () => {
    const oneHourAgo = Date.now() - 1 * 60 * 60 * 1000;
    expect(ageColor(oneHourAgo)).toBe('green');
  });

  it('returns yellow for deployment 24-72h ago', () => {
    const twentyFiveHoursAgo = Date.now() - 25 * 60 * 60 * 1000;
    expect(ageColor(twentyFiveHoursAgo)).toBe('yellow');
  });

  it('returns red for deployment > 72h ago', () => {
    const hundredHoursAgo = Date.now() - 100 * 60 * 60 * 1000;
    expect(ageColor(hundredHoursAgo)).toBe('red');
  });

  it('returns green at boundary (just under 24h)', () => {
    const justUnder = Date.now() - 23.9 * 60 * 60 * 1000;
    expect(ageColor(justUnder)).toBe('green');
  });

  it('returns yellow at boundary (exactly 24h)', () => {
    const exactly24 = Date.now() - 24 * 60 * 60 * 1000;
    expect(ageColor(exactly24)).toBe('yellow');
  });
});

// ── formatTokens ────────────────────────────────────────

describe('formatTokens', () => {
  it('returns plain number for < 1000', () => {
    expect(formatTokens(500)).toBe('500');
  });

  it('returns K suffix for thousands', () => {
    expect(formatTokens(1500)).toBe('1.5K');
  });

  it('returns M suffix for millions', () => {
    expect(formatTokens(1_500_000)).toBe('1.5M');
  });

  it('returns 0 as plain string', () => {
    expect(formatTokens(0)).toBe('0');
  });

  it('returns exact thousand as 1.0K', () => {
    expect(formatTokens(1000)).toBe('1.0K');
  });

  it('returns exact million as 1.0M', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M');
  });
});

// ── formatResetTime ─────────────────────────────────────

describe('formatResetTime', () => {
  it('returns dash for empty records', () => {
    expect(formatResetTime([])).toBe('—');
  });

  it('returns hours and minutes format for >1h span', () => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000 - 30 * 60 * 1000);
    const records = [{ ts: twoHoursAgo.toISOString() }];
    const result = formatResetTime(records);
    expect(result).toMatch(/^2h 30m tracked$/);
  });

  it('returns minutes-only format for <1h span', () => {
    const now = new Date();
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const records = [{ ts: thirtyMinAgo.toISOString() }];
    const result = formatResetTime(records);
    expect(result).toMatch(/^30m tracked$/);
  });

  it('uses earliest record when multiple exist', () => {
    const now = new Date();
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    const records = [
      { ts: oneHourAgo.toISOString() },
      { ts: threeHoursAgo.toISOString() },
    ];
    const result = formatResetTime(records);
    expect(result).toMatch(/^3h 0m tracked$/);
  });
});
