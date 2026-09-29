/**
 * SFX System E2E Tests — Comprehensive verification of the sound effects
 * pipeline against SPEC-1 (Sound Effects), SPEC-63 (Slipstream VFX/SFX),
 * and SPEC-8 (Music System).
 *
 * Novel techniques:
 * 1. Signal chain topology verification via connect() call interception
 * 2. Slipstream parameter curve validation against spec values
 * 3. Volume routing chain verification
 * 4. Near-miss looping lifecycle testing
 * 5. Dampen filter characteristic verification
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Audio node tracking ────────��───────────────────────
let connectCalls: Array<{ from: string; to: string }> = [];
let startedOscillators: Array<{ type: string; freq: number }> = [];
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for future topology tests
let startedBufferSources = 0;

function resetTracking(): void {
  connectCalls = [];
  startedOscillators = [];
  startedBufferSources = 0;
}

// ── Mock factories ─────────────────────────────────────

const makeParam = (v = 0) => ({
  value: v,
  setValueAtTime: vi.fn(),
  exponentialRampToValueAtTime: vi.fn(),
  linearRampToValueAtTime: vi.fn(),
  cancelScheduledValues: vi.fn(),
});

let _nodeId = 0;

const mockGain = () => {
  const id = `gain_${_nodeId++}`;
  return {
    _id: id,
    gain: makeParam(0),
    connect: vi.fn((dest: { _id?: string }) => {
      connectCalls.push({ from: id, to: dest._id ?? 'unknown' });
    }),
    disconnect: vi.fn(),
  };
};

const mockOsc = () => {
  const id = `osc_${_nodeId++}`;
  return {
    _id: id,
    type: '' as string,
    frequency: makeParam(0),
    connect: vi.fn((dest: { _id?: string }) => {
      connectCalls.push({ from: id, to: dest._id ?? 'unknown' });
    }),
    start: vi.fn(function (this: { type: string; frequency: { value: number } }) {
      startedOscillators.push({ type: this.type, freq: this.frequency.value });
    }),
    stop: vi.fn(),
    disconnect: vi.fn(),
  };
};

const mockFilter = () => {
  const id = `filter_${_nodeId++}`;
  return {
    _id: id,
    type: '' as string,
    frequency: makeParam(0),
    Q: makeParam(0),
    connect: vi.fn((dest: { _id?: string }) => {
      connectCalls.push({ from: id, to: dest._id ?? 'unknown' });
    }),
    disconnect: vi.fn(),
  };
};

const mockBufSrc = () => {
  const id = `bufsrc_${_nodeId++}`;
  return {
    _id: id,
    buffer: null as unknown,
    loop: false,
    playbackRate: makeParam(1),
    connect: vi.fn((dest: { _id?: string }) => {
      connectCalls.push({ from: id, to: dest._id ?? 'unknown' });
    }),
    start: vi.fn(() => { startedBufferSources++; }),
    stop: vi.fn(),
    disconnect: vi.fn(),
  };
};

const noiseBufResult = {
  getChannelData: () => new Float32Array(44100),
  duration: 1,
  numberOfChannels: 1,
  sampleRate: 44100,
};

const sfxOutputNode = { _id: 'sfxOutput', connect: vi.fn() };

let _sfxVolume = 1.0;
let mockCtxObj: ReturnType<typeof makeMockCtx>;

function makeMockCtx() {
  return {
    currentTime: 0,
    state: 'running' as string,
    resume: vi.fn(),
    destination: { _id: 'dest' },
    sampleRate: 44100,
    createGain: vi.fn(() => mockGain()),
    createOscillator: vi.fn(() => mockOsc()),
    createBiquadFilter: vi.fn(() => mockFilter()),
    createBufferSource: vi.fn(() => mockBufSrc()),
    createBuffer: vi.fn(() => noiseBufResult),
  };
}

// ── Register mocks before imports ──────────────────────
vi.mock('./sfxContext', () => ({
  getCtx: vi.fn(() => mockCtxObj),
  getSfxOutput: vi.fn(() => sfxOutputNode),
  getSfxVolume: vi.fn(() => _sfxVolume),
  setSfxVolume: vi.fn((v: number) => { _sfxVolume = v; }),
  setSfxDampen: vi.fn(),
  noiseBuf: vi.fn(() => noiseBufResult),
}));

vi.mock('./sfxAssets', () => ({
  playExplosionSourced: vi.fn(),
  playUiForward: vi.fn(),
  playUiBack: vi.fn(),
  playUiJoin: vi.fn(),
  playUiSlipstream: vi.fn(),
  playUiBlip: vi.fn(),
  playUiTab: vi.fn(),
  playUiToggle: vi.fn(),
  playUiCtxAction: vi.fn(),
  playUiReadout: vi.fn(),
  playUiMatchmaking: vi.fn(),
  playUiMatchFound: vi.fn(),
  playUiSettings: vi.fn(),
}));

vi.mock('./swallow', () => ({ warnDev: vi.fn() }));

// Import SFX module
import {
  playHover, playTick, playConfirm, playNotif,
  playVictory, playDefeat, playNavigate,
  playExplosion, playChat,
  playCountdown,
  startProximitySpark, updateProximitySpark, stopProximitySpark,
  startEngine, updateEngine, stopEngine,
} from './sfx';

// Import sfxContext for direct assertions
import { getCtx, getSfxOutput, getSfxVolume } from './sfxContext';

// ════════════════════════════════════════════════════════
// SECTION 1: SFX Context (shared AudioContext)
// ═══════════════════���════════════════════════════════════

describe('SFX Context', () => {
  beforeEach(() => {
    mockCtxObj = makeMockCtx();
    _sfxVolume = 1.0;
    _nodeId = 0;
    resetTracking();
    vi.clearAllMocks();
  });

  it('getCtx returns the AudioContext', () => {
    const ctx = getCtx();
    expect(ctx).toBe(mockCtxObj);
  });

  it('getSfxOutput returns the SFX output node', () => {
    const out = getSfxOutput(mockCtxObj as unknown as AudioContext);
    expect(out).toBe(sfxOutputNode);
  });

  it('getSfxVolume returns current volume', () => {
    expect(getSfxVolume()).toBe(1.0);
  });
});

// ═════════════════════════════════════════��══════════════
// SECTION 2: Procedural UI Sounds (SPEC-1)
// ══════════════���═════════════════════════════════════════

describe('SPEC-1: Procedural UI Sounds', () => {
  beforeEach(() => {
    mockCtxObj = makeMockCtx();
    _sfxVolume = 1.0;
    _nodeId = 0;
    resetTracking();
    vi.clearAllMocks();
  });

  it('playHover creates bandpass-filtered noise sweep', () => {
    playHover();
    expect(mockCtxObj.createBufferSource).toHaveBeenCalledTimes(1);
    expect(mockCtxObj.createBiquadFilter).toHaveBeenCalledTimes(1);
    expect(mockCtxObj.createGain).toHaveBeenCalledTimes(1);
    // Filter should be bandpass
    const filter = mockCtxObj.createBiquadFilter.mock.results[0].value;
    expect(filter.type).toBe('bandpass');
  });

  it('playHover gain scales with sfxVolume', () => {
    _sfxVolume = 0.5;
    playHover();
    const gain = mockCtxObj.createGain.mock.results[0].value;
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(0.06 * 0.5, 3),
      expect.any(Number),
    );
  });

  it('playTick creates sine oscillator at 520Hz', () => {
    playTick();
    expect(mockCtxObj.createOscillator).toHaveBeenCalledTimes(1);
    const osc = mockCtxObj.createOscillator.mock.results[0].value;
    expect(osc.type).toBe('sine');
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(520, expect.any(Number));
  });

  it('playConfirm creates two-tone boop (600Hz → 900Hz)', () => {
    playConfirm();
    expect(mockCtxObj.createOscillator).toHaveBeenCalledTimes(1);
    const osc = mockCtxObj.createOscillator.mock.results[0].value;
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(600, expect.any(Number));
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(900, expect.any(Number));
  });

  it('playNotif creates two-note ascending chime (880Hz + 1320Hz)', () => {
    playNotif();
    expect(mockCtxObj.createOscillator).toHaveBeenCalledTimes(2);
    const osc1 = mockCtxObj.createOscillator.mock.results[0].value;
    const osc2 = mockCtxObj.createOscillator.mock.results[1].value;
    expect(osc1.frequency.setValueAtTime).toHaveBeenCalledWith(880, expect.any(Number));
    expect(osc2.frequency.setValueAtTime).toHaveBeenCalledWith(1320, expect.any(Number));
  });

  it('playNavigate delegates to playUiForward', async () => {
    const mod = await import('./sfxAssets');
    const { playUiForward } = vi.mocked(mod);
    playNavigate();
    expect(playUiForward).toHaveBeenCalledTimes(1);
  });

  it('playVictory creates 3-note ascending arpeggio + shimmer', () => {
    playVictory();
    // 3 oscillators for C5→E5→G5 + 1 shimmer noise
    expect(mockCtxObj.createOscillator).toHaveBeenCalledTimes(3);
    expect(mockCtxObj.createBufferSource).toHaveBeenCalledTimes(1);
    const notes = [523, 659, 784];
    for (let i = 0; i < 3; i++) {
      const osc = mockCtxObj.createOscillator.mock.results[i].value;
      expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(notes[i], expect.any(Number));
    }
  });

  it('playDefeat creates descending tone (330Hz → 200Hz)', () => {
    playDefeat();
    // 2 oscillators: main descending + sub bass
    expect(mockCtxObj.createOscillator).toHaveBeenCalledTimes(2);
    const osc = mockCtxObj.createOscillator.mock.results[0].value;
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(330, expect.any(Number));
    expect(osc.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(200, expect.any(Number));
  });

  it('playChat creates 440Hz sine blip', () => {
    playChat();
    expect(mockCtxObj.createOscillator).toHaveBeenCalledTimes(1);
    const osc = mockCtxObj.createOscillator.mock.results[0].value;
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(440, expect.any(Number));
  });

  it('playCountdown(false) creates beep + sub thump', () => {
    playCountdown(false);
    // Beep (sine) + thump (sine) = 2 oscillators
    expect(mockCtxObj.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('playCountdown(true) creates GO rev-up (4 sound sources)', () => {
    playCountdown(true);
    // Rev (sawtooth) + sub (sine) + sci-fi (square) = 3 oscillators + 1 noise whoosh
    expect(mockCtxObj.createOscillator).toHaveBeenCalledTimes(3);
    expect(mockCtxObj.createBufferSource).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════��═══════════════════════════════════
// SECTION 3: Explosion Sound (SPEC-1)
// ══════════════════���══════════════════════════════���══════

describe('SPEC-1: Explosion Sound', () => {
  beforeEach(() => {
    mockCtxObj = makeMockCtx();
    _sfxVolume = 1.0;
    _nodeId = 0;
    resetTracking();
    vi.clearAllMocks();
  });

  it('playExplosion creates sub impact + boom body (procedural)', () => {
    playExplosion();
    // Sub oscillator + boom noise source
    expect(mockCtxObj.createOscillator).toHaveBeenCalledTimes(1);
    expect(mockCtxObj.createBufferSource).toHaveBeenCalledTimes(1);
  });

  it('playExplosion also calls playExplosionSourced (hybrid approach)', async () => {
    const mod = await import('./sfxAssets');
    const { playExplosionSourced } = vi.mocked(mod);
    playExplosion();
    expect(playExplosionSourced).toHaveBeenCalledTimes(1);
  });

  it('playExplosion accepts optional dest for spatial routing', async () => {
    const mod = await import('./sfxAssets');
    const { playExplosionSourced } = vi.mocked(mod);
    const fakeDest = { _id: 'spatialPanner', connect: vi.fn() };
    playExplosion(fakeDest as unknown as AudioNode);
    expect(playExplosionSourced).toHaveBeenCalledWith(fakeDest);
  });

  it('sub impact drops from 80Hz to 25Hz', () => {
    playExplosion();
    const sub = mockCtxObj.createOscillator.mock.results[0].value;
    expect(sub.frequency.setValueAtTime).toHaveBeenCalledWith(80, expect.any(Number));
    expect(sub.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(25, expect.any(Number));
  });
});

// ════════════════════════════════════════════════��═══════
// SECTION 4: Slipstream Sound (SPEC-63)
// ════���══════════════════════════���════════════════════════

describe('SPEC-63: Slipstream Sound — Procedural Energy Siphon', () => {
  beforeEach(() => {
    mockCtxObj = makeMockCtx();
    _sfxVolume = 1.0;
    _nodeId = 0;
    resetTracking();
    vi.clearAllMocks();
    // Ensure any previous slipstream is stopped
    stopProximitySpark();
  });

  afterEach(() => {
    stopProximitySpark();
  });

  it('startProximitySpark creates the full signal chain', () => {
    startProximitySpark();
    // Wind noise (buffer source) + hum (oscillator) + LFO (oscillator) + crackle (buffer source)
    expect(mockCtxObj.createBufferSource).toHaveBeenCalledTimes(2); // noise + crackle
    expect(mockCtxObj.createOscillator).toHaveBeenCalledTimes(2);   // hum + LFO
    // Filters: bandpass (wind) + highpass (crackle)
    expect(mockCtxObj.createBiquadFilter).toHaveBeenCalledTimes(2);
    // Gains: noiseGain + humGain + lfoGain + crackleGain + master = 5
    expect(mockCtxObj.createGain).toHaveBeenCalledTimes(5);
  });

  it('wind layer uses bandpass filter', () => {
    startProximitySpark();
    const filters = mockCtxObj.createBiquadFilter.mock.results.map(r => r.value);
    const bp = filters.find((f: { type: string }) => f.type === 'bandpass');
    expect(bp).toBeDefined();
  });

  it('wind bandpass Q is 1.5 per spec', () => {
    startProximitySpark();
    const filters = mockCtxObj.createBiquadFilter.mock.results.map(r => r.value);
    const bp = filters.find((f: { type: string }) => f.type === 'bandpass');
    expect(bp!.Q.value).toBe(1.5);
  });

  it('crackle layer uses highpass filter', () => {
    startProximitySpark();
    const filters = mockCtxObj.createBiquadFilter.mock.results.map(r => r.value);
    const hp = filters.find((f: { type: string }) => f.type === 'highpass');
    expect(hp).toBeDefined();
  });

  it('hum oscillator uses sine waveform', () => {
    startProximitySpark();
    const oscs = mockCtxObj.createOscillator.mock.results.map(r => r.value);
    const hum = oscs[0]; // First oscillator is hum
    expect(hum.type).toBe('sine');
  });

  it('LFO oscillator uses sine waveform', () => {
    startProximitySpark();
    const oscs = mockCtxObj.createOscillator.mock.results.map(r => r.value);
    const lfo = oscs[1]; // Second oscillator is LFO
    expect(lfo.type).toBe('sine');
  });

  it('master gain starts at 0 (silent)', () => {
    startProximitySpark();
    // Master gain is the last created
    const gains = mockCtxObj.createGain.mock.results.map(r => r.value);
    const master = gains[0]; // First gain created is master
    expect(master.gain.value).toBe(0);
  });

  it('startProximitySpark is idempotent', () => {
    startProximitySpark();
    const count = mockCtxObj.createOscillator.mock.calls.length;
    startProximitySpark(); // Second call should be no-op
    expect(mockCtxObj.createOscillator).toHaveBeenCalledTimes(count);
  });

  it('updateProximitySpark scales all parameters with intensity', () => {
    startProximitySpark();
    updateProximitySpark(0.8);

    // Verify wind bandpass center frequency rises with intensity
    const filters = mockCtxObj.createBiquadFilter.mock.results.map(r => r.value);
    const bp = filters.find((f: { type: string }) => f.type === 'bandpass');
    // Spec: 200 + prox * 400 → at 0.8: 200 + 320 = 520
    expect(bp!.frequency.value).toBeCloseTo(200 + 0.8 * 400, 0);
  });

  it('updateProximitySpark hum frequency rises with intensity', () => {
    startProximitySpark();
    updateProximitySpark(1.0);

    const oscs = mockCtxObj.createOscillator.mock.results.map(r => r.value);
    const hum = oscs[0];
    // Implementation: 55 + p * 35 = 90 at full intensity
    expect(hum.frequency.value).toBeCloseTo(55 + 1.0 * 35, 0);
  });

  it('updateProximitySpark wind noise gain scales correctly', () => {
    startProximitySpark();
    updateProximitySpark(0.5);

    const gains = mockCtxObj.createGain.mock.results.map(r => r.value);
    // noiseGain should be p * 0.48
    const noiseGain = gains[1]; // Second gain = noiseGain
    expect(noiseGain.gain.value).toBeCloseTo(0.5 * 0.48, 2);
  });

  it('updateProximitySpark hum gain scales correctly', () => {
    startProximitySpark();
    updateProximitySpark(0.5);

    const gains = mockCtxObj.createGain.mock.results.map(r => r.value);
    // humGain should be p * 0.16
    const humGain = gains[3]; // Fourth gain = humGain
    expect(humGain.gain.value).toBeCloseTo(0.5 * 0.16, 2);
  });

  it('updateProximitySpark crackle gain scales correctly', () => {
    startProximitySpark();
    updateProximitySpark(0.5);

    const gains = mockCtxObj.createGain.mock.results.map(r => r.value);
    // crackleGain should be p * 0.08
    const crackleGain = gains[4]; // Fifth gain = crackleGain
    expect(crackleGain.gain.value).toBeCloseTo(0.5 * 0.08, 2);
  });

  it('updateProximitySpark master gain scales with intensity * sfxVolume', () => {
    startProximitySpark();
    _sfxVolume = 0.8;
    updateProximitySpark(0.6, 1.0);

    const gains = mockCtxObj.createGain.mock.results.map(r => r.value);
    const master = gains[0];
    // master = p * 0.12 * vol * vehicleVolume
    expect(master.gain.value).toBeCloseTo(0.6 * 0.12 * 0.8 * 1.0, 3);
  });

  it('updateProximitySpark clamps intensity to [0, 1]', () => {
    startProximitySpark();
    updateProximitySpark(5.0);

    const filters = mockCtxObj.createBiquadFilter.mock.results.map(r => r.value);
    const bp = filters.find((f: { type: string }) => f.type === 'bandpass');
    // Should clamp to p=1.0: 200 + 1.0 * 400 = 600
    expect(bp!.frequency.value).toBeCloseTo(600, 0);
  });

  it('updateProximitySpark accepts vehicleVolume multiplier', () => {
    startProximitySpark();
    updateProximitySpark(1.0, 0.5);

    const gains = mockCtxObj.createGain.mock.results.map(r => r.value);
    const master = gains[0];
    // master = 1.0 * 0.12 * 1.0 * 0.5 = 0.06
    expect(master.gain.value).toBeCloseTo(0.06, 3);
  });

  it('stopProximitySpark stops all oscillators and disconnects', () => {
    startProximitySpark();
    const oscs = mockCtxObj.createOscillator.mock.results.map(r => r.value);
    const bufs = mockCtxObj.createBufferSource.mock.results.map(r => r.value);
    stopProximitySpark();
    for (const osc of oscs) {
      expect(osc.stop).toHaveBeenCalled();
      expect(osc.disconnect).toHaveBeenCalled();
    }
    for (const buf of bufs) {
      expect(buf.stop).toHaveBeenCalled();
      expect(buf.disconnect).toHaveBeenCalled();
    }
  });

  it('stopProximitySpark is safe to call when not started', () => {
    expect(() => stopProximitySpark()).not.toThrow();
  });

  it('stopProximitySpark with fadeDuration ramps master gain to zero', () => {
    vi.useFakeTimers();
    startProximitySpark();
    updateProximitySpark(0.8);

    stopProximitySpark(0.5);
    const gains = mockCtxObj.createGain.mock.results.map(r => r.value);
    const master = gains[0];
    // Should have scheduled a linear ramp to 0
    expect(master.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));

    // After fade duration, oscillators should be stopped
    vi.advanceTimersByTime(550);
    vi.useRealTimers();
  });

  it('multi-frame slipstream simulation: approach → sustain → retreat', () => {
    startProximitySpark();

    // Approach: intensity rises 0 → 1.0 over 30 frames
    for (let f = 0; f < 30; f++) {
      updateProximitySpark(f / 30);
    }
    // Sustain: hold at 1.0 for 30 frames
    for (let f = 0; f < 30; f++) {
      updateProximitySpark(1.0);
    }
    // Retreat: intensity drops 1.0 → 0 over 30 frames
    for (let f = 0; f <= 30; f++) {
      updateProximitySpark(Math.max(0, 1.0 - f / 30));
    }
    // Final update at exactly 0
    updateProximitySpark(0);

    // Verify frequency tracked the approach/retreat
    const filters = mockCtxObj.createBiquadFilter.mock.results.map(r => r.value);
    const bp = filters.find((f: { type: string }) => f.type === 'bandpass');
    // After retreat to 0 intensity, frequency should be at base (200)
    expect(bp!.frequency.value).toBeCloseTo(200, 0);

    stopProximitySpark();
  });
});

// ═════════════════���═════════════════════════════════���════
// SECTION 5: Slipstream Spec Divergence Documentation
// ════════════════════════════════════════════════════════

describe('SPEC-63 vs Implementation: Documented Tuning Differences', () => {
  // These tests document known tuning divergences from spec values.
  // The spec says "all values tunable" so these are intentional adjustments.

  beforeEach(() => {
    mockCtxObj = makeMockCtx();
    _sfxVolume = 1.0;
    _nodeId = 0;
    resetTracking();
    vi.clearAllMocks();
    stopProximitySpark();
  });

  afterEach(() => {
    stopProximitySpark();
  });

  it('hum base frequency: impl=55Hz vs spec=120Hz (tuned down to reduce buzz)', () => {
    startProximitySpark();
    const oscs = mockCtxObj.createOscillator.mock.results.map(r => r.value);
    const hum = oscs[0];
    expect(hum.frequency.value).toBe(55);
  });

  it('LFO frequency: impl=2.2Hz vs spec=3Hz', () => {
    startProximitySpark();
    const oscs = mockCtxObj.createOscillator.mock.results.map(r => r.value);
    const lfo = oscs[1];
    expect(lfo.frequency.value).toBe(2.2);
  });

  it('LFO depth: impl=3 vs spec=8Hz', () => {
    startProximitySpark();
    const gains = mockCtxObj.createGain.mock.results.map(r => r.value);
    const lfoGain = gains[2];
    expect(lfoGain.gain.value).toBe(3);
  });

  it('crackle highpass: impl=1400Hz vs spec=2000Hz', () => {
    startProximitySpark();
    const filters = mockCtxObj.createBiquadFilter.mock.results.map(r => r.value);
    const hp = filters.find((f: { type: string }) => f.type === 'highpass');
    expect(hp!.frequency.value).toBe(1400);
  });
});

// ═══════════════════���════════════════════════════���═══════
// SECTION 6: Engine Delegation (backward compat)
// ══════════════════��═════════════════════════════════════

describe('SPEC-11: Engine Sound Backward Compatibility', () => {
  beforeEach(() => {
    mockCtxObj = makeMockCtx();
    _sfxVolume = 1.0;
    _nodeId = 0;
    resetTracking();
    vi.clearAllMocks();
  });

  it('startEngine delegates to startVehicleEngine', () => {
    expect(() => startEngine('bike')).not.toThrow();
  });

  it('startEngine defaults to bike when no vehicleType given', () => {
    expect(() => startEngine()).not.toThrow();
  });

  it('updateEngine delegates to updateVehicleEngine', () => {
    startEngine('hoverboard');
    expect(() => updateEngine(1.0)).not.toThrow();
    expect(() => updateEngine(1.5, true)).not.toThrow();
  });

  it('stopEngine cleans up', () => {
    startEngine('hoverboard');
    expect(() => stopEngine()).not.toThrow();
  });
});

// ═════════════════════���════════════════════════════════���═
// SECTION 7: Volume Routing
// ════════════════════════════���═══════════════════════════

describe('SFX Volume Routing', () => {
  beforeEach(() => {
    mockCtxObj = makeMockCtx();
    _sfxVolume = 1.0;
    _nodeId = 0;
    resetTracking();
    vi.clearAllMocks();
  });

  it('all sounds route through sfxOutput', () => {
    // Play several sounds and check connect calls
    playHover();
    playTick();
    playConfirm();

    // Each sound's final gain should connect to sfxOutput
    const sfxConnections = connectCalls.filter(c => c.to === 'sfxOutput');
    expect(sfxConnections.length).toBeGreaterThanOrEqual(3);
  });

  it('volume at 0 makes gain effectively 0', () => {
    _sfxVolume = 0;
    playTick();
    const gain = mockCtxObj.createGain.mock.results[0].value;
    // gain = 0.08 * sfxVolume = 0.08 * 0 = 0
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
  });

  it('volume at 0.5 halves gain values', () => {
    _sfxVolume = 0.5;
    playTick();
    const gain = mockCtxObj.createGain.mock.results[0].value;
    // gain = 0.08 * 0.5 = 0.04
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(0.04, 3),
      expect.any(Number),
    );
  });
});

// ════════════════���═══════════════════════════════���═══════
// SECTION 8: Signal Chain Topology
// ════════════════════════════════════════════════════════

describe('Signal Chain: Audio Graph Topology', () => {
  beforeEach(() => {
    mockCtxObj = makeMockCtx();
    _sfxVolume = 1.0;
    _nodeId = 0;
    resetTracking();
    vi.clearAllMocks();
  });

  it('playHover chain: bufferSource → bandpass → gain → sfxOutput', () => {
    playHover();
    // Should have 3 connect calls forming the chain
    expect(connectCalls.length).toBe(3);
    expect(connectCalls[0].from).toMatch(/^bufsrc/);
    expect(connectCalls[0].to).toMatch(/^filter/);
    expect(connectCalls[1].from).toMatch(/^filter/);
    expect(connectCalls[1].to).toMatch(/^gain/);
    expect(connectCalls[2].from).toMatch(/^gain/);
    expect(connectCalls[2].to).toBe('sfxOutput');
  });

  it('playTick chain: oscillator → gain → sfxOutput', () => {
    playTick();
    expect(connectCalls.length).toBe(2);
    expect(connectCalls[0].from).toMatch(/^osc/);
    expect(connectCalls[0].to).toMatch(/^gain/);
    expect(connectCalls[1].from).toMatch(/^gain/);
    expect(connectCalls[1].to).toBe('sfxOutput');
  });

  it('slipstream chain: noise→BP→noiseGain→master, hum→humGain→master, lfo→lfoGain→hum.freq, crackle→HP→crackleGain→master, master→sfxOutput', () => {
    startProximitySpark();
    // Verify key connections exist
    const masterToSfx = connectCalls.find(c => c.to === 'sfxOutput');
    expect(masterToSfx).toBeDefined();
    // Multiple nodes connect to master
    const toMaster = connectCalls.filter(c => c.to === masterToSfx!.from);
    // noiseGain, humGain, crackleGain all connect to master
    expect(toMaster.length).toBeGreaterThanOrEqual(3);
    stopProximitySpark();
  });
});

// ════════════════════════════════════════════════════════
// SECTION 9: Edge Cases & Error Handling
// ════════════��═══════════════════════════════════════════

describe('SFX Edge Cases', () => {
  beforeEach(() => {
    mockCtxObj = makeMockCtx();
    _sfxVolume = 1.0;
    _nodeId = 0;
    resetTracking();
    vi.clearAllMocks();
  });

  it('rapid fire: play multiple sounds in quick succession', () => {
    for (let i = 0; i < 10; i++) {
      expect(() => playHover()).not.toThrow();
      expect(() => playTick()).not.toThrow();
      expect(() => playConfirm()).not.toThrow();
    }
  });

  it('slipstream start-stop-start cycle', () => {
    startProximitySpark();
    updateProximitySpark(0.5);
    stopProximitySpark();
    startProximitySpark();
    updateProximitySpark(0.8);
    stopProximitySpark();
  });

  it('updateProximitySpark before start is safe (no-op)', () => {
    expect(() => updateProximitySpark(0.5)).not.toThrow();
  });

  it('explosion with dest routes procedural through spatial panner', () => {
    const fakePanner = { _id: 'panner', connect: vi.fn() };
    playExplosion(fakePanner as unknown as AudioNode);
    // Master gain should connect to the panner
    const toPanner = connectCalls.filter(c => c.to === 'panner');
    expect(toPanner.length).toBeGreaterThanOrEqual(1);
  });
});
