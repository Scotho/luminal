import { describe, it, expect } from 'vitest';
import { smoothDamp, smoothDampAngle, type VelRef } from './smoothDamp';

const DT = 1 / 60;

describe('smoothDamp', () => {
  it('reaches target within ~3 * smoothTime', () => {
    const vel: VelRef = { v: 0 };
    let x = 0;
    const smoothTime = 0.3;
    for (let i = 0; i < Math.ceil((smoothTime * 3) / DT); i++) {
      x = smoothDamp(x, 10, vel, smoothTime, Infinity, DT);
    }
    expect(x).toBeGreaterThan(9.5);
    expect(x).toBeLessThan(10.5);
  });

  it('never exceeds maxSpeed', () => {
    const vel: VelRef = { v: 0 };
    let x = 0;
    const maxSpeed = 5;
    for (let i = 0; i < 120; i++) {
      const prev = x;
      x = smoothDamp(x, 1000, vel, 0.1, maxSpeed, DT);
      expect(Math.abs(x - prev)).toBeLessThan(maxSpeed * DT + 1e-6);
    }
  });

  it('does not overshoot on step input', () => {
    const vel: VelRef = { v: 0 };
    let x = 0;
    for (let i = 0; i < 240; i++) {
      x = smoothDamp(x, 10, vel, 0.3, Infinity, DT);
      expect(x).toBeLessThanOrEqual(10.0001);
    }
  });

  it('preserves velocity when target changes continuously', () => {
    const vel: VelRef = { v: 0 };
    let x = 0;
    let prevVel = 0;
    for (let i = 0; i < 120; i++) {
      const target = Math.sin(i * 0.05) * 5;
      x = smoothDamp(x, target, vel, 0.2, Infinity, DT);
      if (i > 0) expect(Math.abs(vel.v - prevVel)).toBeLessThan(160 * DT);
      prevVel = vel.v;
    }
  });

  it('returns target immediately when smoothTime is effectively zero', () => {
    const vel: VelRef = { v: 0 };
    const result = smoothDamp(0, 10, vel, 0.0001, Infinity, DT);
    expect(result).toBeCloseTo(10, 2);
  });
});

describe('smoothDampAngle', () => {
  it('wraps short way around the circle', () => {
    const vel: VelRef = { v: 0 };
    let a = Math.PI - 0.1;
    const target = -Math.PI + 0.1;
    for (let i = 0; i < 120; i++) {
      a = smoothDampAngle(a, target, vel, 0.2, Infinity, DT);
    }
    const diff = Math.atan2(Math.sin(a - target), Math.cos(a - target));
    expect(Math.abs(diff)).toBeLessThan(0.05);
  });

  it('does not take the long way when target is nearby', () => {
    const vel: VelRef = { v: 0 };
    let a = 0.1;
    const target = -0.1;
    const positions: number[] = [];
    for (let i = 0; i < 60; i++) {
      a = smoothDampAngle(a, target, vel, 0.2, Infinity, DT);
      positions.push(a);
    }
    for (const p of positions) {
      expect(p).toBeGreaterThan(-0.25);
      expect(p).toBeLessThan(0.15);
    }
  });
});
