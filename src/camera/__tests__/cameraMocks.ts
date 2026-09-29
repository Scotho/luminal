/**
 * Shared camera test mocks for THREE.js types.
 *
 * These lightweight substitutes let camera math run without a real WebGL context.
 * Import the classes from vi.hoisted() blocks, then pass them into vi.mock('three').
 */

import type * as THREE from 'three';
import type { CameraProfile, CameraRigState, CameraTarget } from '../types';
import { CameraMode } from '../types';
import { DEFAULT_NORMAL_PROFILE } from '../cameraProfiles';

// ── FakeVector3 ─────────────────────────────────────────────
// Implements the subset of THREE.Vector3 used by the camera subsystem.
export class FakeVector3 {
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

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  divideScalar(s: number): this {
    this.x /= s;
    this.y /= s;
    this.z /= s;
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

  multiplyScalar(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  distanceTo(v: { x: number; y: number; z: number }): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}

// ── Factory helpers ─────────────────────────────────────────

/** Create a CameraRigState with sensible defaults. Override individual fields as needed. */
export function makeCameraRigState(
  overrides?: Partial<CameraRigState>,
): CameraRigState {
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

/** Create a CameraTarget (what the camera follows). */
export function makeCameraTarget(
  overrides?: Partial<CameraTarget>,
): CameraTarget {
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

/** Create a blank CameraProfile. */
export function makeProfile(
  overrides?: Partial<CameraProfile>,
): CameraProfile {
  return {
    baseFov: 60,
    baseDist: 10,
    vertOffset: 3.5,
    latOffset: 0,
    lookAheadGain: 1,
    lookLatGain: 0.8,
    headingVelBlend: 0,
    posDampLambda: 8,
    rotDampLambda: 10,
    fovSpeedGain: 4,
    distSpeedGain: 0.02,
    ...overrides,
  };
}

/** Frame-rate-independent damp: mirrors THREE.MathUtils.damp. */
export function fakeDamp(
  current: number,
  target: number,
  lambda: number,
  dt: number,
): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}
