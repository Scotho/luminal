/**
 * Unit tests for src/camera/cameraConfig.ts
 *
 * Tests getters, setters, height computation, and the getCameraParams snapshot.
 * Module state is saved/restored in beforeEach/afterEach to avoid cross-test leaks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getCAM_DIST,
  getCAM_HEIGHT,
  getCAM_LOOK_AHEAD,
  getCAM_LERP,
  getBASE_FOV,
  getSHAKE_ENABLED,
  getUserDist,
  setCameraDist,
  setCameraFOV,
  setCameraLookAhead,
  setCameraLerp,
  setShakeEnabled,
  getCameraParams,
} from '../cameraConfig';

// ── State preservation ────────────────────────────────────────

let savedDist: number;
let savedFov: number;
let savedLookAhead: number;
let savedLerp: number;
let savedShake: boolean;

beforeEach(() => {
  savedDist = getCAM_DIST();
  savedFov = getBASE_FOV();
  savedLookAhead = getCAM_LOOK_AHEAD();
  savedLerp = getCAM_LERP();
  savedShake = getSHAKE_ENABLED();
});

afterEach(() => {
  setCameraDist(savedDist);
  setCameraFOV(savedFov);
  setCameraLookAhead(savedLookAhead);
  setCameraLerp(savedLerp);
  setShakeEnabled(savedShake);
});

// ── Tests ──────────────────────────────────────────────────────

describe('cameraConfig — defaults', () => {
  it('getCAM_DIST() defaults to 30', () => {
    expect(getCAM_DIST()).toBe(30);
  });

  it('getUserDist() is an alias for getCAM_DIST()', () => {
    expect(getUserDist()).toBe(getCAM_DIST());
  });

  it('getBASE_FOV() defaults to 60', () => {
    expect(getBASE_FOV()).toBe(60);
  });

  it('getCAM_LOOK_AHEAD() defaults to 11', () => {
    expect(getCAM_LOOK_AHEAD()).toBe(11);
  });

  it('getCAM_LERP() defaults to 5', () => {
    expect(getCAM_LERP()).toBe(5);
  });

  it('getSHAKE_ENABLED() defaults to true', () => {
    expect(getSHAKE_ENABLED()).toBe(true);
  });
});

describe('cameraConfig — setters round-trip', () => {
  it('setCameraDist updates dist', () => {
    setCameraDist(50);
    expect(getCAM_DIST()).toBe(50);
  });

  it('setCameraFOV updates fov', () => {
    setCameraFOV(70);
    expect(getBASE_FOV()).toBe(70);
  });

  it('setCameraLookAhead updates look-ahead', () => {
    setCameraLookAhead(20);
    expect(getCAM_LOOK_AHEAD()).toBe(20);
  });

  it('setCameraLerp updates lerp', () => {
    setCameraLerp(8);
    expect(getCAM_LERP()).toBe(8);
  });

  it('setShakeEnabled toggles shake', () => {
    setShakeEnabled(false);
    expect(getSHAKE_ENABLED()).toBe(false);
    setShakeEnabled(true);
    expect(getSHAKE_ENABLED()).toBe(true);
  });
});

describe('cameraConfig — height computation', () => {
  it('default dist=30 uses base sqrt curve without overshoot lift', () => {
    const expectedHeight = 2.0 + Math.sqrt(30) * 1.4;
    expect(getCAM_HEIGHT()).toBeCloseTo(expectedHeight, 5);
  });

  it('dist=50 adds overshoot lift beyond default 30', () => {
    setCameraDist(50);
    const expectedHeight = 2.0 + Math.sqrt(50) * 1.4 + (50 - 30) * 0.12;
    expect(getCAM_HEIGHT()).toBeCloseTo(expectedHeight, 5);
  });

  it('dist < 30 has no overshoot lift', () => {
    setCameraDist(10);
    const expectedHeight = 2.0 + Math.sqrt(10) * 1.4;
    expect(getCAM_HEIGHT()).toBeCloseTo(expectedHeight, 5);
  });

  it('dist=0 produces base height of 2.0', () => {
    setCameraDist(0);
    expect(getCAM_HEIGHT()).toBeCloseTo(2.0, 5);
  });

  it('height increases monotonically with distance', () => {
    const heights: number[] = [];
    for (const d of [5, 15, 30, 50, 100]) {
      setCameraDist(d);
      heights.push(getCAM_HEIGHT());
    }
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThan(heights[i - 1]);
    }
  });
});

describe('cameraConfig — getCameraParams', () => {
  it('returns correct structure with all current values', () => {
    const params = getCameraParams();
    expect(params).toEqual({
      dist: getCAM_DIST(),
      height: getCAM_HEIGHT(),
      fov: getBASE_FOV(),
      lookAhead: getCAM_LOOK_AHEAD(),
      lerp: getCAM_LERP(),
    });
  });

  it('reflects updated values after setters', () => {
    setCameraDist(42);
    setCameraFOV(75);
    setCameraLookAhead(15);
    setCameraLerp(7);

    const params = getCameraParams();
    expect(params.dist).toBe(42);
    expect(params.fov).toBe(75);
    expect(params.lookAhead).toBe(15);
    expect(params.lerp).toBe(7);
  });
});
