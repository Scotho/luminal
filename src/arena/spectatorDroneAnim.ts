import type { ArenaAudioPass } from '../arenaAudio';
import type { SpectatorDrone } from './arenaState';
import { smoothDamp, smoothDampAngle, type VelRef } from './smoothDamp';

// Arena half-size (keep in sync with src/arenaAudio.ts and src/arenaEffects.ts)
const HALF = 192;

// ── Tunables ──────────────────────────────────────────────
// Chase mode
const TRAIL_OFFSET = 0.9;          // radians offset so drone sits alongside target
const CHASE_ANGLE_SMOOTH = 1.1;    // seconds to settle on a new angle
const CHASE_RADIUS_SMOOTH = 0.8;
const CHASE_ALTITUDE_SMOOTH = 0.9;
const MAX_ANG_SPEED = 0.55;        // rad/s, absolute ceiling
const MAX_RAD_SPEED = 22;          // units/s
const MAX_Y_SPEED = 14;            // units/s

// Look target smoothing
const LOOK_SMOOTH = 0.45;          // seconds
const MAX_LOOK_SPEED = 60;

// Facing / pitch / bank smoothing
const FACING_SMOOTH = 0.35;
const PITCH_SMOOTH = 0.25;
const BANK_SMOOTH = 0.35;
const MAX_FACING_SPEED = 3;        // rad/s
const BANK_GAIN = 0.4;             // rad of lean per rad/s of angular vel
const PITCH_GAIN = 0.06;           // pitch from altitude rate

// Target selection hysteresis — new candidate must be this much closer (squared)
const HYSTERESIS_SQ_RATIO = 0.64;  // ~20% linearly

// Idle-mode continuous drift
const IDLE_ANGULAR_RATE = 0.09;    // rad/s baseline orbit
const IDLE_R_BASE = HALF * 0.62;
const IDLE_R_AMP1 = HALF * 0.18;
const IDLE_R_AMP2 = HALF * 0.06;
const IDLE_Y_BASE = 44;
const IDLE_Y_AMP1 = 9;
const IDLE_Y_AMP2 = 3;

// Additive oscillations (applied on top of smoothed state)
const HOVER_BOB_A = 0.8;
const HOVER_BOB_B = 0.4;
const YAW_WOBBLE_AMP = 0.002;
const YAW_WOBBLE_FREQ = 0.7;

// ── Update entry point ───────────────────────────────────
export function updateSpectatorDrone(pass: ArenaAudioPass): void {
  const { reactive, dt, now } = pass;
  if (!reactive.spectatorDrone) return;
  const cam: SpectatorDrone = reactive.spectatorDrone;

  initState(cam);

  const target = pickTarget(cam, reactive._trackTargets);
  if (target) {
    computeChaseTargets(cam, target);
  } else {
    computeIdleTargets(cam, now, dt);
  }

  integrateMotion(cam, dt);
  updateLookTarget(cam, target, dt);
  applyRotation(cam, dt);
  applyOscillations(cam, now);

  // Recording-light blink — unchanged from original
  cam.recLight.intensity = Math.sin(now * 2) > -0.8 ? 3.0 : 0.3;
}

