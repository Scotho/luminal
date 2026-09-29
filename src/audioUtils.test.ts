import { describe, it, expect } from 'vitest';
import { interpolateKeyframes, smoothValue } from './audioUtils';
import type { Keyframe } from './types/index';

describe('interpolateKeyframes', () => {
  const curve: Keyframe[] = [
    { at: 0.0, value: 100 },
    { at: 1.0, value: 200 },
    { at: 2.0, value: 500 },
  ];

  it('returns first value below curve range', () => {
    expect(interpolateKeyframes(curve, -1)).toBe(100);
  });

  it('returns last value above curve range', () => {
    expect(interpolateKeyframes(curve, 5)).toBe(500);
  });

  it('returns exact value at keyframe', () => {
    expect(interpolateKeyframes(curve, 1.0)).toBe(200);
  });

  it('linearly interpolates between keyframes', () => {
    expect(interpolateKeyframes(curve, 0.5)).toBe(150);
  });

  it('interpolates in second segment', () => {
    expect(interpolateKeyframes(curve, 1.5)).toBe(350);
  });

  it('handles single keyframe', () => {
    expect(interpolateKeyframes([{ at: 1, value: 42 }], 0)).toBe(42);
    expect(interpolateKeyframes([{ at: 1, value: 42 }], 5)).toBe(42);
  });

  it('handles empty array', () => {
    expect(interpolateKeyframes([], 1)).toBe(0);
  });
});

describe('smoothValue', () => {
  it('moves toward target', () => {
    expect(smoothValue(0, 100, 0.5)).toBe(50);
  });

  it('stays at target when already there', () => {
    expect(smoothValue(100, 100, 0.5)).toBe(100);
  });

  it('smoothing of 1 snaps immediately', () => {
    expect(smoothValue(0, 100, 1.0)).toBe(100);
  });

  it('smoothing of 0 stays put', () => {
    expect(smoothValue(0, 100, 0)).toBe(0);
  });
});
