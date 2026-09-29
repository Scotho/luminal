/**
 * Unit tests for src/camera/cameraState.ts
 *
 * Tests detectMode priority logic and tickStateMachine transitions/blending.
 * THREE.js is mocked so cameraProfiles module-level scratch objects initialise.
 */

import { describe, it, expect, vi } from 'vitest';
import type * as THREE from 'three';

// ── Hoisted mock ─────────────────────────────────────────────
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

// ── Imports ───────────────────────────────────────────────────
import { CameraMode } from '../types';
import type { CameraRigState, CameraTarget } from '../types';
import { DEFAULT_NORMAL_PROFILE, PROFILE_MAP } from '../cameraProfiles';
import { detectMode, tickStateMachine } from '../cameraState';

// ── Helpers ───────────────────────────────────────────────────

function makeRigState(overrides?: Partial<CameraRigState>): CameraRigState {
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

function makeTarget(overrides?: Partial<CameraTarget>): CameraTarget {
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

// ── detectMode tests ──────────────────────────────────────────

describe('detectMode', () => {
  it('all flags false returns Normal', () => {
    const player = makeTarget();
    expect(detectMode(player)).toBe(CameraMode.Normal);
  });

  it('boosting=true returns Boost', () => {
    const player = makeTarget({ boosting: true });
    expect(detectMode(player)).toBe(CameraMode.Boost);
  });

  it('drifting=true returns Drift', () => {
    const player = makeTarget({ drifting: true });
    expect(detectMode(player)).toBe(CameraMode.Drift);
  });

  it('driftBoosting=true returns DriftBoost', () => {
    const player = makeTarget({ driftBoosting: true });
    expect(detectMode(player)).toBe(CameraMode.DriftBoost);
  });

  it('dashing=true returns Dash (highest priority)', () => {
    const player = makeTarget({ dashing: true });
    expect(detectMode(player)).toBe(CameraMode.Dash);
  });

  it('dashing wins over driftBoosting+drifting+boosting', () => {
    const player = makeTarget({
      dashing: true,
      boosting: true,
      drifting: true,
      driftBoosting: true,
    });
    expect(detectMode(player)).toBe(CameraMode.Dash);
  });

  it('driftBoosting wins over drifting and boosting', () => {
    const player = makeTarget({
      driftBoosting: true,
      drifting: true,
      boosting: true,
    });
    expect(detectMode(player)).toBe(CameraMode.DriftBoost);
  });

  it('drifting wins over boosting (no driftBoosting)', () => {
    const player = makeTarget({ drifting: true, boosting: true });
    expect(detectMode(player)).toBe(CameraMode.Drift);
  });

  it('boosting alone (no dashing, no drifting) returns Boost', () => {
    const player = makeTarget({ boosting: true, dashing: false, drifting: false });
    expect(detectMode(player)).toBe(CameraMode.Boost);
  });
});

// ── tickStateMachine tests ────────────────────────────────────

describe('tickStateMachine', () => {
  it('returns a profile object with all required fields', () => {
    const cs = makeRigState();
    const player = makeTarget();
    const profile = tickStateMachine(player, 0.016, cs);

    expect(profile.baseFov).toBeDefined();
    expect(profile.baseDist).toBeDefined();
    expect(profile.vertOffset).toBeDefined();
    expect(profile.latOffset).toBeDefined();
    expect(profile.lookAheadGain).toBeDefined();
    expect(profile.posDampLambda).toBeDefined();
    expect(profile.rotDampLambda).toBeDefined();
    expect(profile.fovSpeedGain).toBeDefined();
    expect(profile.distSpeedGain).toBeDefined();
  });

  it('no mode change keeps blendT at 1', () => {
    const cs = makeRigState({ currentMode: CameraMode.Normal, blendT: 1 });
    const player = makeTarget();

    tickStateMachine(player, 0.016, cs);

    expect(cs.currentMode).toBe(CameraMode.Normal);
    expect(cs.blendT).toBe(1);
  });

  it('mode transition resets blendT to 0 then advances', () => {
    const cs = makeRigState({ currentMode: CameraMode.Normal, blendT: 1 });
    const player = makeTarget({ dashing: true });

    tickStateMachine(player, 0.016, cs);

    expect(cs.currentMode).toBe(CameraMode.Dash);
    expect(cs.previousMode).toBe(CameraMode.Normal);
    // blendT was reset to 0, then advanced by dt/0.18
    expect(cs.blendT).toBeGreaterThan(0);
    expect(cs.blendT).toBeLessThan(1);
  });

  it('successive ticks advance blendT toward 1', () => {
    const cs = makeRigState({ currentMode: CameraMode.Normal, blendT: 1 });
    const player = makeTarget({ dashing: true });

    tickStateMachine(player, 0.016, cs);
    const firstBlend = cs.blendT;

    tickStateMachine(player, 0.016, cs);
    expect(cs.blendT).toBeGreaterThan(firstBlend);
  });

  it('blendT reaches 1 after enough ticks (blend completes)', () => {
    const cs = makeRigState({ currentMode: CameraMode.Normal, blendT: 1 });
    const player = makeTarget({ boosting: true });

    // Trigger transition
    tickStateMachine(player, 0.016, cs);

    // Run enough frames to complete blend (0.18s / 0.016 ~ 12 frames)
    for (let i = 0; i < 20; i++) {
      tickStateMachine(player, 0.016, cs);
    }

    expect(cs.blendT).toBe(1);
  });

  it('returned profile interpolates between frozen and target', () => {
    const cs = makeRigState({ currentMode: CameraMode.Normal, blendT: 1 });
    const player = makeTarget({ boosting: true });

    // Transition Normal->Boost with very small dt (blend near 0)
    const profile = tickStateMachine(player, 0.001, cs);

    const normalDist = PROFILE_MAP[CameraMode.Normal].baseDist;
    const boostDist = PROFILE_MAP[CameraMode.Boost].baseDist;
    expect(profile.baseDist).toBeGreaterThanOrEqual(Math.min(normalDist, boostDist));
    expect(profile.baseDist).toBeLessThanOrEqual(Math.max(normalDist, boostDist));
  });

  it('at blendT=1, profile equals target mode profile exactly', () => {
    const cs = makeRigState({ currentMode: CameraMode.Normal, blendT: 1 });
    const player = makeTarget({ boosting: true });

    // Trigger and complete transition
    for (let i = 0; i < 30; i++) {
      tickStateMachine(player, 0.016, cs);
    }

    expect(cs.blendT).toBe(1);
    const profile = tickStateMachine(player, 0.016, cs);
    const target = PROFILE_MAP[CameraMode.Boost];
    expect(profile.baseFov).toBeCloseTo(target.baseFov, 5);
    expect(profile.baseDist).toBeCloseTo(target.baseDist, 5);
  });

  it('double transition freezes correct intermediate profile', () => {
    const cs = makeRigState({ currentMode: CameraMode.Normal, blendT: 1 });

    // Transition 1: Normal -> Boost
    const boostPlayer = makeTarget({ boosting: true });
    tickStateMachine(boostPlayer, 0.05, cs);
    expect(cs.currentMode).toBe(CameraMode.Boost);

    // Transition 2: Boost -> Dash (before blend completes)
    const dashPlayer = makeTarget({ dashing: true });
    tickStateMachine(dashPlayer, 0.016, cs);
    expect(cs.currentMode).toBe(CameraMode.Dash);
    expect(cs.previousMode).toBe(CameraMode.Boost);
    expect(cs.blendT).toBeLessThan(0.5);
  });

  it('rapid mode switching does not produce NaN in profile', () => {
    const cs = makeRigState();

    const modes: Partial<CameraTarget>[] = [
      { boosting: true },
      { dashing: true },
      { drifting: true },
      { driftBoosting: true },
      {},
    ];

    for (let i = 0; i < 50; i++) {
      const player = makeTarget(modes[i % modes.length]);
      const profile = tickStateMachine(player, 0.016, cs);
      expect(Number.isFinite(profile.baseFov)).toBe(true);
      expect(Number.isFinite(profile.baseDist)).toBe(true);
    }
  });
});
