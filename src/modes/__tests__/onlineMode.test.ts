// ── onlineMode.ts unit tests ─────────────────────────────
// TASK-66 — Tests OnlineMode lifecycle hooks that do not require
// a full Game+Scene simulation: teardown, waitingForOpponent,
// beginOnlineCountdown, and applyVisualOffsets.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IOnlineModeHost } from '../onlineMode';
import type { GameState, KillcamPhase, AIState, ColorMap } from '../../types/index';

// ── Mock heavy/side-effectful dependencies ─────────────────
vi.mock('../../player', () => ({
  Player: class MockPlayer {
    mesh = { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 }, parent: null, visible: true, traverse: vi.fn() };
    alive = true;
    angle = 0;
    speed = 0;
    vehicleType = 'bike';
    trail = { warmShaders: vi.fn(), addPoint: vi.fn(), updateHead: vi.fn(), updateSpeed: vi.fn(), tickFadingSegments: vi.fn(() => []), markSegmentDestroyed: vi.fn(), fadeSegment: vi.fn() };
    constructor(_scene: unknown, _opts: unknown) {}
  },
}));

vi.mock('../../grid', () => ({
  createArena: vi.fn(),
  ARENA_SIZE: 200,
  updateWallGlow: vi.fn(),
}));

vi.mock('../../ai', () => ({
  getAIInput: vi.fn(() => ({ turn: 0, accelerate: false, dash: false, brake: false })),
  getAIInputSim: vi.fn(() => ({ turn: 0, accelerate: false, dash: false, brake: false })),
  createAIState: vi.fn(() => ({} as AIState)),
  cloneAIState: vi.fn((s: AIState) => ({ ...s })),
}));

vi.mock('../../scene', () => ({ resetCamera: vi.fn() }));

vi.mock('../../core/simulation', () => ({
  createSimState: vi.fn(() => ({ tick: 0, players: [], trails: [] })),
  SIM_DT: 1 / 60,
  serializeSimState: vi.fn(() => ({})),
  deserializeSimState: vi.fn(() => ({})),
}));

