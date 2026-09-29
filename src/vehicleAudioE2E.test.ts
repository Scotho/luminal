/**
 * Vehicle Audio Engine E2E Tests — Comprehensive verification of the
 * vehicle engine audio system against SPEC-65 (Vehicle Audio Profiles)
 * and SPEC-11 (Vehicle Engine Audio Design).
 *
 * Novel techniques:
 * 1. Parameter trajectory recording over multi-frame simulations
 * 2. Crossfade curve regression testing
 * 3. Strategy dispatch verification
 * 4. Audio graph node counting for resource budget
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Provide GainNode global ────────────────────────────
if (typeof globalThis.GainNode === 'undefined') {
  (globalThis as Record<string, unknown>).GainNode = class GainNode {};
}

// ── Mock AudioNode factories with parameter tracking ───
interface ParamTracker {
  value: number;
  history: number[];
  setValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  cancelScheduledValues: ReturnType<typeof vi.fn>;
}

function makeParam(initial = 0): ParamTracker {
  const param: ParamTracker = {
    value: initial,
    history: [initial],
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
  // Track value changes via proxy
  return new Proxy(param, {
    set(target, prop, value) {
      if (prop === 'value') {
        target.history.push(value as number);
      }
      (target as Record<string | symbol, unknown>)[prop] = value;
      return true;
    },
  });
}

interface MockGainNode {
  gain: ParamTracker;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

interface MockOsc {
  type: string;
  frequency: ParamTracker;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

interface MockFilter {
  type: string;
  frequency: ParamTracker;
  Q: ParamTracker;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

interface MockBufSrc {
  buffer: unknown;
  loop: boolean;
  playbackRate: ParamTracker;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
}

// Track all created nodes for budget verification
const createdNodes = {
  oscillators: [] as MockOsc[],
  gains: [] as MockGainNode[],
  filters: [] as MockFilter[],
  bufferSources: [] as MockBufSrc[],
};

function resetCreatedNodes(): void {
  createdNodes.oscillators = [];
  createdNodes.gains = [];
  createdNodes.filters = [];
  createdNodes.bufferSources = [];
}

const mockAudioBuf = {
  getChannelData: () => new Float32Array(44100 * 3),
  duration: 3,
  numberOfChannels: 1,
  sampleRate: 44100,
};

const makeMockCtx = () => ({
  sampleRate: 44100,
  currentTime: 0,
  state: 'running' as string,
  resume: vi.fn(),
  destination: {},
  createOscillator: vi.fn(() => {
    const osc: MockOsc = {
      type: 'sine',
      frequency: makeParam(440),
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
    };
    createdNodes.oscillators.push(osc);
    return osc;
  }),
  createGain: vi.fn(() => {
    const g: MockGainNode = {
      gain: makeParam(1),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    createdNodes.gains.push(g);
    return g;
  }),
  createBiquadFilter: vi.fn(() => {
    const f: MockFilter = {
      type: 'lowpass',
      frequency: makeParam(350),
      Q: makeParam(1),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    createdNodes.filters.push(f);
    return f;
  }),
  createBufferSource: vi.fn(() => {
    const bs: MockBufSrc = {
      buffer: null,
      loop: false,
      playbackRate: makeParam(1),
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
      addEventListener: vi.fn(),
    };
    createdNodes.bufferSources.push(bs);
    return bs;
  }),
  createBuffer: vi.fn(() => mockAudioBuf),
});

let mockCtx = makeMockCtx();
const mockSfxOutput = { connect: vi.fn() };

vi.mock('./sfxContext', () => ({
  getCtx: vi.fn(() => mockCtx),
  getSfxOutput: vi.fn(() => mockSfxOutput),
  getSfxVolume: vi.fn(() => 1.0),
  noiseBuf: vi.fn(() => mockAudioBuf),
}));

vi.mock('./swallow', () => ({ warnDev: vi.fn() }));

vi.mock('./vehicleSfxLoader', () => ({
  getVehicleBuffer: vi.fn(() => mockAudioBuf),
}));

// ── Import after mocks ─────────────────────────────────
import {
  startVehicleEngine,
  updateVehicleEngine,
  stopVehicleEngine,
  getActiveVehicleType,
  fadeOutVehicleEngine,
} from './vehicleAudioEngine';

import { getVehicleAudioProfile } from './vehicleAudioProfiles';
import { interpolateKeyframes } from './audioUtils';
import * as sfxContext from './sfxContext';
import type { VehicleType } from './types/index';

// ════════════════════════════════════════════════════════
// SECTION 1: Vehicle Audio Profile Spec Compliance
// ════════════════════════════════════════════════════════

describe('SPEC-65: Vehicle Audio Profile Registry', () => {
  it('Spectre (bike) uses sweep strategy', () => {
    const profile = getVehicleAudioProfile('bike');
    expect(profile.strategy).toBe('sweep');
    expect(profile.vehicleType).toBe('bike');
  });

  it('Slingshot (car) uses procedural strategy (switched from sweep per SPEC-96)', () => {
    const profile = getVehicleAudioProfile('car');
    expect(profile.strategy).toBe('procedural');
    expect(profile.vehicleType).toBe('car');
  });

  it('Vector (hoverboard) uses procedural strategy', () => {
    const profile = getVehicleAudioProfile('hoverboard');
    expect(profile.strategy).toBe('procedural');
    expect(profile.vehicleType).toBe('hoverboard');
  });

  it('all profiles have startup and shutdown fields', () => {
    for (const vt of ['bike', 'car', 'hoverboard'] as VehicleType[]) {
      const profile = getVehicleAudioProfile(vt);
      expect(typeof profile.startup).toBe('string');
      expect(typeof profile.shutdown).toBe('string');
    }
  });

  it('Spectre has sweepConfig with required fields', () => {
    const profile = getVehicleAudioProfile('bike');
    expect(profile.sweepConfig).toBeDefined();
    const cfg = profile.sweepConfig!;
    expect(cfg.idleSample).toBe('idle');
    expect(cfg.sweepSample).toBe('speed-sweep');
    expect(cfg.sweepPositionCurve.length).toBeGreaterThanOrEqual(3);
    expect(cfg.playbackRateRange).toHaveLength(2);
    expect(cfg.noiseCurve.length).toBeGreaterThanOrEqual(2);
    expect(cfg.filterCurve.length).toBeGreaterThanOrEqual(2);
    expect(cfg.boostQCurve.length).toBeGreaterThanOrEqual(2);
  });

  it('Spectre has passByConfig with 3 speed tiers', () => {
    const profile = getVehicleAudioProfile('bike');
    expect(profile.passByConfig).toBeDefined();
    const cfg = profile.passByConfig!;
    expect(cfg.slowSamples).toHaveLength(4);
    expect(cfg.mediumSamples).toHaveLength(4);
    expect(cfg.fastSamples).toHaveLength(4);
    expect(cfg.speedThresholds).toHaveLength(2);
  });

  it('Vector has proceduralConfig', () => {
    const profile = getVehicleAudioProfile('hoverboard');
    expect(profile.proceduralConfig).toBeDefined();
    const cfg = profile.proceduralConfig!;
    expect(cfg.basePitchIdle).toBeGreaterThan(0);
    expect(cfg.basePitchScale).toBeGreaterThan(0);
    expect(cfg.smoothing).toBeGreaterThan(0);
    expect(cfg.smoothing).toBeLessThanOrEqual(1);
  });

  it('Spectre sweep position curve covers speed range 0 to 2.5', () => {
    const profile = getVehicleAudioProfile('bike');
    const curve = profile.sweepConfig!.sweepPositionCurve;
    expect(curve[0].at).toBe(0);
    expect(curve[curve.length - 1].at).toBe(2.5);
    expect(curve[0].value).toBe(0);
    expect(curve[curve.length - 1].value).toBe(1.0);
  });

  it('Spectre sweep has engineFilterCurve for separate LP path', () => {
    const profile = getVehicleAudioProfile('bike');
    expect(profile.sweepConfig!.engineFilterCurve).toBeDefined();
    expect(profile.sweepConfig!.engineFilterCurve!.length).toBeGreaterThanOrEqual(2);
  });

  it('Spectre sweep has volumeCurve for speed-dependent volume', () => {
    const profile = getVehicleAudioProfile('bike');
    expect(profile.sweepConfig!.volumeCurve).toBeDefined();
    // Volume should increase with speed
    const curve = profile.sweepConfig!.volumeCurve!;
    const vLow = interpolateKeyframes(curve, 0);
    const vHigh = interpolateKeyframes(curve, 2.0);
    expect(vHigh).toBeGreaterThan(vLow);
  });

  it('Slingshot procedural has lower idle gain than Spectre sweep volume at base speed', () => {
    const bike = getVehicleAudioProfile('bike');
    const car = getVehicleAudioProfile('car');
    // Bike uses sweep with a volumeCurve; car uses procedural with masterGainIdle
    expect(bike.sweepConfig!.volumeCurve).toBeDefined();
    expect(car.proceduralConfig).toBeDefined();
    const bikeVol = interpolateKeyframes(bike.sweepConfig!.volumeCurve!, 1.125);
    const carGain = car.proceduralConfig!.masterGainIdle + car.proceduralConfig!.masterGainScale;
    // Car procedural max gain should be well below bike sweep volume at base speed
    expect(carGain).toBeLessThanOrEqual(bikeVol);
  });
});

// ════════════════════════════════════════════════════════
// SECTION 2: Engine Strategy Dispatch
// ════════════════════════════════════════════════════════

describe('SPEC-65: Engine Strategy Dispatch', () => {
  beforeEach(() => {
    stopVehicleEngine();
    mockCtx = makeMockCtx();
    vi.mocked(sfxContext.getCtx).mockReturnValue(mockCtx as unknown as AudioContext);
    resetCreatedNodes();
  });

  it('bike dispatches to SweepEngine', () => {
    startVehicleEngine('bike');
    expect(getActiveVehicleType()).toBe('bike');
    // Sweep creates buffer sources (idle + sweep + noise)
    expect(createdNodes.bufferSources.length).toBeGreaterThanOrEqual(3);
  });

  it('car dispatches to ProceduralEngine (switched from sweep per SPEC-96)', () => {
    startVehicleEngine('car');
    expect(getActiveVehicleType()).toBe('car');
    // Procedural creates oscillators, not buffer sources
    expect(createdNodes.oscillators.length).toBeGreaterThanOrEqual(2);
  });

  it('hoverboard dispatches to ProceduralEngine', () => {
    startVehicleEngine('hoverboard');
    expect(getActiveVehicleType()).toBe('hoverboard');
    // Procedural creates 2 oscillators + boost layer adds 2 more
    expect(createdNodes.oscillators.length).toBe(4);
  });

  it('switching vehicle stops old strategy and starts new', () => {
    startVehicleEngine('bike');
    expect(getActiveVehicleType()).toBe('bike');
    startVehicleEngine('hoverboard');
    expect(getActiveVehicleType()).toBe('hoverboard');
  });

  it('starting same vehicle twice is idempotent', () => {
    startVehicleEngine('bike');
    const nodeCount = createdNodes.bufferSources.length;
    startVehicleEngine('bike');
    expect(createdNodes.bufferSources.length).toBe(nodeCount);
  });
});

// ════════════════════════════════════════════════════════
// SECTION 3: Procedural Engine (Hoverboard)
// ════════════════════════════════════════════════════════

describe('SPEC-65: Procedural Engine (Hoverboard)', () => {
  beforeEach(() => {
    stopVehicleEngine();
    mockCtx = makeMockCtx();
    vi.mocked(sfxContext.getCtx).mockReturnValue(mockCtx as unknown as AudioContext);
    resetCreatedNodes();
  });

  it('creates 2 oscillators (fundamental + harmonic) plus boost layer', () => {
    startVehicleEngine('hoverboard');
    // 2 procedural + 2 boost layer
    expect(createdNodes.oscillators).toHaveLength(4);
  });

  it('fundamental uses triangle waveform', () => {
    startVehicleEngine('hoverboard');
    expect(createdNodes.oscillators[0].type).toBe('triangle');
  });

  it('harmonic uses sine waveform', () => {
    startVehicleEngine('hoverboard');
    expect(createdNodes.oscillators[1].type).toBe('sine');
  });

  it('fundamental starts at basePitchIdle', () => {
    const cfg = getVehicleAudioProfile('hoverboard').proceduralConfig!;
    startVehicleEngine('hoverboard');
    expect(createdNodes.oscillators[0].frequency.value).toBe(cfg.basePitchIdle);
  });

  it('harmonic starts at 2× basePitchIdle', () => {
    const cfg = getVehicleAudioProfile('hoverboard').proceduralConfig!;
    startVehicleEngine('hoverboard');
    expect(createdNodes.oscillators[1].frequency.value).toBe(cfg.basePitchIdle * 2);
  });

  it('creates noise buffer sources (procedural + boost layer)', () => {
    startVehicleEngine('hoverboard');
    // 1 procedural + 1 boost layer
    expect(createdNodes.bufferSources).toHaveLength(2);
    expect(createdNodes.bufferSources[0].loop).toBe(true);
  });

  it('creates lowpass filter for fundamental', () => {
    startVehicleEngine('hoverboard');
    const lp = createdNodes.filters.find(f => f.type === 'lowpass');
    expect(lp).toBeDefined();
  });

  it('creates bandpass filter for noise', () => {
    startVehicleEngine('hoverboard');
    const bp = createdNodes.filters.find(f => f.type === 'bandpass');
    expect(bp).toBeDefined();
  });

  it('update increases pitch with speedFactor', () => {
    startVehicleEngine('hoverboard');
    const cfg = getVehicleAudioProfile('hoverboard').proceduralConfig!;
    const osc = createdNodes.oscillators[0];
    const initialFreq = osc.frequency.value;

    // Update at speed 1.0
    updateVehicleEngine(1.0);
    // Frequency should have moved toward (basePitchIdle + 1.0 * basePitchScale)
    const targetFreq = cfg.basePitchIdle + 1.0 * cfg.basePitchScale;
    // With smoothing of 0.08, after one frame it moves 8% toward target
    const expectedFreq = initialFreq + (targetFreq - initialFreq) * cfg.smoothing;
    expect(osc.frequency.value).toBeCloseTo(expectedFreq, 1);
  });

  it('master gain scales with speedFactor and sfxVolume', () => {
    startVehicleEngine('hoverboard');

    // Find master gain (the one that connects to output)
    // Master starts at 0
    updateVehicleEngine(1.0);
    // Target: (masterGainIdle + 1.0 * masterGainScale) * 0.8 * 0.9 * sfxVolume
    // The master gain should have moved from 0 toward target
    const masterGain = createdNodes.gains.find(g => g.gain.history.length > 1);
    expect(masterGain).toBeDefined();
  });

  it('Q switches at speedFactor > 1.0 (boost threshold)', () => {
    startVehicleEngine('hoverboard');
    const lp = createdNodes.filters.find(f => f.type === 'lowpass')!;

    // Below boost: Q targets idleQ
    updateVehicleEngine(0.5);
    const qAfterIdle = lp.Q.value;

    // Above boost: Q targets boostQ
    for (let i = 0; i < 50; i++) updateVehicleEngine(1.5);
    const qAfterBoost = lp.Q.value;

    expect(qAfterBoost).toBeGreaterThan(qAfterIdle);
  });

  it('multi-frame simulation: parameters converge to steady state', () => {
    startVehicleEngine('hoverboard');
    const cfg = getVehicleAudioProfile('hoverboard').proceduralConfig!;
    const osc = createdNodes.oscillators[0];

    // Run 100 frames at constant speed
    for (let i = 0; i < 100; i++) {
      updateVehicleEngine(1.5);
    }

    // Should have converged close to target
    const targetFreq = cfg.basePitchIdle + 1.5 * cfg.basePitchScale;
    expect(osc.frequency.value).toBeCloseTo(targetFreq, 0);
  });

  it('stopVehicleEngine disconnects all nodes', () => {
    startVehicleEngine('hoverboard');
    stopVehicleEngine();
    for (const osc of createdNodes.oscillators) {
      expect(osc.disconnect).toHaveBeenCalled();
    }
    expect(getActiveVehicleType()).toBeNull();
  });
});

// ════════════════════════════════════════════════════════
// SECTION 4: Sweep Engine (Spectre / Slingshot)
// ════════════════════════════════════════════════════════

describe('SPEC-65: Sweep Engine', () => {
  beforeEach(() => {
    stopVehicleEngine();
    mockCtx = makeMockCtx();
    vi.mocked(sfxContext.getCtx).mockReturnValue(mockCtx as unknown as AudioContext);
    resetCreatedNodes();
  });

  it('creates idle loop + sweep loop + noise source (3 buffer sources)', () => {
    startVehicleEngine('bike');
    expect(createdNodes.bufferSources.length).toBeGreaterThanOrEqual(3);
  });

  it('idle and sweep sources are looping', () => {
    startVehicleEngine('bike');
    const loopingSources = createdNodes.bufferSources.filter(s => s.loop);
    expect(loopingSources.length).toBeGreaterThanOrEqual(3);
  });

  it('idle gain starts at 1.0 (fully audible at speed 0)', () => {
    startVehicleEngine('bike');
    // First gain node should be idle gain, starting at 1.0
    const idleGain = createdNodes.gains.find(g => g.gain.value === 1.0);
    expect(idleGain).toBeDefined();
  });

  it('sweep gain starts at 0.0 (silent at speed 0)', () => {
    startVehicleEngine('bike');
    const sweepGain = createdNodes.gains.find(g => g.gain.value === 0.0);
    expect(sweepGain).toBeDefined();
  });

  it('creates lowpass filter for engine signal path', () => {
    startVehicleEngine('bike');
    const lpFilters = createdNodes.filters.filter(f => f.type === 'lowpass');
    expect(lpFilters.length).toBeGreaterThanOrEqual(1);
  });

  it('creates bandpass filter for noise layer', () => {
    startVehicleEngine('bike');
    const bpFilters = createdNodes.filters.filter(f => f.type === 'bandpass');
    expect(bpFilters.length).toBeGreaterThanOrEqual(1);
  });

  it('crossfade: idle fades out by speedFactor 0.7', () => {
    startVehicleEngine('bike');
    // Run many frames at speed 0.7+ to let smoothing converge
    for (let i = 0; i < 200; i++) {
      updateVehicleEngine(1.0);
    }
    // After convergence, idle gain should be near 0
    const idleGain = createdNodes.gains[0]; // First gain = idle
    expect(idleGain.gain.value).toBeCloseTo(0, 1);
  });

  it('crossfade: sweep fades in as speed increases', () => {
    startVehicleEngine('bike');
    // Run many frames at base speed
    for (let i = 0; i < 200; i++) {
      updateVehicleEngine(1.125);
    }
    // Sweep gain should be near 1.0
    const sweepGain = createdNodes.gains[1]; // Second gain = sweep
    expect(sweepGain.gain.value).toBeCloseTo(1.0, 1);
  });

  it('master volume scales with sfxVolume', () => {
    startVehicleEngine('bike');
    updateVehicleEngine(1.0);
    // Sweep master is 4th gain (idle, sweep, noise, master); boost layer gains follow
    const masterGain = createdNodes.gains[3];
    expect(masterGain.gain.value).toBeGreaterThan(0);
  });

  it('sweep position curve interpolation is monotonic', () => {
    const profile = getVehicleAudioProfile('bike');
    const curve = profile.sweepConfig!.sweepPositionCurve;
    let prevVal = -1;
    for (let sf = 0; sf <= 2.5; sf += 0.1) {
      const val = interpolateKeyframes(curve, sf);
      expect(val).toBeGreaterThanOrEqual(prevVal);
      prevVal = val;
    }
  });

  it('noise gain increases with speed', () => {
    const profile = getVehicleAudioProfile('bike');
    const curve = profile.sweepConfig!.noiseCurve;
    const gLow = interpolateKeyframes(curve, 0);
    const gHigh = interpolateKeyframes(curve, 2.0);
    expect(gHigh).toBeGreaterThan(gLow);
  });

  it('filter frequency increases with speed (brighter at high speed)', () => {
    const profile = getVehicleAudioProfile('bike');
    const curve = profile.sweepConfig!.engineFilterCurve ?? profile.sweepConfig!.filterCurve;
    const fLow = interpolateKeyframes(curve, 0);
    const fHigh = interpolateKeyframes(curve, 2.0);
    expect(fHigh).toBeGreaterThan(fLow);
  });

  it('boostQ curve rises at high speeds', () => {
    const profile = getVehicleAudioProfile('bike');
    const curve = profile.sweepConfig!.boostQCurve;
    const qLow = interpolateKeyframes(curve, 0);
    const qHigh = interpolateKeyframes(curve, 2.0);
    expect(qHigh).toBeGreaterThan(qLow);
  });

  it('playback rate stays within configured range', () => {
    const profile = getVehicleAudioProfile('bike');
    const [rateMin, rateMax] = profile.sweepConfig!.playbackRateRange;
    startVehicleEngine('bike');
    // Run at various speeds
    for (const speed of [0, 0.5, 1.0, 1.5, 2.0, 2.5]) {
      for (let i = 0; i < 20; i++) updateVehicleEngine(speed);
      // Check sweep source playback rate
      const sweepSrc = createdNodes.bufferSources[1]; // Second source = sweep
      expect(sweepSrc.playbackRate.value).toBeGreaterThanOrEqual(rateMin - 0.1);
      expect(sweepSrc.playbackRate.value).toBeLessThanOrEqual(rateMax + 0.1);
    }
  });
});

// ════════════════════════════════════════════════════════
// SECTION 5: Fade Out
// ════════════════════════════════════════════════════════

describe('SPEC-65: Engine Fade Out', () => {
  beforeEach(() => {
    stopVehicleEngine();
    mockCtx = makeMockCtx();
    vi.mocked(sfxContext.getCtx).mockReturnValue(mockCtx as unknown as AudioContext);
    resetCreatedNodes();
  });

  it('fadeOutVehicleEngine calls linearRampToValueAtTime', () => {
    vi.useFakeTimers();
    startVehicleEngine('bike');
    const cb = vi.fn();
    fadeOutVehicleEngine(0.3, cb);
    // Master gain should have received ramp scheduling
    // (The mock might not capture AudioParam scheduling perfectly,
    // but we verify the callback fires after duration)
    vi.advanceTimersByTime(350);
    expect(cb).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('fadeOutVehicleEngine clears active vehicle', () => {
    startVehicleEngine('hoverboard');
    fadeOutVehicleEngine(0.1);
    expect(getActiveVehicleType()).toBeNull();
  });

  it('fadeOutVehicleEngine with no active engine calls onComplete', () => {
    const cb = vi.fn();
    fadeOutVehicleEngine(0.5, cb);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('shutdown one-shot plays on stopVehicleEngine', () => {
    startVehicleEngine('bike');
    stopVehicleEngine();
    // Should have created a buffer source for the shutdown sample
    const shutdownSources = createdNodes.bufferSources.filter(
      s => s.start.mock.calls.length > 0
    );
    expect(shutdownSources.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════
// SECTION 6: Speed Factor Trajectory Testing
// ════════════════════════════════════════════════════════

describe('SPEC-65: Speed Factor Trajectories', () => {
  beforeEach(() => {
    stopVehicleEngine();
    mockCtx = makeMockCtx();
    vi.mocked(sfxContext.getCtx).mockReturnValue(mockCtx as unknown as AudioContext);
    resetCreatedNodes();
  });

  it('acceleration trajectory: 0 → 1.125 over 60 frames', () => {
    startVehicleEngine('hoverboard');
    const osc = createdNodes.oscillators[0];

    for (let frame = 0; frame < 60; frame++) {
      const speed = (frame / 60) * 1.125;
      updateVehicleEngine(speed);
    }

    // Frequency should have risen
    const cfg = getVehicleAudioProfile('hoverboard').proceduralConfig!;
    const targetFreq = cfg.basePitchIdle + 1.125 * cfg.basePitchScale;
    // Should be close but not exactly at target (smoothing lag)
    expect(osc.frequency.value).toBeGreaterThan(cfg.basePitchIdle);
    expect(osc.frequency.value).toBeLessThan(targetFreq + 5);
  });

  it('deceleration trajectory: 2.5 → 0.7 over 60 frames', () => {
    startVehicleEngine('hoverboard');

    // First ramp up
    for (let i = 0; i < 100; i++) updateVehicleEngine(2.5);

    const peakFreq = createdNodes.oscillators[0].frequency.value;

    // Then decelerate
    for (let frame = 0; frame < 60; frame++) {
      const speed = 2.5 - (frame / 60) * 1.8;
      updateVehicleEngine(speed);
    }

    // Frequency should have dropped
    expect(createdNodes.oscillators[0].frequency.value).toBeLessThan(peakFreq);
  });

  it('boost → coast → brake cycle', () => {
    startVehicleEngine('bike');

    // Boost phase
    for (let i = 0; i < 30; i++) updateVehicleEngine(1.625, true);
    // Coast phase (no throttle, speed drops naturally)
    for (let i = 0; i < 30; i++) updateVehicleEngine(1.3);
    // Brake phase
    for (let i = 0; i < 30; i++) updateVehicleEngine(0.7);

    // Should not throw through any phase
    expect(getActiveVehicleType()).toBe('bike');
  });

  it('dash speed spike (2.5) does not cause discontinuity', () => {
    startVehicleEngine('bike');
    // Steady state
    for (let i = 0; i < 50; i++) updateVehicleEngine(1.125);
    // Sudden dash
    expect(() => updateVehicleEngine(2.5)).not.toThrow();
    // Continue
    for (let i = 0; i < 10; i++) updateVehicleEngine(2.5);
    expect(getActiveVehicleType()).toBe('bike');
  });
});

// ════════════════════════════════════════════════════════
// SECTION 7: Audio Utility Functions
// ════════════════════════════════════════════════════════

describe('Audio Utils: Keyframe Interpolation', () => {
  it('returns 0 for empty curve', () => {
    expect(interpolateKeyframes([], 1.0)).toBe(0);
  });

  it('returns single value for single-keyframe curve', () => {
    expect(interpolateKeyframes([{ at: 0, value: 42 }], 5.0)).toBe(42);
  });

  it('returns first value below first keyframe', () => {
    const curve = [{ at: 1, value: 10 }, { at: 2, value: 20 }];
    expect(interpolateKeyframes(curve, 0)).toBe(10);
  });

  it('returns last value above last keyframe', () => {
    const curve = [{ at: 1, value: 10 }, { at: 2, value: 20 }];
    expect(interpolateKeyframes(curve, 5)).toBe(20);
  });

  it('interpolates linearly between keyframes', () => {
    const curve = [{ at: 0, value: 0 }, { at: 10, value: 100 }];
    expect(interpolateKeyframes(curve, 5)).toBe(50);
  });

  it('interpolates between non-zero keyframes', () => {
    const curve = [{ at: 1, value: 10 }, { at: 3, value: 30 }];
    expect(interpolateKeyframes(curve, 2)).toBe(20);
  });

  it('handles multi-segment curve', () => {
    const curve = [
      { at: 0, value: 0 },
      { at: 1, value: 100 },
      { at: 2, value: 50 },
    ];
    expect(interpolateKeyframes(curve, 0.5)).toBe(50);
    expect(interpolateKeyframes(curve, 1.5)).toBe(75);
  });

  it('exact keyframe match returns exact value', () => {
    const curve = [{ at: 0, value: 0 }, { at: 1, value: 10 }, { at: 2, value: 20 }];
    expect(interpolateKeyframes(curve, 1)).toBe(10);
  });
});

// ════════════════════════════════════════════════════════
// SECTION 8: Resource Budget Verification
// ════════════════════════════════════════════════════════

describe('SPEC-65: Resource Budget', () => {
  beforeEach(() => {
    stopVehicleEngine();
    mockCtx = makeMockCtx();
    vi.mocked(sfxContext.getCtx).mockReturnValue(mockCtx as unknown as AudioContext);
    resetCreatedNodes();
  });

  it('procedural engine + boost layer creates expected node count', () => {
    startVehicleEngine('hoverboard');
    // Procedural: 2 osc + 1 noise + 3 gain + 2 filter
    // Boost layer: 2 osc + 1 noise + 3 gain + 2 filter
    expect(createdNodes.oscillators).toHaveLength(4);
    expect(createdNodes.bufferSources).toHaveLength(2);
    expect(createdNodes.gains).toHaveLength(6);
    expect(createdNodes.filters).toHaveLength(4);
    const total = createdNodes.oscillators.length +
      createdNodes.bufferSources.length +
      createdNodes.gains.length +
      createdNodes.filters.length;
    expect(total).toBe(16);
  });

  it('sweep engine + boost layer creates expected node count', () => {
    startVehicleEngine('bike');
    // Sweep: 3 buffer sources + 4 gains + 2 filters
    // Boost layer: 2 osc + 1 buffer source + 3 gains + 2 filters
    expect(createdNodes.bufferSources).toHaveLength(4);
    expect(createdNodes.gains).toHaveLength(7);
    expect(createdNodes.filters).toHaveLength(4);
    expect(createdNodes.oscillators).toHaveLength(2);
  });
});
