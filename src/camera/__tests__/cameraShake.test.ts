/**
 * Unit tests for src/camera/cameraShake.ts
 *
 * Tests triggerShake presets, updateShake decay, and shake enable/disable.
 * THREE.js is mocked; shake offset math uses real value noise.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
import type { CameraRigState } from '../types';
import { getSHAKE_ENABLED, setShakeEnabled } from '../cameraConfig';
import { DEFAULT_NORMAL_PROFILE } from '../cameraProfiles';
import { triggerShake, updateShake } from '../cameraShake';

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

// ── State preservation ────────────────────────────────────────

let savedShake: boolean;

beforeEach(() => {
  savedShake = getSHAKE_ENABLED();
  setShakeEnabled(true);
});

afterEach(() => {
  setShakeEnabled(savedShake);
});

// ── Tests ─────────────────────────────────────────────────────

describe('triggerShake', () => {
  it('"boost" adds impulse with correct preset values', () => {
    const cs = makeRigState();
    triggerShake('boost', cs);

    expect(cs.activeImpulses).toHaveLength(1);
    expect(cs.activeImpulses[0].amplitude).toBe(0.08);
    expect(cs.activeImpulses[0].frequency).toBe(18);
    expect(cs.activeImpulses[0].duration).toBe(0.25);
    expect(cs.activeImpulses[0].elapsed).toBe(0);
  });

  it('"collision" adds impulse with correct preset values', () => {
    const cs = makeRigState();
    triggerShake('collision', cs);

    expect(cs.activeImpulses).toHaveLength(1);
    expect(cs.activeImpulses[0].amplitude).toBe(0.15);
    expect(cs.activeImpulses[0].frequency).toBe(14);
    expect(cs.activeImpulses[0].duration).toBe(0.35);
  });

  it('multiple triggers stack impulses', () => {
    const cs = makeRigState();
    triggerShake('boost', cs);
    triggerShake('collision', cs);

    expect(cs.activeImpulses).toHaveLength(2);
  });

  it('is no-op when shake is disabled', () => {
    setShakeEnabled(false);
    const cs = makeRigState();
    triggerShake('boost', cs);

    expect(cs.activeImpulses).toHaveLength(0);
  });

  it('is no-op when cs is undefined', () => {
    expect(() => triggerShake('boost', undefined)).not.toThrow();
  });

  it('"grind" adds impulse with grind preset values', () => {
    const cs = makeRigState();
    triggerShake('grind', cs);
    expect(cs.activeImpulses).toHaveLength(1);
    expect(cs.activeImpulses[0].amplitude).toBe(0.04);
    expect(cs.activeImpulses[0].frequency).toBe(24);
    expect(cs.activeImpulses[0].duration).toBe(0.15);
  });

  it('"dashBurst" adds impulse with dashBurst preset values', () => {
    const cs = makeRigState();
    triggerShake('dashBurst', cs);
    expect(cs.activeImpulses).toHaveLength(1);
    expect(cs.activeImpulses[0].amplitude).toBe(0.06);
    expect(cs.activeImpulses[0].frequency).toBe(20);
    expect(cs.activeImpulses[0].duration).toBe(0.18);
  });

  it('"landing" adds impulse with landing preset values', () => {
    const cs = makeRigState();
    triggerShake('landing', cs);
    expect(cs.activeImpulses).toHaveLength(1);
    expect(cs.activeImpulses[0].amplitude).toBe(0.10);
    expect(cs.activeImpulses[0].frequency).toBe(10);
    expect(cs.activeImpulses[0].duration).toBe(0.30);
  });

  it('"death" adds impulse with death preset values', () => {
    const cs = makeRigState();
    triggerShake('death', cs);
    expect(cs.activeImpulses).toHaveLength(1);
    expect(cs.activeImpulses[0].amplitude).toBe(0.20);
    expect(cs.activeImpulses[0].frequency).toBe(8);
    expect(cs.activeImpulses[0].duration).toBe(0.50);
  });
});

describe('updateShake', () => {
  it('with no impulses, sets shakeOffset to zero', () => {
    const cs = makeRigState();
    cs.shakeOffset.set(5, 5, 5);

    updateShake(0.016, cs);

    expect(cs.shakeOffset.x).toBe(0);
    expect(cs.shakeOffset.y).toBe(0);
    expect(cs.shakeOffset.z).toBe(0);
  });

  it('advances elapsed and produces non-zero offset during active impulse', () => {
    const cs = makeRigState();
    triggerShake('boost', cs);

    updateShake(0.016, cs);

    expect(cs.activeImpulses).toHaveLength(1);
    expect(cs.activeImpulses[0].elapsed).toBeCloseTo(0.016, 5);

    const hasOffset = cs.shakeOffset.x !== 0 || cs.shakeOffset.y !== 0;
    expect(hasOffset).toBe(true);
  });

  it('removes impulses that exceed their duration', () => {
    const cs = makeRigState();
    triggerShake('boost', cs);
    expect(cs.activeImpulses).toHaveLength(1);

    // Advance past the boost duration (0.25s)
    updateShake(0.3, cs);

    expect(cs.activeImpulses).toHaveLength(0);
  });

  it('only removes expired impulses, keeps active ones', () => {
    const cs = makeRigState();
    triggerShake('boost', cs); // duration 0.25s
    triggerShake('collision', cs); // duration 0.35s

    // Advance 0.3s: boost expired, collision still active
    updateShake(0.3, cs);

    expect(cs.activeImpulses).toHaveLength(1);
    expect(cs.activeImpulses[0].duration).toBe(0.35);
  });

  it('clears offset to zero when shake is disabled', () => {
    const cs = makeRigState();
    triggerShake('boost', cs);
    cs.shakeOffset.set(1, 1, 1);

    setShakeEnabled(false);
    updateShake(0.016, cs);

    expect(cs.shakeOffset.x).toBe(0);
    expect(cs.shakeOffset.y).toBe(0);
    expect(cs.shakeOffset.z).toBe(0);
  });

  it('shake Z component is always 0 (XY only)', () => {
    const cs = makeRigState();
    triggerShake('boost', cs);

    updateShake(0.016, cs);

    expect(cs.shakeOffset.z).toBe(0);
  });

  it('amplitude decays over time (fade-out envelope)', () => {
    const cs = makeRigState();
    triggerShake('boost', cs);

    // Early in the impulse
    updateShake(0.01, cs);
    const earlyMag = Math.sqrt(
      cs.shakeOffset.x * cs.shakeOffset.x + cs.shakeOffset.y * cs.shakeOffset.y,
    );

    // Reset and do a longer tick (closer to end of duration)
    const cs2 = makeRigState();
    triggerShake('boost', cs2);
    updateShake(0.24, cs2);
    const lateMag = Math.sqrt(
      cs2.shakeOffset.x * cs2.shakeOffset.x + cs2.shakeOffset.y * cs2.shakeOffset.y,
    );

    // Near end of duration, amplitude should be much smaller
    expect(lateMag).toBeLessThan(earlyMag);
  });
});
