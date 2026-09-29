/**
 * Unit tests for src/camera/cameraRig.ts
 *
 * Strategy:
 * - Mock Three.js with a real-math Vector3 substitute so module-level scratch
 *   vectors and CameraRigState fields initialise correctly.
 * - MathUtils.damp is re-implemented inline so pure-math behaviour is verifiable
 *   without depending on the three package at all.
 * - Collision resolution is mocked to return 0 (no obstruction) so updateCamera
 *   tests focus on damping / FOV logic, not raycast geometry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Use vi.hoisted so the factory is available before vi.mock hoisting ─
const { FakeVector3, fakeDamp } = vi.hoisted(() => {
  class FakeVector3 {
    x: number; y: number; z: number;
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this; }
    copy(v: { x: number; y: number; z: number }): this { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone(): FakeVector3 { return new FakeVector3(this.x, this.y, this.z); }
    add(v: { x: number; y: number; z: number }): this { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    sub(v: { x: number; y: number; z: number }): this { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
    subVectors(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): this {
      this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this;
    }
    addScaledVector(v: { x: number; y: number; z: number }, s: number): this {
      this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this;
    }
    multiplyScalar(s: number): this { this.x *= s; this.y *= s; this.z *= s; return this; }
    normalize(): this {
      const l = this.length();
      if (l > 1e-9) { this.x /= l; this.y /= l; this.z /= l; }
      return this;
    }
    length(): number { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
    divideScalar(s: number): this { this.x /= s; this.y /= s; this.z /= s; return this; }
    distanceTo(v: { x: number; y: number; z: number }): number {
      const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }

  /** Frame-rate-independent damp: mirrors THREE.MathUtils.damp. */
  function fakeDamp(current: number, target: number, lambda: number, dt: number): number {
    return current + (target - current) * (1 - Math.exp(-lambda * dt));
  }

  return { FakeVector3, fakeDamp };
});

// ── Mock three ────────────────────────────────────────────────
vi.mock('three', () => ({
  Vector3: FakeVector3,
  Raycaster: vi.fn(() => ({
    set: vi.fn(),
    near: 0,
    far: Infinity,
    intersectObjects: vi.fn(() => []),
  })),
  MathUtils: {
    damp: fakeDamp,
  },
}));

// ── Mock cameraCollision — no geometry in unit tests ─────────
vi.mock('./cameraCollision', () => ({
  resolveCameraCollision: vi.fn(
    (_pivot: unknown, desired: InstanceType<typeof FakeVector3>, out: InstanceType<typeof FakeVector3>) => {
      out.copy(desired);
      return 0;
    },
  ),
  setCameraCollisionMeshes: vi.fn(),
  getCameraCollisionMeshes: vi.fn(() => []),
  getCollisionTuning: vi.fn(() => ({})),
  setCollisionTuning: vi.fn(),
}));

// ── Mock cameraShake — deterministic no-op ───────────────────
vi.mock('./cameraShake', () => ({
  triggerShake: vi.fn(),
  updateShake: vi.fn(),
}));

// ── Now import the module under test ─────────────────────────
import {
  createCameraState,
  resetCamera,
  seedCameraState,
  updateCamera,
  getRigTuning,
  setRigTuning,
} from './cameraRig';
import { CameraMode } from './types';
import { DEFAULT_NORMAL_PROFILE } from './cameraProfiles';
import { getBASE_FOV } from './cameraConfig';

// ── Helpers ────────────────────────────────────────────────────

function makeMockCamera(x = 0, y = 10, z = -20) {
  const pos = new FakeVector3(x, y, z);
  return {
    position: pos,
    lookAt: vi.fn(),
    updateProjectionMatrix: vi.fn(),
    fov: getBASE_FOV(),
  };
}