vi.mock('../../core/simSpatialGrid', () => ({ SimSpatialGrid: class { rebuild = vi.fn(); } }));
vi.mock('../../core/lockstepManager', () => ({ LockstepManager: class {} }));
vi.mock('../../vehicleConfig', () => ({ getVehiclePhysics: vi.fn(() => ({ baseSpeed: 30 })) }));
vi.mock('../../core/seededRandom', () => ({
  seededRandom: vi.fn(() => () => 0),
  recreateRng: vi.fn(() => () => 0),
}));
vi.mock('../../vibrate', () => ({ vibrate: vi.fn(), VIBE: { dash: 1, boost: 1, death: 1 } }));
vi.mock('../../sfx', () => ({
  playExplosion: vi.fn(),
  startProximitySpark: vi.fn(),
  updateProximitySpark: vi.fn(),
  stopProximitySpark: vi.fn(),
  playBoost: vi.fn(),
  playDash: vi.fn(),
  playSputter: vi.fn(),
  playTurnSwoosh: vi.fn(),
  playGrindEnter: vi.fn(),
  playGrindBail: vi.fn(),
  playGrindExit: vi.fn(),
  playGrindLanding: vi.fn(),
  playGrindHop: vi.fn(),
  startGrindLoop: vi.fn(),
  updateGrindLoop: vi.fn(),
  stopGrindLoop: vi.fn(),
}));
vi.mock('../../vehicleAudioEngine', () => ({
  startVehicleEngine: vi.fn(),
  updateVehicleEngine: vi.fn(),
  stopVehicleEngine: vi.fn(),
}));
vi.mock('../../sfxAssets', () => ({ playDriftEnter: vi.fn(), playDriftExit: vi.fn() }));
vi.mock('../../input', () => ({
  isAccelerate: vi.fn(() => false),
  isDash: vi.fn(() => false),
  isBrake: vi.fn(() => false),
  isSpecial: vi.fn(() => false),
  TOUCH_ENABLED: false,
}));
vi.mock('../../touch', () => ({ setTouchVehicle: vi.fn() }));
vi.mock('../../touchButtons', () => ({ setTouchButtonVehicle: vi.fn() }));
vi.mock('../../ui/mapSelectUI', () => ({ getSelectedMap: vi.fn(() => 'default') }));
vi.mock('../../ui/streakUI', () => ({ hideStreakDisplay: vi.fn() }));
vi.mock('../../netLog', () => ({
  net: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../replay', () => ({ ReplayRecorder: class { reset = vi.fn(); hasData = vi.fn(() => false); } }));
vi.mock('../demoMode', () => ({ DemoMode: class { teardown = vi.fn(); } }));
vi.mock('../../core/collisionSystem', () => ({
  updateTrailProximityVFX: vi.fn(),
  updateEnemySlipstreamVFX: vi.fn(),
  clearEnemySlipstreamVFX: vi.fn(),
}));
vi.mock('../../trail', () => ({ Trail: class {} }));
vi.mock('../../spatialGrid', () => ({ grid: { removeSegment: vi.fn() } }));
vi.mock('../../core/inputBuffer', () => ({ DelayAdvisor: class { recommend = vi.fn(() => 2); } }));

vi.mock('three', () => {
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v: { x: number; y: number; z: number }) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
  }
  class Scene {}
  class PerspectiveCamera {
    position = new Vector3();
    fov = 50;
    lookAt = vi.fn();
    updateProjectionMatrix = vi.fn();
  }
  return { Vector3, Scene, PerspectiveCamera };
});

import * as THREE from 'three';
import { OnlineMode } from '../onlineMode';

// ── Test doubles ────────────────────────────────────────────

interface LocalPlayerDouble {
  mesh: { position: { x: number; z: number } };
  alive: boolean;
}

function makePlayer(x = 0, z = 0): LocalPlayerDouble {
  return { mesh: { position: { x, z } }, alive: true };
}

interface MockLockstep {
  myVisualOffset: { x: number; z: number };
  _offsets: Map<number, { x: number; z: number }>;
  getVisualOffset: (i: number) => { x: number; z: number };
  setInputDelay: (d: number) => void;
}

function makeLockstep(): MockLockstep {
  const ls: MockLockstep = {
    myVisualOffset: { x: 0, z: 0 },
    _offsets: new Map(),
    getVisualOffset: (i: number) => ls._offsets.get(i) ?? { x: 0, z: 0 },
    setInputDelay: vi.fn(),
  };
  return ls;
}

interface MockOnlineMatch {
  stop: () => void;
  signalLoaded: () => Promise<void>;
  netcode: { estimatedRttMs: number };
  myUid: string;
  allPlayerUids: string[];
  opponents: unknown[];
  seed: number;
  useLockstep: boolean;
}

function makeOnlineMatch(overrides: Partial<MockOnlineMatch> = {}): MockOnlineMatch {
  return {
    stop: vi.fn(),
    signalLoaded: vi.fn(() => Promise.resolve()),
    netcode: { estimatedRttMs: 50 },
    myUid: 'me',
    allPlayerUids: ['me', 'you'],
    opponents: [],
    seed: 12345,
    useLockstep: true,
    ...overrides,
  };
}

type TestHost = Omit<IOnlineModeHost, 'player' | 'opponent' | '_onlineMatch' | '_lockstep' | '_demoMode' | '_replayRecorder' | '_colorMap'> & {
  player: LocalPlayerDouble | null;
  opponent: LocalPlayerDouble | null;
  _onlineMatch: MockOnlineMatch | null;
  _lockstep: MockLockstep | null;
  _demoMode: { teardown: () => void };
  _replayRecorder: { reset: () => void; hasData: () => boolean };
  _colorMap: ColorMap;
};

function createHost(overrides: Partial<TestHost> = {}): TestHost {
  const base: TestHost = {
    // IGameCore
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    state: 'playing' as GameState,
    mode: 'online',
    _fading: false,
    player: makePlayer(),
    ais: [],
    _onlineMatch: makeOnlineMatch(),
    _killcamPhase: 'none' as KillcamPhase,
    _killcamActive: false,
    _killcamPos: null,
    _killcamStartCamPos: null,
    _killcamTimer: 0,
    _killcamDelayTimer: 0,
    _spectating: false,
    cleanup: vi.fn(),
    _sceneFade: vi.fn(() => Promise.resolve()),

    // IOnlineModeHost specific
    opponent: null,
    matchTime: 0,
    _lockstep: null,
    _delayAdvisor: { recommend: vi.fn(() => 2) } as unknown as IOnlineModeHost['_delayAdvisor'],
    _lockstepMyIndex: 0,
    _lockstepHumanCount: 2,
    _lockstepAiStates: [],

    _colorMap: { red: { color: 0xff0000, emissive: 0xcc0000 } } as ColorMap,
    playerColor: 0x00ffff,
    playerEmissive: 0x00cccc,

    _transitionCamStart: new THREE.Vector3(),
    _transitionFovStart: 50,
    _transitionTimer: 0,
    _transitionDuration: 1.2,
    _victoryFireworks: false,

    _radarCtx: null,
    _replayRecorder: { reset: vi.fn(), hasData: vi.fn(() => false) },
    _demoMode: { teardown: vi.fn() },

    _lastTurnSwooshTime: 0,
    _aiFrame: 0,
    adminGodMode: false,

    _refreshPlayerColor: vi.fn(),
    stopBgReplay: vi.fn(),
    stopMenuReplay: vi.fn(),
    _beginCountdown: vi.fn(),
  };
  return Object.assign(base, overrides);
}

function asHost(h: TestHost): IOnlineModeHost {
  return h as unknown as IOnlineModeHost;
}

// ── DOM helpers ─────────────────────────────────────────────
function setupDOM(): void {
  const ids = ['disconnect-banner', 'connecting-spinner', 'meter-wrap', 'radar', 'match-timer', 'countdown'];
  for (const id of ids) {
    if (document.getElementById(id)) continue;
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  setupDOM();
});

afterEach(() => {
  document.body.innerHTML = '';
});

// ═══════════════════════════════════════════════════════════
// Construction
// ═══════════════════════════════════════════════════════════
describe('OnlineMode construction', () => {
  it('constructs with a host', () => {
    const host = createHost();
    const mode = new OnlineMode(asHost(host));
    expect(mode).toBeInstanceOf(OnlineMode);
  });
});

// ═══════════════════════════════════════════════════════════
// _teardownOnline
// ═══════════════════════════════════════════════════════════
describe('_teardownOnline', () => {
  it('stops the online match and clears the reference', () => {
    const match = makeOnlineMatch();
    const host = createHost({ _onlineMatch: match });
    const mode = new OnlineMode(asHost(host));
    mode._teardownOnline();
    expect(match.stop).toHaveBeenCalledTimes(1);
    expect(host._onlineMatch).toBeNull();
  });

  it('clears lockstep state', () => {
    const host = createHost({ _lockstep: makeLockstep() });
    const mode = new OnlineMode(asHost(host));
    mode._teardownOnline();
    expect(host._lockstep).toBeNull();
  });

  it('resets mode back to local', () => {
    const host = createHost({ mode: 'online' });
    const mode = new OnlineMode(asHost(host));
    mode._teardownOnline();
    expect(host.mode).toBe('local');
  });

  it('hides the disconnect banner', () => {
    const host = createHost();
    const banner = document.getElementById('disconnect-banner')!;
    banner.classList.remove('hidden');
    const mode = new OnlineMode(asHost(host));
    mode._teardownOnline();
    expect(banner.classList.contains('hidden')).toBe(true);
  });

  it('is safe when onlineMatch is already null', () => {
    const host = createHost({ _onlineMatch: null });
    const mode = new OnlineMode(asHost(host));
    expect(() => mode._teardownOnline()).not.toThrow();
    expect(host.mode).toBe('local');
  });
});

// ═══════════════════════════════════════════════════════════
// _beginWaitingForOpponent
// ═══════════════════════════════════════════════════════════
describe('_beginWaitingForOpponent', () => {
  it('sets state to waitingOnline', () => {
    const host = createHost();
    const mode = new OnlineMode(asHost(host));
    mode._beginWaitingForOpponent();
    expect(host.state).toBe('waitingOnline');
  });

  it('shows the connecting spinner', () => {
    const host = createHost();
    const spinner = document.getElementById('connecting-spinner')!;
    spinner.classList.add('hidden');
    const mode = new OnlineMode(asHost(host));
    mode._beginWaitingForOpponent();
    expect(spinner.classList.contains('hidden')).toBe(false);
  });

  it('applies adaptive input delay when lockstep exists', () => {
    const ls = makeLockstep();
    const host = createHost({ _lockstep: ls });
    const mode = new OnlineMode(asHost(host));
    mode._beginWaitingForOpponent();
    expect(ls.setInputDelay).toHaveBeenCalledWith(2);
  });

  it('calls onlineMatch.signalLoaded', () => {
    const match = makeOnlineMatch();
    const host = createHost({ _onlineMatch: match });
    const mode = new OnlineMode(asHost(host));
    mode._beginWaitingForOpponent();
    expect(match.signalLoaded).toHaveBeenCalledTimes(1);
  });

  it('does not apply input delay when lockstep is null', () => {
    const match = makeOnlineMatch();
    const host = createHost({ _onlineMatch: match, _lockstep: null });
    const mode = new OnlineMode(asHost(host));
    expect(() => mode._beginWaitingForOpponent()).not.toThrow();
    // No crash means the null-guard worked.
    expect(host.state).toBe('waitingOnline');
  });

  it('schedules retry when signalLoaded rejects', async () => {
    vi.useFakeTimers();
    try {
      const rejectingMatch = makeOnlineMatch({
        signalLoaded: vi.fn(() => Promise.reject(new Error('boom'))),
      });
      const host = createHost({ _onlineMatch: rejectingMatch });
      const mode = new OnlineMode(asHost(host));
      mode._beginWaitingForOpponent();
      // Let the rejected promise microtask flush.
      await vi.advanceTimersByTimeAsync(0);
      // Retry should have been scheduled via setTimeout.
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      await vi.advanceTimersByTimeAsync(1500);
      // signalLoaded called at least twice: initial attempt + first retry.
      expect(rejectingMatch.signalLoaded.mock?.calls.length ?? 0).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ═══════════════════════════════════════════════════════════
// beginOnlineCountdown
// ═══════════════════════════════════════════════════════════
describe('beginOnlineCountdown', () => {
  it('hides the connecting spinner and calls _beginCountdown', () => {
    const host = createHost();
    const spinner = document.getElementById('connecting-spinner')!;
    spinner.classList.remove('hidden');
    const mode = new OnlineMode(asHost(host));
    mode.beginOnlineCountdown();
    expect(spinner.classList.contains('hidden')).toBe(true);
    expect(host._beginCountdown).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════
// applyVisualOffsets
// ═══════════════════════════════════════════════════════════
describe('applyVisualOffsets', () => {
  it('applies my visual offset to the local player mesh', () => {
    const ls = makeLockstep();
    ls.myVisualOffset = { x: 1.5, z: -2 };
    const host = createHost({ _lockstep: ls, player: makePlayer(0, 0), _lockstepMyIndex: 0, _lockstepHumanCount: 1 });
    const mode = new OnlineMode(asHost(host));
    mode.applyVisualOffsets();
    expect(host.player!.mesh.position.x).toBeCloseTo(1.5, 5);
    expect(host.player!.mesh.position.z).toBeCloseTo(-2, 5);
  });

  it('does not mutate player when my offset is zero', () => {
    const ls = makeLockstep();
    ls.myVisualOffset = { x: 0, z: 0 };
    const host = createHost({ _lockstep: ls, player: makePlayer(5, 5), _lockstepMyIndex: 0, _lockstepHumanCount: 1 });
    const mode = new OnlineMode(asHost(host));
    mode.applyVisualOffsets();
    expect(host.player!.mesh.position.x).toBe(5);
    expect(host.player!.mesh.position.z).toBe(5);
  });

  it('applies per-remote-human visual offsets', () => {
    const ls = makeLockstep();
    ls._offsets.set(1, { x: 0.5, z: -0.25 });
    const remotePlayer = makePlayer(10, 10);
    const host = createHost({
      _lockstep: ls,
      _lockstepMyIndex: 0,
      _lockstepHumanCount: 2,
      ais: [{
        player: remotePlayer as unknown as IOnlineModeHost['ais'][number]['player'],
        aiState: null,
        colorHex: 0xff0000,
        uid: 'remote-uid',
      }],
    });
    const mode = new OnlineMode(asHost(host));
    mode.applyVisualOffsets();
    expect(remotePlayer.mesh.position.x).toBeCloseTo(10.5, 5);
    expect(remotePlayer.mesh.position.z).toBeCloseTo(9.75, 5);
  });

  it('skips AI entries (non-null aiState)', () => {
    const ls = makeLockstep();
    ls._offsets.set(1, { x: 99, z: 99 });
    const aiPlayer = makePlayer(0, 0);
    const host = createHost({
      _lockstep: ls,
      _lockstepMyIndex: 0,
      _lockstepHumanCount: 2,
      ais: [{
        player: aiPlayer as unknown as IOnlineModeHost['ais'][number]['player'],
        aiState: {} as AIState,
        colorHex: 0xff0000,
      }],
    });
    const mode = new OnlineMode(asHost(host));
    mode.applyVisualOffsets();
    // AI entries must not receive visual smoothing offsets.
    expect(aiPlayer.mesh.position.x).toBe(0);
    expect(aiPlayer.mesh.position.z).toBe(0);
  });
});
