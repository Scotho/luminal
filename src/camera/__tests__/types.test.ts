/**
 * Unit tests for src/camera/types.ts
 *
 * Tests the CameraMode enum values and structure.
 * Type-level interfaces (CameraProfile, CameraRigState, etc.) are verified
 * indirectly by compilation and by tests in other modules that construct them.
 */

import { describe, it, expect } from 'vitest';
import { CameraMode } from '../types';

describe('CameraMode enum', () => {
  it('has exactly 5 named members', () => {
    const names = Object.keys(CameraMode).filter((k) => isNaN(Number(k)));
    expect(names).toHaveLength(5);
  });

  it('contains Normal, Boost, Drift, DriftBoost, Dash', () => {
    const names = Object.keys(CameraMode).filter((k) => isNaN(Number(k)));
    expect(names).toEqual(
      expect.arrayContaining(['Normal', 'Boost', 'Drift', 'DriftBoost', 'Dash']),
    );
  });

  it('assigns correct numeric values 0-4', () => {
    expect(CameraMode.Normal).toBe(0);
    expect(CameraMode.Boost).toBe(1);
    expect(CameraMode.Drift).toBe(2);
    expect(CameraMode.DriftBoost).toBe(3);
    expect(CameraMode.Dash).toBe(4);
  });

  it('reverse-maps numbers to string names', () => {
    expect(CameraMode[0]).toBe('Normal');
    expect(CameraMode[1]).toBe('Boost');
    expect(CameraMode[2]).toBe('Drift');
    expect(CameraMode[3]).toBe('DriftBoost');
    expect(CameraMode[4]).toBe('Dash');
  });

  it('out-of-range index returns undefined', () => {
    // TypeScript enum should not have a mapping for values outside 0-4
    expect(CameraMode[5]).toBeUndefined();
    expect(CameraMode[-1]).toBeUndefined();
  });
});