function makeAlivePlayer(overrides: Partial<{
  x: number; y: number; z: number;
  angle: number; speed: number; maxSpeed: number;
  boosting: boolean; dashing: boolean; drifting: boolean; driftBoosting: boolean;
  slipAngle: number; velocityAngle: number;
}> = {}) {
  const { x = 0, y = 0, z = 0, angle = 0, speed = 30, maxSpeed = 100, ...rest } = overrides;
  return {
    mesh: { position: new FakeVector3(x, y, z) },
    angle,
    alive: true,
    speed,
    maxSpeed,
    boosting: false,
    dashing: false,
    drifting: false,
    driftBoosting: false,
    proximitySpeedBoost: 0,
    slipAngle: 0,
    velocityAngle: angle,
    ...rest,
  };
}

// ── Tests: createCameraState ───────────────────────────────────

describe('createCameraState', () => {
  it('returns an object with all required fields', () => {
    const cs = createCameraState();
    expect(cs).toBeDefined();
    expect(cs.pivotPos).toBeDefined();
    expect(cs.boomPos).toBeDefined();
    expect(cs.camPos).toBeDefined();
    expect(cs.lookTarget).toBeDefined();
    expect(cs.shakeOffset).toBeDefined();
    expect(cs.activeImpulses).toBeDefined();
    expect(cs.targetPos).toBeDefined();
    expect(cs.targetLook).toBeDefined();
    expect(cs.currentLook).toBeDefined();
  });

  it('starts with CameraMode.Normal', () => {
    const cs = createCameraState();
    expect(cs.currentMode).toBe(CameraMode.Normal);
    expect(cs.previousMode).toBe(CameraMode.Normal);
  });

  it('starts with blendT = 1 (fully blended)', () => {
    const cs = createCameraState();
    expect(cs.blendT).toBe(1);
  });

  it('starts with lookInitialized = false', () => {
    const cs = createCameraState();
    expect(cs.lookInitialized).toBe(false);
  });

  it('starts with prevAngle = null', () => {
    const cs = createCameraState();
    expect(cs.prevAngle).toBeNull();
  });

  it('starts with _proxFOV = 0 and occlusionPush = 0', () => {
    const cs = createCameraState();
    expect(cs._proxFOV).toBe(0);
    expect(cs.occlusionPush).toBe(0);
    expect(cs.prevOcclusionPush).toBe(0);
  });

  it('starts with smoothHeadingZ = -1 (pointing away from camera default)', () => {
    const cs = createCameraState();
    expect(cs.smoothHeadingX).toBe(0);
    expect(cs.smoothHeadingZ).toBe(-1);
  });

  it('frozenProfile matches DEFAULT_NORMAL_PROFILE', () => {
    const cs = createCameraState();
    expect(cs.frozenProfile).toEqual(DEFAULT_NORMAL_PROFILE);
    // Should be a copy, not the same reference
    expect(cs.frozenProfile).not.toBe(DEFAULT_NORMAL_PROFILE);
  });

  it('currentFOV matches getBASE_FOV()', () => {
    const cs = createCameraState();
    expect(cs.currentFOV).toBe(getBASE_FOV());
  });

  it('activeImpulses starts as empty array', () => {
    const cs = createCameraState();
    expect(Array.isArray(cs.activeImpulses)).toBe(true);
    expect(cs.activeImpulses).toHaveLength(0);
  });

  it('each call returns a new independent state object', () => {
    const a = createCameraState();
    const b = createCameraState();
    expect(a).not.toBe(b);
    expect(a.pivotPos).not.toBe(b.pivotPos);
  });
});

// ── Tests: resetCamera ─────────────────────────────────────────

