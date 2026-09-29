import type * as THREE from 'three';

// ── Camera Mode (state machine states) ──────────────────────
export enum CameraMode {
  Normal = 0,
  Boost = 1,
  Drift = 2,
  DriftBoost = 3,
  Dash = 4,
}

// ── Camera Profile (per-mode parameter set) ─────────────────
export interface CameraProfile {
  baseFov: number;          // degrees (base before speed gain)
  baseDist: number;         // units behind target
  vertOffset: number;       // Y above target
  latOffset: number;        // lateral offset (drift side-shift)
  lookAheadGain: number;    // multiplier on forward look-ahead
  lookLatGain: number;      // lateral look-ahead from steering
  headingVelBlend: number;  // 0=car forward, 1=velocity direction
  posDampLambda: number;    // position damping (MathUtils.damp lambda)
  rotDampLambda: number;    // rotation damping
  fovSpeedGain: number;     // FOV degrees added at speedNorm=1
  distSpeedGain: number;    // distance back-off per m/s speed
}

// ── Shake impulse ───────────────────────────────────────────
export interface ShakeImpulse {
  amplitude: number;   // meters
  frequency: number;   // Hz
  duration: number;    // seconds total
  elapsed: number;     // seconds elapsed
}

// ── Camera rig state (replaces legacy CameraState) ──────────
export interface CameraRigState {
  // 3-node rig vectors
  pivotPos: THREE.Vector3;
  boomPos: THREE.Vector3;
  camPos: THREE.Vector3;
  currentFOV: number;

  // state machine
  currentMode: CameraMode;
  previousMode: CameraMode;
  blendT: number;
  frozenProfile: CameraProfile;

  // smoothed values
  lookTarget: THREE.Vector3;
  lookInitialized: boolean;
  prevAngle: number | null;

  // shake
  shakeOffset: THREE.Vector3;
  activeImpulses: ShakeImpulse[];

  // proximity FOV
  _proxFOV: number;

  // grind FOV
  _grindFOV: number;

  // collision
  occlusionPush: number;
  prevOcclusionPush: number;

  // heading tracking (for axis-specific damping decomposition)
  smoothHeadingX: number;
  smoothHeadingZ: number;

  // Fallback / scratch vectors
  targetPos: THREE.Vector3;
  targetLook: THREE.Vector3;
  currentLook: THREE.Vector3;
}

// ── Camera target (what the camera follows) ─────────────────
export interface CameraTarget {
  mesh: { position: THREE.Vector3 };
  angle: number;
  alive: boolean;
  boosting: boolean;
  dashing: boolean;
  drifting?: boolean;
  driftBoosting?: boolean;
  proximitySpeedBoost?: number;
  speed?: number;
  maxSpeed?: number;
  velocityAngle?: number;
  slipAngle?: number;
  isGrinding?: boolean;
  grindBalanceValue?: number;
}

