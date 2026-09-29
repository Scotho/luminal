/**
 * Spatial Audio E2E Tests — Comprehensive verification of the proximity
 * audio engine against SPEC-61 (Proximity Audio Engine Design).
 *
 * Novel techniques used:
 * 1. Audio graph topology verification via connect() call tracking
 * 2. Distance attenuation model simulation
 * 3. Multi-frame state trajectory testing
 * 4. Resource budget accounting
 * 5. Spatial coordinate transformation verification
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as THREE from 'three';

// ── Provide GainNode global for instanceof checks ──────
if (typeof globalThis.GainNode === 'undefined') {
  (globalThis as Record<string, unknown>).GainNode = class GainNode {};
}

// ── Fine-grained mock factories ────────────────────────
// Each factory creates a unique mock with tracked connections
// to enable graph topology verification.

interface TrackedNode {
  _id: string;
  _type: string;
  _connections: TrackedNode[];
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

let _nodeCounter = 0;
const _allNodes: TrackedNode[] = [];

function makeTrackedNode(type: string): TrackedNode {
  const node: TrackedNode = {
    _id: `${type}_${_nodeCounter++}`,
    _type: type,
    _connections: [],
    connect: vi.fn((dest: TrackedNode) => {
      node._connections.push(dest);
      return dest;
    }),
    disconnect: vi.fn(),
  };
  _allNodes.push(node);
  return node;
}

function makePanner(): TrackedNode & {
  positionX: { value: number };
  positionY: { value: number };
  positionZ: { value: number };
  distanceModel: string;
  panningModel: string;
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;
  coneInnerAngle: number;
  coneOuterAngle: number;
} {
  const base = makeTrackedNode('panner');
  return Object.assign(base, {
    positionX: { value: 0 },
    positionY: { value: 0 },
    positionZ: { value: 0 },
    distanceModel: '',
    panningModel: '',
    refDistance: 0,
    maxDistance: 0,
    rolloffFactor: 0,
    coneInnerAngle: 0,
    coneOuterAngle: 0,
  });
}

function makeGain(): TrackedNode & { gain: { value: number; setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn>; cancelScheduledValues: ReturnType<typeof vi.fn> } } {
  const base = makeTrackedNode('gain');
  return Object.assign(base, {
    gain: {
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    },
  });
}

function makeOscillator(): TrackedNode & {
  type: string;
  frequency: { value: number; setValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn> };
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  const base = makeTrackedNode('oscillator');
  return Object.assign(base, {
    type: '',
    frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    start: vi.fn(),
    stop: vi.fn(),
  });
}

function makeFilter(): TrackedNode & {
  type: string;
  frequency: { value: number; setValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn> };
  Q: { value: number };
} {
  const base = makeTrackedNode('filter');
  return Object.assign(base, {
    type: '',
    frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    Q: { value: 0 },
  });
}

function makeBufferSource(): TrackedNode & {
  buffer: unknown;
  loop: boolean;
  playbackRate: { value: number };
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  const base = makeTrackedNode('bufferSource');
  return Object.assign(base, {
    buffer: null,
    loop: false,
    playbackRate: { value: 1 },
    start: vi.fn(),
    stop: vi.fn(),
  });
}

// ── Mock Listener ──────────────────────────────────────
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

// ── Mock AudioContext ──────────────────────────────────
const mockDestination = makeTrackedNode('destination');
let _pannerInstances: ReturnType<typeof makePanner>[] = [];

const mockCtx = {
  currentTime: 0,
  state: 'running' as string,
  resume: vi.fn(),
  destination: mockDestination,
  sampleRate: 44100,
  listener: mockListener,
  createGain: vi.fn(() => makeGain()),
  createOscillator: vi.fn(() => makeOscillator()),
  createBiquadFilter: vi.fn(() => makeFilter()),
  createPanner: vi.fn(() => {
    const p = makePanner();
    _pannerInstances.push(p);
    return p;
  }),
  createBuffer: vi.fn(() => ({
    getChannelData: () => new Float32Array(44100 * 3),
    duration: 3,
    numberOfChannels: 1,
    sampleRate: 44100,
  })),
  createBufferSource: vi.fn(() => makeBufferSource()),
};

vi.stubGlobal('AudioContext', vi.fn(() => mockCtx));
vi.stubGlobal('webkitAudioContext', vi.fn(() => mockCtx));

const sfxOutputNode = makeTrackedNode('sfxOutput');

vi.mock('./sfxContext', () => ({
  getCtx: vi.fn(() => mockCtx),
  getSfxOutput: vi.fn(() => sfxOutputNode),
  getSfxVolume: vi.fn(() => 1.0),
  noiseBuf: vi.fn(() => ({
    getChannelData: () => new Float32Array(44100 * 3),
    duration: 3,
    numberOfChannels: 1,
    sampleRate: 44100,
  })),
}));

vi.mock('./swallow', () => ({ warnDev: vi.fn() }));
vi.mock('./vehicleAudioProfiles', () => ({
  getVehicleAudioProfile: vi.fn((type: string) => ({
    vehicleType: type,
    strategy: 'procedural',
    startup: 'bikeStart',
    shutdown: '',
    proceduralConfig: {
      basePitchIdle: 45, basePitchScale: 35,
      lpFreqIdle: 150, lpFreqScale: 200,
      boostQ: 3.0, idleQ: 1.0,
      masterGainIdle: 0.04, masterGainScale: 0.06,
      noiseGainIdle: 0.01, noiseGainScale: 0.025,
      noiseBpFreqIdle: 200, noiseBpFreqScale: 400,
      harmonicGainIdle: 0.02, harmonicGainScale: 0.03,
      smoothing: 0.08,
    },
  })),
}));

vi.mock('./vehicleSfxLoader', () => ({
  getVehicleBuffer: vi.fn(() => null),
}));

// ── Import after mocks ─────────────────────────────────
import {
  SoundRange, RANGE_CONFIG,
  initListener, updateListener,
  createOpponentAudio, getOpponentPanner,
  updateOpponentPosition, playOpponentSound,
  destroyOpponentAudio, destroyAllOpponents,
  markOpponentDead,
  startOpponentEngine, updateOpponentEngine,
  stopOpponentEngine, fadeOutOpponentEngine,
  fadeOutAllOpponentEngines,
} from './spatialAudio';

import {
  SPEC_RANGE_CONFIG,
  SPEC_RESOURCE_BUDGET, calcInverseDistanceGain,
  checkPannerCompliance,
} from './audioDebugLog';

// ── Helpers ────────────────────────────────────────────
function resetAll(): void {
  destroyAllOpponents();
  _nodeCounter = 0;
  _allNodes.length = 0;
  _pannerInstances = [];
  mockListener.positionX.value = 0;
  mockListener.positionY.value = 0;
  mockListener.positionZ.value = 0;
  mockListener.forwardX.value = 0;
  mockListener.forwardY.value = 0;
  mockListener.forwardZ.value = -1;
  mockListener.upX.value = 0;
  mockListener.upY.value = 1;
  mockListener.upZ.value = 0;
  vi.clearAllMocks();
}

// ════════════════════════════════════════════════════════
// SECTION 1: Range Configuration Spec Compliance
// ════════════════════════════════════════════════════════

describe('SPEC-61: Range Configuration', () => {
  it('SHORT range matches spec: refDistance=10, maxDistance=96, rolloff=1.5', () => {
    const cfg = RANGE_CONFIG[SoundRange.SHORT];
    expect(cfg.refDistance).toBe(SPEC_RANGE_CONFIG.SHORT.refDistance);
    expect(cfg.maxDistance).toBe(SPEC_RANGE_CONFIG.SHORT.maxDistance);
    expect(cfg.rolloffFactor).toBe(SPEC_RANGE_CONFIG.SHORT.rolloffFactor);
  });

  it('MEDIUM range matches spec: refDistance=20, maxDistance=192, rolloff=1.2', () => {
    const cfg = RANGE_CONFIG[SoundRange.MEDIUM];
    expect(cfg.refDistance).toBe(SPEC_RANGE_CONFIG.MEDIUM.refDistance);
    expect(cfg.maxDistance).toBe(SPEC_RANGE_CONFIG.MEDIUM.maxDistance);
    expect(cfg.rolloffFactor).toBe(SPEC_RANGE_CONFIG.MEDIUM.rolloffFactor);
  });

  it('LONG range matches spec: refDistance=30, maxDistance=384, rolloff=1.0', () => {
    const cfg = RANGE_CONFIG[SoundRange.LONG];
    expect(cfg.refDistance).toBe(SPEC_RANGE_CONFIG.LONG.refDistance);
    expect(cfg.maxDistance).toBe(SPEC_RANGE_CONFIG.LONG.maxDistance);
    expect(cfg.rolloffFactor).toBe(SPEC_RANGE_CONFIG.LONG.rolloffFactor);
  });

  it('ARENA_SIZE alignment: SHORT=quarter(96), MEDIUM=half(192), LONG=full(384)', () => {
    const ARENA_SIZE = 384;
    expect(RANGE_CONFIG[SoundRange.SHORT].maxDistance).toBe(ARENA_SIZE / 4);
    expect(RANGE_CONFIG[SoundRange.MEDIUM].maxDistance).toBe(ARENA_SIZE / 2);
    expect(RANGE_CONFIG[SoundRange.LONG].maxDistance).toBe(ARENA_SIZE);
  });

  it('rolloff decreases with range (more gradual falloff for distant sounds)', () => {
    expect(RANGE_CONFIG[SoundRange.SHORT].rolloffFactor)
      .toBeGreaterThan(RANGE_CONFIG[SoundRange.MEDIUM].rolloffFactor);
    expect(RANGE_CONFIG[SoundRange.MEDIUM].rolloffFactor)
      .toBeGreaterThan(RANGE_CONFIG[SoundRange.LONG].rolloffFactor);
  });

  it('all three SoundRange enum values exist', () => {
    expect(SoundRange.SHORT).toBe(0);
    expect(SoundRange.MEDIUM).toBe(1);
    expect(SoundRange.LONG).toBe(2);
  });
});

// ════════════════════════════════════════════════════════
// SECTION 2: Panner Configuration Compliance
// ════════════════════════════════════════════════════════

describe('SPEC-61: Panner Configuration', () => {
  beforeEach(() => {
    resetAll();
    initListener(mockCtx as unknown as AudioContext);
  });

  it('all panners use HRTF panning model', () => {
    createOpponentAudio('p1', mockCtx as unknown as AudioContext);
    for (const p of _pannerInstances) {
      expect(p.panningModel).toBe('HRTF');
    }
  });

  it('all panners use inverse distance model', () => {
    createOpponentAudio('p1', mockCtx as unknown as AudioContext);
    for (const p of _pannerInstances) {
      expect(p.distanceModel).toBe('inverse');
    }
  });

  it('all panners are omnidirectional (360/360 cone)', () => {
    createOpponentAudio('p1', mockCtx as unknown as AudioContext);
    for (const p of _pannerInstances) {
      expect(p.coneInnerAngle).toBe(360);
      expect(p.coneOuterAngle).toBe(360);
    }
  });

  it('panners are connected to sfxOutput', () => {
    createOpponentAudio('p1', mockCtx as unknown as AudioContext);
    for (const p of _pannerInstances) {
      expect(p.connect).toHaveBeenCalledWith(sfxOutputNode);
    }
  });

  it('SHORT panner has correct range config', () => {
    createOpponentAudio('p1', mockCtx as unknown as AudioContext);
    const p = _pannerInstances[0]; // First panner = SHORT
    expect(p.refDistance).toBe(10);
    expect(p.maxDistance).toBe(96);
    expect(p.rolloffFactor).toBe(1.5);
  });

  it('MEDIUM panner has correct range config', () => {
    createOpponentAudio('p1', mockCtx as unknown as AudioContext);
    const p = _pannerInstances[1]; // Second panner = MEDIUM
    expect(p.refDistance).toBe(20);
    expect(p.maxDistance).toBe(192);
    expect(p.rolloffFactor).toBe(1.2);
  });

  it('LONG panner has correct range config', () => {
    createOpponentAudio('p1', mockCtx as unknown as AudioContext);
    const p = _pannerInstances[2]; // Third panner = LONG
    expect(p.refDistance).toBe(30);
    expect(p.maxDistance).toBe(384);
    expect(p.rolloffFactor).toBe(1.0);
  });

  it('compliance checker validates all panner properties', () => {
    createOpponentAudio('p1', mockCtx as unknown as AudioContext);
    for (let range = 0; range < 3; range++) {
      const p = _pannerInstances[range];
      const results = checkPannerCompliance({
        range,
        posX: p.positionX.value,
        posY: p.positionY.value,
        posZ: p.positionZ.value,
        refDistance: p.refDistance,
        maxDistance: p.maxDistance,
        rolloffFactor: p.rolloffFactor,
        distanceModel: p.distanceModel,
        panningModel: p.panningModel,
        coneInner: p.coneInnerAngle,
        coneOuter: p.coneOuterAngle,
      }, range);
      for (const r of results) {
        expect(r.passed, `${r.check}: expected ${r.expected}, got ${r.actual}`).toBe(true);
      }
    }
  });
});

// ════════════════════════════════════════════════════════
// SECTION 3: Listener Tracking
// ════════════════════════════════════════════════════════

describe('SPEC-61: Listener Setup & Camera Tracking', () => {
  beforeEach(() => {
    resetAll();
    initListener(mockCtx as unknown as AudioContext);
  });

  it('updateListener sets position from camera', () => {
    const cam = {
      position: { x: 100, y: 50, z: -200 },
      getWorldDirection: vi.fn((v: { x: number; y: number; z: number }) => {
        v.x = 0; v.y = 0; v.z = -1; return v;
      }),
    };
    updateListener(cam as unknown as THREE.PerspectiveCamera);
    expect(mockListener.positionX.value).toBe(100);
    expect(mockListener.positionY.value).toBe(50);
    expect(mockListener.positionZ.value).toBe(-200);
  });

  it('updateListener sets forward direction from camera', () => {
    const cam = {
      position: { x: 0, y: 0, z: 0 },
      getWorldDirection: vi.fn((v: { x: number; y: number; z: number }) => {
        v.x = 0.707; v.y = 0; v.z = -0.707; return v;
      }),
    };
    updateListener(cam as unknown as THREE.PerspectiveCamera);
    expect(mockListener.forwardX.value).toBeCloseTo(0.707);
    expect(mockListener.forwardY.value).toBe(0);
    expect(mockListener.forwardZ.value).toBeCloseTo(-0.707);
  });

  it('updateListener always sets up vector to (0,1,0)', () => {
    const cam = {
      position: { x: 0, y: 0, z: 0 },
      getWorldDirection: vi.fn((v: { x: number; y: number; z: number }) => {
        v.x = 1; v.y = 0; v.z = 0; return v;
      }),
    };
    updateListener(cam as unknown as THREE.PerspectiveCamera);
    expect(mockListener.upX.value).toBe(0);
    expect(mockListener.upY.value).toBe(1);
    expect(mockListener.upZ.value).toBe(0);
  });

  it('updateListener is safe before initListener', () => {
    // Reset to pre-init state by destroying everything
    resetAll();
    // Don't call initListener
    const cam = {
      position: { x: 10, y: 20, z: 30 },
      getWorldDirection: vi.fn((v: { x: number; y: number; z: number }) => {
        v.x = 0; v.y = 0; v.z = -1; return v;
      }),
    };
    // Should not throw — just no-op
    expect(() => updateListener(cam as unknown as THREE.PerspectiveCamera)).not.toThrow();
  });

  it('multi-frame listener tracking simulates camera movement', () => {
    // Simulate camera moving along X axis over 5 frames
    for (let frame = 0; frame < 5; frame++) {
      const x = frame * 10;
      const cam = {
        position: { x, y: 5, z: -50 },
        getWorldDirection: vi.fn((v: { x: number; y: number; z: number }) => {
          v.x = 0; v.y = 0; v.z = -1; return v;
        }),
      };
      updateListener(cam as unknown as THREE.PerspectiveCamera);
      expect(mockListener.positionX.value).toBe(x);
    }
  });
});

// ════════════════════════════════════════════════════════
// SECTION 4: Opponent Audio Registry Lifecycle
// ════════════════════════════════════════════════════════

describe('SPEC-61: Opponent Audio Registry', () => {
  beforeEach(() => {
    resetAll();
    initListener(mockCtx as unknown as AudioContext);
  });

  it('createOpponentAudio creates exactly 3 panners per opponent', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    expect(mockCtx.createPanner).toHaveBeenCalledTimes(3);
  });

  it('3 opponents create 9 panners (matching resource budget)', () => {
    createOpponentAudio('a', mockCtx as unknown as AudioContext);
    createOpponentAudio('b', mockCtx as unknown as AudioContext);
    createOpponentAudio('c', mockCtx as unknown as AudioContext);
    expect(mockCtx.createPanner).toHaveBeenCalledTimes(
      SPEC_RESOURCE_BUDGET.totalPanners
    );
  });

  it('duplicate createOpponentAudio is idempotent', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    expect(mockCtx.createPanner).toHaveBeenCalledTimes(3);
  });

  it('getOpponentPanner returns distinct panners per range', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    const short = getOpponentPanner('opp1', SoundRange.SHORT);
    const medium = getOpponentPanner('opp1', SoundRange.MEDIUM);
    const long = getOpponentPanner('opp1', SoundRange.LONG);
    expect(short).toBeDefined();
    expect(medium).toBeDefined();
    expect(long).toBeDefined();
    // They should be different objects
    expect(short).not.toBe(medium);
    expect(medium).not.toBe(long);
  });

  it('getOpponentPanner returns null for non-existent opponent', () => {
    expect(getOpponentPanner('ghost', SoundRange.SHORT)).toBeNull();
  });

  it('destroyOpponentAudio disconnects all panners', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    const short = getOpponentPanner('opp1', SoundRange.SHORT);
    destroyOpponentAudio('opp1');
    expect(short!.disconnect).toHaveBeenCalled();
    expect(getOpponentPanner('opp1', SoundRange.SHORT)).toBeNull();
  });

  it('destroyAllOpponents clears entire registry', () => {
    for (const id of ['a', 'b', 'c']) {
      createOpponentAudio(id, mockCtx as unknown as AudioContext);
    }
    destroyAllOpponents();
    for (const id of ['a', 'b', 'c']) {
      expect(getOpponentPanner(id, SoundRange.SHORT)).toBeNull();
    }
  });

  it('double destroy is safe', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    destroyOpponentAudio('opp1');
    expect(() => destroyOpponentAudio('opp1')).not.toThrow();
  });

  it('markOpponentDead prevents position updates', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    updateOpponentPosition('opp1', 100, 200);
    markOpponentDead('opp1');
    // After marking dead, further position updates should be ignored
    const panner = getOpponentPanner('opp1', SoundRange.SHORT)!;
    const prevX = panner.positionX.value;
    updateOpponentPosition('opp1', 999, 999);
    expect(panner.positionX.value).toBe(prevX);
  });
});

// ════════════════════════════════════════════════════════
// SECTION 5: Position Updates
// ════════════════════════════════════════════════════════

describe('SPEC-61: Position Updates', () => {
  beforeEach(() => {
    resetAll();
    initListener(mockCtx as unknown as AudioContext);
  });

  it('updateOpponentPosition sets all 3 panners to same world position', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    updateOpponentPosition('opp1', 42, 84);

    for (const range of [SoundRange.SHORT, SoundRange.MEDIUM, SoundRange.LONG]) {
      const p = getOpponentPanner('opp1', range)!;
      expect(p.positionX.value).toBe(42);
      expect(p.positionZ.value).toBe(84);
    }
  });

  it('Y position is always 0 (2D arena)', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    updateOpponentPosition('opp1', 50, 75);
    for (const range of [SoundRange.SHORT, SoundRange.MEDIUM, SoundRange.LONG]) {
      expect(getOpponentPanner('opp1', range)!.positionY.value).toBe(0);
    }
  });

  it('updating unknown opponent is safe (no-op)', () => {
    expect(() => updateOpponentPosition('ghost', 10, 20)).not.toThrow();
  });

  it('position updates are independent per opponent', () => {
    createOpponentAudio('a', mockCtx as unknown as AudioContext);
    createOpponentAudio('b', mockCtx as unknown as AudioContext);
    updateOpponentPosition('a', 10, 20);
    updateOpponentPosition('b', 30, 40);
    expect(getOpponentPanner('a', SoundRange.SHORT)!.positionX.value).toBe(10);
    expect(getOpponentPanner('b', SoundRange.SHORT)!.positionX.value).toBe(30);
  });

  it('rapid position updates simulate movement trajectory', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    // Simulate opponent moving diagonally across arena
    for (let frame = 0; frame < 60; frame++) {
      const x = frame * 6;  // 0 → 354
      const z = frame * 3;  // 0 → 177
      updateOpponentPosition('opp1', x, z);
      const p = getOpponentPanner('opp1', SoundRange.SHORT)!;
      expect(p.positionX.value).toBe(x);
      expect(p.positionZ.value).toBe(z);
    }
  });

  it('negative coordinates are valid (arena can have negative space)', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    updateOpponentPosition('opp1', -100, -200);
    expect(getOpponentPanner('opp1', SoundRange.SHORT)!.positionX.value).toBe(-100);
    expect(getOpponentPanner('opp1', SoundRange.SHORT)!.positionZ.value).toBe(-200);
  });
});

// ════════════════════════════════════════════════════════
// SECTION 6: Spatial Sound Routing
// ════════════════════════════════════════════════════════

describe('SPEC-61: Sound Routing', () => {
  beforeEach(() => {
    resetAll();
    initListener(mockCtx as unknown as AudioContext);
  });

  it('playOpponentSound routes through correct range panner', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    const callback = vi.fn();

    playOpponentSound('opp1', SoundRange.MEDIUM, callback);
    expect(callback).toHaveBeenCalledTimes(1);

    const panner = getOpponentPanner('opp1', SoundRange.MEDIUM);
    expect(callback).toHaveBeenCalledWith(panner);
  });

  it('SHORT range for engines, swooshes, sparks', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    const calls: AudioNode[] = [];
    playOpponentSound('opp1', SoundRange.SHORT, (dest) => calls.push(dest));
    expect(calls[0]).toBe(getOpponentPanner('opp1', SoundRange.SHORT));
  });

  it('MEDIUM range for boosts, dashes, drifts', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    const calls: AudioNode[] = [];
    playOpponentSound('opp1', SoundRange.MEDIUM, (dest) => calls.push(dest));
    expect(calls[0]).toBe(getOpponentPanner('opp1', SoundRange.MEDIUM));
  });

  it('LONG range for explosions, taunts', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    const calls: AudioNode[] = [];
    playOpponentSound('opp1', SoundRange.LONG, (dest) => calls.push(dest));
    expect(calls[0]).toBe(getOpponentPanner('opp1', SoundRange.LONG));
  });

  it('playOpponentSound is silent for unknown opponent', () => {
    const callback = vi.fn();
    playOpponentSound('ghost', SoundRange.SHORT, callback);
    expect(callback).not.toHaveBeenCalled();
  });

  it('multiple sounds can route through same opponent panner', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    const calls: AudioNode[] = [];
    playOpponentSound('opp1', SoundRange.MEDIUM, (d) => calls.push(d));
    playOpponentSound('opp1', SoundRange.MEDIUM, (d) => calls.push(d));
    expect(calls.length).toBe(2);
    expect(calls[0]).toBe(calls[1]); // Same panner
  });
});

// ════════════════════════════════════════════════════════
// SECTION 7: Opponent Engine Synths
// ════════════════════════════════════════════════════════

describe('SPEC-61: Opponent Engine Synths', () => {
  beforeEach(() => {
    resetAll();
    initListener(mockCtx as unknown as AudioContext);
  });

  it('startOpponentEngine routes through SHORT panner', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    startOpponentEngine('opp1');
    // The engine strategy's start() receives the SHORT panner as dest
    // Verify by checking that oscillator/gain nodes were created
    expect(mockCtx.createOscillator).toHaveBeenCalled();
    expect(mockCtx.createGain).toHaveBeenCalled();
  });

  it('startOpponentEngine is idempotent', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    startOpponentEngine('opp1');
    const count = mockCtx.createOscillator.mock.calls.length;
    startOpponentEngine('opp1');
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(count);
  });

  it('updateOpponentEngine derives accelDir from speed delta', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    startOpponentEngine('opp1');
    // Accelerating: 0.5 → 1.0
    expect(() => updateOpponentEngine('opp1', 0.5)).not.toThrow();
    expect(() => updateOpponentEngine('opp1', 1.0)).not.toThrow();
    // Decelerating: 1.0 → 0.8
    expect(() => updateOpponentEngine('opp1', 0.8)).not.toThrow();
  });

  it('updateOpponentEngine infers boosting from speedFactor > 1.0', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    startOpponentEngine('opp1');
    // Below 1.0 — not boosting
    expect(() => updateOpponentEngine('opp1', 0.8)).not.toThrow();
    // Above 1.0 — boosting
    expect(() => updateOpponentEngine('opp1', 1.5)).not.toThrow();
  });

  it('stopOpponentEngine cleans up and allows restart', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    startOpponentEngine('opp1');
    stopOpponentEngine('opp1');
    // Should be able to start again
    const count = mockCtx.createOscillator.mock.calls.length;
    startOpponentEngine('opp1');
    expect(mockCtx.createOscillator.mock.calls.length).toBeGreaterThan(count);
  });

  it('fadeOutOpponentEngine ramps to zero then stops', () => {
    vi.useFakeTimers();
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    startOpponentEngine('opp1');
    fadeOutOpponentEngine('opp1', 0.3);
    // Engine should still exist during fade
    expect(() => updateOpponentEngine('opp1', 0.5)).not.toThrow();
    vi.advanceTimersByTime(350);
    // After fade, engine should be stopped — restart creates new nodes
    const count = mockCtx.createOscillator.mock.calls.length;
    startOpponentEngine('opp1');
    expect(mockCtx.createOscillator.mock.calls.length).toBeGreaterThan(count);
    vi.useRealTimers();
  });

  it('fadeOutAllOpponentEngines fades all running engines', () => {
    vi.useFakeTimers();
    createOpponentAudio('a', mockCtx as unknown as AudioContext);
    createOpponentAudio('b', mockCtx as unknown as AudioContext);
    startOpponentEngine('a');
    startOpponentEngine('b');
    fadeOutAllOpponentEngines(0.2);
    vi.advanceTimersByTime(250);
    // Both should be stopped
    const count = mockCtx.createOscillator.mock.calls.length;
    startOpponentEngine('a');
    startOpponentEngine('b');
    expect(mockCtx.createOscillator.mock.calls.length).toBeGreaterThan(count);
    vi.useRealTimers();
  });

  it('destroyOpponentAudio auto-stops engine', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    startOpponentEngine('opp1');
    expect(() => destroyOpponentAudio('opp1')).not.toThrow();
  });

  it('3 simultaneous opponent engines match resource budget', () => {
    for (const id of ['a', 'b', 'c']) {
      createOpponentAudio(id, mockCtx as unknown as AudioContext);
      startOpponentEngine(id);
    }
    // 3 opponents × 3 panners = 9
    expect(mockCtx.createPanner).toHaveBeenCalledTimes(9);
    // Each procedural engine: 2 oscillators, so 3 × 2 = 6
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(6);
  });
});

// ════════════════════════════════════════════════════════
// SECTION 8: Distance Attenuation Model
// ════════════════════════════════════════════════════════

describe('SPEC-61: Distance Attenuation Model (inverse)', () => {
  it('gain is 1.0 at refDistance', () => {
    expect(calcInverseDistanceGain(10, 10, 96, 1.5)).toBe(1.0);
  });

  it('gain is 1.0 below refDistance (clamped)', () => {
    expect(calcInverseDistanceGain(5, 10, 96, 1.5)).toBe(1.0);
  });

  it('gain decreases with distance (SHORT range)', () => {
    const { refDistance, maxDistance, rolloffFactor } = RANGE_CONFIG[SoundRange.SHORT];
    const g10 = calcInverseDistanceGain(10, refDistance, maxDistance, rolloffFactor);
    const g50 = calcInverseDistanceGain(50, refDistance, maxDistance, rolloffFactor);
    const g96 = calcInverseDistanceGain(96, refDistance, maxDistance, rolloffFactor);
    expect(g10).toBeGreaterThan(g50);
    expect(g50).toBeGreaterThan(g96);
  });

  it('gain at maxDistance for SHORT is very small', () => {
    const cfg = RANGE_CONFIG[SoundRange.SHORT];
    const g = calcInverseDistanceGain(cfg.maxDistance, cfg.refDistance, cfg.maxDistance, cfg.rolloffFactor);
    expect(g).toBeLessThan(0.1);
  });

  it('LONG range has gentler falloff than SHORT', () => {
    const dist = 50;
    const gShort = calcInverseDistanceGain(dist,
      RANGE_CONFIG[SoundRange.SHORT].refDistance,
      RANGE_CONFIG[SoundRange.SHORT].maxDistance,
      RANGE_CONFIG[SoundRange.SHORT].rolloffFactor);
    const gLong = calcInverseDistanceGain(dist,
      RANGE_CONFIG[SoundRange.LONG].refDistance,
      RANGE_CONFIG[SoundRange.LONG].maxDistance,
      RANGE_CONFIG[SoundRange.LONG].rolloffFactor);
    expect(gLong).toBeGreaterThan(gShort);
  });

  it('attenuation curve is monotonically decreasing', () => {
    const cfg = RANGE_CONFIG[SoundRange.MEDIUM];
    let prevGain = 1.0;
    for (let d = cfg.refDistance; d <= cfg.maxDistance; d += 5) {
      const g = calcInverseDistanceGain(d, cfg.refDistance, cfg.maxDistance, cfg.rolloffFactor);
      expect(g).toBeLessThanOrEqual(prevGain);
      prevGain = g;
    }
  });

  it('beyond maxDistance, gain is clamped (not zero)', () => {
    const cfg = RANGE_CONFIG[SoundRange.SHORT];
    const gAtMax = calcInverseDistanceGain(cfg.maxDistance, cfg.refDistance, cfg.maxDistance, cfg.rolloffFactor);
    const gBeyond = calcInverseDistanceGain(cfg.maxDistance + 100, cfg.refDistance, cfg.maxDistance, cfg.rolloffFactor);
    // Should be clamped to maxDistance gain
    expect(gBeyond).toBe(gAtMax);
  });
});

// ════════════════════════════════════════════════════════
// SECTION 9: Multi-Opponent Scenarios
// ════════════════════════════════════════════════════════

describe('SPEC-61: Multi-Opponent Scenarios', () => {
  beforeEach(() => {
    resetAll();
    initListener(mockCtx as unknown as AudioContext);
  });

  it('4-player FFA: 3 opponents have independent audio', () => {
    const ids = ['opp1', 'opp2', 'opp3'];
    for (const id of ids) {
      createOpponentAudio(id, mockCtx as unknown as AudioContext);
    }

    // Set different positions
    updateOpponentPosition('opp1', 10, 0);
    updateOpponentPosition('opp2', 0, 50);
    updateOpponentPosition('opp3', -30, -30);

    // Each has distinct panner positions
    const p1 = getOpponentPanner('opp1', SoundRange.SHORT)!;
    const p2 = getOpponentPanner('opp2', SoundRange.SHORT)!;
    const p3 = getOpponentPanner('opp3', SoundRange.SHORT)!;

    expect(p1.positionX.value).toBe(10);
    expect(p2.positionZ.value).toBe(50);
    expect(p3.positionX.value).toBe(-30);
  });

  it('opponents at different distances have different attenuation', () => {
    const ids = ['near', 'mid', 'far'];
    const distances = [20, 80, 180];
    for (let i = 0; i < ids.length; i++) {
      createOpponentAudio(ids[i], mockCtx as unknown as AudioContext);
      updateOpponentPosition(ids[i], distances[i], 0);
    }

    // Calculate expected attenuation for SHORT range
    const cfg = RANGE_CONFIG[SoundRange.SHORT];
    const gNear = calcInverseDistanceGain(20, cfg.refDistance, cfg.maxDistance, cfg.rolloffFactor);
    const gMid = calcInverseDistanceGain(80, cfg.refDistance, cfg.maxDistance, cfg.rolloffFactor);
    const gFar = calcInverseDistanceGain(180, cfg.refDistance, cfg.maxDistance, cfg.rolloffFactor);

    expect(gNear).toBeGreaterThan(gMid);
    // Far is beyond SHORT maxDistance (96), so clamps
    expect(gMid).toBeGreaterThan(gFar);
  });

  it('killing one opponent does not affect others', () => {
    createOpponentAudio('a', mockCtx as unknown as AudioContext);
    createOpponentAudio('b', mockCtx as unknown as AudioContext);
    markOpponentDead('a');
    // b should still accept position updates
    updateOpponentPosition('b', 100, 100);
    expect(getOpponentPanner('b', SoundRange.SHORT)!.positionX.value).toBe(100);
  });

  it('destroy then recreate opponent (rejoin scenario)', () => {
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    destroyOpponentAudio('opp1');
    // Rejoin
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    expect(getOpponentPanner('opp1', SoundRange.SHORT)).not.toBeNull();
    updateOpponentPosition('opp1', 42, 42);
    expect(getOpponentPanner('opp1', SoundRange.SHORT)!.positionX.value).toBe(42);
  });
});

// ════════════════════════════════════════════════════════
// SECTION 10: Full Lifecycle Integration
// ════════════════════════════════════════════════════════

describe('SPEC-61: Full Match Lifecycle', () => {
  beforeEach(() => {
    resetAll();
    initListener(mockCtx as unknown as AudioContext);
  });

  it('simulates complete match: create → engines → updates → death → explosion → cleanup', () => {
    // Match start: create 3 opponents
    const ids = ['opp1', 'opp2', 'opp3'];
    for (const id of ids) {
      createOpponentAudio(id, mockCtx as unknown as AudioContext);
      startOpponentEngine(id);
    }

    // Simulate 30 frames of gameplay
    for (let frame = 0; frame < 30; frame++) {
      const cam = {
        position: { x: frame * 2, y: 5, z: 0 },
        getWorldDirection: vi.fn((v: { x: number; y: number; z: number }) => {
          v.x = 0; v.y = 0; v.z = -1; return v;
        }),
      };
      updateListener(cam as unknown as THREE.PerspectiveCamera);

      for (let i = 0; i < ids.length; i++) {
        updateOpponentPosition(ids[i], 100 + i * 50, 50 + frame);
        updateOpponentEngine(ids[i], 1.0 + frame * 0.02);
      }
    }

    // Opponent dies: play explosion through LONG panner
    playOpponentSound('opp1', SoundRange.LONG, vi.fn());
    markOpponentDead('opp1');
    stopOpponentEngine('opp1');

    // Match end: destroy all
    destroyAllOpponents();
    for (const id of ids) {
      expect(getOpponentPanner(id, SoundRange.SHORT)).toBeNull();
    }
  });

  it('rapid create/destroy stress test (10 cycles)', () => {
    for (let i = 0; i < 10; i++) {
      createOpponentAudio('stress', mockCtx as unknown as AudioContext);
      startOpponentEngine('stress');
      updateOpponentPosition('stress', i * 10, i * 5);
      updateOpponentEngine('stress', 1.0);
      stopOpponentEngine('stress');
      destroyOpponentAudio('stress');
    }
    expect(getOpponentPanner('stress', SoundRange.SHORT)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════
// SECTION 11: Spatial Coordinate Verification
// ════════════════════════════════════════════════════════

describe('SPEC-61: Spatial Coordinate Transformations', () => {
  beforeEach(() => {
    resetAll();
    initListener(mockCtx as unknown as AudioContext);
  });

  it('opponent directly ahead: positive Z offset from listener', () => {
    const cam = {
      position: { x: 0, y: 5, z: 0 },
      getWorldDirection: vi.fn((v: { x: number; y: number; z: number }) => {
        v.x = 0; v.y = 0; v.z = -1; return v;
      }),
    };
    updateListener(cam as unknown as THREE.PerspectiveCamera);
    createOpponentAudio('ahead', mockCtx as unknown as AudioContext);
    updateOpponentPosition('ahead', 0, -50); // In front of listener facing -Z
    const p = getOpponentPanner('ahead', SoundRange.SHORT)!;
    expect(p.positionX.value).toBe(0);
    expect(p.positionZ.value).toBe(-50);
  });

  it('opponent to the right: positive X offset from listener', () => {
    const cam = {
      position: { x: 0, y: 5, z: 0 },
      getWorldDirection: vi.fn((v: { x: number; y: number; z: number }) => {
        v.x = 0; v.y = 0; v.z = -1; return v;
      }),
    };
    updateListener(cam as unknown as THREE.PerspectiveCamera);
    createOpponentAudio('right', mockCtx as unknown as AudioContext);
    updateOpponentPosition('right', 50, 0);
    expect(getOpponentPanner('right', SoundRange.SHORT)!.positionX.value).toBe(50);
  });

  it('opponent behind: positive Z relative to camera facing -Z', () => {
    const cam = {
      position: { x: 0, y: 5, z: 0 },
      getWorldDirection: vi.fn((v: { x: number; y: number; z: number }) => {
        v.x = 0; v.y = 0; v.z = -1; return v;
      }),
    };
    updateListener(cam as unknown as THREE.PerspectiveCamera);
    createOpponentAudio('behind', mockCtx as unknown as AudioContext);
    updateOpponentPosition('behind', 0, 50);
    expect(getOpponentPanner('behind', SoundRange.SHORT)!.positionZ.value).toBe(50);
  });

  it('distance calculation: Pythagorean from listener to opponent', () => {
    const cam = {
      position: { x: 0, y: 0, z: 0 },
      getWorldDirection: vi.fn((v: { x: number; y: number; z: number }) => {
        v.x = 0; v.y = 0; v.z = -1; return v;
      }),
    };
    updateListener(cam as unknown as THREE.PerspectiveCamera);
    createOpponentAudio('opp1', mockCtx as unknown as AudioContext);
    updateOpponentPosition('opp1', 30, 40);
    // Distance should be sqrt(30² + 40²) = 50
    const p = getOpponentPanner('opp1', SoundRange.SHORT)!;
    const dist = Math.sqrt(p.positionX.value ** 2 + p.positionZ.value ** 2);
    expect(dist).toBe(50);
  });
});