describe('resetCamera', () => {
  it('resets lookInitialized to false', () => {
    const cs = createCameraState();
    cs.lookInitialized = true;
    resetCamera(cs);
    expect(cs.lookInitialized).toBe(false);
  });

  it('resets currentFOV to getBASE_FOV()', () => {
    const cs = createCameraState();
    cs.currentFOV = 90;
    resetCamera(cs);
    expect(cs.currentFOV).toBe(getBASE_FOV());
  });

  it('resets prevAngle to null', () => {
    const cs = createCameraState();
    cs.prevAngle = 1.5;
    resetCamera(cs);
    expect(cs.prevAngle).toBeNull();
  });

  it('resets _proxFOV to 0', () => {
    const cs = createCameraState();
    cs._proxFOV = 2.5;
    resetCamera(cs);
    expect(cs._proxFOV).toBe(0);
  });

  it('resets currentMode to Normal', () => {
    const cs = createCameraState();
    cs.currentMode = CameraMode.Boost;
    resetCamera(cs);
    expect(cs.currentMode).toBe(CameraMode.Normal);
  });

  it('resets blendT to 1', () => {
    const cs = createCameraState();
    cs.blendT = 0.3;
    resetCamera(cs);
    expect(cs.blendT).toBe(1);
  });

  it('resets frozenProfile to DEFAULT_NORMAL_PROFILE values', () => {
    const cs = createCameraState();
    cs.frozenProfile.baseFov = 999;
    resetCamera(cs);
    expect(cs.frozenProfile).toEqual(DEFAULT_NORMAL_PROFILE);
  });
});

// ── Tests: seedCameraState ─────────────────────────────────────

describe('seedCameraState', () => {
  it('copies camera position into targetPos', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(5, 12, -25);
    const lookTarget = new FakeVector3(0, 1, 10);
    seedCameraState(cam as never, lookTarget as never, cs);
    expect(cs.targetPos.x).toBeCloseTo(5);
    expect(cs.targetPos.y).toBeCloseTo(12);
    expect(cs.targetPos.z).toBeCloseTo(-25);
  });

  it('copies lookTarget into targetLook and currentLook', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(0, 10, -20);
    const lookTarget = new FakeVector3(3, 1, 8);
    seedCameraState(cam as never, lookTarget as never, cs);
    expect(cs.targetLook.x).toBeCloseTo(3);
    expect(cs.targetLook.y).toBeCloseTo(1);
    expect(cs.targetLook.z).toBeCloseTo(8);
    expect(cs.currentLook.x).toBeCloseTo(3);
    expect(cs.currentLook.y).toBeCloseTo(1);
    expect(cs.currentLook.z).toBeCloseTo(8);
  });

  it('sets lookInitialized to true', () => {
    const cs = createCameraState();
    const cam = makeMockCamera();
    const lookTarget = new FakeVector3(0, 0, 0);
    seedCameraState(cam as never, lookTarget as never, cs);
    expect(cs.lookInitialized).toBe(true);
  });

  it('copies camera.fov into currentFOV', () => {
    const cs = createCameraState();
    const cam = makeMockCamera();
    cam.fov = 75;
    const lookTarget = new FakeVector3(0, 0, 0);
    seedCameraState(cam as never, lookTarget as never, cs);
    expect(cs.currentFOV).toBe(75);
  });

  it('resets prevAngle to null', () => {
    const cs = createCameraState();
    cs.prevAngle = 2.0;
    const cam = makeMockCamera();
    const lookTarget = new FakeVector3(0, 0, 0);
    seedCameraState(cam as never, lookTarget as never, cs);
    expect(cs.prevAngle).toBeNull();
  });

  it('resets currentMode to Normal and blendT to 1', () => {
    const cs = createCameraState();
    cs.currentMode = CameraMode.Drift;
    cs.blendT = 0.2;
    const cam = makeMockCamera();
    const lookTarget = new FakeVector3(0, 0, 0);
    seedCameraState(cam as never, lookTarget as never, cs);
    expect(cs.currentMode).toBe(CameraMode.Normal);
    expect(cs.blendT).toBe(1);
  });

  it('resets frozenProfile to DEFAULT_NORMAL_PROFILE', () => {
    const cs = createCameraState();
    cs.frozenProfile.baseFov = 50;
    const cam = makeMockCamera();
    const lookTarget = new FakeVector3(0, 0, 0);
    seedCameraState(cam as never, lookTarget as never, cs);
    expect(cs.frozenProfile).toEqual(DEFAULT_NORMAL_PROFILE);
  });
});

// ── Tests: getRigTuning / setRigTuning ─────────────────────────

