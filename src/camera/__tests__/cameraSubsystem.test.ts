/**
 * Unit tests for the camera subsystem (TASK-57)
 *
 * Covers: types, cameraConfig, cameraProfiles, cameraCollision, cameraShake, cameraState
 *
 * Three.js is mocked with lightweight substitutes so all camera math
 * runs without a real WebGL context.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as THREE from 'three';

// ── Hoisted helpers (available before vi.mock runs) ────────────
const { FakeVector3, mockIntersections } = vi.hoisted(() => {
  class FakeVector3 {
    x: number; y: number; z: number;
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x: number, y: number, z: number): FakeVector3 { this.x = x; this.y = y; this.z = z; return this; }
    copy(v: { x: number; y: number; z: number }): FakeVector3 { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone(): FakeVector3 { return new FakeVector3(this.x, this.y, this.z); }
    subVectors(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): FakeVector3 {
      this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this;
    }
    addScaledVector(v: { x: number; y: number; z: number }, s: number): FakeVector3 {
      this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this;
    }
    length(): number { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
    divideScalar(s: number): FakeVector3 { this.x /= s; this.y /= s; this.z /= s; return this; }
  }

  /** Configurable intersection results for the Raycaster mock.
   *  Set this array before calling resolveCameraCollision to simulate hits.
   *  Each call to intersectObjects pops the first entry (or returns [] if empty). */
  const mockIntersections: Array<Array<{ distance: number }>> = [];

  return { FakeVector3, mockIntersections };
});

// ── Mock three.js ──────────────────────────────────────────────
vi.mock('three', () => ({
  Vector3: FakeVector3,
  Raycaster: class {
    near = 0; far = 0;
    set(): void { /* noop */ }
    intersectObjects(
      _objects: unknown[],
      _recursive: boolean,
      target?: Array<{ distance: number }>,
    ): Array<{ distance: number }> {
      const batch = mockIntersections.length > 0 ? mockIntersections.shift()! : [];
      if (target && batch.length > 0) {
        target.push(...batch);
      }
      return batch;
    }
  },
  Mesh: class {},
}));

// ── Imports (after mock setup) ─────────────────────────────────
import { CameraMode } from '../types';
import type { CameraProfile, CameraRigState, CameraTarget } from '../types';
import {
  getCAM_DIST, getCAM_HEIGHT, getCAM_LOOK_AHEAD, getCAM_LERP,
  getBASE_FOV, getSHAKE_ENABLED,
  setCameraDist, setCameraFOV, setCameraLookAhead, setCameraLerp,
  setShakeEnabled, getCameraParams,
} from '../cameraConfig';
import { PROFILE_MAP, DEFAULT_NORMAL_PROFILE, lerpProfile } from '../cameraProfiles';
import {
  getCollisionTuning, setCollisionTuning,
  resolveCameraCollision,
  setCameraCollisionMeshes, getCameraCollisionMeshes,
} from '../cameraCollision';
import { triggerShake, updateShake } from '../cameraShake';
import { detectMode, tickStateMachine } from '../cameraState';

// ── Helpers ────────────────────────────────────────────────────

function makeCameraRigState(overrides?: Partial<CameraRigState>): CameraRigState {
  return {
    pivotPos: new FakeVector3(),
    boomPos: new FakeVector3(),
    camPos: new FakeVector3(),
    currentFOV: 60,
    currentMode: CameraMode.Normal,
    previousMode: CameraMode.Normal,
    blendT: 1,
    frozenProfile: { ...DEFAULT_NORMAL_PROFILE },
    lookTarget: new FakeVector3(),
    lookInitialized: false,
    prevAngle: null,
    shakeOffset: new FakeVector3(),
    activeImpulses: [],
    _proxFOV: 0,
    occlusionPush: 0,
    prevOcclusionPush: 0,
    smoothHeadingX: 0,
    smoothHeadingZ: 0,
    targetPos: new FakeVector3(),
    targetLook: new FakeVector3(),
    currentLook: new FakeVector3(),
    ...overrides,
  } as CameraRigState;
}

