import type { CameraProfile } from './types';
import { CameraMode } from './types';

// Default profiles — Phase 1 uses these for factory defaults only.
// Active profile blending is wired in Phase 4.

export const DEFAULT_NORMAL_PROFILE: CameraProfile = {
  baseFov: 60,
  baseDist: 9.25,
  vertOffset: 3.2,
  latOffset: 0.0,
  lookAheadGain: 1.1,
  lookLatGain: 0.8,
  headingVelBlend: 0.0,
  posDampLambda: 8.8,
  rotDampLambda: 10.8,
  fovSpeedGain: 4.5,
  distSpeedGain: 0.016,
};

export const PROFILE_MAP: Record<CameraMode, CameraProfile> = {
  [CameraMode.Normal]: { ...DEFAULT_NORMAL_PROFILE },
  [CameraMode.Boost]: {
    baseFov: 61, baseDist: 9.6, vertOffset: 3.3, latOffset: 0.0,
    lookAheadGain: 1.18, lookLatGain: 0.8, headingVelBlend: 0.0,
    posDampLambda: 9.6, rotDampLambda: 11.8, fovSpeedGain: 6.2, distSpeedGain: 0.02,
  },
  [CameraMode.Drift]: {
    baseFov: 61, baseDist: 9.5, vertOffset: 3.25, latOffset: 1.0,
    lookAheadGain: 1.08, lookLatGain: 0.96, headingVelBlend: 0.2,
    posDampLambda: 6.8, rotDampLambda: 7.4, fovSpeedGain: 4.8, distSpeedGain: 0.018,
  },
  [CameraMode.DriftBoost]: {
    baseFov: 62, baseDist: 10.0, vertOffset: 3.35, latOffset: 0.95,
    lookAheadGain: 1.22, lookLatGain: 0.82, headingVelBlend: 0.15,
    posDampLambda: 7.9, rotDampLambda: 8.5, fovSpeedGain: 6.4, distSpeedGain: 0.02,
  },
  [CameraMode.Dash]: {
    baseFov: 63, baseDist: 10.3, vertOffset: 3.45, latOffset: 0.0,
    lookAheadGain: 1.32, lookLatGain: 0.6, headingVelBlend: 0.0,
    posDampLambda: 10.1, rotDampLambda: 12.5, fovSpeedGain: 7.2, distSpeedGain: 0.022,
  },
};

/** Interpolate all fields between two profiles. */
export function lerpProfile(a: CameraProfile, b: CameraProfile, t: number, out: CameraProfile = {} as CameraProfile): CameraProfile {
  out.baseFov = a.baseFov + (b.baseFov - a.baseFov) * t;
  out.baseDist = a.baseDist + (b.baseDist - a.baseDist) * t;
  out.vertOffset = a.vertOffset + (b.vertOffset - a.vertOffset) * t;
  out.latOffset = a.latOffset + (b.latOffset - a.latOffset) * t;
  out.lookAheadGain = a.lookAheadGain + (b.lookAheadGain - a.lookAheadGain) * t;
  out.lookLatGain = a.lookLatGain + (b.lookLatGain - a.lookLatGain) * t;
  out.headingVelBlend = a.headingVelBlend + (b.headingVelBlend - a.headingVelBlend) * t;
  out.posDampLambda = a.posDampLambda + (b.posDampLambda - a.posDampLambda) * t;
  out.rotDampLambda = a.rotDampLambda + (b.rotDampLambda - a.rotDampLambda) * t;
  out.fovSpeedGain = a.fovSpeedGain + (b.fovSpeedGain - a.fovSpeedGain) * t;
  out.distSpeedGain = a.distSpeedGain + (b.distSpeedGain - a.distSpeedGain) * t;
  return out;
}
