/**
 * Unit tests for src/camera/cameraProfiles.ts
 *
 * Tests PROFILE_MAP completeness, DEFAULT_NORMAL_PROFILE values,
 * and the lerpProfile interpolation function.
 */

import { describe, it, expect } from 'vitest';
import { CameraMode } from '../types';
import type { CameraProfile } from '../types';
import { PROFILE_MAP, DEFAULT_NORMAL_PROFILE, lerpProfile } from '../cameraProfiles';

// ── PROFILE_MAP ───────────────────────────────────────────────

describe('PROFILE_MAP', () => {
  it('has an entry for every CameraMode value', () => {
    const modes = [
      CameraMode.Normal,
      CameraMode.Boost,
      CameraMode.Drift,
      CameraMode.DriftBoost,
      CameraMode.Dash,
    ];
    for (const mode of modes) {
      expect(PROFILE_MAP[mode]).toBeDefined();
    }
  });

  it('each profile has all 11 required numeric fields', () => {
    const fields: (keyof CameraProfile)[] = [
      'baseFov',
      'baseDist',
      'vertOffset',
      'latOffset',
      'lookAheadGain',
      'lookLatGain',
      'headingVelBlend',
      'posDampLambda',
      'rotDampLambda',
      'fovSpeedGain',
      'distSpeedGain',
    ];
    for (const mode of Object.values(CameraMode).filter(
      (v) => typeof v === 'number',
    ) as CameraMode[]) {
      const profile = PROFILE_MAP[mode];
      for (const field of fields) {
        expect(typeof profile[field]).toBe('number');
      }
    }
  });

  it('Normal profile matches DEFAULT_NORMAL_PROFILE field-by-field', () => {
    const normal = PROFILE_MAP[CameraMode.Normal];
    for (const key of Object.keys(DEFAULT_NORMAL_PROFILE) as (keyof CameraProfile)[]) {
      expect(normal[key]).toBe(DEFAULT_NORMAL_PROFILE[key]);
    }
  });

  it('Boost profile has higher fovSpeedGain than Normal', () => {
    expect(PROFILE_MAP[CameraMode.Boost].fovSpeedGain).toBeGreaterThan(
      PROFILE_MAP[CameraMode.Normal].fovSpeedGain,
    );
  });

  it('Drift profile has non-zero latOffset (lateral shift)', () => {
    expect(PROFILE_MAP[CameraMode.Drift].latOffset).toBeGreaterThan(0);
  });

  it('Dash profile has the largest baseDist', () => {
    const dashDist = PROFILE_MAP[CameraMode.Dash].baseDist;
    for (const mode of [CameraMode.Normal, CameraMode.Boost, CameraMode.Drift, CameraMode.DriftBoost]) {
      expect(dashDist).toBeGreaterThanOrEqual(PROFILE_MAP[mode].baseDist);
    }
  });
});

// ── DEFAULT_NORMAL_PROFILE ────────────────────────────────────

describe('DEFAULT_NORMAL_PROFILE', () => {
  it('has baseFov of 60', () => {
    expect(DEFAULT_NORMAL_PROFILE.baseFov).toBe(60);
  });

  it('has baseDist of 9.25', () => {
    expect(DEFAULT_NORMAL_PROFILE.baseDist).toBe(9.25);
  });

  it('has zero latOffset (no lateral shift in Normal)', () => {
    expect(DEFAULT_NORMAL_PROFILE.latOffset).toBe(0);
  });

  it('has zero headingVelBlend (camera follows car forward, not velocity)', () => {
    expect(DEFAULT_NORMAL_PROFILE.headingVelBlend).toBe(0);
  });

  it('has positive damping lambdas', () => {
    expect(DEFAULT_NORMAL_PROFILE.posDampLambda).toBeGreaterThan(0);
    expect(DEFAULT_NORMAL_PROFILE.rotDampLambda).toBeGreaterThan(0);
  });
});

// ── lerpProfile ───────────────────────────────────────────────

describe('lerpProfile', () => {
  const profileA: CameraProfile = {
    baseFov: 60,
    baseDist: 10,
    vertOffset: 3,
    latOffset: 0,
    lookAheadGain: 1,
    lookLatGain: 0.5,
    headingVelBlend: 0,
    posDampLambda: 6,
    rotDampLambda: 8,
    fovSpeedGain: 4,
    distSpeedGain: 0.02,
  };

  const profileB: CameraProfile = {
    baseFov: 80,
    baseDist: 20,
    vertOffset: 5,
    latOffset: 2,
    lookAheadGain: 2,
    lookLatGain: 1.5,
    headingVelBlend: 1,
    posDampLambda: 12,
    rotDampLambda: 16,
    fovSpeedGain: 10,
    distSpeedGain: 0.06,
  };

  it('t=0 returns values equal to a', () => {
    const out = {} as CameraProfile;
    lerpProfile(profileA, profileB, 0, out);
    for (const key of Object.keys(profileA) as (keyof CameraProfile)[]) {
      expect(out[key]).toBeCloseTo(profileA[key], 10);
    }
  });

  it('t=1 returns values equal to b', () => {
    const out = {} as CameraProfile;
    lerpProfile(profileA, profileB, 1, out);
    for (const key of Object.keys(profileB) as (keyof CameraProfile)[]) {
      expect(out[key]).toBeCloseTo(profileB[key], 10);
    }
  });

  it('t=0.5 returns midpoints', () => {
    const out = {} as CameraProfile;
    lerpProfile(profileA, profileB, 0.5, out);
    for (const key of Object.keys(profileA) as (keyof CameraProfile)[]) {
      const expected = (profileA[key] + profileB[key]) / 2;
      expect(out[key]).toBeCloseTo(expected, 10);
    }
  });

  it('t=0.25 returns quarter interpolation', () => {
    const out = {} as CameraProfile;
    lerpProfile(profileA, profileB, 0.25, out);
    for (const key of Object.keys(profileA) as (keyof CameraProfile)[]) {
      const expected = profileA[key] + (profileB[key] - profileA[key]) * 0.25;
      expect(out[key]).toBeCloseTo(expected, 10);
    }
  });

  it('returns the out object (same reference)', () => {
    const out = {} as CameraProfile;
    const result = lerpProfile(profileA, profileB, 0.3, out);
    expect(result).toBe(out);
  });

  it('works without an explicit out parameter', () => {
    const result = lerpProfile(profileA, profileB, 0.5);
    expect(result.baseFov).toBeCloseTo(70, 5);
  });

  it('lerp between identical profiles returns same values', () => {
    const out = {} as CameraProfile;
    lerpProfile(profileA, profileA, 0.5, out);
    for (const key of Object.keys(profileA) as (keyof CameraProfile)[]) {
      expect(out[key]).toBeCloseTo(profileA[key], 10);
    }
  });
});
