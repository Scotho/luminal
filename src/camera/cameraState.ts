import type { CameraTarget, CameraProfile, CameraRigState } from './types';
import { CameraMode } from './types';
import { PROFILE_MAP, lerpProfile } from './cameraProfiles';

// Default blend duration in seconds
const DEFAULT_BLEND_DURATION = 0.18;

/** Smoothstep: t^2 * (3 - 2t) */
function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

// Scratch profile object to avoid per-frame allocations
const _activeProfile: CameraProfile = { ...PROFILE_MAP[CameraMode.Normal] };

/** Detect camera mode from player state flags. Priority-ordered (first match wins). */
export function detectMode(player: CameraTarget): CameraMode {
  if (player.dashing) return CameraMode.Dash;
  if (player.driftBoosting) return CameraMode.DriftBoost;
  if (player.drifting && !player.driftBoosting) return CameraMode.Drift;
  if (player.boosting && !player.dashing && !player.drifting) return CameraMode.Boost;
  return CameraMode.Normal;
}

/**
 * Tick the state machine: detect mode, manage transitions, return interpolated profile.
 * Mutates cs.currentMode, cs.previousMode, cs.blendT, cs.frozenProfile.
 * Returns a reference to the active (interpolated) profile — do not store, as it's reused.
 */
export function tickStateMachine(player: CameraTarget, dt: number, cs: CameraRigState): CameraProfile {
  const desired = detectMode(player);

  if (desired !== cs.currentMode) {
    // Transition: freeze current interpolated profile, start blend
    copyProfile(_activeProfile, cs.frozenProfile);
    cs.previousMode = cs.currentMode;
    cs.currentMode = desired;
    cs.blendT = 0;
  }

  // Advance blend timer
  if (cs.blendT < 1) {
    cs.blendT = Math.min(1, cs.blendT + dt / DEFAULT_BLEND_DURATION);
  }

  // Interpolate between frozen profile and target profile
  const targetProfile = PROFILE_MAP[cs.currentMode];
  const ease = smoothstep(cs.blendT);
  lerpProfile(cs.frozenProfile, targetProfile, ease, _activeProfile);

  return _activeProfile;
}

/** Copy all fields from src into dst. */
function copyProfile(src: CameraProfile, dst: CameraProfile): void {
  dst.baseFov = src.baseFov;
  dst.baseDist = src.baseDist;
  dst.vertOffset = src.vertOffset;
  dst.latOffset = src.latOffset;
  dst.lookAheadGain = src.lookAheadGain;
  dst.lookLatGain = src.lookLatGain;
  dst.headingVelBlend = src.headingVelBlend;
  dst.posDampLambda = src.posDampLambda;
  dst.rotDampLambda = src.rotDampLambda;
  dst.fovSpeedGain = src.fovSpeedGain;
  dst.distSpeedGain = src.distSpeedGain;
}