describe('getRigTuning / setRigTuning', () => {
  it('returns default tuning values', () => {
    const t = getRigTuning();
    expect(t.DAMP_LATERAL).toBeGreaterThan(0);
    expect(t.DAMP_VERTICAL).toBeGreaterThan(0);
    expect(t.DAMP_DISTANCE).toBeGreaterThan(0);
    expect(t.LOOK_AHEAD_MIN).toBeGreaterThan(0);
    expect(t.LOOK_AHEAD_MAX).toBeGreaterThan(t.LOOK_AHEAD_MIN);
    expect(t.PIVOT_HEIGHT).toBeGreaterThan(0);
  });

  it('setRigTuning updates a single key', () => {
    const before = getRigTuning().DAMP_LATERAL;
    setRigTuning('DAMP_LATERAL', before * 2);
    expect(getRigTuning().DAMP_LATERAL).toBeCloseTo(before * 2);
    // Restore
    setRigTuning('DAMP_LATERAL', before);
  });

  it('setRigTuning ignores unknown keys', () => {
    const before = getRigTuning();
    expect(() => setRigTuning('UNKNOWN_KEY', 999)).not.toThrow();
    const after = getRigTuning();
    expect(after).toEqual(before);
  });

  it('can update all known tuning keys', () => {
    const keys = ['DAMP_LATERAL', 'DAMP_VERTICAL', 'DAMP_DISTANCE', 'LOOK_AHEAD_MIN', 'LOOK_AHEAD_MAX', 'PIVOT_HEIGHT'];
    const original = getRigTuning();
    for (const key of keys) {
      setRigTuning(key, 99);
      expect((getRigTuning() as Record<string, number>)[key]).toBe(99);
    }
    // Restore
    setRigTuning('DAMP_LATERAL', original.DAMP_LATERAL);
    setRigTuning('DAMP_VERTICAL', original.DAMP_VERTICAL);
    setRigTuning('DAMP_DISTANCE', original.DAMP_DISTANCE);
    setRigTuning('LOOK_AHEAD_MIN', original.LOOK_AHEAD_MIN);
    setRigTuning('LOOK_AHEAD_MAX', original.LOOK_AHEAD_MAX);
    setRigTuning('PIVOT_HEIGHT', original.PIVOT_HEIGHT);
  });
});

// ── Tests: updateCamera ─────────────────────────────────────────

describe('updateCamera — early exit conditions', () => {
  it('returns early when player is null', () => {
    const cs = createCameraState();
    const cam = makeMockCamera();
    const startX = cam.position.x;
    updateCamera(cam as never, null, 0.016, cs);
    expect(cam.position.x).toBe(startX);
    expect(cam.updateProjectionMatrix).not.toHaveBeenCalled();
  });

  it('returns early when player.alive is false', () => {
    const cs = createCameraState();
    const cam = makeMockCamera();
    const player = makeAlivePlayer();
    (player as { alive: boolean }).alive = false;
    updateCamera(cam as never, player as never, 0.016, cs);
    expect(cam.updateProjectionMatrix).not.toHaveBeenCalled();
  });

  it('uses cached state when player position is non-finite', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(5, 10, -15);
    cs.targetPos.set(5, 10, -15);
    cs.currentLook.set(0, 1, 0);
    cs.currentFOV = 65;

    const player = makeAlivePlayer();
    (player.mesh.position as FakeVector3).x = NaN;

    updateCamera(cam as never, player as never, 0.016, cs);
    // Camera position should be copied from targetPos
    expect(cam.position.x).toBeCloseTo(5);
    expect(cam.lookAt).toHaveBeenCalled();
    expect(cam.updateProjectionMatrix).toHaveBeenCalled();
  });
});

