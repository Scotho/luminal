import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProceduralConfig } from './types/index';

// ── Mock dependencies ────────────────────────────────────
vi.mock('./swallow', () => ({ warnDev: vi.fn() }));

// ── Mock AudioNode helpers ───────────────────────────────
const mockAudioParam = (initial = 0) => ({ value: initial });

const mockOscillator = () => ({
  type: 'sine' as OscillatorType,
  frequency: mockAudioParam(440),
  connect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  disconnect: vi.fn(),
});

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

const mockBuffer = () => ({
  getChannelData: vi.fn(() => new Float32Array(44100 * 3)),
});

const mockBufferSource = () => ({
  buffer: null as AudioBuffer | null,
  loop: false,
  connect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  disconnect: vi.fn(),
});

const makeMockCtx = () => ({
  sampleRate: 44100,
  createOscillator: vi.fn(() => mockOscillator()),
  createGain: vi.fn(() => mockGain()),
  createBiquadFilter: vi.fn(() => mockFilter()),
  createBufferSource: vi.fn(() => mockBufferSource()),
  createBuffer: vi.fn(() => mockBuffer()),
});

let mockCtx = makeMockCtx();
const mockSfxOutput = { connect: vi.fn() };

vi.mock('./sfxContext', () => ({
  getCtx: vi.fn(() => mockCtx),
  getSfxOutput: vi.fn(() => mockSfxOutput),
  getSfxVolume: vi.fn(() => 1.0),
}));

// ── Import after mocks ───────────────────────────────────
import { ProceduralEngine } from './engineStrategyProcedural';
import * as sfxContext from './sfxContext';

// ── Fixture config (mirrors Hoverboard/Vector values) ───
const TEST_CONFIG: ProceduralConfig = {
  basePitchIdle: 55,
  basePitchScale: 35,
  lpFreqIdle: 200,
  lpFreqScale: 200,
  boostQ: 3.0,
  idleQ: 1.0,
  masterGainIdle: 0.04,
  masterGainScale: 0.06,
  noiseGainIdle: 0.01,
  noiseGainScale: 0.025,
  noiseBpFreqIdle: 200,
  noiseBpFreqScale: 400,
  harmonicGainIdle: 0.02,
  harmonicGainScale: 0.03,
  smoothing: 0.08,
};

