import * as THREE from 'three';
import { getVehiclePhysics } from './vehicleConfig';

// ── Public types ────────────────────────────────────────

export enum BikeAnimState {
  Idle,
  Accel,
  Boost,
  Turn,
  Brake,
}

/** Per-frame snapshot of physics state fed into the bike animator. */
export interface BikeAnimInput {
  dt: number;
  speed: number;
  baseSpeed: number;
  boosting: boolean;
  dashing: boolean;
  turnRamp: number;        // -1..+1 smoothed turn intensity
  brakeBlend: number;      // 0..1
}

// ── Internal pose target ────────────────────────────────

interface BikePose {
  innerY: number;
  innerRollZ: number;
  innerPitchX: number;
}

/** Static key list — avoids per-frame Object.keys() allocation. */
const POSE_KEYS: (keyof BikePose)[] = ['innerY', 'innerRollZ', 'innerPitchX'];

// Bike physics use turnLerp=14/turnDecay=28.8 (vs hoverboard's 8/12) — snappier response.
// Roll and pitch rates bumped accordingly to match the bike's tighter handling profile.
const LERP_RATES: Record<keyof BikePose, number> = {
  innerY: 10,
  innerRollZ: 12,
  innerPitchX: 8,
};

function defaultPose(): BikePose {
  return { innerY: 0, innerRollZ: 0, innerPitchX: 0 };
}

// Import maxLean from vehicle config so we don't duplicate the magic number
const MAX_LEAN = getVehiclePhysics('bike').maxLean;
const LEGACY_TURN_LEAN_SCALE = 0.84;

// ── Animator class ─────────────────────────────────────

export class BikeAnimator {
  private _state: BikeAnimState = BikeAnimState.Idle;
  private _innerGroup: THREE.Group;

  // Pre-allocated pose buffers (avoids per-frame allocation)
  private _pose: BikePose = defaultPose();
  private _target: BikePose = defaultPose();

  constructor(innerGroup: THREE.Group) {
    this._innerGroup = innerGroup;
  }

  getState(): BikeAnimState {
    return this._state;
  }

  reset(): void {
    this._state = BikeAnimState.Idle;
    this._pose = defaultPose();
    this._applyPose();
  }

  update(input: BikeAnimInput): void {
    const { dt } = input;
    const time = performance.now();

    this._state = this._resolveState(input);
    this._computeTarget(input, time);

    // Blend toward target using exponential lerp
    for (let i = 0; i < POSE_KEYS.length; i++) {
      const key = POSE_KEYS[i];
      const blend = 1 - Math.exp(-LERP_RATES[key] * dt);
      this._pose[key] += (this._target[key] - this._pose[key]) * blend;
    }

    this._applyPose();
  }

  /** Determine animation state from physics input. */
  private _resolveState(input: BikeAnimInput): BikeAnimState {
    if (input.brakeBlend > 0.1) return BikeAnimState.Brake;
    if (input.dashing) return BikeAnimState.Boost;
    if (input.boosting) return BikeAnimState.Accel;
    if (Math.abs(input.turnRamp) > 0.1) return BikeAnimState.Turn;
    return BikeAnimState.Idle;
  }

  /** Write target pose into this._target (no allocation). */
  private _computeTarget(input: BikeAnimInput, time: number): void {
    const out = this._target;

    switch (this._state) {
      case BikeAnimState.Idle:
        // Subtle idle bob — two layered sines for organic feel
        out.innerY = Math.sin(time * 0.003) * 0.025 + Math.sin(time * 0.005) * 0.01;
        out.innerRollZ = Math.sin(time * 0.002) * 0.015;
        out.innerPitchX = Math.sin(time * 0.0025) * 0.008;
        break;

      case BikeAnimState.Accel:
        out.innerY = -0.028 + Math.sin(time * 0.005) * 0.01;
        out.innerRollZ = 0;
        out.innerPitchX = -0.095;
        break;

      case BikeAnimState.Boost:
        out.innerY = -0.06 + Math.sin(time * 0.006) * 0.008;
        out.innerRollZ = 0;
        out.innerPitchX = -0.16;
        break;

      case BikeAnimState.Turn:
        out.innerY = 0;
        out.innerRollZ = -input.turnRamp * MAX_LEAN * LEGACY_TURN_LEAN_SCALE;
        out.innerPitchX = -Math.abs(input.turnRamp) * 0.025;
        break;

      case BikeAnimState.Brake:
        out.innerY = 0;
        out.innerRollZ = 0;
        out.innerPitchX = 0.06 * input.brakeBlend;
        break;
    }
  }

  private _applyPose(): void {
    const p = this._pose;
    this._innerGroup.position.y = p.innerY;
    this._innerGroup.rotation.z = p.innerRollZ;
    this._innerGroup.rotation.x = p.innerPitchX;
  }
}
