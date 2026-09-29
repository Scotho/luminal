import type {
  VehicleType,
  VehicleAudioProfile,
  SweepConfig,
  ProceduralConfig,
  PassByConfig,
  Keyframe,
} from './types/index';

// ── Shared pass-by config (placeholder — Slingshot reuses Spectre keys until
//    Slingshot-specific assets are sourced) ────────────────────────────────────
// TODO: replace Slingshot passByConfig with car-specific sample keys once
//       audio assets are finalized.
const SHARED_PASS_BY_CONFIG: PassByConfig = {
  slowSamples: [
    'passby-slow-01',
    'passby-slow-02',
    'passby-slow-03',
    'passby-slow-04',
  ],
  mediumSamples: [
    'passby-medium-01',
    'passby-medium-02',
    'passby-medium-03',
    'passby-medium-04',
  ],
  fastSamples: [
    'passby-fast-01',
    'passby-fast-02',
    'passby-fast-03',
    'passby-fast-04',
  ],
  speedThresholds: [0.8, 1.3],
  triggerRange: 12,
  cooldown: 2.5,
};

// ── Noise seasoning layer shared by procedural-aware strategies ───────────────
const BIKE_PROCEDURAL_LAYER = {
  noiseCurve: [
    { at: 0.0, value: 0.01 },
    { at: 1.0, value: 0.025 },
    { at: 2.0, value: 0.045 },
  ] satisfies Keyframe[],
  filterCurve: [
    { at: 0.0, value: 400 },
    { at: 1.0, value: 800 },
    { at: 2.0, value: 1200 },
  ] satisfies Keyframe[],
  boostQCurve: [
    { at: 0.0, value: 1.0 },
    { at: 1.0, value: 1.5 },
    { at: 1.5, value: 3.0 },
    { at: 2.0, value: 3.0 },
  ] satisfies Keyframe[],
};

// ── Spectre (bike) — sweep strategy ──────────────────────────────────────────
// Speed factor reference: base=1.125 (45 km/h), boost=1.625 (65 km/h), dash=2.5 (100 km/h)
const SPECTRE_SWEEP_CONFIG: SweepConfig = {
  idleSample: 'idle',
  sweepSample: 'speed-sweep',
  idleFadeEnd: 0.7,
  sweepFadeStart: 0.15,
  sweepPositionCurve: [
    { at: 0.0, value: 0.0 },
    { at: 1.125, value: 0.35 },
    { at: 1.625, value: 0.65 },
    { at: 2.5, value: 1.0 },
  ],
  playbackRateRange: [0.8, 1.4],
  noiseCurve: BIKE_PROCEDURAL_LAYER.noiseCurve,
  filterCurve: BIKE_PROCEDURAL_LAYER.filterCurve,
  boostQCurve: BIKE_PROCEDURAL_LAYER.boostQCurve,
  // Engine LP filter — open enough at idle so the sample character comes through
  engineFilterCurve: [
    { at: 0.0, value: 4000 },
    { at: 1.125, value: 7000 },
    { at: 2.0, value: 12000 },
  ],
  // Volume curve — idle quieter, high speeds louder
  volumeCurve: [
    { at: 0.0, value: 0.544 },
    { at: 0.7, value: 0.712 },
    { at: 1.125, value: 0.84 },
    { at: 2.0, value: 0.968 },
    { at: 2.5, value: 1.008 },
  ],
};

const SPECTRE_PROFILE: VehicleAudioProfile = {
  vehicleType: 'bike',
  strategy: 'sweep',
  startup: 'engine-on',
  shutdown: 'engine-off',
  sweepConfig: SPECTRE_SWEEP_CONFIG,
  passByConfig: SHARED_PASS_BY_CONFIG,
  proceduralLayer: BIKE_PROCEDURAL_LAYER,
};

// ── Slingshot (car) — procedural strategy ──────────────────────────────────
// Tuned in the SPEC-96 sandbox (i6-japanese-1 profile, osc-noise-lp topology,
// car driver, saturation 0.21). Switched from sweep to procedural to get a
// synthesised engine that responds smoothly across the full speed range.
//
// To revert to sample-based sweep, uncomment the sweep config below and change
// SLINGSHOT_PROFILE.strategy back to 'sweep'.

