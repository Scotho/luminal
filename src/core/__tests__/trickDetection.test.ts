// ── Trick Detection Tests ──────────────────────────────
import { describe, it, expect } from 'vitest';
import { detectTrick, TRICKS } from '../trickDetection';

describe('detectTrick', () => {
  it('returns null for empty buffer', () => {
    expect(detectTrick([])).toBeNull();
  });

  it('detects SPIN for [1, 1, 1]', () => {
    const result = detectTrick([1, 1, 1]);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('SPIN');
    expect(result!.meterBonus).toBe(8);
  });

  it('detects WHIP for [-1, -1, -1]', () => {
    const result = detectTrick([-1, -1, -1]);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('WHIP');
    expect(result!.meterBonus).toBe(8);
  });

  it('detects REVERSAL for [1, -1, 1]', () => {
    const result = detectTrick([1, -1, 1]);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('REVERSAL');
    expect(result!.meterBonus).toBe(12);
  });

  it('detects FLIP for [-1, 1, -1]', () => {
    const result = detectTrick([-1, 1, -1]);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('FLIP');
    expect(result!.meterBonus).toBe(12);
  });

  it('detects CORKSCREW for [1, -1, -1, 1] — longest match wins', () => {
    const result = detectTrick([1, -1, -1, 1]);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('CORKSCREW');
    expect(result!.meterBonus).toBe(15);
  });

  it('returns null for random/incomplete patterns', () => {
    expect(detectTrick([1])).toBeNull();
    expect(detectTrick([1, -1])).toBeNull();
    expect(detectTrick([-1, 1])).toBeNull();
    expect(detectTrick([1, 1])).toBeNull();
  });

  it('matches valid suffix after noise in buffer', () => {
    // Noise before SPIN pattern
    const result = detectTrick([-1, 1, -1, 1, 1, 1]);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('SPIN');
  });

  it('matches CORKSCREW with noise prefix', () => {
    const result = detectTrick([-1, -1, 1, -1, -1, 1]);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('CORKSCREW');
  });

  it('TRICKS array has correct count', () => {
    expect(TRICKS).toHaveLength(5);
  });
});
