/**
 * Unit tests for src/camera/cameraCollision.ts
 *
 * Tests tuning accessors, mesh management, and collision resolution.
 * THREE.js is mocked with lightweight substitutes — no WebGL context needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as THREE from 'three';

// ── Hoisted mock factory ─────────────────────────────────────
const { FakeVector3 } = vi.hoisted(() => {
  class FakeVector3 {
    x: number;
    y: number;
    z: number;
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    set(x: number, y: number, z: number): FakeVector3 {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
    copy(v: { x: number; y: number; z: number }): FakeVector3 {
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
    ): FakeVector3 {
      this.x = a.x - b.x;
      this.y = a.y - b.y;
      this.z = a.z - b.z;
      return this;
    }
    addScaledVector(v: { x: number; y: number; z: number }, s: number): FakeVector3 {
      this.x += v.x * s;
      this.y += v.y * s;
      this.z += v.z * s;
      return this;
    }
    length(): number {
      return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }
    divideScalar(s: number): FakeVector3 {
      this.x /= s;
      this.y /= s;
      this.z /= s;
      return this;
    }
  }
  return { FakeVector3 };
});

// ── Mock three.js ─────────────────────────────────────────────
vi.mock('three', () => ({
  Vector3: FakeVector3,
  Raycaster: class {
    near = 0;
    far = 0;
    set(): void {
      /* noop */
    }
    intersectObjects(): never[] {
      return [];
    }
  },
  Mesh: class {},
}));

// ── Import module under test ──────────────────────────────────
import {
  getCollisionTuning,
  setCollisionTuning,
  setCameraCollisionMeshes,
  getCameraCollisionMeshes,
  resolveCameraCollision,
} from '../cameraCollision';

// ── Tests ─────────────────────────────────────────────────────

describe('cameraCollision — tuning', () => {
  beforeEach(() => {
    setCameraCollisionMeshes([]);
    setCollisionTuning('COLLISION_BUFFER', 0.15);
    setCollisionTuning('MIN_CAMERA_DIST', 0.5);
    setCollisionTuning('SWEEP_RADIUS', 0.8);
    setCollisionTuning('CRUSH_THRESHOLD', 0.3);
  });

  it('getCollisionTuning returns all four default values', () => {
    const tuning = getCollisionTuning();
    expect(tuning.COLLISION_BUFFER).toBe(0.15);
    expect(tuning.MIN_CAMERA_DIST).toBe(0.5);
    expect(tuning.SWEEP_RADIUS).toBe(0.8);
    expect(tuning.CRUSH_THRESHOLD).toBe(0.3);
  });

  it('setCollisionTuning updates COLLISION_BUFFER', () => {
    setCollisionTuning('COLLISION_BUFFER', 0.5);
    expect(getCollisionTuning().COLLISION_BUFFER).toBe(0.5);
  });

  it('setCollisionTuning updates MIN_CAMERA_DIST', () => {
    setCollisionTuning('MIN_CAMERA_DIST', 1.0);
    expect(getCollisionTuning().MIN_CAMERA_DIST).toBe(1.0);
  });

  it('setCollisionTuning updates SWEEP_RADIUS', () => {
    setCollisionTuning('SWEEP_RADIUS', 1.5);
    expect(getCollisionTuning().SWEEP_RADIUS).toBe(1.5);
  });

  it('setCollisionTuning updates CRUSH_THRESHOLD', () => {
    setCollisionTuning('CRUSH_THRESHOLD', 0.6);
    expect(getCollisionTuning().CRUSH_THRESHOLD).toBe(0.6);
  });

  it('unknown key is silently ignored', () => {
    const before = getCollisionTuning();
    setCollisionTuning('UNKNOWN_KEY', 999);
    const after = getCollisionTuning();
    expect(after).toEqual(before);
  });
});

describe('cameraCollision — mesh management', () => {
  beforeEach(() => {
    setCameraCollisionMeshes([]);
  });

  it('defaults to empty mesh list', () => {
    expect(getCameraCollisionMeshes()).toHaveLength(0);
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

  it('setting empty array clears meshes', () => {
    setCameraCollisionMeshes([{} as THREE.Mesh]);
    expect(getCameraCollisionMeshes()).toHaveLength(1);
    setCameraCollisionMeshes([]);
    expect(getCameraCollisionMeshes()).toHaveLength(0);
  });
});

describe('cameraCollision — resolveCameraCollision', () => {
  beforeEach(() => {
    setCameraCollisionMeshes([]);
    setCollisionTuning('COLLISION_BUFFER', 0.15);
    setCollisionTuning('MIN_CAMERA_DIST', 0.5);
  });

  it('with no meshes, returns push=0 and copies desiredPos to out', () => {
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

  it('with zero-length direction (same pivot and desired), returns 0', () => {
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

  it('with meshes but no intersection (mock returns []), copies desired and returns 0', () => {
    setCameraCollisionMeshes([{} as THREE.Mesh]);
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

  it('push return value is always between 0 and 1', () => {
    // With our mock raycaster returning no hits, push should be 0
    setCameraCollisionMeshes([{} as THREE.Mesh]);
    const pivot = new FakeVector3(0, 0, 0);
    const desired = new FakeVector3(10, 10, 10);
    const out = new FakeVector3();

    const push = resolveCameraCollision(
      pivot as unknown as THREE.Vector3,
      desired as unknown as THREE.Vector3,
      out as unknown as THREE.Vector3,
    );

    expect(push).toBeGreaterThanOrEqual(0);
    expect(push).toBeLessThanOrEqual(1);
  });
});