function makeCameraTarget(overrides?: Partial<CameraTarget>): CameraTarget {
  return {
    mesh: { position: new FakeVector3() as unknown as THREE.Vector3 },
    angle: 0,
    alive: true,
    boosting: false,
    dashing: false,
    drifting: false,
    driftBoosting: false,
    ...overrides,
  } as CameraTarget;
}

// ================================================================
// 1. types.ts — CameraMode enum
// ================================================================
describe('types.ts — CameraMode', () => {
  it('enum has all 5 modes with correct numeric values', () => {
    expect(CameraMode.Normal).toBe(0);
    expect(CameraMode.Boost).toBe(1);
    expect(CameraMode.Drift).toBe(2);
    expect(CameraMode.DriftBoost).toBe(3);
    expect(CameraMode.Dash).toBe(4);
  });

  it('enum has exactly 5 members', () => {
    // Numeric enums produce both key->value and value->key mappings
    const names = Object.keys(CameraMode).filter(k => isNaN(Number(k)));
    expect(names).toHaveLength(5);
    expect(names).toEqual(expect.arrayContaining(['Normal', 'Boost', 'Drift', 'DriftBoost', 'Dash']));
  });
});

// ================================================================
// 2. cameraConfig.ts — getters / setters / module state
// ================================================================
describe('cameraConfig.ts', () => {
  // Save defaults so we can restore after each test
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

  it('getCAM_DIST() defaults to 30', () => {
    expect(getCAM_DIST()).toBe(30);
  });

  it('setCameraDist(50) updates dist and height', () => {
    setCameraDist(50);
    expect(getCAM_DIST()).toBe(50);
    // Height = 2.0 + sqrt(50)*1.4 + (50-30)*0.12
    const expectedHeight = 2.0 + Math.sqrt(50) * 1.4 + 20 * 0.12;
    expect(getCAM_HEIGHT()).toBeCloseTo(expectedHeight, 5);
  });

  it('setCameraFOV / getBASE_FOV round-trips', () => {
    setCameraFOV(70);
    expect(getBASE_FOV()).toBe(70);
  });

  it('setCameraLookAhead round-trips', () => {
    setCameraLookAhead(20);
    expect(getCAM_LOOK_AHEAD()).toBe(20);
  });

  it('setCameraLerp round-trips', () => {
    setCameraLerp(8);
    expect(getCAM_LERP()).toBe(8);
  });

  it('setShakeEnabled round-trips', () => {
    setShakeEnabled(false);
    expect(getSHAKE_ENABLED()).toBe(false);
    setShakeEnabled(true);
    expect(getSHAKE_ENABLED()).toBe(true);
  });

  it('getCameraParams returns correct structure', () => {
    const params = getCameraParams();
    expect(params).toEqual({
      dist: getCAM_DIST(),
      height: getCAM_HEIGHT(),
      fov: getBASE_FOV(),
      lookAhead: getCAM_LOOK_AHEAD(),
      lerp: getCAM_LERP(),
    });
  });

  it('setCameraDist(30) matches original default height', () => {
    // Below default distance: no overshoot lift
    const expectedHeight = 2.0 + Math.sqrt(30) * 1.4;
    expect(getCAM_HEIGHT()).toBeCloseTo(expectedHeight, 5);
  });
});

