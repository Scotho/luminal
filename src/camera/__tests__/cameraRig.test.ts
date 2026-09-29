/**
 * Unit tests for src/camera/cameraRig.ts — factory, seed, reset, tuning
 *
 * Covers createCameraState, seedCameraState, resetCamera, getRigTuning/setRigTuning,
 * and updateCamera early-exit paths. Full updateCamera convergence tests live in
 * the root-level cameraRig.test.ts.
 *
 * THREE.js is mocked with FakeVector3 and MathUtils.damp.
 * cameraCollision and cameraShake are mocked to isolate rig logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock factory ─────────────────────────────────────
const { FakeVector3, fakeDamp } = vi.hoisted(() => {
  class FakeVector3 {
    x: number;
    y: number;
    z: number;
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    set(x: number, y: number, z: number): this {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
    copy(v: { x: number; y: number; z: number }): this {
      this.x = v.x;
      this.y = v.y;
      this.z = v.z;
      return this;
    }
    clone(): FakeVector3 {
      return new FakeVector3(this.x, this.y, this.z);
    }
    add(v: { x: number; y: number; z: number }): this {
      this.x += v.x;
      this.y += v.y;
      this.z += v.z;
      return this;
    }
    sub(v: { x: number; y: number; z: number }): this {
      this.x -= v.x;
      this.y -= v.y;
      this.z -= v.z;
      return this;
    }
    subVectors(
      a: { x: number; y: number; z: number },
      b: { x: number; y: number; z: number },
    ): this {
      this.x = a.x - b.x;
      this.y = a.y - b.y;
      this.z = a.z - b.z;
      return this;
    }
    addScaledVector(v: { x: number; y: number; z: number }, s: number): this {
      this.x += v.x * s;
      this.y += v.y * s;
      this.z += v.z * s;
      return this;
    }
    multiplyScalar(s: number): this {
      this.x *= s;
      this.y *= s;
      this.z *= s;
      return this;
    }
    normalize(): this {
      const l = this.length();
      if (l > 1e-9) {
        this.x /= l;
        this.y /= l;
        this.z /= l;
      }
      return this;
    }
    length(): number {
      return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }
    divideScalar(s: number): this {
      this.x /= s;
      this.y /= s;
      this.z /= s;
      return this;
    }
    distanceTo(v: { x: number; y: number; z: number }): number {
      const dx = this.x - v.x;
      const dy = this.y - v.y;
      const dz = this.z - v.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }

  function fakeDamp(
    current: number,
    target: number,
    lambda: number,
    dt: number,
  ): number {
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
  MathUtils: { damp: fakeDamp },
}));

// ── Mock cameraCollision ──────────────────────────────────────
vi.mock('../cameraCollision', () => ({
  resolveCameraCollision: vi.fn(
    (
      _pivot: unknown,
      desired: InstanceType<typeof FakeVector3>,
      out: InstanceType<typeof FakeVector3>,
    ) => {
      out.copy(desired);
      return 0;
    },
  ),
  setCameraCollisionMeshes: vi.fn(),
  getCameraCollisionMeshes: vi.fn(() => []),
  getCollisionTuning: vi.fn(() => ({})),
  setCollisionTuning: vi.fn(),
}));

// ── Mock cameraShake ──────────────────────────────────────────
vi.mock('../cameraShake', () => ({
  triggerShake: vi.fn(),
  updateShake: vi.fn(),
}));

// ── Imports ───────────────────────────────────────────────────
import {
  createCameraState,
  resetCamera,
  seedCameraState,
  updateCamera,
  getRigTuning,
  setRigTuning,
} from '../cameraRig';
import { CameraMode } from '../types';
import { DEFAULT_NORMAL_PROFILE } from '../cameraProfiles';
import { getBASE_FOV } from '../cameraConfig';

// ── Helpers ───────────────────────────────────────────────────

function makeMockCamera(x = 0, y = 10, z = -20) {
  return {
    position: new FakeVector3(x, y, z),
    lookAt: vi.fn(),
    updateProjectionMatrix: vi.fn(),
    fov: getBASE_FOV(),
  };
}

function makePlayer(overrides: Partial<{
  x: number; y: number; z: number; angle: number;
  speed: number; maxSpeed: number;
  boosting: boolean; dashing: boolean; drifting: boolean; driftBoosting: boolean;
  isGrinding: boolean; grindBalanceValue: number;
}> = {}) {
  const { x = 0, y = 0, z = 0, angle = 0, speed = 30, maxSpeed = 100, ...rest } = overrides;
  return {
    mesh: { position: new FakeVector3(x, y, z) },
    angle, alive: true, speed, maxSpeed,
    boosting: false, dashing: false, drifting: false, driftBoosting: false,
    proximitySpeedBoost: 0, slipAngle: 0, velocityAngle: angle,
    isGrinding: false, grindBalanceValue: 0,
    ...rest,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('createCameraState', () => {
  it('returns all required CameraRigState fields', () => {
    const cs = createCameraState();
    expect(cs.pivotPos).toBeDefined();
    expect(cs.boomPos).toBeDefined();
    expect(cs.camPos).toBeDefined();
    expect(cs.lookTarget).toBeDefined();
    expect(cs.shakeOffset).toBeDefined();
    expect(cs.activeImpulses).toEqual([]);
    expect(cs.targetPos).toBeDefined();
    expect(cs.targetLook).toBeDefined();
    expect(cs.currentLook).toBeDefined();
  });

  it('starts in Normal mode with blendT=1', () => {
    const cs = createCameraState();
    expect(cs.currentMode).toBe(CameraMode.Normal);
    expect(cs.previousMode).toBe(CameraMode.Normal);
    expect(cs.blendT).toBe(1);
  });

  it('frozenProfile is a copy of DEFAULT_NORMAL_PROFILE', () => {
    const cs = createCameraState();
    expect(cs.frozenProfile).toEqual(DEFAULT_NORMAL_PROFILE);
    expect(cs.frozenProfile).not.toBe(DEFAULT_NORMAL_PROFILE);
  });

  it('each call returns independent state', () => {
    const a = createCameraState();
    const b = createCameraState();
    expect(a).not.toBe(b);
    expect(a.pivotPos).not.toBe(b.pivotPos);
  });

  it('smoothHeadingZ defaults to -1 (facing away from camera)', () => {
    const cs = createCameraState();
    expect(cs.smoothHeadingX).toBe(0);
    expect(cs.smoothHeadingZ).toBe(-1);
  });
});

describe('resetCamera', () => {
  it('resets mode, blend, fov, and lookInitialized', () => {
    const cs = createCameraState();
    cs.currentMode = CameraMode.Dash;
    cs.blendT = 0.3;
    cs.currentFOV = 90;
    cs.lookInitialized = true;
    cs.prevAngle = 1.5;
    cs._proxFOV = 2.5;

    resetCamera(cs);

    expect(cs.currentMode).toBe(CameraMode.Normal);
    expect(cs.blendT).toBe(1);
    expect(cs.currentFOV).toBe(getBASE_FOV());
    expect(cs.lookInitialized).toBe(false);
    expect(cs.prevAngle).toBeNull();
    expect(cs._proxFOV).toBe(0);
  });

  it('resets frozenProfile to DEFAULT_NORMAL_PROFILE values', () => {
    const cs = createCameraState();
    cs.frozenProfile.baseFov = 999;
    resetCamera(cs);
    expect(cs.frozenProfile).toEqual(DEFAULT_NORMAL_PROFILE);
  });
});

describe('seedCameraState', () => {
  it('seeds targetPos from camera position', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(5, 12, -25);
    const look = new FakeVector3(0, 1, 10);

    seedCameraState(cam as never, look as never, cs);

    expect(cs.targetPos.x).toBeCloseTo(5);
    expect(cs.targetPos.y).toBeCloseTo(12);
    expect(cs.targetPos.z).toBeCloseTo(-25);
  });

  it('seeds currentLook and targetLook from lookTarget', () => {
    const cs = createCameraState();
    const cam = makeMockCamera();
    const look = new FakeVector3(3, 1, 8);

    seedCameraState(cam as never, look as never, cs);

    expect(cs.targetLook.x).toBeCloseTo(3);
    expect(cs.currentLook.x).toBeCloseTo(3);
  });

  it('sets lookInitialized to true', () => {
    const cs = createCameraState();
    seedCameraState(makeMockCamera() as never, new FakeVector3() as never, cs);
    expect(cs.lookInitialized).toBe(true);
  });

  it('copies camera.fov into currentFOV', () => {
    const cs = createCameraState();
    const cam = makeMockCamera();
    cam.fov = 75;
    seedCameraState(cam as never, new FakeVector3() as never, cs);
    expect(cs.currentFOV).toBe(75);
  });
});

describe('getRigTuning / setRigTuning', () => {
  it('returns positive default values', () => {
    const t = getRigTuning();
    expect(t.DAMP_LATERAL).toBeGreaterThan(0);
    expect(t.DAMP_VERTICAL).toBeGreaterThan(0);
    expect(t.DAMP_DISTANCE).toBeGreaterThan(0);
    expect(t.LOOK_AHEAD_MIN).toBeGreaterThan(0);
    expect(t.LOOK_AHEAD_MAX).toBeGreaterThan(t.LOOK_AHEAD_MIN);
    expect(t.PIVOT_HEIGHT).toBeGreaterThan(0);
  });

  it('updates and reads back a single key', () => {
    const before = getRigTuning().DAMP_LATERAL;
    setRigTuning('DAMP_LATERAL', before * 2);
    expect(getRigTuning().DAMP_LATERAL).toBeCloseTo(before * 2);
    setRigTuning('DAMP_LATERAL', before); // restore
  });

  it('ignores unknown keys without throwing', () => {
    const before = getRigTuning();
    expect(() => setRigTuning('UNKNOWN_KEY', 999)).not.toThrow();
    expect(getRigTuning()).toEqual(before);
  });
});

describe('updateCamera — early exits', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns early when player is null', () => {
    const cs = createCameraState();
    const cam = makeMockCamera();
    updateCamera(cam as never, null, 0.016, cs);
    expect(cam.updateProjectionMatrix).not.toHaveBeenCalled();
  });

  it('returns early when player.alive is false', () => {
    const cs = createCameraState();
    const cam = makeMockCamera();
    const player = makePlayer();
    (player as { alive: boolean }).alive = false;
    updateCamera(cam as never, player as never, 0.016, cs);
    expect(cam.updateProjectionMatrix).not.toHaveBeenCalled();
  });

  it('falls back to cached state when position is NaN', () => {
    const cs = createCameraState();
    cs.targetPos.set(5, 10, -15);
    cs.currentLook.set(0, 1, 0);
    cs.currentFOV = 65;

    const cam = makeMockCamera(5, 10, -15);
    const player = makePlayer();
    (player.mesh.position as InstanceType<typeof FakeVector3>).x = NaN;

    updateCamera(cam as never, player as never, 0.016, cs);
    expect(cam.position.x).toBeCloseTo(5);
    expect(cam.lookAt).toHaveBeenCalled();
  });
});

describe('updateCamera — normal operation basics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls lookAt and updateProjectionMatrix each frame', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(0, 15, -30);
    updateCamera(cam as never, makePlayer({ speed: 30 }) as never, 0.016, cs);
    expect(cam.lookAt).toHaveBeenCalled();
    expect(cam.updateProjectionMatrix).toHaveBeenCalled();
  });

  it('initializes lookInitialized on first call', () => {
    const cs = createCameraState();
    expect(cs.lookInitialized).toBe(false);
    updateCamera(makeMockCamera(0, 15, -30) as never, makePlayer() as never, 0.016, cs);
    expect(cs.lookInitialized).toBe(true);
  });

  it('does not produce NaN after many frames', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(0, 15, -30);
    for (let i = 0; i < 120; i++) {
      updateCamera(cam as never, makePlayer({ speed: 50, angle: 0.5 }) as never, 0.016, cs);
    }
    expect(Number.isFinite(cam.position.x)).toBe(true);
    expect(Number.isFinite(cam.fov)).toBe(true);
  });
});

describe('grind FOV widening', () => {
  beforeEach(() => vi.clearAllMocks());

  it('_grindFOV initializes to 0', () => {
    const cs = createCameraState();
    expect(cs._grindFOV).toBe(0);
  });

  it('resetCamera resets _grindFOV to 0', () => {
    const cs = createCameraState();
    cs._grindFOV = 3;
    resetCamera(cs);
    expect(cs._grindFOV).toBe(0);
  });

  it('increases _grindFOV when grinding (normal)', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(0, 15, -30);
    const player = makePlayer({ isGrinding: true, grindBalanceValue: 0.4 });
    // Run enough frames for the damp to converge toward +2
    for (let i = 0; i < 120; i++) {
      updateCamera(cam as never, player as never, 0.016, cs);
    }
    // Normal grind target is +2 (balance 0.4 is outside sweet spot)
    expect(cs._grindFOV).toBeGreaterThan(1.5);
    expect(cs._grindFOV).toBeLessThanOrEqual(2.1);
  });

  it('increases _grindFOV more when dash-grinding', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(0, 15, -30);
    const player = makePlayer({ isGrinding: true, dashing: true, grindBalanceValue: 0.4 });
    for (let i = 0; i < 120; i++) {
      updateCamera(cam as never, player as never, 0.016, cs);
    }
    // Dash grind target is +6
    expect(cs._grindFOV).toBeGreaterThan(5);
    expect(cs._grindFOV).toBeLessThanOrEqual(6.1);
  });

  it('tightens _grindFOV in sweet spot (|balance| < 0.15)', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(0, 15, -30);
    const player = makePlayer({ isGrinding: true, grindBalanceValue: 0.05 });
    for (let i = 0; i < 120; i++) {
      updateCamera(cam as never, player as never, 0.016, cs);
    }
    // Sweet spot: normal(2) + tighten(-1) = 1
    expect(cs._grindFOV).toBeGreaterThan(0.5);
    expect(cs._grindFOV).toBeLessThanOrEqual(1.1);
  });

  it('decays _grindFOV back to 0 when grinding stops', () => {
    const cs = createCameraState();
    const cam = makeMockCamera(0, 15, -30);
    // Start grinding
    const gPlayer = makePlayer({ isGrinding: true, grindBalanceValue: 0.4 });
    for (let i = 0; i < 60; i++) {
      updateCamera(cam as never, gPlayer as never, 0.016, cs);
    }
    expect(cs._grindFOV).toBeGreaterThan(1);
    // Stop grinding
    const nPlayer = makePlayer({ isGrinding: false });
    for (let i = 0; i < 120; i++) {
      updateCamera(cam as never, nPlayer as never, 0.016, cs);
    }
    expect(cs._grindFOV).toBeLessThan(0.1);
  });
});
