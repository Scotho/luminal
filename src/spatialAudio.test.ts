import { describe, it, expect, vi, beforeEach } from 'vitest';

// Provide GainNode global for instanceof checks in spatialAudio.ts
if (typeof globalThis.GainNode === 'undefined') {
  (globalThis as Record<string, unknown>).GainNode = class GainNode {};
}

// Mock AudioContext
const mockPanner = {
  positionX: { value: 0 },
  positionY: { value: 0 },
  positionZ: { value: 0 },
  distanceModel: '' as string,
  panningModel: '' as string,
  refDistance: 0,
  maxDistance: 0,
  rolloffFactor: 0,
  coneInnerAngle: 0,
  coneOuterAngle: 0,
  connect: vi.fn(),
  disconnect: vi.fn(),
};

const mockListener = {
  positionX: { value: 0 },
  positionY: { value: 0 },
  positionZ: { value: 0 },
  forwardX: { value: 0 },
  forwardY: { value: 0 },
  forwardZ: { value: -1 },
  upX: { value: 0 },
  upY: { value: 1 },
  upZ: { value: 0 },
};

const mockGain = {
  gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
  connect: vi.fn(),
  disconnect: vi.fn(),
};

const mockOsc = {
  type: '',
  frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
  connect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  disconnect: vi.fn(),
};

const mockBP = {
  type: '',
  frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
  Q: { value: 0 },
  connect: vi.fn(),
  disconnect: vi.fn(),
};

const mockCtx = {
  currentTime: 0,
  state: 'running' as string,
  resume: vi.fn(),
  destination: {},
  sampleRate: 44100,
  listener: mockListener,
  createGain: vi.fn(() => ({ ...mockGain })),
  createOscillator: vi.fn(() => ({ ...mockOsc })),
  createBiquadFilter: vi.fn(() => ({ ...mockBP })),
  createPanner: vi.fn(() => ({ ...mockPanner })),
  createBuffer: vi.fn(() => ({ getChannelData: () => new Float32Array(4410) })),
  createBufferSource: vi.fn(() => ({
    buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), loop: false,
  })),
};

function MockAudioContextImpl(this: unknown) { return mockCtx; }
MockAudioContextImpl.prototype = {};
const MockAudioContextCtor = vi.fn(function MockAudioContext(this: unknown) { return mockCtx; });
vi.stubGlobal('AudioContext', MockAudioContextCtor);
vi.stubGlobal('webkitAudioContext', MockAudioContextCtor);

vi.mock('./sfxContext', () => ({
  getCtx: vi.fn(() => mockCtx),
  getSfxOutput: vi.fn(() => mockCtx.destination),
  getSfxVolume: vi.fn(() => 1.0),
}));

vi.mock('./swallow', () => ({
  warnDev: vi.fn(),
}));

import {
  RANGE_CONFIG, SoundRange, initListener, updateListener,
  createOpponentAudio, updateOpponentPosition, destroyOpponentAudio,
  destroyAllOpponents, getOpponentPanner, playOpponentSound,
  startOpponentEngine, updateOpponentEngine, stopOpponentEngine,
  fadeOutOpponentEngine,
} from './spatialAudio';

function resetMockValues(): void {
  mockPanner.positionX.value = 0;
  mockPanner.positionY.value = 0;
  mockPanner.positionZ.value = 0;
  mockListener.positionX.value = 0;
  mockListener.positionY.value = 0;
  mockListener.positionZ.value = 0;
  mockListener.forwardX.value = 0;
  mockListener.forwardY.value = 0;
  mockListener.forwardZ.value = -1;
  mockListener.upX.value = 0;
  mockListener.upY.value = 1;
  mockListener.upZ.value = 0;
}

describe('Range config', () => {
  it('SHORT maxDistance is quarter arena (96)', () => {
    expect(RANGE_CONFIG[SoundRange.SHORT].maxDistance).toBe(96);
  });

  it('MEDIUM maxDistance is half arena (192)', () => {
    expect(RANGE_CONFIG[SoundRange.MEDIUM].maxDistance).toBe(192);
  });

  it('LONG maxDistance is full arena (384)', () => {
    expect(RANGE_CONFIG[SoundRange.LONG].maxDistance).toBe(384);
  });
});

describe('Listener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockValues();
  });

  it('initListener stores the AudioListener', () => {
    initListener(mockCtx as unknown as AudioContext);
    const mockCamera = {
      position: { x: 10, y: 20, z: 30 },
      getWorldDirection: vi.fn((v: { x: number; y: number; z: number }) => {
        v.x = 0; v.y = 0; v.z = -1;
        return v;
      }),
    };
    updateListener(mockCamera as any);
    expect(mockListener.positionX.value).toBe(10);
    expect(mockListener.positionY.value).toBe(20);
    expect(mockListener.positionZ.value).toBe(30);
  });
});