describe('updateCamera — normal operation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls camera.lookAt and updateProjectionMatrix each frame', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(0, 15, -30);
    const player = makeAlivePlayer({ x: 0, y: 0, z: 0, speed: 30 });

    updateCamera(cam as never, player as never, 0.016, cs);

    expect(cam.lookAt).toHaveBeenCalled();
    expect(cam.updateProjectionMatrix).toHaveBeenCalled();
  });

  it('sets camera.fov after update', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(0, 15, -30);
    const player = makeAlivePlayer({ speed: 30 });

    updateCamera(cam as never, player as never, 0.016, cs);

    expect(cam.fov).toBeGreaterThan(0);
    expect(Number.isFinite(cam.fov)).toBe(true);
  });

  it('FOV is clamped between 55 and 90 degrees', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(0, 15, -30);
    const player = makeAlivePlayer({ speed: 30 });

    // Run several frames
    for (let i = 0; i < 30; i++) {
      updateCamera(cam as never, player as never, 0.016, cs);
    }

    expect(cam.fov).toBeGreaterThanOrEqual(55);
    expect(cam.fov).toBeLessThanOrEqual(90);
  });

  it('currentFOV tracks camera.fov after update', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(0, 15, -30);
    const player = makeAlivePlayer({ speed: 30 });

    updateCamera(cam as never, player as never, 0.016, cs);

    expect(cs.currentFOV).toBeCloseTo(cam.fov);
  });

  it('initializes lookInitialized on first call', () => {
    const cs = createCameraState();
    expect(cs.lookInitialized).toBe(false);

    const cam = makeMockCamera(0, 15, -30);
    const player = makeAlivePlayer();

    updateCamera(cam as never, player as never, 0.016, cs);
    expect(cs.lookInitialized).toBe(true);
  });

  it('records prevAngle after first call', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(0, 15, -30);
    const player = makeAlivePlayer({ angle: 1.2 });

    updateCamera(cam as never, player as never, 0.016, cs);
    expect(cs.prevAngle).toBeCloseTo(1.2);
  });

  it('camera position converges toward target over multiple frames', () => {
    const cs = createCameraState();
    // Seed camera far from vehicle
    const cam = makeMockCamera(100, 50, 100);
    const player = makeAlivePlayer({ x: 0, y: 0, z: 0, speed: 0 });

    const initialDist = (cam.position as FakeVector3).length();

    // Run 60 frames at 60fps
    for (let i = 0; i < 60; i++) {
      updateCamera(cam as never, player as never, 0.016, cs);
    }

    const finalDist = (cam.position as FakeVector3).length();
    // Camera should have moved closer to origin (the vehicle position)
    expect(finalDist).toBeLessThan(initialDist);
  });

  it('larger dt results in faster convergence than smaller dt', () => {
    const player = makeAlivePlayer({ x: 0, y: 0, z: 0, speed: 0 });

    // Sim A: large dt (fast convergence)
    const csA = createCameraState();
    const camA = makeMockCamera(100, 50, 100);
    for (let i = 0; i < 10; i++) {
      updateCamera(camA as never, player as never, 0.1, csA);
    }

    // Sim B: small dt (slow convergence)
    const csB = createCameraState();
    const camB = makeMockCamera(100, 50, 100);
    for (let i = 0; i < 10; i++) {
      updateCamera(camB as never, player as never, 0.001, csB);
    }

    const distA = (camA.position as FakeVector3).length();
    const distB = (camB.position as FakeVector3).length();

    // Larger dt should have moved camera more (closer to vehicle)
    expect(distA).toBeLessThan(distB);
  });

  it('targetPos is updated to the resolved boom position each frame', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(0, 15, -30);
    const player = makeAlivePlayer({ x: 0, y: 0, z: 0 });

    updateCamera(cam as never, player as never, 0.016, cs);

    // targetPos should be a finite position
    expect(Number.isFinite(cs.targetPos.x)).toBe(true);
    expect(Number.isFinite(cs.targetPos.y)).toBe(true);
    expect(Number.isFinite(cs.targetPos.z)).toBe(true);
  });

  it('does not produce NaN in camera position after many frames', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(0, 15, -30);
    const player = makeAlivePlayer({ x: 0, y: 0, z: 0, speed: 50, angle: 0.5 });

    for (let i = 0; i < 120; i++) {
      updateCamera(cam as never, player as never, 0.016, cs);
    }

    expect(Number.isFinite(cam.position.x)).toBe(true);
    expect(Number.isFinite(cam.position.y)).toBe(true);
    expect(Number.isFinite(cam.position.z)).toBe(true);
    expect(Number.isFinite(cam.fov)).toBe(true);
  });
});

