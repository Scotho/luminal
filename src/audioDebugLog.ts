// ── Audio Diagnostic Logger ─────────────────────────────
// Runtime instrumentation for verifying audio system behavior
// against design specs. Used by src/spatialAudioE2E.test.ts.

export interface PannerSnapshot {
  range: number;
  posX: number;
  posY: number;
  posZ: number;
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;
  distanceModel: string;
  panningModel: string;
  coneInner: number;
  coneOuter: number;
}

// ── Spec Reference Values ──────────────────────────────
// Extracted from design specs for runtime comparison.

export const SPEC_RANGE_CONFIG = {
  SHORT:  { refDistance: 10, maxDistance: 96,  rolloffFactor: 1.5 },
  MEDIUM: { refDistance: 20, maxDistance: 192, rolloffFactor: 1.2 },
  LONG:   { refDistance: 30, maxDistance: 384, rolloffFactor: 1.0 },
} as const;

export const SPEC_PANNER_DEFAULTS = {
  distanceModel: 'inverse',
  panningModel: 'HRTF',
  coneInnerAngle: 360,
  coneOuterAngle: 360,
} as const;

// ts-prune-ignore-next
export const SPEC_RESOURCE_BUDGET = {
  pannersPerOpponent: 3,
  maxOpponents: 3,
  totalPanners: 9,
  engineNodesPerPlayer: 8,
  totalEngineNodes: 32,
  sharedNoiseBuffers: 1,
} as const;

// ── Distance Attenuation Calculator ────────────────────
// Inverse distance model: gain = refDistance / (refDistance + rolloff * (distance - refDistance))
// Clamped to [0, maxDistance] range.
// ts-prune-ignore-next
export function calcInverseDistanceGain(
  distance: number,
  refDistance: number,
  maxDistance: number,
  rolloffFactor: number,
): number {
  const d = Math.max(refDistance, Math.min(distance, maxDistance));
  if (d <= refDistance) return 1.0;
  return refDistance / (refDistance + rolloffFactor * (d - refDistance));
}

// ── Spec Compliance Checker ────────────────────────────
export interface ComplianceResult {
  check: string;
  passed: boolean;
  expected: string;
  actual: string;
}

// ts-prune-ignore-next
export function checkPannerCompliance(panner: PannerSnapshot, range: number): ComplianceResult[] {
  const rangeNames = ['SHORT', 'MEDIUM', 'LONG'] as const;
  const rangeName = rangeNames[range] ?? 'UNKNOWN';
  const spec = SPEC_RANGE_CONFIG[rangeName as keyof typeof SPEC_RANGE_CONFIG];
  if (!spec) return [{ check: 'range', passed: false, expected: 'valid range', actual: String(range) }];

  return [
    {
      check: `${rangeName} refDistance`,
      passed: panner.refDistance === spec.refDistance,
      expected: String(spec.refDistance),
      actual: String(panner.refDistance),
    },
    {
      check: `${rangeName} maxDistance`,
      passed: panner.maxDistance === spec.maxDistance,
      expected: String(spec.maxDistance),
      actual: String(panner.maxDistance),
    },
    {
      check: `${rangeName} rolloffFactor`,
      passed: panner.rolloffFactor === spec.rolloffFactor,
      expected: String(spec.rolloffFactor),
      actual: String(panner.rolloffFactor),
    },
    {
      check: `${rangeName} distanceModel`,
      passed: panner.distanceModel === SPEC_PANNER_DEFAULTS.distanceModel,
      expected: SPEC_PANNER_DEFAULTS.distanceModel,
      actual: panner.distanceModel,
    },
    {
      check: `${rangeName} panningModel`,
      passed: panner.panningModel === SPEC_PANNER_DEFAULTS.panningModel,
      expected: SPEC_PANNER_DEFAULTS.panningModel,
      actual: panner.panningModel,
    },
    {
      check: `${rangeName} omnidirectional (inner)`,
      passed: panner.coneInner === SPEC_PANNER_DEFAULTS.coneInnerAngle,
      expected: String(SPEC_PANNER_DEFAULTS.coneInnerAngle),
      actual: String(panner.coneInner),
    },
    {
      check: `${rangeName} omnidirectional (outer)`,
      passed: panner.coneOuter === SPEC_PANNER_DEFAULTS.coneOuterAngle,
      expected: String(SPEC_PANNER_DEFAULTS.coneOuterAngle),
      actual: String(panner.coneOuter),
    },
  ];
}