// ── Internals (stubs for now — implemented in Tasks 4-6) ─
function initState(cam: SpectatorDrone): void {
  if (cam._initialized) return;
  cam._angVel = 0;
  cam._radVel = 0;
  cam._yVel = 0;
  cam._facingVel = 0;
  cam._pitchVel = 0;
  cam._bankVel = 0;
  cam._facingAngle = cam.angle;
  cam._desiredAngle = cam.angle;
  // Seed the smoothed look point along the drone's current facing.
  const ahead = 20;
  cam._lookX = cam.mesh.position.x - Math.sin(cam.angle) * ahead;
  cam._lookY = 2;
  cam._lookZ = cam.mesh.position.z - Math.cos(cam.angle) * ahead;
  cam._lookVelX = 0;
  cam._lookVelY = 0;
  cam._lookVelZ = 0;
  cam._latchedTargetIdx = -1;
  cam._initialized = true;
}
function pickTarget(
  cam: SpectatorDrone,
  targets: Array<{ x: number; z: number } | null> | undefined,
): { x: number; z: number } | null {
  if (!targets || targets.length === 0) {
    cam._latchedTargetIdx = -1;
    return null;
  }

  // Squared distance from drone to each live target.
  const dx0 = cam.mesh.position.x;
  const dz0 = cam.mesh.position.z;
  const distSq: number[] = [];
  let anyAlive = false;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (!t) { distSq.push(Infinity); continue; }
    anyAlive = true;
    const dx = t.x - dx0;
    const dz = t.z - dz0;
    distSq.push(dx * dx + dz * dz);
  }
  if (!anyAlive) {
    cam._latchedTargetIdx = -1;
    return null;
  }

  const currentIdx = cam._latchedTargetIdx ?? -1;
  const currentAlive = currentIdx >= 0 && currentIdx < targets.length && targets[currentIdx];
  const currentDist = currentAlive ? distSq[currentIdx] : Infinity;

  // Find the absolute nearest alive target.
  let nearestIdx = -1;
  let nearestDist = Infinity;
  for (let i = 0; i < targets.length; i++) {
    if (distSq[i] < nearestDist) {
      nearestDist = distSq[i];
      nearestIdx = i;
    }
  }

  // If the current latch is dead or missing, take the nearest immediately.
  if (!currentAlive) {
    cam._latchedTargetIdx = nearestIdx;
    return targets[nearestIdx];
  }

  // Keep the current latch unless a different candidate is clearly closer.
  if (nearestIdx !== currentIdx && nearestDist < currentDist * HYSTERESIS_SQ_RATIO) {
    cam._latchedTargetIdx = nearestIdx;
    return targets[nearestIdx];
  }

  return targets[currentIdx];
}
function computeChaseTargets(cam: SpectatorDrone, target: { x: number; z: number }): void {
  // Trailing offset — sit ~51 degrees behind the target's world-space angle.
  // Matches the original code's + 0.9 offset.
  cam._desiredAngle = Math.atan2(target.z, target.x) + TRAIL_OFFSET;

  // Radius scales with target's distance from center; altitude rises
  // slightly when the target is far from center. Matches original math
  // at the original arenaAudio.ts:365-366.
  const targetR = Math.sqrt(target.x * target.x + target.z * target.z);
  cam.targetR = Math.max(40, Math.min(HALF * 0.95, targetR * 2 + 30));
  cam.targetY = 38 + Math.min(30, targetR * 0.15);
}
function computeIdleTargets(cam: SpectatorDrone, now: number, dt: number): void {
  // Continuous sum-of-sines — no phase boundaries. All three quantities
  // are pure functions of `now`, so sample-to-sample deltas are bounded.
  cam.targetR =
    IDLE_R_BASE +
    Math.sin(now * 0.08) * IDLE_R_AMP1 +
    Math.sin(now * 0.19 + 1.3) * IDLE_R_AMP2;
  cam.targetY =
    IDLE_Y_BASE +
    Math.sin(now * 0.12) * IDLE_Y_AMP1 +
    Math.sin(now * 0.27 + 0.7) * IDLE_Y_AMP2;
  // Monotonic angular drift. smoothDampAngle wraps the diff, so `_desiredAngle`
  // growing unbounded across a long session is fine.
  cam._desiredAngle = (cam._desiredAngle ?? cam.angle) + IDLE_ANGULAR_RATE * dt;
}
function integrateMotion(cam: SpectatorDrone, dt: number): void {
  // Angular integration — both idle and chase mode set cam._desiredAngle.
  const angVelRef: VelRef = { v: cam._angVel ?? 0 };
  cam.angle = smoothDampAngle(
    cam.angle, cam._desiredAngle ?? cam.angle, angVelRef,
    CHASE_ANGLE_SMOOTH, MAX_ANG_SPEED, dt,
  );
  cam._angVel = angVelRef.v;

  // Radius integration.
  const radVelRef: VelRef = { v: cam._radVel ?? 0 };
  cam.orbitR = smoothDamp(
    cam.orbitR, cam.targetR, radVelRef,
    CHASE_RADIUS_SMOOTH, MAX_RAD_SPEED, dt,
  );
  cam._radVel = radVelRef.v;

  // Altitude integration.
  const yVelRef: VelRef = { v: cam._yVel ?? 0 };
  cam.flyY = smoothDamp(
    cam.flyY, cam.targetY, yVelRef,
    CHASE_ALTITUDE_SMOOTH, MAX_Y_SPEED, dt,
  );
  cam._yVel = yVelRef.v;

  // Write world position. Hover-bob is applied later in applyOscillations.
  const posX = Math.cos(cam.angle) * cam.orbitR;
  const posZ = Math.sin(cam.angle) * cam.orbitR;
  cam.mesh.position.set(posX, cam.flyY, posZ);
}
function updateLookTarget(
  cam: SpectatorDrone,
  target: { x: number; z: number } | null,
  dt: number,
): void {
  // Desired look point: in chase mode the current target, in idle the
  // arena origin. Y is always 2 (car height).
  const desiredX = target ? target.x : 0;
  const desiredY = 2;
  const desiredZ = target ? target.z : 0;

  const lvxRef: VelRef = { v: cam._lookVelX ?? 0 };
  const lvyRef: VelRef = { v: cam._lookVelY ?? 0 };
  const lvzRef: VelRef = { v: cam._lookVelZ ?? 0 };

  cam._lookX = smoothDamp(cam._lookX ?? desiredX, desiredX, lvxRef, LOOK_SMOOTH, MAX_LOOK_SPEED, dt);
  cam._lookY = smoothDamp(cam._lookY ?? desiredY, desiredY, lvyRef, LOOK_SMOOTH, MAX_LOOK_SPEED, dt);
  cam._lookZ = smoothDamp(cam._lookZ ?? desiredZ, desiredZ, lvzRef, LOOK_SMOOTH, MAX_LOOK_SPEED, dt);

  cam._lookVelX = lvxRef.v;
  cam._lookVelY = lvyRef.v;
  cam._lookVelZ = lvzRef.v;
}
function applyRotation(cam: SpectatorDrone, dt: number): void {
  // Desired facing is the angle from the drone's current position toward
  // the smoothed look target. This never snaps when target switches because
  // the look target itself is smoothed.
  const posX = cam.mesh.position.x;
  const posZ = cam.mesh.position.z;
  const posY = cam.mesh.position.y;
  const dx = (cam._lookX ?? 0) - posX;
  const dz = (cam._lookZ ?? 0) - posZ;
  const desiredFacing = Math.atan2(dx, dz);

  const facingVelRef: VelRef = { v: cam._facingVel ?? 0 };
  cam._facingAngle = smoothDampAngle(
    cam._facingAngle ?? desiredFacing, desiredFacing, facingVelRef,
    FACING_SMOOTH, MAX_FACING_SPEED, dt,
  );
  cam._facingVel = facingVelRef.v;

  // Pitch: nose down when diving (negative altitude rate), up when climbing,
  // plus a contribution from looking toward the look-target's Y.
  const pitchFromAltitude = -(cam._yVel ?? 0) * PITCH_GAIN;
  const lookDy = (cam._lookY ?? 2) - posY;
  const lookHoriz = Math.sqrt(dx * dx + dz * dz) + 1e-3;
  const pitchFromLook = -Math.atan2(lookDy, lookHoriz);
  const desiredPitch = pitchFromAltitude + pitchFromLook;

  const pitchVelRef: VelRef = { v: cam._pitchVel ?? 0 };
  cam.pitchAngle = smoothDamp(
    cam.pitchAngle, desiredPitch, pitchVelRef,
    PITCH_SMOOTH, 5, dt,
  );
  cam._pitchVel = pitchVelRef.v;

  // Bank from angular velocity — lean into turns. BANK_GAIN is unitless
  // (rad of lean per rad/s of angular velocity).
  const desiredBank = -(cam._angVel ?? 0) * BANK_GAIN;
  const bankVelRef: VelRef = { v: cam._bankVel ?? 0 };
  cam.bankAngle = smoothDamp(
    cam.bankAngle, desiredBank, bankVelRef,
    BANK_SMOOTH, 5, dt,
  );
  cam._bankVel = bankVelRef.v;

  // Write rotation in Y-X-Z order (standard for yaw/pitch/roll).
  cam.mesh.rotation.order = 'YXZ';
  cam.mesh.rotation.y = cam._facingAngle;
  cam.mesh.rotation.x = cam.pitchAngle;
  cam.mesh.rotation.z = cam.bankAngle;
}
function applyOscillations(cam: SpectatorDrone, now: number): void {
  // Hover bob — additive on top of smoothed Y. Sum of two sines for
  // organic motion. Pure function of `now`, so discontinuity-free.
  const bob = Math.sin(now * 1.5) * HOVER_BOB_A + Math.sin(now * 2.3) * HOVER_BOB_B;
  cam.mesh.position.y += bob;

  // Idle yaw wobble — subtle side-to-side drift, additive on top of
  // smoothed facing angle.
  cam.mesh.rotation.y += Math.sin(now * YAW_WOBBLE_FREQ) * YAW_WOBBLE_AMP;
}

// Used by tests to observe internal tunables
export const __test__ = {
  HALF, TRAIL_OFFSET, HYSTERESIS_SQ_RATIO,
  IDLE_R_BASE, IDLE_Y_BASE, IDLE_ANGULAR_RATE,
  MAX_ANG_SPEED, MAX_RAD_SPEED, MAX_Y_SPEED,
};

