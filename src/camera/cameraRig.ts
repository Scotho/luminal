import * as THREE from 'three';
import type { CameraRigState, CameraTarget } from './types';
import { CameraMode } from './types';
import {
  getCAM_DIST, getCAM_HEIGHT, getCAM_LERP,
  getBASE_FOV,
} from './cameraConfig';
import { DEFAULT_NORMAL_PROFILE } from './cameraProfiles';
import { tickStateMachine } from './cameraState';
import { resolveCameraCollision } from './cameraCollision';
import { triggerShake, updateShake } from './cameraShake';

// ── Helpers ─────────────────────────────────────────────────
const { damp } = THREE.MathUtils;

function isFiniteVec3(v: THREE.Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** Frame-rate independent damping for Vector3 (mutates `current` in place). */
function dampVec3(current: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number): void {
  current.x = damp(current.x, target.x, lambda, dt);
  current.y = damp(current.y, target.y, lambda, dt);
  current.z = damp(current.z, target.z, lambda, dt);
}

// Axis-specific damping lambdas (spec: lat 0.10-0.14s, vert 0.16-0.22s, dist 0.20-0.28s)
let DAMP_LATERAL = 12.0;   // ~0.12s settling
let DAMP_VERTICAL = 7.0;   // ~0.18s settling
let DAMP_DISTANCE = 5.0;   // ~0.24s settling

/**
 * Axis-specific position damping: decompose error into heading-relative axes,
 * damp each with its own lambda, then reconstruct.
 */
function dampAxisSpecific(
  current: THREE.Vector3, target: THREE.Vector3,
  hx: number, hz: number, // heading direction (normalized, XZ)
  latLambda: number, vertLambda: number, distLambda: number,
  dt: number,
): void {
  // Error vector
  const ex = target.x - current.x;
  const ey = target.y - current.y;
  const ez = target.z - current.z;

  // Right direction (perpendicular to heading in XZ plane)
  const rx = -hz;
  const rz = hx;

  // Project error onto heading-relative axes (XZ plane only)
  const errDist = ex * (-hx) + ez * (-hz);  // along -heading (behind vehicle)
  const errLat = ex * rx + ez * rz;          // lateral
  const errVert = ey;                         // vertical (Y axis)

  // Damp each component independently
  const factorLat = 1 - Math.exp(-latLambda * dt);
  const factorVert = 1 - Math.exp(-vertLambda * dt);
  const factorDist = 1 - Math.exp(-distLambda * dt);

  // Reconstruct damped position
  const dampedLat = errLat * factorLat;
  const dampedDist = errDist * factorDist;
  const dampedVert = errVert * factorVert;

  current.x += dampedLat * rx + dampedDist * (-hx);
  current.y += dampedVert;
  current.z += dampedLat * rz + dampedDist * (-hz);
}

// ── Scratch vectors (zero per-frame allocations) ────────────
const _pivotTarget = new THREE.Vector3();
const _boomTarget = new THREE.Vector3();
const _boomCorrected = new THREE.Vector3();

// ── Private sub-function: sway / reveal offset ──────────────
/**
 * Computes the lateral reveal offset based on turn rate and lateral velocity.
 * This biases the pivot target sideways so the camera reveals what the player
 * is turning into (spec 3c: turn reveal).
 *
 * @param turnRate  - yaw change in rad/s
 * @param speed     - current speed
 * @param slipRad   - current slip angle in radians
 * @param rightStickX - right-stick horizontal input (-1..1)
 * @returns lateral reveal offset in world units
 */
function _computeSway(
  turnRate: number,
  speed: number,
  slipRad: number,
  rightStickX: number,
): number {
  const latVel: number = speed * Math.sin(slipRad);
  const turnReveal: number = Math.max(-1, Math.min(1, turnRate * 0.10 + latVel * 0.015));
  return turnReveal * 0.66 + rightStickX * 3.0;
}

// ── Private sub-function: look-ahead distance ────────────────
/**
 * Computes how far ahead of the vehicle the camera pivot looks,
 * based on current speed and boost state (spec Layer B).
 *
 * @param speed      - current speed
 * @param speedNorm  - normalized speed (0..1)
 * @param isBoosting - whether the player is currently boosting/dashing
 * @returns look-ahead distance in world units
 */
function _computeLookAhead(
  speed: number,
  speedNorm: number,
  isBoosting: boolean,
): number {
  const lookAheadTime: number = 0.18 + 0.14 * speedNorm + (isBoosting ? 0.05 : 0);
  return Math.max(LOOK_AHEAD_MIN, Math.min(LOOK_AHEAD_MAX, speed * lookAheadTime));
}

// ── Private sub-function: speed-based camera distance ────────
/**
 * Computes the final camera distance and height based on the current profile,
 * base config values, and right-stick Y input (spec Layer C.c).
 *
 * @param CAM_DIST   - base camera distance from config
 * @param CAM_HEIGHT - base camera height from config
 * @param profile    - current interpolated camera profile
 * @param speed      - current speed
 * @param rightStickY - right-stick vertical input (-1..1)
 * @returns { finalDist, finalHeight } in world units
 */
function _computeSpeedDistance(
  CAM_DIST: number,
  CAM_HEIGHT: number,
  profile: { baseDist: number; distSpeedGain: number; vertOffset: number },
  speed: number,
  rightStickY: number,
): { finalDist: number; finalHeight: number } {
  const distBase: number = CAM_DIST + (profile.baseDist - 10) + profile.distSpeedGain * speed;
  const heightBase: number = CAM_HEIGHT + (profile.vertOffset - 3.5) * 0.5;
  const stickDistMod: number = 1.0 + rightStickY * 0.35;
  return {
    finalDist: distBase * stickDistMod,
    finalHeight: heightBase * stickDistMod,
  };
}

// Default max speed for speedNorm when player doesn't provide one
const DEFAULT_MAX_SPEED = 100;

// Speed-based look-ahead range
let LOOK_AHEAD_MIN = 4;
let LOOK_AHEAD_MAX = 20;

// Pivot target height: 0.45H where H ≈ 2.7 (vehicle height)
let PIVOT_HEIGHT = 1.22;

// ── Admin tuning accessors ──────────────────────────────────
export function getRigTuning() {
  return { DAMP_LATERAL, DAMP_VERTICAL, DAMP_DISTANCE, LOOK_AHEAD_MIN, LOOK_AHEAD_MAX, PIVOT_HEIGHT };
}
export function setRigTuning(key: string, val: number): void {
  switch (key) {
    case 'DAMP_LATERAL': DAMP_LATERAL = val; break;
    case 'DAMP_VERTICAL': DAMP_VERTICAL = val; break;
    case 'DAMP_DISTANCE': DAMP_DISTANCE = val; break;
    case 'LOOK_AHEAD_MIN': LOOK_AHEAD_MIN = val; break;
    case 'LOOK_AHEAD_MAX': LOOK_AHEAD_MAX = val; break;
    case 'PIVOT_HEIGHT': PIVOT_HEIGHT = val; break;
  }
}

// ── Factory ─────────────────────────────────────────────────
export function createCameraState(): CameraRigState {
  return {
    pivotPos: new THREE.Vector3(),
    boomPos: new THREE.Vector3(),
    camPos: new THREE.Vector3(),
    currentFOV: getBASE_FOV(),

    currentMode: CameraMode.Normal,
    previousMode: CameraMode.Normal,
    blendT: 1,
    frozenProfile: { ...DEFAULT_NORMAL_PROFILE },

    lookTarget: new THREE.Vector3(),
    lookInitialized: false,
    prevAngle: null,

    shakeOffset: new THREE.Vector3(),
    activeImpulses: [],
    _proxFOV: 0,
    _grindFOV: 0,
    occlusionPush: 0,
    prevOcclusionPush: 0,
    smoothHeadingX: 0,
    smoothHeadingZ: -1,

    targetPos: new THREE.Vector3(),
    targetLook: new THREE.Vector3(),
    currentLook: new THREE.Vector3(),
  };
}

// ── Seed / Reset ────────────────────────────────────────────
const _defaultCamState: CameraRigState = createCameraState();

export function seedCameraState(camera: THREE.PerspectiveCamera, lookTarget: THREE.Vector3, cs: CameraRigState = _defaultCamState): void {
  cs.targetPos.copy(camera.position);
  cs.targetLook.copy(lookTarget);
  cs.currentLook.copy(lookTarget);
  cs.lookInitialized = true;
  cs.currentFOV = camera.fov;
  cs.prevAngle = null;
  cs.currentMode = CameraMode.Normal;
  cs.blendT = 1;
  cs.frozenProfile = { ...DEFAULT_NORMAL_PROFILE };
}

export function resetCamera(cs: CameraRigState = _defaultCamState): void {
  cs.lookInitialized = false;
  cs.currentFOV = getBASE_FOV();
  cs.prevAngle = null;
  cs._proxFOV = 0;
  cs._grindFOV = 0;
  cs.currentMode = CameraMode.Normal;
  cs.blendT = 1;
  cs.frozenProfile = { ...DEFAULT_NORMAL_PROFILE };
}

// ── Private update-phase helpers (Phase 4 extracted) ────────

/** Apply saved state to the camera when player pos/angle is non-finite. */
function _applyFallbackState(camera: THREE.PerspectiveCamera, cs: CameraRigState): void {
  if (isFiniteVec3(cs.targetPos)) camera.position.copy(cs.targetPos);
  if (isFiniteVec3(cs.currentLook)) camera.lookAt(cs.currentLook);
  if (Number.isFinite(cs.currentFOV)) {
    camera.fov = cs.currentFOV;
    camera.updateProjectionMatrix();
  }
}

interface HeadingRef {
  headingX: number;
  headingZ: number;
  rightX: number;
  rightZ: number;
  slipRad: number;
  slip01: number;
}

/**
 * Compute the slip-proportional heading reference (spec Layer B).
 * Returns both the normalized heading direction and its right-perpendicular.
 */
function _computeHeadingRef(
  player: CameraTarget,
  angle: number,
  speedNorm: number,
): HeadingRef {
  const carFwdX: number = -Math.sin(angle);
  const carFwdZ: number = -Math.cos(angle);

  // Compute slip01: continuous 0..1 from slip angle (spec: saturate((|slipDeg| - 6) / 20))
  const slipRad: number = player.slipAngle ?? 0;
  const slipDeg: number = Math.abs(slipRad) * (180 / Math.PI);
  const slip01: number = Math.min(1, Math.max(0, (slipDeg - 6) / 20));

  // headingRef = lerp(fwdDir, velDir, slip01 * blend), gated by speed
  // 0.45 keeps camera mostly behind the nose — you see the car's profile
  // during drift instead of the camera fully chasing the velocity direction
  const speedGate: number = Math.min(1, speedNorm * 3);
  const velBlend: number = slip01 * 0.45 * speedGate;

  let headingX: number;
  let headingZ: number;
  if (velBlend > 0.001 && player.velocityAngle !== undefined) {
    const velX: number = -Math.sin(player.velocityAngle);
    const velZ: number = -Math.cos(player.velocityAngle);
    headingX = carFwdX + (velX - carFwdX) * velBlend;
    headingZ = carFwdZ + (velZ - carFwdZ) * velBlend;
    const len = Math.sqrt(headingX * headingX + headingZ * headingZ);
    if (len > 0.001) { headingX /= len; headingZ /= len; }
  } else {
    headingX = carFwdX;
    headingZ = carFwdZ;
  }
  const rightX: number = -headingZ;
  const rightZ: number = headingX;

  return { headingX, headingZ, rightX, rightZ, slipRad, slip01 };
}

/** Run the state machine and auto-trigger shakes on mode transitions. */
function _updateStateMachineAndShake(
  player: CameraTarget,
  dt: number,
  cs: CameraRigState,
): ReturnType<typeof tickStateMachine> {
  const prevMode = cs.currentMode;
  const profile = tickStateMachine(player, dt, cs);

  // Auto-trigger shake on state transitions
  if (cs.currentMode !== prevMode) {
    if (cs.currentMode === CameraMode.Boost || cs.currentMode === CameraMode.DriftBoost) {
      triggerShake('boost', cs);
    } else if (cs.currentMode === CameraMode.Dash) {
      triggerShake('boost', cs); // dash also gets a boost-style shake
    }
  }
  return profile;
}

/** Smooth currentLook toward pivot target with yaw-error catch-up boost. */
function _dampCurrentLook(
  cs: CameraRigState,
  camera: THREE.PerspectiveCamera,
  headingX: number,
  headingZ: number,
  rotDamp: number,
  dt: number,
): void {
  if (!cs.lookInitialized) {
    cs.currentLook.copy(_pivotTarget);
    cs.lookInitialized = true;
  }
  if (!isFiniteVec3(cs.currentLook)) cs.currentLook.copy(_pivotTarget);

  // Heading-error catch-up: if yaw error > 20°, boost lateral damping
  const camDirX: number = cs.currentLook.x - camera.position.x;
  const camDirZ: number = cs.currentLook.z - camera.position.z;
  const camDirLen: number = Math.sqrt(camDirX * camDirX + camDirZ * camDirZ);
  let yawCatchup = 1.0;
  if (camDirLen > 0.1) {
    const dot = (camDirX * headingX + camDirZ * headingZ) / camDirLen;
    const yawError: number = Math.acos(Math.min(1, Math.max(-1, dot)));
    if (yawError > 0.35) yawCatchup = 1.8; // 20° ≈ 0.35 rad — softened for lower drift yaw rate
  }
  dampVec3(cs.currentLook, _pivotTarget, rotDamp * yawCatchup, dt);
}

/** Run collision correction and trigger shake on first wall-hit. */
function _applyCollisionAndShake(cs: CameraRigState): void {
  cs.prevOcclusionPush = cs.occlusionPush;
  cs.occlusionPush = resolveCameraCollision(cs.currentLook, _boomTarget, _boomCorrected);

  // Trigger collision shake when camera first hits a wall
  if (cs.occlusionPush > 0.15 && cs.prevOcclusionPush < 0.05) {
    triggerShake('collision', cs);
  }
}

/** Asymmetric damping — position damping with smoothed heading frame. */
function _dampCameraPosition(
  camera: THREE.PerspectiveCamera,
  cs: CameraRigState,
  headingX: number,
  headingZ: number,
  dampScale: number,
  dt: number,
): void {
  // Use heading direction for decomposition frame (stable, no jitter)
  cs.smoothHeadingX = damp(cs.smoothHeadingX, headingX, 3.0, dt);
  cs.smoothHeadingZ = damp(cs.smoothHeadingZ, headingZ, 3.0, dt);
  const dhLen = Math.sqrt(cs.smoothHeadingX * cs.smoothHeadingX + cs.smoothHeadingZ * cs.smoothHeadingZ);
  const dhx = dhLen > 0.001 ? cs.smoothHeadingX / dhLen : 0;
  const dhz = dhLen > 0.001 ? cs.smoothHeadingZ / dhLen : -1;

  // Asymmetric collision distance damping: fast push-in (~0.04s), slow return (~0.25s)
  const occIncreasing = cs.occlusionPush > cs.prevOcclusionPush + 0.01;
  const distLambda = occIncreasing ? 20.0 : (cs.occlusionPush > 0.01 ? 5.0 : DAMP_DISTANCE * dampScale);

  cs.targetPos.copy(_boomCorrected);
  if (!isFiniteVec3(camera.position)) camera.position.copy(_boomCorrected);
  dampAxisSpecific(
    camera.position, _boomCorrected,
    dhx, dhz,
    DAMP_LATERAL * dampScale, DAMP_VERTICAL * dampScale, distLambda,
    dt,
  );
}

/**
 * Build pivot target (point-ahead focus) and boom target (camera desired pos)
 * in the shared scratch vectors _pivotTarget and _boomTarget. Mutates both.
 */
function _computePivotAndBoomTargets(
  pos: THREE.Vector3,
  player: CameraTarget,
  profile: ReturnType<typeof tickStateMachine>,
  heading: HeadingRef,
  turnRate: number,
  speed: number,
  speedNorm: number,
  rightStickX: number,
  rightStickY: number,
): void {
  const { headingX, headingZ, rightX, rightZ, slipRad } = heading;

  // ── Step 3: Time-based look-ahead (spec Layer B) ──────────
  // lookAheadTime = lerp(0.18s, 0.32s, speed01) + 0.05s while boosting
  const isBoosting: boolean = !!(player.boosting || player.dashing);
  const lookAheadDist: number = _computeLookAhead(speed, speedNorm, isBoosting);

  // Lateral composition bias from turn rate + lateral velocity (spec 3c: turn reveal)
  const revealOffset: number = _computeSway(turnRate, speed, slipRad, rightStickX); // 0.12L max ≈ 0.66 units

  // Pivot target: point ahead of vehicle (spec: vehiclePos + up*0.45H + lookAheadVec)
  _pivotTarget.set(
    pos.x + headingX * lookAheadDist + rightX * revealOffset * 0.3,
    pos.y + PIVOT_HEIGHT,
    pos.z + headingZ * lookAheadDist + rightZ * revealOffset * 0.3,
  );

  // ── Step 5: Compute boom target (camera desired position) ─
  // CAM_DIST IS the actual distance (slider value = world units behind vehicle).
  // Profile adds small per-mode deltas. Speed adds back-off on top.
  const CAM_DIST = getCAM_DIST();
  const CAM_HEIGHT = getCAM_HEIGHT();
  const { finalDist, finalHeight } = _computeSpeedDistance(CAM_DIST, CAM_HEIGHT, profile, speed, rightStickY);

  // Lateral offset from profile (drift side-shift)
  const latOffset: number = profile.latOffset;

  _boomTarget.set(
    pos.x - headingX * finalDist + rightX * (revealOffset + latOffset),
    pos.y + finalHeight,
    pos.z - headingZ * finalDist + rightZ * (revealOffset + latOffset),
  );
}

/** Compute and apply final FOV (base + user + prox/grind layers) with asymmetric damping. */
function _updateFov(
  camera: THREE.PerspectiveCamera,
  cs: CameraRigState,
  player: CameraTarget,
  profile: ReturnType<typeof tickStateMachine>,
  speedNorm: number,
  dt: number,
): void {
  // Profile baseFov + user FOV offset + speed gain
  const userFovOffset: number = getBASE_FOV() - 62; // user deviation from default 62°
  const rawFOV: number = profile.baseFov + userFovOffset + profile.fovSpeedGain * speedNorm;

  // Slipstream FOV kick
  const proxFOVThreshold = 0.3;
  const proxFOVMax = 3; // reduced from 4 to stay within spec range
  const proxRaw = (player.proximitySpeedBoost ?? 0);
  const proxTarget = proxRaw > proxFOVThreshold
    ? ((proxRaw - proxFOVThreshold) / (1 - proxFOVThreshold)) * proxFOVMax
    : 0;
  const proxLambda = proxTarget > cs._proxFOV ? 8.0 : 3.5;
  cs._proxFOV = damp(cs._proxFOV, proxTarget, proxLambda, dt);

  // Grind FOV layer
  const GRIND_FOV_NORMAL = 2;
  const GRIND_FOV_DASH = 6;
  const GRIND_FOV_SWEET_TIGHTEN = -1;
  let grindFOVTarget = 0;
  if (player.isGrinding) {
    grindFOVTarget = player.dashing ? GRIND_FOV_DASH : GRIND_FOV_NORMAL;
    const balance = player.grindBalanceValue ?? 0;
    if (Math.abs(balance) < 0.15) {
      grindFOVTarget += GRIND_FOV_SWEET_TIGHTEN;
    }
  }
  const grindFOVLambda = grindFOVTarget > cs._grindFOV ? 10 : 3.5;
  cs._grindFOV = damp(cs._grindFOV, grindFOVTarget, grindFOVLambda, dt);

  // Hard FOV clamp (spec: never fisheye)
  const targetFOV: number = Math.min(90, Math.max(55, rawFOV + cs._proxFOV + cs._grindFOV));

  // Asymmetric FOV ramp: fast-in (0.12s), slow-out (0.28s)
  const fovLambda: number = targetFOV > cs.currentFOV ? 10.0 : 4.0;
  cs.currentFOV = damp(cs.currentFOV, targetFOV, fovLambda, dt);
  camera.fov = cs.currentFOV;
  camera.updateProjectionMatrix();
}

// ── Main update (Phase 4: state machine + profile blending) ─
export function updateCamera(
  camera: THREE.PerspectiveCamera,
  player: CameraTarget | null | undefined,
  dt: number,
  cs: CameraRigState = _defaultCamState,
  rightStickX: number = 0,
  rightStickY: number = 0,
): void {
  if (!player || !player.alive) return;

  const pos: THREE.Vector3 = player.mesh.position;
  const angle: number = player.angle;
  if (!isFiniteVec3(pos) || !Number.isFinite(angle)) {
    _applyFallbackState(camera, cs);
    return;
  }

  // ── Step 1: Read player state ─────────────────────────────
  const speed: number = player.speed ?? 0;
  const maxSpeed: number = player.maxSpeed ?? DEFAULT_MAX_SPEED;
  const speedNorm: number = maxSpeed > 0 ? Math.min(speed / maxSpeed, 1) : 0;

  // Track turn rate for sway
  if (cs.prevAngle === null) cs.prevAngle = angle;
  const turnRate: number = (angle - cs.prevAngle) / Math.max(dt, 0.001);
  cs.prevAngle = angle;

  // ── Step 2: State machine → interpolated profile ──────────
  const profile = _updateStateMachineAndShake(player, dt, cs);

  // Damping: user stiffness setting scales profile damping
  // CAM_LERP (user slider 1-15, default 5) acts as a multiplier on profile lambda
  const dampScale: number = getCAM_LERP() / 5.0; // normalize to 1.0 at default
  const rotDamp: number = profile.rotDampLambda * dampScale;

  // ── Heading reference: slip-proportional blend (spec Layer B) ──
  const heading = _computeHeadingRef(player, angle, speedNorm);

  // ── Steps 3 + 5: build pivot / boom targets into scratch vecs ──
  _computePivotAndBoomTargets(pos, player, profile, heading, turnRate, speed, speedNorm, rightStickX, rightStickY);

  // ── Step 4: Smooth pivot position ─────────────────────────
  _dampCurrentLook(cs, camera, heading.headingX, heading.headingZ, rotDamp, dt);

  // ── Step 6: Collision correction ───────────────────────────
  _applyCollisionAndShake(cs);

  // ── Step 7: Axis-specific position damping ────────────────
  _dampCameraPosition(camera, cs, heading.headingX, heading.headingZ, dampScale, dt);

  // ── Step 8: Camera rotation — look at smoothed pivot ──────
  camera.lookAt(cs.currentLook);

  // ── Step 9: Camera shake (additive, after smoothing) ──────
  updateShake(dt, cs);
  camera.position.x += cs.shakeOffset.x;
  camera.position.y += cs.shakeOffset.y;

  // ── Step 10: FOV (spec Layer C.d) ──────────────────────────
  _updateFov(camera, cs, player, profile, speedNorm, dt);
}
