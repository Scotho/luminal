import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock dependencies ────────────────────────────────────
vi.mock('./swallow', () => ({ warnDev: vi.fn() }));

// ── Stub Web Audio API globals missing from jsdom ────────
class MockGainNode {}
vi.stubGlobal('GainNode', MockGainNode);

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
  duration: 2,
  numberOfChannels: 1,
  sampleRate: 44100,
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
  createOscillator: vi.fn(() => mockOscillator()),
  createGain: vi.fn(() => mockGain()),
  createBiquadFilter: vi.fn(() => mockFilter()),
  createBufferSource: vi.fn(() => mockBufferSource()),
  createBuffer: vi.fn(() => mockBuffer()),
});

let mockCtx = makeMockCtx();
const mockSfxOutput = { connect: vi.fn() };
const mockAudioBuf = { duration: 2, numberOfChannels: 1, sampleRate: 44100 } as unknown as AudioBuffer;

vi.mock('./sfxContext', () => ({
  getCtx: vi.fn(() => mockCtx),
  getSfxOutput: vi.fn(() => mockSfxOutput),
  getSfxVolume: vi.fn(() => 1.0),
  noiseBuf: vi.fn(() => mockAudioBuf),
}));

vi.mock('./vehicleSfxLoader', () => ({
  getVehicleBuffer: vi.fn(() => mockAudioBuf),
}));

// ── Import after mocks ───────────────────────────────────
import {
  startVehicleEngine,
  updateVehicleEngine,
  stopVehicleEngine,
  getActiveVehicleType,
  fadeOutVehicleEngine,
} from './vehicleAudioEngine';
import * as sfxContext from './sfxContext';

// ════════════════════════════════════════════════════════
describe('vehicleAudioEngine (dispatcher)', () => {
  beforeEach(() => {
    // Clean up any lingering engine state between tests
    stopVehicleEngine();
    mockCtx = makeMockCtx();
    vi.mocked(sfxContext.getCtx).mockReturnValue(mockCtx as unknown as AudioContext);
  });

  // ── Vehicle startup ──────────────────────────────────

  it('starts hoverboard (procedural) without throwing', () => {
    expect(() => startVehicleEngine('hoverboard')).not.toThrow();
  });

  it('starts bike (sweep) without throwing', () => {
    expect(() => startVehicleEngine('bike')).not.toThrow();
  });

  it('starts car (rpm-band) without throwing', () => {
    expect(() => startVehicleEngine('car')).not.toThrow();
  });

  // ── updateVehicleEngine ──────────────────────────────

  it('updateVehicleEngine(1.5) after start does not throw', () => {
    startVehicleEngine('hoverboard');
    expect(() => updateVehicleEngine(1.5)).not.toThrow();
  });

  it('updateVehicleEngine(1.5, true) with boosting flag does not throw', () => {
    startVehicleEngine('car');
    expect(() => updateVehicleEngine(1.5, true)).not.toThrow();
  });

  it('updateVehicleEngine before start is a no-op (does not throw)', () => {
    // engine was stopped in beforeEach, so no active strategy
    expect(() => updateVehicleEngine(1.0)).not.toThrow();
  });

  // ── stopVehicleEngine ────────────────────────────────

  it('stopVehicleEngine cleans up — getActiveVehicleType returns null', () => {
    startVehicleEngine('bike');
    expect(getActiveVehicleType()).toBe('bike');
    stopVehicleEngine();
    expect(getActiveVehicleType()).toBeNull();
  });

  it('double stop is safe (no throw)', () => {
    startVehicleEngine('hoverboard');
    stopVehicleEngine();
    expect(() => stopVehicleEngine()).not.toThrow();
  });

  // ── getActiveVehicleType ─────────────────────────────

  it('getActiveVehicleType returns null before start', () => {
    expect(getActiveVehicleType()).toBeNull();
  });

  it('getActiveVehicleType returns the started vehicle type', () => {
    startVehicleEngine('car');
    expect(getActiveVehicleType()).toBe('car');
  });

  // ── Vehicle switching ────────────────────────────────

  it('switching vehicles stops old and starts new', () => {
    startVehicleEngine('bike');
    expect(getActiveVehicleType()).toBe('bike');

    startVehicleEngine('car');
    expect(getActiveVehicleType()).toBe('car');
  });

  it('starting same vehicle twice is idempotent — no throw', () => {
    startVehicleEngine('hoverboard');
    expect(() => startVehicleEngine('hoverboard')).not.toThrow();
    expect(getActiveVehicleType()).toBe('hoverboard');
  });

  // ── accelDir derivation ──────────────────────────────

  it('derives accelDir correctly across sequential updates — no throw', () => {
    startVehicleEngine('car');
    // Accelerating
    expect(() => updateVehicleEngine(0.5)).not.toThrow();
    expect(() => updateVehicleEngine(1.0)).not.toThrow();
    // Decelerating
    expect(() => updateVehicleEngine(0.8)).not.toThrow();
    // Coasting
    expect(() => updateVehicleEngine(0.8)).not.toThrow();
  });

  // ── Optional dest parameter ──────────────────────────

  it('accepts optional dest AudioNode without throwing', () => {
    const fakeDest = { connect: vi.fn() } as unknown as AudioNode;
    expect(() => startVehicleEngine('hoverboard', fakeDest)).not.toThrow();
  });

  // ── fadeOutVehicleEngine ─────────────────────────────

  it('fadeOutVehicleEngine calls onComplete after duration', () => {
    vi.useFakeTimers();
    startVehicleEngine('bike');
    const cb = vi.fn();
    fadeOutVehicleEngine(0.3, cb);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(350); // 300ms + 50ms buffer
    expect(cb).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
