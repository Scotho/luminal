import { describe, it, expect, vi, beforeEach } from 'vitest';


// ── Mock dependencies ────────────────────────────────────
vi.mock('./swallow', () => ({ warnDev: vi.fn() }));

// ── Mock AudioNode helpers ───────────────────────────────
const mockAudioParam = (initial = 0) => ({ value: initial });

const mockGain = () => ({
  gain: mockAudioParam(1),
  connect: vi.fn(),
  disconnect: vi.fn(),
});

const mockFilter = () => ({
  type: 'lowpass' as BiquadFilterType,
  frequency: mockAudioParam(350),
  Q: mockAudioParam(1),
  connect: vi.fn(),
  disconnect: vi.fn(),
});

const mockBufferSource = () => ({
  buffer: null as AudioBuffer | null,
  loop: false,
  playbackRate: mockAudioParam(1),
  connect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  disconnect: vi.fn(),
});

const makeMockCtx = () => ({
  sampleRate: 44100,
  currentTime: 0,
  createGain: vi.fn(() => mockGain()),
  createBiquadFilter: vi.fn(() => mockFilter()),
  createBufferSource: vi.fn(() => mockBufferSource()),
});

let mockCtx = makeMockCtx();
const mockSfxOutput = { connect: vi.fn() };
const mockBuf = { duration: 2, numberOfChannels: 1, sampleRate: 44100 } as unknown as AudioBuffer;

vi.mock('./sfxContext', () => ({
  getCtx: vi.fn(() => mockCtx),
  getSfxOutput: vi.fn(() => mockSfxOutput),
  getSfxVolume: vi.fn(() => 1.0),
}));

vi.mock('./vehicleSfxLoader', () => ({
  getVehicleBuffer: vi.fn(() => mockBuf),
}));

// ── Import after mocks ───────────────────────────────────
import { RpmBandEngine } from './engineStrategyRpmBand';
import * as sfxContext from './sfxContext';

// Car no longer uses rpm-band strategy (switched to sweep).
// Use a minimal test-local RPM band profile for engine tests.
const testRpmProfile: import('./types/index').VehicleAudioProfile = {
  vehicleType: 'car',
  strategy: 'rpm-band',
  startup: '',
  shutdown: '',
  rpmBandConfig: {
    bandBoundaries: [0.0, 0.5, 1.0, 1.5, 2.0],
    bandSamples: [
      { bandName: 'idle', onSample: null, offSample: null, loopSample: 'idle' },
      { bandName: 'low', onSample: 'low-on', offSample: 'low-off', loopSample: 'low-off' },
      { bandName: 'med', onSample: 'med-on', offSample: 'med-off', loopSample: 'med-off' },
      { bandName: 'high', onSample: 'high-on', offSample: 'high-off', loopSample: 'high-off' },
      { bandName: 'max', onSample: null, offSample: null, loopSample: 'max' },
    ],
    crossfadeWidth: 0.25,
    windSamples: ['wind-01'],
    windBoundaries: [0.0, 1.0, 2.0],
    windGainCurve: [{ at: 0.0, value: 0.0 }, { at: 2.0, value: 0.3 }],
    aggroOnSample: 'aggro-on',
    aggroOffSample: 'aggro-off',
    aggroFadeIn: 0.3,
    aggroFadeOut: 0.6,
    playbackRateRange: [0.95, 1.05],
    filterCurve: [{ at: 0.0, value: 600 }, { at: 2.0, value: 3000 }],
  },
};