// ════════════════════════════════════════════════════════
describe('ProceduralEngine', () => {
  beforeEach(() => {
    // Fresh mock context per test to avoid node reuse issues
    mockCtx = makeMockCtx();
    vi.mocked(sfxContext.getCtx).mockReturnValue(mockCtx as unknown as AudioContext);
  });

  // ── Lifecycle ────────────────────────────────────────

  it('start() works without throwing', () => {
    const engine = new ProceduralEngine(TEST_CONFIG);
    expect(() => engine.start()).not.toThrow();
  });

  it('start() creates oscillators, filters, gains, and a noise source', () => {
    const engine = new ProceduralEngine(TEST_CONFIG);
    engine.start();
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2);
    expect(mockCtx.createBiquadFilter).toHaveBeenCalledTimes(2);
    expect(mockCtx.createGain).toHaveBeenCalledTimes(3);
    expect(mockCtx.createBufferSource).toHaveBeenCalledTimes(1);
  });

  it('start() is idempotent — second call is a no-op', () => {
    const engine = new ProceduralEngine(TEST_CONFIG);
    engine.start();
    const oscCallCount = mockCtx.createOscillator.mock.calls.length;
    engine.start(); // should do nothing
    expect(mockCtx.createOscillator.mock.calls.length).toBe(oscCallCount);
  });

  it('isRunning() returns false before start()', () => {
    const engine = new ProceduralEngine(TEST_CONFIG);
    expect(engine.isRunning()).toBe(false);
  });

  it('isRunning() returns true after start()', () => {
    const engine = new ProceduralEngine(TEST_CONFIG);
    engine.start();
    expect(engine.isRunning()).toBe(true);
  });

  it('isRunning() returns false after stop()', () => {
    const engine = new ProceduralEngine(TEST_CONFIG);
    engine.start();
    engine.stop();
    expect(engine.isRunning()).toBe(false);
  });

  // ── stop() ───────────────────────────────────────────

  it('stop() before start() is safe (no-op)', () => {
    const engine = new ProceduralEngine(TEST_CONFIG);
    expect(() => engine.stop()).not.toThrow();
  });

  it('stop() cleans up — nodes become null (no further update effects)', () => {
    const engine = new ProceduralEngine(TEST_CONFIG);
    engine.start();
    engine.stop();
    // After stop, update should be a no-op (no throws, no node access)
    expect(() => engine.update(1.0)).not.toThrow();
  });

  it('can restart after stop()', () => {
    const engine = new ProceduralEngine(TEST_CONFIG);
    engine.start();
    engine.stop();
    expect(engine.isRunning()).toBe(false);
    engine.start();
    expect(engine.isRunning()).toBe(true);
  });

  // ── update() ────────────────────────────────────────

  it('update() before start() is a no-op (does not throw)', () => {
    const engine = new ProceduralEngine(TEST_CONFIG);
    expect(() => engine.update(0)).not.toThrow();
    expect(() => engine.update(1.0)).not.toThrow();
    expect(() => engine.update(1.5)).not.toThrow();
  });

  it('update(0) — idle speed — does not throw', () => {
    const engine = new ProceduralEngine(TEST_CONFIG);
    engine.start();
    expect(() => engine.update(0)).not.toThrow();
  });

  it('update(1.0) — base speed — does not throw', () => {
    const engine = new ProceduralEngine(TEST_CONFIG);
    engine.start();
    expect(() => engine.update(1.0)).not.toThrow();
  });

  it('update(1.5) — boost speed — does not throw', () => {
    const engine = new ProceduralEngine(TEST_CONFIG);
    engine.start();
    expect(() => engine.update(1.5)).not.toThrow();
  });

  it('update() nudges oscillator frequency toward target', () => {
    const engine = new ProceduralEngine(TEST_CONFIG);
    engine.start();

    // Capture the saw oscillator — it's the first createOscillator() call
    const sawNode = mockCtx.createOscillator.mock.results[0].value as ReturnType<typeof mockOscillator>;
    const initialFreq = sawNode.frequency.value;

    engine.update(1.0);

    // The value should have moved toward (basePitchIdle + 1.0 * basePitchScale)
    const target = TEST_CONFIG.basePitchIdle + 1.0 * TEST_CONFIG.basePitchScale;
    const updated = sawNode.frequency.value;
    // Should have moved from initial toward target (or be at target if initial === target)
    if (initialFreq !== target) {
      const distBefore = Math.abs(target - initialFreq);
      const distAfter = Math.abs(target - updated);
      expect(distAfter).toBeLessThanOrEqual(distBefore);
    }
  });

  it('update(>1.0) uses boostQ for filter resonance target', () => {
    const engine = new ProceduralEngine(TEST_CONFIG);
    engine.start();

    const filterNode = mockCtx.createBiquadFilter.mock.results[0].value as ReturnType<typeof mockFilter>;
    const qBefore = filterNode.Q.value;

    engine.update(1.5); // speedFactor > 1.0 → boostQ path

    // Q should have moved from its initial value toward boostQ (3.0)
    // i.e. the distance to boostQ should now be smaller than it was before the update
    const distToBoostBefore = Math.abs(TEST_CONFIG.boostQ - qBefore);
    const distToBoostAfter = Math.abs(TEST_CONFIG.boostQ - filterNode.Q.value);
    if (qBefore !== TEST_CONFIG.boostQ) {
      expect(distToBoostAfter).toBeLessThan(distToBoostBefore);
    }
  });

  // ── Optional dest parameter ──────────────────────────

  it('accepts an optional dest AudioNode and routes master.connect to it', () => {
    const engine = new ProceduralEngine(TEST_CONFIG);
    const fakeDest = { connect: vi.fn() } as unknown as AudioNode;
    engine.start(fakeDest);

    // master gain node is the last createGain() call — index 2
    const masterNode = mockCtx.createGain.mock.results[2].value as ReturnType<typeof mockGain>;
    // master.connect() should have been called with fakeDest
    expect(masterNode.connect).toHaveBeenCalledWith(fakeDest);
  });

  it('routes to sfxOutput when no dest is provided', () => {
    const engine = new ProceduralEngine(TEST_CONFIG);
    engine.start(); // no dest

    const masterNode = mockCtx.createGain.mock.results[2].value as ReturnType<typeof mockGain>;
    expect(masterNode.connect).toHaveBeenCalledWith(mockSfxOutput);
  });
});
