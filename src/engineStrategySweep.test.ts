import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getVehicleAudioProfile } from './vehicleAudioProfiles';

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
  createGain: vi.fn(() => mockGain()),
  createBiquadFilter: vi.fn(() => mockFilter()),
  createBufferSource: vi.fn(() => mockBufferSource()),
});

let mockCtx = makeMockCtx();
const mockSfxOutput = { connect: vi.fn() };
const mockNoiseBuf = { duration: 3, numberOfChannels: 1, sampleRate: 44100 } as unknown as AudioBuffer;
const mockIdleBuf = { duration: 2, numberOfChannels: 1, sampleRate: 44100 } as unknown as AudioBuffer;
const mockSweepBuf = { duration: 5, numberOfChannels: 1, sampleRate: 44100 } as unknown as AudioBuffer;

vi.mock('./sfxContext', () => ({
  getCtx: vi.fn(() => mockCtx),
  getSfxOutput: vi.fn(() => mockSfxOutput),
  getSfxVolume: vi.fn(() => 1.0),
  noiseBuf: vi.fn(() => mockNoiseBuf),
}));

vi.mock('./vehicleSfxLoader', () => ({
  getVehicleBuffer: vi.fn((vehicleType: string, sampleKey: string) => {
    if (sampleKey === 'idle') return mockIdleBuf;
    if (sampleKey === 'speed-sweep') return mockSweepBuf;
    return null;
  }),
}));

// ── Import after mocks ───────────────────────────────────
import { SweepEngine } from './engineStrategySweep';
import * as sfxContext from './sfxContext';

// ── Get real bike profile ────────────────────────────────
const bikeProfile = getVehicleAudioProfile('bike');

// ════════════════════════════════════════════════════════
describe('SweepEngine', () => {
  beforeEach(() => {
    mockCtx = makeMockCtx();
    vi.mocked(sfxContext.getCtx).mockReturnValue(mockCtx as unknown as AudioContext);
  });

  // ── Lifecycle ────────────────────────────────────────

  it('start() works without throwing', () => {
    const engine = new SweepEngine(bikeProfile);
    expect(() => engine.start()).not.toThrow();
  });

  it('start() is idempotent — second call is a no-op', () => {
    const engine = new SweepEngine(bikeProfile);
    engine.start();
    const gainCallCount = mockCtx.createGain.mock.calls.length;
    engine.start(); // should do nothing
    expect(mockCtx.createGain.mock.calls.length).toBe(gainCallCount);
  });

  it('isRunning() returns false before start()', () => {
    const engine = new SweepEngine(bikeProfile);
    expect(engine.isRunning()).toBe(false);
  });

  it('isRunning() returns true after start()', () => {
    const engine = new SweepEngine(bikeProfile);
    engine.start();
    expect(engine.isRunning()).toBe(true);
  });

  it('isRunning() returns false after stop()', () => {
    const engine = new SweepEngine(bikeProfile);
    engine.start();
    engine.stop();
    expect(engine.isRunning()).toBe(false);
  });

  // ── update() ────────────────────────────────────────

  it('update(0.0) — idle speed — does not throw', () => {
    const engine = new SweepEngine(bikeProfile);
    engine.start();
    expect(() => engine.update(0.0)).not.toThrow();
  });

  it('update(1.625) — boost speed — does not throw', () => {
    const engine = new SweepEngine(bikeProfile);
    engine.start();
    expect(() => engine.update(1.625)).not.toThrow();
  });

  it('update(2.5) — dash speed — does not throw', () => {
    const engine = new SweepEngine(bikeProfile);
    engine.start();
    expect(() => engine.update(2.5)).not.toThrow();
  });

  // ── stop() ───────────────────────────────────────────

  it('stop() before start() is safe (no-op)', () => {
    const engine = new SweepEngine(bikeProfile);
    expect(() => engine.stop()).not.toThrow();
  });

  it('stop() cleans up — nodes become null (no further update effects)', () => {
    const engine = new SweepEngine(bikeProfile);
    engine.start();
    engine.stop();
    expect(() => engine.update(1.0)).not.toThrow();
  });

  it('can restart after stop()', () => {
    const engine = new SweepEngine(bikeProfile);
    engine.start();
    engine.stop();
    expect(engine.isRunning()).toBe(false);
    engine.start();
    expect(engine.isRunning()).toBe(true);
  });
});