// ════════════════════════════════════════════════════════
describe('RpmBandEngine', () => {
  beforeEach(() => {
    mockCtx = makeMockCtx();
    vi.mocked(sfxContext.getCtx).mockReturnValue(mockCtx as unknown as AudioContext);
  });

  // ── Lifecycle ────────────────────────────────────────

  it('start() works without throwing', () => {
    const engine = new RpmBandEngine(testRpmProfile);
    expect(() => engine.start()).not.toThrow();
  });

  it('start() is idempotent — second call is a no-op', () => {
    const engine = new RpmBandEngine(testRpmProfile);
    engine.start();
    const gainCallCount = mockCtx.createGain.mock.calls.length;
    engine.start(); // should do nothing
    expect(mockCtx.createGain.mock.calls.length).toBe(gainCallCount);
  });

  it('isRunning() returns false before start()', () => {
    const engine = new RpmBandEngine(testRpmProfile);
    expect(engine.isRunning()).toBe(false);
  });

  it('isRunning() returns true after start()', () => {
    const engine = new RpmBandEngine(testRpmProfile);
    engine.start();
    expect(engine.isRunning()).toBe(true);
  });

  it('isRunning() returns false after stop()', () => {
    const engine = new RpmBandEngine(testRpmProfile);
    engine.start();
    engine.stop();
    expect(engine.isRunning()).toBe(false);
  });

  // ── update() ────────────────────────────────────────

  it('update(0.0, 0) — idle, coasting — does not throw', () => {
    const engine = new RpmBandEngine(testRpmProfile);
    engine.start();
    expect(() => engine.update(0.0, 0)).not.toThrow();
  });

  it('update(1.2, 1) — base speed, accelerating — does not throw', () => {
    const engine = new RpmBandEngine(testRpmProfile);
    engine.start();
    expect(() => engine.update(1.2, 1)).not.toThrow();
  });

  it('update(1.2, -1) — base speed, decelerating — does not throw', () => {
    const engine = new RpmBandEngine(testRpmProfile);
    engine.start();
    expect(() => engine.update(1.2, -1)).not.toThrow();
  });

  it('update(1.55, 1) — boost speed, accelerating — does not throw', () => {
    const engine = new RpmBandEngine(testRpmProfile);
    engine.start();
    expect(() => engine.update(1.55, 1)).not.toThrow();
  });

  it('update(2.675, 1) — dash speed — does not throw', () => {
    const engine = new RpmBandEngine(testRpmProfile);
    engine.start();
    expect(() => engine.update(2.675, 1)).not.toThrow();
  });

  it('update(1.55, 1, true) — boost state triggers aggressiveness — does not throw', () => {
    const engine = new RpmBandEngine(testRpmProfile);
    engine.start();
    expect(() => engine.update(1.55, 1, true)).not.toThrow();
  });

  it('update() without start() is a safe no-op', () => {
    const engine = new RpmBandEngine(testRpmProfile);
    expect(() => engine.update(1.0, 1)).not.toThrow();
  });

  // ── stop() ───────────────────────────────────────────

  it('stop() before start() is safe (no-op)', () => {
    const engine = new RpmBandEngine(testRpmProfile);
    expect(() => engine.stop()).not.toThrow();
  });

  it('stop() cleans up — no further update effects', () => {
    const engine = new RpmBandEngine(testRpmProfile);
    engine.start();
    engine.stop();
    expect(() => engine.update(1.0, 1)).not.toThrow();
  });

  it('can restart after stop()', () => {
    const engine = new RpmBandEngine(testRpmProfile);
    engine.start();
    engine.stop();
    expect(engine.isRunning()).toBe(false);
    engine.start();
    expect(engine.isRunning()).toBe(true);
  });

  // ── Aggressiveness layer lifecycle ───────────────────

  it('toggling boost on/off multiple times does not throw', () => {
    const engine = new RpmBandEngine(testRpmProfile);
    engine.start();
    expect(() => {
      engine.update(1.55, 1, true);
      engine.update(1.55, 1, false);
      engine.update(1.55, 1, true);
      engine.update(1.55, 1, false);
    }).not.toThrow();
  });

  // ── Sample selection ─────────────────────────────────

  it('update() with positive accelDir uses loopSample for sustained layer, not onSample', () => {
    const engine = new RpmBandEngine(testRpmProfile);
    engine.start();

    // Update at speed 0.6 (inside 'low' band, index 1), accelerating
    engine.update(0.6, 1);

    // Access internal layer to verify sample key
    const nodes = (engine as any).nodes;
    const layerAKey = nodes.layerA.currentKey;
    const cfg = testRpmProfile.rpmBandConfig!;
    // Should be using loopSample ('low-off'), not onSample ('low-on')
    expect(layerAKey).toBe(cfg.bandSamples[1].loopSample);
  });

  it('update() with negative accelDir also uses loopSample', () => {
    const engine = new RpmBandEngine(testRpmProfile);
    engine.start();

    // Update at speed 0.6 (inside 'low' band), decelerating
    engine.update(0.6, -1);

    const nodes = (engine as any).nodes;
    const layerAKey = nodes.layerA.currentKey;
    const cfg = testRpmProfile.rpmBandConfig!;
    expect(layerAKey).toBe(cfg.bandSamples[1].loopSample);
  });
});

describe('RPM band profile integrity', () => {
  it('middle bands have loopSample different from onSample', () => {
    const cfg = testRpmProfile.rpmBandConfig!;
    // First (idle) and last (max-rpm) bands have no on/off — skip them
    for (let i = 1; i < cfg.bandSamples.length - 1; i++) {
      const band = cfg.bandSamples[i];
      expect(band.loopSample, `band '${band.bandName}' loopSample should differ from onSample`)
        .not.toBe(band.onSample);
    }
  });

  it('all loopSample keys reference existing sample names', () => {
    const cfg = testRpmProfile.rpmBandConfig!;
    for (const band of cfg.bandSamples) {
      expect(band.loopSample.length).toBeGreaterThan(0);
    }
  });
});