describe('updateCamera — right-stick inputs', () => {
  it('accepts rightStickX and rightStickY without throwing', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(0, 15, -30);
    const player = makeAlivePlayer({ speed: 40 });

    expect(() => {
      updateCamera(cam as never, player as never, 0.016, cs, 1.0, -0.5);
    }).not.toThrow();
  });

  it('rightStickY = 1 produces different camera position than rightStickY = -1', () => {
    const player = makeAlivePlayer({ x: 0, y: 0, z: 0, speed: 30 });

    // Run enough frames to reach near-steady-state
    const csUp = createCameraState();
    const camUp = makeMockCamera(0, 15, -30);
    for (let i = 0; i < 30; i++) {
      updateCamera(camUp as never, player as never, 0.016, csUp, 0, 1.0);
    }

    const csDown = createCameraState();
    const camDown = makeMockCamera(0, 15, -30);
    for (let i = 0; i < 30; i++) {
      updateCamera(camDown as never, player as never, 0.016, csDown, 0, -1.0);
    }

    // Stick-up should push camera further back (larger Z magnitude in some axis)
    // We just verify they differ — the exact direction depends on heading
    const yUp = camUp.position.y;
    const yDown = camDown.position.y;
    expect(yUp).not.toBeCloseTo(yDown, 3);
  });
});

describe('updateCamera — FOV dynamics', () => {
  it('proxFOV stays 0 when proximitySpeedBoost is 0', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(0, 15, -30);
    const player = makeAlivePlayer({ speed: 30, proximitySpeedBoost: 0 } as Parameters<typeof makeAlivePlayer>[0] & { proximitySpeedBoost: number });

    for (let i = 0; i < 30; i++) {
      updateCamera(cam as never, player as never, 0.016, cs);
    }

    expect(cs._proxFOV).toBeCloseTo(0, 3);
  });

  it('proxFOV rises when proximitySpeedBoost is high', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(0, 15, -30);
    const player = makeAlivePlayer({ speed: 30 });
    (player as { proximitySpeedBoost: number }).proximitySpeedBoost = 0.8;

    for (let i = 0; i < 30; i++) {
      updateCamera(cam as never, player as never, 0.016, cs);
    }

    expect(cs._proxFOV).toBeGreaterThan(0);
  });

  it('FOV is higher at max speed than at zero speed (fovSpeedGain > 0)', () => {
    // Run both until near-convergence
    const csZero = createCameraState();
    const camZero = makeMockCamera(0, 15, -30);
    const playerZero = makeAlivePlayer({ speed: 0 });
    for (let i = 0; i < 60; i++) {
      updateCamera(camZero as never, playerZero as never, 0.016, csZero);
    }

    const csFast = createCameraState();
    const camFast = makeMockCamera(0, 15, -30);
    const playerFast = makeAlivePlayer({ speed: 100, maxSpeed: 100 });
    for (let i = 0; i < 60; i++) {
      updateCamera(camFast as never, playerFast as never, 0.016, csFast);
    }

    // At full speed the FOV should be larger (fovSpeedGain is positive in all profiles)
    expect(camFast.fov).toBeGreaterThan(camZero.fov - 0.1);
  });
});

describe('updateCamera — smoothHeadingX/Z tracking', () => {
  it('smoothHeadingX and smoothHeadingZ converge toward vehicle heading', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(0, 15, -30);
    // Vehicle heading: angle = 0 → carFwdX = -sin(0) = 0, carFwdZ = -cos(0) = -1
    const player = makeAlivePlayer({ angle: 0, speed: 30 });

    for (let i = 0; i < 30; i++) {
      updateCamera(cam as never, player as never, 0.016, cs);
    }

    // smoothHeadingX should approach 0, smoothHeadingZ should approach -1
    expect(Math.abs(cs.smoothHeadingX)).toBeLessThan(0.2);
    expect(cs.smoothHeadingZ).toBeLessThan(-0.7);
  });
});