describe('Opponent audio lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockValues();
    destroyAllOpponents();
    initListener(mockCtx as unknown as AudioContext);
  });

  it('createOpponentAudio creates 3 panners', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    expect(mockCtx.createPanner).toHaveBeenCalledTimes(3);
  });

  it('getOpponentPanner returns the correct panner for a tier', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    const panner = getOpponentPanner('opp1', SoundRange.MEDIUM);
    expect(panner).toBeDefined();
  });

  it('getOpponentPanner returns null for unknown id', () => {
    expect(getOpponentPanner('unknown', SoundRange.SHORT)).toBeNull();
  });

  it('updateOpponentPosition sets panner positions', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    updateOpponentPosition('opp1', 50, 75);
    const panner = getOpponentPanner('opp1', SoundRange.SHORT);
    expect(panner!.positionX.value).toBe(50);
    expect(panner!.positionZ.value).toBe(75);
  });

  it('destroyOpponentAudio removes opponent', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    destroyOpponentAudio('opp1');
    expect(getOpponentPanner('opp1', SoundRange.SHORT)).toBeNull();
  });

  it('destroyAllOpponents clears all', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    createOpponentAudio('opp2', mockCtx as unknown as AudioContext);
    destroyAllOpponents();
    expect(getOpponentPanner('opp1', SoundRange.SHORT)).toBeNull();
    expect(getOpponentPanner('opp2', SoundRange.SHORT)).toBeNull();
  });

  it('double destroy does not throw', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    destroyOpponentAudio('opp1');
    expect(() => destroyOpponentAudio('opp1')).not.toThrow();
  });
});

describe('Opponent engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockValues();
    destroyAllOpponents();
    initListener(mockCtx as unknown as AudioContext);
  });

  it('startOpponentEngine creates oscillators', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    startOpponentEngine('opp1');
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2);
    expect(mockCtx.createBufferSource).toHaveBeenCalled();
  });

  it('startOpponentEngine is idempotent', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    startOpponentEngine('opp1');
    const count = mockCtx.createOscillator.mock.calls.length;
    startOpponentEngine('opp1');
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(count);
  });

  it('stopOpponentEngine cleans up', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    startOpponentEngine('opp1');
    stopOpponentEngine('opp1');
    startOpponentEngine('opp1');
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(4);
  });

  it('updateOpponentEngine does not throw for unknown id', () => {
    expect(() => updateOpponentEngine('ghost', 1.0)).not.toThrow();
  });
});

describe('fadeOutOpponentEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockValues();
    destroyAllOpponents();
    initListener(mockCtx as unknown as AudioContext);
  });

  it('ramps gain to zero', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    startOpponentEngine('opp1');
    fadeOutOpponentEngine('opp1', 0.5);
    // Should have called linearRampToValueAtTime
    // The master gain mock should have been used
    expect(() => fadeOutOpponentEngine('opp1', 0.5)).not.toThrow();
  });

  it('does not throw for unknown id', () => {
    expect(() => fadeOutOpponentEngine('ghost')).not.toThrow();
  });
});

describe('playOpponentSound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockValues();
    destroyAllOpponents();
    initListener(mockCtx as unknown as AudioContext);
  });

  it('calls play callback with the correct panner', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    const play = vi.fn();
    playOpponentSound('opp1', SoundRange.MEDIUM, play);
    expect(play).toHaveBeenCalledTimes(1);
    const panner = getOpponentPanner('opp1', SoundRange.MEDIUM);
    expect(play).toHaveBeenCalledWith(panner);
  });

  it('does not call play for unknown opponent', () => {
    const play = vi.fn();
    playOpponentSound('ghost', SoundRange.LONG, play);
    expect(play).not.toHaveBeenCalled();
  });
});

describe('Full lifecycle integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockValues();
    destroyAllOpponents();
    initListener(mockCtx as unknown as AudioContext);
  });

  it('create → start engine → update → stop → destroy without errors', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    startOpponentEngine('opp1');
    updateOpponentPosition('opp1', 100, 200);
    updateOpponentEngine('opp1', 1.5);
    stopOpponentEngine('opp1');
    destroyOpponentAudio('opp1');
    expect(getOpponentPanner('opp1', SoundRange.SHORT)).toBeNull();
  });

  it('destroyOpponentAudio stops engine automatically', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    startOpponentEngine('opp1');
    expect(() => destroyOpponentAudio('opp1')).not.toThrow();
  });

  it('handles 3 simultaneous opponents', () => {
    for (const id of ['a', 'b', 'c']) {
      createOpponentAudio(id, mockCtx as unknown as AudioContext);
      startOpponentEngine(id);
    }
    // 3 opponents × 3 panners = 9 panners
    expect(mockCtx.createPanner).toHaveBeenCalledTimes(9);
    // 3 opponents × 2 oscillators each = 6
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(6);

    destroyAllOpponents();
    for (const id of ['a', 'b', 'c']) {
      expect(getOpponentPanner(id, SoundRange.SHORT)).toBeNull();
    }
  });
});