// --- Previous sweep config (kept for easy revert) ---
// const SLINGSHOT_SWEEP_CONFIG: SweepConfig = {
//   idleSample: 'idle',
//   sweepSample: 'speed-sweep',
//   idleFadeEnd: 0.7,
//   sweepFadeStart: 0.15,
//   sweepPositionCurve: [
//     { at: 0.0, value: 0.0 },
//     { at: 1.125, value: 0.35 },
//     { at: 1.625, value: 0.65 },
//     { at: 2.5, value: 1.0 },
//   ],
//   playbackRateRange: [0.8, 1.4],
//   noiseCurve: [
//     { at: 0.0, value: 0.008 },
//     { at: 1.0, value: 0.02 },
//     { at: 2.0, value: 0.04 },
//   ],
//   filterCurve: [
//     { at: 0.0, value: 350 },
//     { at: 1.0, value: 700 },
//     { at: 2.0, value: 1100 },
//   ],
//   boostQCurve: [
//     { at: 0.0, value: 1.0 },
//     { at: 1.0, value: 1.5 },
//     { at: 1.5, value: 3.0 },
//     { at: 2.0, value: 3.0 },
//   ],
//   engineFilterCurve: [
//     { at: 0.0, value: 3200 },
//     { at: 1.125, value: 5500 },
//     { at: 2.0, value: 9000 },
//   ],
//   volumeCurve: [
//     { at: 0.0, value: 0.48 },
//     { at: 0.7, value: 0.64 },
//     { at: 1.125, value: 0.72 },
//     { at: 2.0, value: 0.8 },
//     { at: 2.5, value: 0.84 },
//   ],
// };

const SLINGSHOT_PROCEDURAL_CONFIG: ProceduralConfig = {
  basePitchIdle: 60,
  basePitchScale: 90,
  lpFreqIdle: 420,
  lpFreqScale: 1600,
  idleQ: 1.2,
  boostQ: 3.5,
  masterGainIdle: 0.045,
  masterGainScale: 0.06,
  noiseGainIdle: 0.018,
  noiseGainScale: 0.04,
  noiseBpFreqIdle: 500,
  noiseBpFreqScale: 1100,
  harmonicGainIdle: 0.035,
  harmonicGainScale: 0.055,
  smoothing: 0.08,
};

const SLINGSHOT_PROFILE: VehicleAudioProfile = {
  vehicleType: 'car',
  strategy: 'procedural',
  startup: 'engine-on',
  shutdown: 'engine-off',
  proceduralConfig: SLINGSHOT_PROCEDURAL_CONFIG,
  passByConfig: SHARED_PASS_BY_CONFIG,
};

// ── Vector (hoverboard) — procedural strategy ───────────────────────────────
// Values sourced directly from sfx.ts updateEngine() to preserve existing sound.
const VECTOR_PROCEDURAL_CONFIG: ProceduralConfig = {
  basePitchIdle: 45,
  basePitchScale: 35,
  lpFreqIdle: 150,
  lpFreqScale: 200,
  boostQ: 3.0,
  idleQ: 1.0,
  masterGainIdle: 0.032,
  masterGainScale: 0.048,
  noiseGainIdle: 0.01,
  noiseGainScale: 0.025,
  noiseBpFreqIdle: 200,
  noiseBpFreqScale: 400,
  harmonicGainIdle: 0.02,
  harmonicGainScale: 0.03,
  smoothing: 0.08,
};

const VECTOR_PROFILE: VehicleAudioProfile = {
  vehicleType: 'hoverboard',
  strategy: 'procedural',
  startup: 'bikeStart',
  shutdown: '',
  proceduralConfig: VECTOR_PROCEDURAL_CONFIG,
};

// ── Registry ─────────────────────────────────────────────────────────────────

const PROFILES: Record<VehicleType, VehicleAudioProfile> = {
  bike: SPECTRE_PROFILE,
  car: SLINGSHOT_PROFILE,
  hoverboard: VECTOR_PROFILE,
};

export function getVehicleAudioProfile(vehicleType: VehicleType): VehicleAudioProfile {
  return PROFILES[vehicleType];
}
