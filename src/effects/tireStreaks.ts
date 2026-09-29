/**
 * SPEC-94: SLINGSHOT tire streak system.
 *
 * Floor-level streak decals painted during drift with three glow stages.
 * InstancedMesh pool with age-based fade. Quality-tier gated.
 */

import * as THREE from 'three';

// ── Constants ───────────────────────────────────────────────────

const FADE_DURATION_MS = 1500;
const DEFAULT_MAX_INSTANCES = 512;

// Color/intensity per drift stage
const STAGE_COLORS: Record<string, { r: number; g: number; b: number; intensity: number }> = {
  low:  { r: 1.0, g: 0.53, b: 0.87, intensity: 0.6 },
  med:  { r: 1.0, g: 0.40, b: 0.93, intensity: 1.2 },
  high: { r: 1.0, g: 0.13, b: 1.0,  intensity: 2.0 },
};

// ── Types ───────────────────────────────────────────────────────

export type DriftIntensity = 'low' | 'med' | 'high';

export interface TireStreakSystemOpts {
  maxInstances?: number;
  fadeDuration?: number;
}

// ── TireStreakSystem ─────────────────────────────────────────────

const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _pos = new THREE.Vector3();

export class TireStreakSystem {
  readonly maxInstances: number;
  readonly fadeDuration: number;
  readonly instancedMesh: THREE.InstancedMesh;

  private ages: Float32Array;
  private activeSet: Set<number> = new Set();
  private freeList: number[] = [];
  private instanceColors: Float32Array;

  constructor(opts: TireStreakSystemOpts = {}) {
    this.maxInstances = opts.maxInstances ?? DEFAULT_MAX_INSTANCES;
    this.fadeDuration = opts.fadeDuration ?? FADE_DURATION_MS;

    // Flat plane geometry on Y=0.01
    const geo = new THREE.PlaneGeometry(0.35, 1.2);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xff88ee,
      emissiveIntensity: 1,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.instancedMesh = new THREE.InstancedMesh(geo, mat, this.maxInstances);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.frustumCulled = false;
    this.instancedMesh.count = 0;

    // Color buffer for per-instance tinting
    this.instanceColors = new Float32Array(this.maxInstances * 3);
    this.instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(
      this.instanceColors, 3,
    );

    this.ages = new Float32Array(this.maxInstances);

    // Build free list (reversed so pop gives lowest index)
    for (let i = this.maxInstances - 1; i >= 0; i--) {
      this.freeList.push(i);
      // Zero-out transform
      _mat4.makeScale(0, 0, 0);
      this.instancedMesh.setMatrixAt(i, _mat4);
    }
  }

  get activeCount(): number {
    return this.activeSet.size;
  }

  get freeCount(): number {
    return this.freeList.length;
  }

  spawnStreak(
    x: number,
    z: number,
    heading: number,
    intensity: DriftIntensity,
    now: number,
  ): void {
    let idx: number;
    if (this.freeList.length > 0) {
      idx = this.freeList.pop()!;
    } else {
      // Reclaim oldest active instance
      let oldestIdx = -1;
      let oldestAge = -1;
      for (const i of this.activeSet) {
        if (this.ages[i] > oldestAge) {
          oldestAge = this.ages[i];
          oldestIdx = i;
        }
      }
      if (oldestIdx < 0) return;
      idx = oldestIdx;
      this.activeSet.delete(idx);
    }

    // Set transform
    _pos.set(x, 0.01, z);
    _quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, heading);
    _mat4.compose(_pos, _quat, _scale);
    this.instancedMesh.setMatrixAt(idx, _mat4);

    // Set color from stage
    const col = STAGE_COLORS[intensity];
    const offset = idx * 3;
    this.instanceColors[offset] = col.r * col.intensity;
    this.instanceColors[offset + 1] = col.g * col.intensity;
    this.instanceColors[offset + 2] = col.b * col.intensity;

    this.ages[idx] = 0;
    this.activeSet.add(idx);

    // Update mesh count to cover this instance
    this.instancedMesh.count = Math.max(this.instancedMesh.count, idx + 1);
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      (this.instancedMesh.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
  }

  tickFade(dtMs: number): void {
    const toRemove: number[] = [];

    for (const idx of this.activeSet) {
      this.ages[idx] += dtMs;
      const t = this.ages[idx] / this.fadeDuration;
      if (t >= 1) {
        toRemove.push(idx);
      } else {
        // Fade by scaling down alpha (encoded in color brightness)
        const fade = 1 - t * t; // quadratic ease-out
        const offset = idx * 3;
        const col = this.instanceColors;
        // Apply fade directly to color channel
        // (base color was already set in spawn, we scale it down)
        // Use a simple dimming approach
        col[offset] *= (1 - dtMs / this.fadeDuration);
        col[offset + 1] *= (1 - dtMs / this.fadeDuration);
        col[offset + 2] *= (1 - dtMs / this.fadeDuration);
      }
    }

    for (const idx of toRemove) {
      this.releaseInstance(idx);
    }

    if (toRemove.length > 0) {
      this.instancedMesh.instanceMatrix.needsUpdate = true;
    }
    if (this.activeSet.size > 0 && this.instancedMesh.instanceColor) {
      (this.instancedMesh.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
  }

  fastFade(durationMs: number): void {
    // Accelerate all active instances to fade in durationMs
    for (const idx of this.activeSet) {
      this.ages[idx] = Math.max(this.ages[idx], this.fadeDuration - durationMs);
    }
  }

  clear(): void {
    for (const idx of this.activeSet) {
      this.releaseInstance(idx);
    }
    this.activeSet.clear();
    this.instancedMesh.count = 0;
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  private releaseInstance(idx: number): void {
    _mat4.makeScale(0, 0, 0);
    this.instancedMesh.setMatrixAt(idx, _mat4);
    this.activeSet.delete(idx);
    this.freeList.push(idx);
  }
}

// ── Drift intensity helper ──────────────────────────────────────

export function getDriftIntensity(slipAngle: number, speed: number, maxSpeed: number): DriftIntensity {
  const score = Math.abs(slipAngle) * (speed / Math.max(1, maxSpeed));
  if (score > 0.45) return 'high';
  if (score > 0.25) return 'med';
  return 'low';
}
