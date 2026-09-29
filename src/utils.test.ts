import { describe, it, expect } from 'vitest';
import { pointToSegmentDist, lerpAngle, hexToCSS, hexToRGBA, formatTime } from './utils';

describe('pointToSegmentDist', () => {
  it('returns 0 when point is on the segment', () => {
    expect(pointToSegmentDist(5, 0, 0, 0, 10, 0)).toBeCloseTo(0);
  });

  it('returns perpendicular distance', () => {
    expect(pointToSegmentDist(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
  });

  it('returns distance to nearest endpoint when beyond segment', () => {
    expect(pointToSegmentDist(15, 0, 0, 0, 10, 0)).toBeCloseTo(5);
  });

  it('returns distance to start when before segment', () => {
    expect(pointToSegmentDist(-3, 4, 0, 0, 10, 0)).toBeCloseTo(5);
  });

  it('handles zero-length segment (point)', () => {
    expect(pointToSegmentDist(3, 4, 0, 0, 0, 0)).toBeCloseTo(5);
  });

  it('handles diagonal segments', () => {
    // Segment from (0,0) to (10,10), point at (5,0)
    // Perpendicular distance to line y=x at (5,0) is 5/sqrt(2)
    expect(pointToSegmentDist(5, 0, 0, 0, 10, 10)).toBeCloseTo(5 / Math.SQRT2);
  });

  it('handles vertical segments', () => {
    expect(pointToSegmentDist(3, 5, 0, 0, 0, 10)).toBeCloseTo(3);
  });

  it('returns 0 for point at segment start', () => {
    expect(pointToSegmentDist(0, 0, 0, 0, 10, 0)).toBeCloseTo(0);
  });

  it('returns 0 for point at segment end', () => {
    expect(pointToSegmentDist(10, 0, 0, 0, 10, 0)).toBeCloseTo(0);
  });
});

describe('lerpAngle', () => {
  it('interpolates forward', () => {
    expect(lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4);
  });

  it('returns start angle at t=0', () => {
    expect(lerpAngle(1, 2, 0)).toBeCloseTo(1);
  });

  it('returns end angle at t=1', () => {
    expect(lerpAngle(1, 2, 1)).toBeCloseTo(2);
  });

  it('wraps around correctly (positive to negative)', () => {
    // From nearly PI to nearly -PI should go through PI, not through 0
    const result = lerpAngle(Math.PI * 0.9, -Math.PI * 0.9, 0.5);
    expect(Math.abs(result)).toBeCloseTo(Math.PI, 1);
  });

  it('wraps short way around from negative to positive', () => {
    // From -170° to 170° should go through ±180°, not through 0°
    const from = -170 * Math.PI / 180;
    const to = 170 * Math.PI / 180;
    const result = lerpAngle(from, to, 0.5);
    expect(Math.abs(result)).toBeGreaterThan(Math.PI * 0.9);
  });

  it('handles same angle', () => {
    expect(lerpAngle(1.5, 1.5, 0.5)).toBeCloseTo(1.5);
  });
});

describe('hexToCSS', () => {
  it('converts red', () => {
    expect(hexToCSS(0xff0000)).toBe('rgb(255, 0, 0)');
  });

  it('converts green', () => {
    expect(hexToCSS(0x00ff00)).toBe('rgb(0, 255, 0)');
  });

  it('converts blue', () => {
    expect(hexToCSS(0x0000ff)).toBe('rgb(0, 0, 255)');
  });

  it('converts black', () => {
    expect(hexToCSS(0x000000)).toBe('rgb(0, 0, 0)');
  });

  it('converts white', () => {
    expect(hexToCSS(0xffffff)).toBe('rgb(255, 255, 255)');
  });

  it('converts mixed color', () => {
    expect(hexToCSS(0x1a2b3c)).toBe('rgb(26, 43, 60)');
  });
});

describe('hexToRGBA', () => {
  it('converts with full opacity', () => {
    expect(hexToRGBA(0xff0000, 1)).toBe('rgba(255, 0, 0, 1)');
  });

  it('converts with half opacity', () => {
    expect(hexToRGBA(0x00ff00, 0.5)).toBe('rgba(0, 255, 0, 0.5)');
  });

  it('converts with zero opacity', () => {
    expect(hexToRGBA(0x0000ff, 0)).toBe('rgba(0, 0, 255, 0)');
  });
});

describe('formatTime', () => {
  it('formats zero', () => {
    expect(formatTime(0)).toBe('0:00');
  });

  it('formats seconds only', () => {
    expect(formatTime(45)).toBe('0:45');
  });

  it('formats minutes and seconds', () => {
    expect(formatTime(65)).toBe('1:05');
  });

  it('pads single-digit seconds', () => {
    expect(formatTime(61)).toBe('1:01');
  });

  it('formats large times', () => {
    expect(formatTime(599)).toBe('9:59');
  });

  it('formats 10+ minutes', () => {
    expect(formatTime(605)).toBe('10:05');
  });

  it('floors fractional seconds', () => {
    expect(formatTime(65.7)).toBe('1:05');
  });
});
