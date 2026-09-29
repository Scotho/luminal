import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// Mock AudioContext and its nodes
const mockGain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
const mockOsc = { type: '', frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
const mockBP = { type: '', frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), value: 0 }, Q: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };

const mockCtx = {
  currentTime: 0,
  state: 'running',
  resume: vi.fn(),
  destination: {},
  sampleRate: 44100,
  createGain: vi.fn(() => ({ ...mockGain })),
  createOscillator: vi.fn(() => ({ ...mockOsc })),
  createBiquadFilter: vi.fn(() => ({ ...mockBP })),
  createBuffer: vi.fn(() => ({ getChannelData: () => new Float32Array(4410) })),
  createBufferSource: vi.fn(() => ({ buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), loop: false })),
};

// getCtx() uses `new (window.AudioContext || window.webkitAudioContext)()`
// We need a real constructor function (not arrow fn) so `new` works.
// vi.stubGlobal is used so vitest automatically restores the originals after the file.
function MockAudioContextImpl(this: unknown) { return mockCtx; }
MockAudioContextImpl.prototype = {};
const MockAudioContextCtor = vi.fn(function MockAudioContext(this: unknown) { return mockCtx; });

vi.stubGlobal('AudioContext', MockAudioContextCtor);
vi.stubGlobal('webkitAudioContext', MockAudioContextCtor);

// Mock sfxAssets — playLobbyJoin now delegates to sample-based playUiJoin
const { mockPlayUiJoin } = vi.hoisted(() => ({ mockPlayUiJoin: vi.fn() }));
vi.mock('./sfxAssets', () => ({
  playExplosionSourced: vi.fn(),
  playUiForward: vi.fn(),
  playUiBack: vi.fn(),
  playUiJoin: mockPlayUiJoin,
  playUiBlip: vi.fn(),
  playUiTab: vi.fn(),
  playUiToggle: vi.fn(),
  playUiCtxAction: vi.fn(),
  playUiReadout: vi.fn(),
  playUiMatchmaking: vi.fn(),
  playUiMatchFound: vi.fn(),
  playUiSettings: vi.fn(),
  playUiSlipstream: vi.fn(),
}));

import { playChat, playLobbyJoin, playLobbyLeave, playError, playBoost, playDash, playSputter, playTurnSwoosh, playExplosion, playGrindSweetLockIn, playGrindChainExtend, playGrindMilestone, playGrindCashOut, playGrindBust } from './sfx';

describe('Procedural UI sounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('playChat creates an oscillator', () => {
    playChat();
    expect(mockCtx.createOscillator).toHaveBeenCalled();
    expect(mockCtx.createGain).toHaveBeenCalled();
  });

  it('playLobbyJoin delegates to sample-based playUiJoin', () => {
    playLobbyJoin();
    expect(mockPlayUiJoin).toHaveBeenCalled();
  });

  it('playLobbyLeave creates two oscillators for descending chime', () => {
    playLobbyLeave();
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('playError delegates to sample-based playUiBack', () => {
    playError();
    // playError now delegates to playUiBack (from sfxAssets), no direct oscillator creation
    expect(mockCtx.createOscillator).not.toHaveBeenCalled();
  });
});

// Engine sound tests removed — startEngine/updateEngine/stopEngine now delegate to
// vehicleAudioEngine. Engine behaviour is covered by:
//   - engineStrategyProcedural.test.ts
//   - engineStrategySweep.test.ts
//   - engineStrategyRpmBand.test.ts
//   - vehicleAudioEngine.test.ts

describe('Spatial dest param', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('playBoost connects to custom dest when provided', () => {
    // Create a unique sentinel object that cannot match the default sfx output
    const customDest = { __sentinel: true, connect: vi.fn(), disconnect: vi.fn() };
    playBoost(1.0, customDest as unknown as AudioNode);
    const gainCalls = mockCtx.createGain.mock.results;
    const masterGain = gainCalls[0].value;
    expect(masterGain.connect).toHaveBeenCalledWith(customDest);
  });

  it('playBoost connects to default output when no dest', () => {
    playBoost(1.0);
    const gainCalls = mockCtx.createGain.mock.results;
    const masterGain = gainCalls[0].value;
    expect(masterGain.connect).toHaveBeenCalled();
  });
});

// ── SPEC-82 grind cue smoke tests ─────────────────────
describe('SPEC-82 grind cue functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('playGrindSweetLockIn runs without throwing', () => {
    expect(() => playGrindSweetLockIn()).not.toThrow();
  });

  it('playGrindChainExtend runs without throwing', () => {
    expect(() => playGrindChainExtend()).not.toThrow();
  });

  it('playGrindMilestone runs without throwing for each tier', () => {
    for (let tier = 0; tier < 4; tier++) {
      expect(() => playGrindMilestone(tier)).not.toThrow();
    }
  });

  it('playGrindCashOut runs without throwing', () => {
    expect(() => playGrindCashOut(500)).not.toThrow();
  });

  it('playGrindBust runs without throwing', () => {
    expect(() => playGrindBust()).not.toThrow();
  });
});
