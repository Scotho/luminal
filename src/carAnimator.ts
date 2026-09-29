import * as THREE from 'three';

// ── Public types ──────────────────────────────────

export enum CarAnimState {
  Idle,
  Accel,
  Boost,
  Turn,
  Drift,
  Brake,
  Airborne,
}

export interface CarAnimInput {
  dt: number;
  speed: number;
  baseSpeed: number;
  boosting: boolean;
  dashing: boolean;
  turnRamp: number;
  brakeBlend: number;
  drifting: boolean;
  driftDirection: number; // -1 or +1
  airborne: boolean;
  airborneTimer: number;
  airborneDuration: number;
  airbornePeak: number;
}

// ── Internal pose target ──────────────────────────

interface CarPose {
  innerY: number;
  innerRollZ: number;
  innerPitchX: number;
  innerYawY: number;
}

/** Static key list — avoids per-frame Object.keys() allocation. */
const POSE_KEYS: (keyof CarPose)[] = ['innerY', 'innerRollZ', 'innerPitchX', 'innerYawY'];

// Car is bulkier than bike — slightly slower lerp than bike but faster than hoverboard
const LERP_RATES: Record<keyof CarPose, number> = {
  innerY: 7,
  innerRollZ: 9,
  innerPitchX: 6,
  innerYawY: 5,
};

function defaultPose(): CarPose {
  return { innerY: 0, innerRollZ: 0, innerPitchX: 0, innerYawY: 0 };
}

// Car body roll is gentler than bike lean — no maxLean from config (bike/hoverboard only)
const CAR_ROLL = 0.18;
const DRIFT_ROLL = 0.25;
const DRIFT_YAW = 0.12;

// ── Animator class ────────────────────────────────

export class CarAnimator {
  private _state = CarAnimState.Idle;
  private _innerGroup: THREE.Group;

  // Pre-allocated pose buffers (avoids per-frame allocation)
  private _pose: CarPose = defaultPose();
  private _target: CarPose = defaultPose();

  constructor(innerGroup: THREE.Group) {
    this._innerGroup = innerGroup;
  }

  getState(): CarAnimState { return this._state; }

  reset(): void {
    this._state = CarAnimState.Idle;
    this._pose = defaultPose();
    this._target = defaultPose();
    this._applyPose();
  }

  update(input: CarAnimInput): void {
    const { dt } = input;
    const time = performance.now();

    this._state = this._resolveState(input);
    this._computeTargetPose(input, time);

    for (let i = 0; i < POSE_KEYS.length; i++) {
      const key = POSE_KEYS[i];
      const blend = 1 - Math.exp(-LERP_RATES[key] * dt);
      this._pose[key] += (this._target[key] - this._pose[key]) * blend;
    }

    this._applyPose();
  }

  private _resolveState(input: CarAnimInput): CarAnimState {
    if (input.airborne) return CarAnimState.Airborne;
    if (input.drifting) return CarAnimState.Drift;
    if (input.brakeBlend > 0.1) return CarAnimState.Brake;
    if (input.dashing) return CarAnimState.Boost;
    if (input.boosting) return CarAnimState.Accel;
    if (Math.abs(input.turnRamp) > 0.1) return CarAnimState.Turn;
    return CarAnimState.Idle;
  }

  private _computeTargetPose(input: CarAnimInput, time: number): void {
    const out = this._target;

    switch (this._state) {
      case CarAnimState.Idle:
        out.innerY = Math.sin(time * 0.0025) * 0.015 + Math.sin(time * 0.004) * 0.008;
        out.innerRollZ = Math.sin(time * 0.0018) * 0.01;
        out.innerPitchX = Math.sin(time * 0.002) * 0.008 + Math.sin(time * 0.0035) * 0.005;
        out.innerYawY = 0;
        break;

      case CarAnimState.Accel:
        out.innerY = 0;
        out.innerRollZ = 0;
        out.innerPitchX = -0.05;
        out.innerYawY = 0;
        break;

      case CarAnimState.Boost:
        out.innerY = 0;
        out.innerRollZ = 0;
        out.innerPitchX = -0.10;
        out.innerYawY = 0;
        break;

      case CarAnimState.Turn:
        out.innerY = 0;
        out.innerRollZ = -input.turnRamp * CAR_ROLL;
        out.innerPitchX = 0;
        out.innerYawY = 0;
        break;

      case CarAnimState.Drift:
        out.innerY = 0;
        out.innerRollZ = -input.turnRamp * DRIFT_ROLL;
        out.innerPitchX = 0.03;
        out.innerYawY = input.driftDirection * DRIFT_YAW;
        break;

      case CarAnimState.Brake:
        out.innerY = 0;
        out.innerRollZ = 0;
        out.innerPitchX = 0.06 * input.brakeBlend;
        out.innerYawY = 0;
        break;

      case CarAnimState.Airborne: {
        const t = input.airborneDuration > 0 ? 1 - (input.airborneTimer / input.airborneDuration) : 0;
        const tClamped = Math.max(0, Math.min(1, t));
        out.innerY = input.airbornePeak * Math.sin(Math.PI * tClamped);
        out.innerRollZ = -input.turnRamp * CAR_ROLL * 0.5;
        out.innerPitchX = Math.sin(time * 0.006) * 0.02;
        out.innerYawY = 0;
        break;
      }
    }
  }

  private _applyPose(): void {
    this._innerGroup.position.y = this._pose.innerY;
    this._innerGroup.rotation.z = this._pose.innerRollZ;
    this._innerGroup.rotation.x = this._pose.innerPitchX;
    // Yaw is stored in userData for the caller to combine with base rotation
    // (the car's base rotation.y = Math.PI is applied at the clone level, not here)
    this._innerGroup.userData._animYawY = this._pose.innerYawY;
  }
}