// ================================================================
// 3. cameraProfiles.ts — PROFILE_MAP and lerpProfile
// ================================================================
describe('cameraProfiles.ts', () => {
  it('PROFILE_MAP has entries for all 5 CameraMode values', () => {
    expect(PROFILE_MAP[CameraMode.Normal]).toBeDefined();
    expect(PROFILE_MAP[CameraMode.Boost]).toBeDefined();
    expect(PROFILE_MAP[CameraMode.Drift]).toBeDefined();
    expect(PROFILE_MAP[CameraMode.DriftBoost]).toBeDefined();
    expect(PROFILE_MAP[CameraMode.Dash]).toBeDefined();
  });

  it('DEFAULT_NORMAL_PROFILE has expected field values', () => {
    expect(DEFAULT_NORMAL_PROFILE.baseFov).toBe(60);
    expect(DEFAULT_NORMAL_PROFILE.baseDist).toBe(9.25);
    expect(DEFAULT_NORMAL_PROFILE.vertOffset).toBe(3.2);
    expect(DEFAULT_NORMAL_PROFILE.latOffset).toBe(0.0);
    expect(DEFAULT_NORMAL_PROFILE.lookAheadGain).toBe(1.1);
    expect(DEFAULT_NORMAL_PROFILE.lookLatGain).toBe(0.8);
    expect(DEFAULT_NORMAL_PROFILE.headingVelBlend).toBe(0.0);
    expect(DEFAULT_NORMAL_PROFILE.posDampLambda).toBe(8.8);
    expect(DEFAULT_NORMAL_PROFILE.rotDampLambda).toBe(10.8);
    expect(DEFAULT_NORMAL_PROFILE.fovSpeedGain).toBe(4.5);
    expect(DEFAULT_NORMAL_PROFILE.distSpeedGain).toBe(0.016);
  });

  it('PROFILE_MAP[Normal] matches DEFAULT_NORMAL_PROFILE values', () => {
    const normal = PROFILE_MAP[CameraMode.Normal];
    for (const key of Object.keys(DEFAULT_NORMAL_PROFILE) as (keyof CameraProfile)[]) {
      expect(normal[key]).toBe(DEFAULT_NORMAL_PROFILE[key]);
    }
  });

  describe('lerpProfile', () => {
    const profileA: CameraProfile = {
      baseFov: 60, baseDist: 10, vertOffset: 3, latOffset: 0,
      lookAheadGain: 1, lookLatGain: 0.5, headingVelBlend: 0,
      posDampLambda: 6, rotDampLambda: 8, fovSpeedGain: 4, distSpeedGain: 0.02,
    };
    const profileB: CameraProfile = {
      baseFov: 80, baseDist: 20, vertOffset: 5, latOffset: 2,
      lookAheadGain: 2, lookLatGain: 1.5, headingVelBlend: 1,
      posDampLambda: 12, rotDampLambda: 16, fovSpeedGain: 10, distSpeedGain: 0.06,
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

    it('returns the out object', () => {
      const out = {} as CameraProfile;
      const result = lerpProfile(profileA, profileB, 0.3, out);
      expect(result).toBe(out);
    });
  });
});

// ================================================================
// 4. cameraCollision.ts — tuning, mesh management, resolve
// ================================================================
describe('cameraCollision.ts', () => {
  beforeEach(() => {
    // Reset collision meshes
    setCameraCollisionMeshes([]);
    // Reset tuning to defaults
    setCollisionTuning('COLLISION_BUFFER', 0.15);
    setCollisionTuning('MIN_CAMERA_DIST', 0.5);
    setCollisionTuning('SWEEP_RADIUS', 0.8);
    setCollisionTuning('CRUSH_THRESHOLD', 0.3);
    // Clear any leftover mock intersections
    mockIntersections.length = 0;
  });

  it('getCollisionTuning returns default values', () => {
    const tuning = getCollisionTuning();
    expect(tuning.COLLISION_BUFFER).toBe(0.15);
    expect(tuning.MIN_CAMERA_DIST).toBe(0.5);
    expect(tuning.SWEEP_RADIUS).toBe(0.8);
    expect(tuning.CRUSH_THRESHOLD).toBe(0.3);
  });

  it('setCollisionTuning updates individual values', () => {
    setCollisionTuning('COLLISION_BUFFER', 0.5);
    expect(getCollisionTuning().COLLISION_BUFFER).toBe(0.5);

    setCollisionTuning('MIN_CAMERA_DIST', 1.0);
    expect(getCollisionTuning().MIN_CAMERA_DIST).toBe(1.0);
  });

  it('setCameraCollisionMeshes / getCameraCollisionMeshes round-trips', () => {
    const meshA = {} as THREE.Mesh;
    const meshB = {} as THREE.Mesh;
    setCameraCollisionMeshes([meshA, meshB]);
    const result = getCameraCollisionMeshes();
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(meshA);
    expect(result[1]).toBe(meshB);
  });

  it('resolveCameraCollision with no meshes returns push=0 and copies desiredPos', () => {
    setCameraCollisionMeshes([]);
    const pivot = new FakeVector3(0, 0, 0);
    const desired = new FakeVector3(0, 5, -10);
    const out = new FakeVector3();

    const push = resolveCameraCollision(
      pivot as unknown as THREE.Vector3,
      desired as unknown as THREE.Vector3,
      out as unknown as THREE.Vector3,
    );

    expect(push).toBe(0);
    expect(out.x).toBe(desired.x);
    expect(out.y).toBe(desired.y);
    expect(out.z).toBe(desired.z);
  });

  it('resolveCameraCollision with zero-length direction returns 0', () => {
    // Same pivot and desired = zero-length direction vector
    setCameraCollisionMeshes([{} as THREE.Mesh]);
    const samePoint = new FakeVector3(5, 5, 5);
    const out = new FakeVector3();

    const push = resolveCameraCollision(
      samePoint as unknown as THREE.Vector3,
      samePoint as unknown as THREE.Vector3,
      out as unknown as THREE.Vector3,
    );

    expect(push).toBe(0);
  });

  it('center ray hit shortens boom by COLLISION_BUFFER', () => {
    setCameraCollisionMeshes([{} as THREE.Mesh]);
    const pivot = new FakeVector3(0, 0, 0);
    const desired = new FakeVector3(0, 0, -10);
    const out = new FakeVector3();

    // Center ray hits at distance 5; offset rays miss
    mockIntersections.push([{ distance: 5 }]); // center ray
    mockIntersections.push([]);                 // up offset ray
    mockIntersections.push([]);                 // right offset ray

    const push = resolveCameraCollision(
      pivot as unknown as THREE.Vector3,
      desired as unknown as THREE.Vector3,
      out as unknown as THREE.Vector3,
    );

    // correctedDist = 5 - 0.15 = 4.85, maxDist = 10
    // push = 1 - 4.85/10 = 0.515
    expect(push).toBeGreaterThan(0);
    expect(push).toBeCloseTo(1 - (5 - 0.15) / 10, 5);
  });

  it('offset ray hit (up) takes closest across all rays', () => {
    setCameraCollisionMeshes([{} as THREE.Mesh]);
    const pivot = new FakeVector3(0, 0, 0);
    const desired = new FakeVector3(0, 0, -10);
    const out = new FakeVector3();

    // Center ray hits at 8, up offset ray hits at 3 (closer)
    mockIntersections.push([{ distance: 8 }]); // center ray
    mockIntersections.push([{ distance: 3 }]); // up offset ray — closer
    mockIntersections.push([]);                 // right offset ray

    const push = resolveCameraCollision(
      pivot as unknown as THREE.Vector3,
      desired as unknown as THREE.Vector3,
      out as unknown as THREE.Vector3,
    );

    // Closest = 3, correctedDist = 3 - 0.15 = 2.85, maxDist = 10
    expect(push).toBeCloseTo(1 - (3 - 0.15) / 10, 5);
  });

  it('correctedDist is clamped to MIN_CAMERA_DIST when very close', () => {
    setCameraCollisionMeshes([{} as THREE.Mesh]);
    setCollisionTuning('MIN_CAMERA_DIST', 0.5);
    setCollisionTuning('COLLISION_BUFFER', 0.15);
    const pivot = new FakeVector3(0, 0, 0);
    const desired = new FakeVector3(0, 0, -10);
    const out = new FakeVector3();

    // Hit extremely close — correctedDist would go below MIN_CAMERA_DIST
    mockIntersections.push([{ distance: 0.2 }]); // center: 0.2 - 0.15 = 0.05 < 0.5
    mockIntersections.push([]);
    mockIntersections.push([]);

    const push = resolveCameraCollision(
      pivot as unknown as THREE.Vector3,
      desired as unknown as THREE.Vector3,
      out as unknown as THREE.Vector3,
    );

    // correctedDist clamped to 0.5, push = 1 - 0.5/10 = 0.95
    expect(push).toBeCloseTo(1 - 0.5 / 10, 5);
  });

  it('height raise when distance crushed below CRUSH_THRESHOLD fraction', () => {
    setCameraCollisionMeshes([{} as THREE.Mesh]);
    setCollisionTuning('CRUSH_THRESHOLD', 0.3);
    setCollisionTuning('COLLISION_BUFFER', 0.15);
    setCollisionTuning('MIN_CAMERA_DIST', 0.5);
    const pivot = new FakeVector3(0, 0, 0);
    const desired = new FakeVector3(0, 0, -10);
    const out = new FakeVector3();

    // maxDist = 10, crushLimit = 10 * 0.3 = 3.0
    // Hit at 1.0 -> correctedDist = 1.0 - 0.15 = 0.85 < crushLimit
    mockIntersections.push([{ distance: 1.0 }]); // center
    mockIntersections.push([]);                    // up
    mockIntersections.push([]);                    // right

    resolveCameraCollision(
      pivot as unknown as THREE.Vector3,
      desired as unknown as THREE.Vector3,
      out as unknown as THREE.Vector3,
    );

    // Height raise: out.y += (crushLimit - correctedDist) * 0.5
    // crushLimit = 3.0, correctedDist = 0.85
    // out.y = pivot.y + dir.y * crushLimit + (3.0 - 0.85) * 0.5
    // dir = (0, 0, -1), so dir.y * crushLimit = 0
    // out.y = 0 + 0 + (2.15) * 0.5 = 1.075
    expect(out.y).toBeCloseTo((3.0 - 0.85) * 0.5, 4);
  });

  it('no height raise when correctedDist above crush threshold', () => {
    setCameraCollisionMeshes([{} as THREE.Mesh]);
    setCollisionTuning('CRUSH_THRESHOLD', 0.3);
    setCollisionTuning('COLLISION_BUFFER', 0.15);
    const pivot = new FakeVector3(0, 0, 0);
    const desired = new FakeVector3(0, 0, -10);
    const out = new FakeVector3();

    // maxDist = 10, crushLimit = 3.0
    // Hit at 6.0 -> correctedDist = 6.0 - 0.15 = 5.85 > crushLimit
    mockIntersections.push([{ distance: 6.0 }]); // center
    mockIntersections.push([]);                    // up
    mockIntersections.push([]);                    // right

    resolveCameraCollision(
      pivot as unknown as THREE.Vector3,
      desired as unknown as THREE.Vector3,
      out as unknown as THREE.Vector3,
    );

    // No height raise — camera just moves along direction
    // dir = (0, 0, -1), correctedDist = 5.85
    // out = pivot + dir * 5.85 = (0, 0, -5.85)
    expect(out.y).toBe(0);
    expect(out.z).toBeCloseTo(-5.85, 4);
  });

  it('right offset ray detects side wall collision', () => {
    setCameraCollisionMeshes([{} as THREE.Mesh]);
    const pivot = new FakeVector3(0, 0, 0);
    const desired = new FakeVector3(0, 0, -10);
    const out = new FakeVector3();

    // Center and up miss, right offset hits closest
    mockIntersections.push([]);                 // center: no hit
    mockIntersections.push([]);                 // up: no hit
    mockIntersections.push([{ distance: 4 }]); // right offset: hit at 4

    const push = resolveCameraCollision(
      pivot as unknown as THREE.Vector3,
      desired as unknown as THREE.Vector3,
      out as unknown as THREE.Vector3,
    );

    // correctedDist = 4 - 0.15 = 3.85, maxDist = 10
    expect(push).toBeCloseTo(1 - 3.85 / 10, 5);
  });
});

// ================================================================
// 5. cameraShake.ts — triggerShake and updateShake
// ================================================================
describe('cameraShake.ts', () => {
  let savedShake: boolean;

  beforeEach(() => {
    savedShake = getSHAKE_ENABLED();
    setShakeEnabled(true);
  });

  afterEach(() => {
    setShakeEnabled(savedShake);
  });

  it('triggerShake("boost") adds impulse to activeImpulses', () => {
    const cs = makeCameraRigState();
    expect(cs.activeImpulses).toHaveLength(0);

    triggerShake('boost', cs);

    expect(cs.activeImpulses).toHaveLength(1);
    expect(cs.activeImpulses[0].amplitude).toBe(0.08);
    expect(cs.activeImpulses[0].frequency).toBe(18);
    expect(cs.activeImpulses[0].duration).toBe(0.25);
    expect(cs.activeImpulses[0].elapsed).toBe(0);
  });

  it('triggerShake("collision") adds collision impulse', () => {
    const cs = makeCameraRigState();
    triggerShake('collision', cs);

    expect(cs.activeImpulses).toHaveLength(1);
    expect(cs.activeImpulses[0].amplitude).toBe(0.15);
    expect(cs.activeImpulses[0].frequency).toBe(14);
    expect(cs.activeImpulses[0].duration).toBe(0.35);
  });

  it('triggerShake is no-op when shake disabled', () => {
    setShakeEnabled(false);
    const cs = makeCameraRigState();

    triggerShake('boost', cs);

    expect(cs.activeImpulses).toHaveLength(0);
  });

  it('triggerShake is no-op when cs is undefined', () => {
    // Should not throw
    expect(() => triggerShake('boost', undefined)).not.toThrow();
  });

  it('updateShake decays impulses and removes expired ones', () => {
    const cs = makeCameraRigState();
    triggerShake('boost', cs);
    expect(cs.activeImpulses).toHaveLength(1);

    // Advance past the impulse duration (0.25s)
    updateShake(0.3, cs);

    expect(cs.activeImpulses).toHaveLength(0);
  });

  it('updateShake with no impulses sets shakeOffset to zero', () => {
    const cs = makeCameraRigState();
    cs.shakeOffset.set(5, 5, 5);

    updateShake(0.016, cs);

    expect(cs.shakeOffset.x).toBe(0);
    expect(cs.shakeOffset.y).toBe(0);
    expect(cs.shakeOffset.z).toBe(0);
  });

  it('updateShake advances elapsed and produces non-zero offset', () => {
    const cs = makeCameraRigState();
    triggerShake('boost', cs);

    // Small dt that won't expire the impulse
    updateShake(0.016, cs);

    // Impulse should still be active
    expect(cs.activeImpulses).toHaveLength(1);
    expect(cs.activeImpulses[0].elapsed).toBeCloseTo(0.016, 5);

    // shakeOffset should have some value (noise-based, hard to predict exact)
    const hasOffset = cs.shakeOffset.x !== 0 || cs.shakeOffset.y !== 0;
    expect(hasOffset).toBe(true);
  });

  it('updateShake with shake disabled clears offset to zero', () => {
    const cs = makeCameraRigState();
    triggerShake('boost', cs);
    cs.shakeOffset.set(1, 1, 1);

    setShakeEnabled(false);
    updateShake(0.016, cs);

    expect(cs.shakeOffset.x).toBe(0);
    expect(cs.shakeOffset.y).toBe(0);
    expect(cs.shakeOffset.z).toBe(0);
  });
});

// ================================================================
// 6. cameraState.ts — detectMode and tickStateMachine
// ================================================================
describe('cameraState.ts', () => {
  describe('detectMode', () => {
    it('all flags false returns Normal', () => {
      const player = makeCameraTarget({ boosting: false, dashing: false, drifting: false, driftBoosting: false });
      expect(detectMode(player)).toBe(CameraMode.Normal);
    });

    it('dashing=true returns Dash (highest priority)', () => {
      const player = makeCameraTarget({ dashing: true, boosting: true, drifting: true, driftBoosting: true });
      expect(detectMode(player)).toBe(CameraMode.Dash);
    });

    it('driftBoosting=true (no dashing) returns DriftBoost', () => {
      const player = makeCameraTarget({ driftBoosting: true, drifting: true, boosting: true });
      expect(detectMode(player)).toBe(CameraMode.DriftBoost);
    });

    it('drifting=true (no dashing, no driftBoosting) returns Drift', () => {
      const player = makeCameraTarget({ drifting: true, boosting: true });
      expect(detectMode(player)).toBe(CameraMode.Drift);
    });

    it('boosting=true (no dashing, no drifting) returns Boost', () => {
      const player = makeCameraTarget({ boosting: true });
      expect(detectMode(player)).toBe(CameraMode.Boost);
    });
  });

  describe('tickStateMachine', () => {
    it('starts Normal, detects Normal, blendT stays at 1', () => {
      const cs = makeCameraRigState({ currentMode: CameraMode.Normal, blendT: 1 });
      const player = makeCameraTarget();

      const profile = tickStateMachine(player, 0.016, cs);

      expect(cs.currentMode).toBe(CameraMode.Normal);
      expect(cs.blendT).toBe(1);
      expect(profile).toBeDefined();
      expect(profile.baseFov).toBeDefined();
    });

    it('mode transition resets blendT to 0', () => {
      const cs = makeCameraRigState({ currentMode: CameraMode.Normal, blendT: 1 });
      const player = makeCameraTarget({ dashing: true });

      tickStateMachine(player, 0.016, cs);

      expect(cs.currentMode).toBe(CameraMode.Dash);
      expect(cs.previousMode).toBe(CameraMode.Normal);
      // blendT was reset to 0 then advanced by dt/BLEND_DURATION
      // BLEND_DURATION = 0.18, so blendT = 0 + 0.016/0.18 ~ 0.089
      expect(cs.blendT).toBeGreaterThan(0);
      expect(cs.blendT).toBeLessThan(1);
    });

    it('successive ticks advance blendT toward 1', () => {
      const cs = makeCameraRigState({ currentMode: CameraMode.Normal, blendT: 1 });
      const player = makeCameraTarget({ dashing: true });

      // First tick: triggers transition
      tickStateMachine(player, 0.016, cs);
      const firstBlend = cs.blendT;

      // Second tick: advances further
      tickStateMachine(player, 0.016, cs);
      expect(cs.blendT).toBeGreaterThan(firstBlend);
    });

    it('blendT reaches 1 after enough ticks', () => {
      const cs = makeCameraRigState({ currentMode: CameraMode.Normal, blendT: 1 });
      const player = makeCameraTarget({ boosting: true });

      // Trigger transition
      tickStateMachine(player, 0.016, cs);

      // Run enough frames to complete blend (0.18s / 0.016 ~ 12 frames)
      for (let i = 0; i < 20; i++) {
        tickStateMachine(player, 0.016, cs);
      }

      expect(cs.blendT).toBe(1);
    });

    it('returned profile interpolates between frozen and target', () => {
      const cs = makeCameraRigState({ currentMode: CameraMode.Normal, blendT: 1 });
      const player = makeCameraTarget({ boosting: true });

      // Transition Normal->Boost at t=0
      const profile = tickStateMachine(player, 0.001, cs);

      // Very small dt, so blend is near 0 — profile should be close to Normal
      const normalDist = PROFILE_MAP[CameraMode.Normal].baseDist;
      const boostDist = PROFILE_MAP[CameraMode.Boost].baseDist;
      expect(profile.baseDist).toBeGreaterThanOrEqual(Math.min(normalDist, boostDist));
      expect(profile.baseDist).toBeLessThanOrEqual(Math.max(normalDist, boostDist));
    });

    it('double transition freezes correct intermediate profile', () => {
      const cs = makeCameraRigState({ currentMode: CameraMode.Normal, blendT: 1 });

      // Transition 1: Normal -> Boost
      const boostPlayer = makeCameraTarget({ boosting: true });
      tickStateMachine(boostPlayer, 0.05, cs);
      expect(cs.currentMode).toBe(CameraMode.Boost);

      // Transition 2: Boost -> Dash (before blend completes)
      const dashPlayer = makeCameraTarget({ dashing: true });
      tickStateMachine(dashPlayer, 0.016, cs);
      expect(cs.currentMode).toBe(CameraMode.Dash);
      expect(cs.previousMode).toBe(CameraMode.Boost);
      // blendT should be reset for the new transition
      expect(cs.blendT).toBeLessThan(0.5);
    });
  });
});
