// ── replayMode.ts unit tests ─────────────────────────────
// TASK-66 — Tests ReplayMode camera mode cycling, seek/scrubbing,
// ghost lifecycle, menu replay start/stop, and bg replay teardown.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IReplayModeHost } from '../replayMode';
import type {
  ReplaySnapshot, ReplayFrame, PlayerState, InterpolatedReplayFrame,
  GameState, KillcamPhase, FreeCamInput,
} from '../../types/index';

// ── Mock heavy dependencies ─────────────────────────────────
// NOTE: vi.mock calls are hoisted above imports, so any captured
// variables referenced inside the factory must be declared via vi.hoisted().
const spies = vi.hoisted(() => ({
  destroyTrail: vi.fn(),
  addPoint: vi.fn(),
  updateHead: vi.fn(),
  updateSpeed: vi.fn(),
  createArena: vi.fn(),
  setSpectatorTargets: vi.fn(),
}));

vi.mock('../../trail', () => ({
  Trail: class MockTrail {
    constructor(_scene: unknown, _color: number) {}
    destroy = spies.destroyTrail;
    addPoint = spies.addPoint;
    updateHead = spies.updateHead;
    updateSpeed = spies.updateSpeed;
  },
}));

vi.mock('../../grid', () => ({
  createArena: spies.createArena,
  setSpectatorTargets: spies.setSpectatorTargets,
}));

vi.mock('../../scene', () => ({
  updateCamera: vi.fn(),
  resetCamera: vi.fn(),
}));

vi.mock('../../replay', () => ({
  ReplayRecorder: class {},
  ReplayPlayer: class {},
}));

vi.mock('../../playerColors', () => ({
  FALLBACK_OPPONENT_COLOR_KEY: 'red',
  getPlayerColor: vi.fn(() => ({ color: 0xff0000, emissive: 0xcc0000 })),
}));

vi.mock('../../bikeModel', () => ({
  cloneBikeModel: vi.fn(() => ({ scale: { setScalar: vi.fn() } })),
  getBikeModelHeight: vi.fn(() => 2.7),
}));
vi.mock('../../carModel', () => ({
  cloneCarModel: vi.fn(() => ({ scale: { setScalar: vi.fn() } })),
}));
vi.mock('../../hoverboardModel', () => ({
  cloneHoverboardModel: vi.fn(() => ({ scale: { setScalar: vi.fn() } })),
  getHoverboardModelHeight: vi.fn(() => 2.7),
}));

vi.mock('../../graphics', () => ({
  getGfx: vi.fn(() => ({ bloom: { strength: 4.55, radius: 0.37, threshold: 0.37, enabled: true, vehiclesMul: 1, trailsMul: 1.05, environmentMul: 0.45, lightsMul: 3, vehiclesOn: true, trailsOn: true, environmentOn: true, lightsOn: true } })),
}));

vi.mock('../../ui/mapSelectUI', () => ({ getSelectedMap: vi.fn(() => 'default') }));

vi.mock('three', () => {
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v: { x: number; y: number; z: number }) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    add(v: { x: number; y: number; z: number }) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    addScaledVector(v: { x: number; y: number; z: number }, s: number) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
    lerpVectors(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, t: number) {
      this.x = a.x + (b.x - a.x) * t;
      this.y = a.y + (b.y - a.y) * t;
      this.z = a.z + (b.z - a.z) * t;
      return this;
    }
  }
  class Group {
    visible = true;
    position = new Vector3();
    rotation = { y: 0 };
    scale = { setScalar: vi.fn() };
    children: unknown[] = [];
    add = vi.fn();
    traverse = vi.fn((cb: (c: unknown) => void) => { cb(this); });
  }
  class PointLight {
    intensity = 1.2;
    position = new Vector3();
    constructor(public color: number, intensity: number, public distance: number) { this.intensity = intensity; }
  }
  class Scene { children: unknown[] = []; add = vi.fn(); remove = vi.fn(); }
  class PerspectiveCamera {
    position = new Vector3();
    fov = 50;
    lookAt = vi.fn();
    updateProjectionMatrix = vi.fn();
    getWorldDirection = vi.fn((v: Vector3) => { v.set(0, 0, -1); return v; });
  }
  return { Vector3, Group, PointLight, Scene, PerspectiveCamera };
});

import * as THREE from 'three';
import { ReplayMode } from '../replayMode';

// ── Test doubles ────────────────────────────────────────────

interface MockReplayPlayer {
  data: ReplaySnapshot | null;
  playing: boolean;
  speed: number;
  time: number;
  frameIndex: number;
  loop: boolean;
  load: (snap: ReplaySnapshot) => void;
  seekTo: (progress: number) => void;
  update: (dt: number) => InterpolatedReplayFrame | null;
  isFinished: () => boolean;
}

function makeFrame(t: number, px: number, pz: number, alive = true): ReplayFrame {
  const p: PlayerState = { x: px, z: pz, angle: 0, speed: 10, boosting: false, dashing: false, alive };
  return { t, player: p, ais: [] };
}

function makeSnapshot(): ReplaySnapshot {
  return {
    frames: [
      makeFrame(0, 0, 0),
      makeFrame(0.5, 1, 1),
      makeFrame(1, 2, 2),
      makeFrame(1.5, 3, 3),
    ],
    playerColor: 0x00ffff,
    playerEmissive: 0x00cccc,
    playerVehicle: 'bike',
    aiColors: [{ color: 0xff0000, emissive: 0xcc0000 }],
    aiVehicles: ['bike'],
    duration: 1.5,
  };
}

function makeReplayPlayer(snap: ReplaySnapshot | null = null): MockReplayPlayer {
  const rp: MockReplayPlayer = {
    data: snap,
    playing: !!snap,
    speed: 1,
    time: 0,
    frameIndex: 0,
    loop: false,
    load: vi.fn((s: ReplaySnapshot) => { rp.data = s; rp.playing = true; rp.time = 0; }),
    seekTo: vi.fn((p: number) => { rp.time = p * (rp.data?.duration ?? 0); }),
    update: vi.fn(() => null),
    isFinished: vi.fn(() => false),
  };
  return rp;
}

type TestHost = Omit<IReplayModeHost, '_replayPlayer' | '_replayRecorder' | '_demoMode'> & {
  _replayPlayer: MockReplayPlayer;
  _replayRecorder: { hasData: () => boolean; getSnapshot: () => ReplaySnapshot };
  _demoMode: { teardown: () => void };
};

function createHost(overrides: Partial<TestHost> = {}): TestHost {
  const camera = new THREE.PerspectiveCamera();
  const base: TestHost = {
    // IGameCore
    scene: new THREE.Scene(),
    camera,
    state: 'menu' as GameState,
    mode: 'local',
    _fading: false,
    player: null,
    ais: [],
    _onlineMatch: null,
    _killcamPhase: 'none' as KillcamPhase,
    _killcamActive: false,
    _killcamPos: null,
    _killcamStartCamPos: null,
    _killcamTimer: 0,
    _killcamDelayTimer: 0,
    _spectating: false,
    cleanup: vi.fn(),
    _sceneFade: vi.fn(() => Promise.resolve()),

    // IReplayModeHost specific
    gameOverTimer: 0,
    bloomPass: null,
    baseBloomStrength: 1.0,
    adminBloomFreeze: false,
    _freeCamPos: new THREE.Vector3(),
    _freeCamYaw: 0,
    _freeCamPitch: 0,
    _freeCamVel: new THREE.Vector3(),
    _replayRecorder: {
      hasData: vi.fn(() => true),
      getSnapshot: vi.fn(() => makeSnapshot()),
    },
    _replayPlayer: makeReplayPlayer(makeSnapshot()),
    _prepDone: false,
    _prebuiltPlayerGhost: null,
    _prebuiltResultState: null,
    _radarPreRendered: false,
    _demoMode: { teardown: vi.fn() },
    returnToMenu: vi.fn(),
  };
  return Object.assign(base, overrides);
}

function asHost(h: TestHost): IReplayModeHost {
  return h as unknown as IReplayModeHost;
}

// ── DOM helpers ─────────────────────────────────────────────
function setupDOM(): void {
  const ids = [
    'replay-overlay', 'replay-status', 'replay-cam-val',
    'btn-replay-play', 'btn-replay-restart',
    'replay-progress-fill', 'replay-time', 'slowmo-overlay',
    'meter-wrap', 'overlay', 'result',
  ];
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
describe('ReplayMode construction', () => {
  it('initializes with overhead camera mode and defaults', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    expect(rm.camMode).toBe(0);
    expect(rm._replayCamMode).toBe(0);
    expect(rm._replayZoom).toBe(1);
    expect(rm._replayGhosts).toEqual([]);
    expect(rm._bgReplayActive).toBe(false);
    expect(rm._menuReplayActive).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// handleWheelZoom
// ═══════════════════════════════════════════════════════════
describe('handleWheelZoom', () => {
  it('updates overhead zoom in cam mode 0', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    rm._replayCamMode = 0;
    rm._replayZoom = 1;
    rm.handleWheelZoom(200);
    expect(rm._replayZoom).toBeCloseTo(1.2, 5);
  });

  it('clamps overhead zoom to [0.5, 3.5]', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    rm._replayCamMode = 0;
    rm._replayZoom = 1;
    rm.handleWheelZoom(10000);
    expect(rm._replayZoom).toBe(3.5);
    rm.handleWheelZoom(-100000);
    expect(rm._replayZoom).toBe(0.5);
  });

  it('routes to freeCamInput.zoomDelta in cam mode 1', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    rm._replayCamMode = 1;
    rm._freeCamInput = {};
    rm.handleWheelZoom(50);
    expect(rm._freeCamInput.zoomDelta).toBeCloseTo(0.5, 5);
  });

  it('does nothing in cam modes 2+', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    rm._replayCamMode = 2;
    rm._replayZoom = 1;
    rm.handleWheelZoom(500);
    expect(rm._replayZoom).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════
// setFreeCamInput / applyMouseLook
// ═══════════════════════════════════════════════════════════
describe('setFreeCamInput', () => {
  it('clears input when not in free cam mode', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    rm._replayCamMode = 0;
    rm.setFreeCamInput({ forward: true } as FreeCamInput);
    expect(rm._freeCamInput).toEqual({});
  });

  it('preserves zoomDelta when assigning new input', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    rm._replayCamMode = 1;
    rm._freeCamInput = { zoomDelta: 0.3 };
    rm.setFreeCamInput({ forward: true } as FreeCamInput);
    expect(rm._freeCamInput.forward).toBe(true);
    expect(rm._freeCamInput.zoomDelta).toBeCloseTo(0.3, 5);
  });
});

describe('applyMouseLook', () => {
  it('does nothing when freeCamInput is empty', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    rm._freeCamInput = {};
    rm.applyMouseLook(100, 100);
    expect(host._freeCamYaw).toBe(0);
    expect(host._freeCamPitch).toBe(0);
  });

  it('updates yaw/pitch when freeCamInput has content', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    rm._freeCamInput = { forward: true };
    rm.applyMouseLook(100, 50);
    expect(host._freeCamYaw).toBeCloseTo(-0.12, 3);
    expect(host._freeCamPitch).toBeCloseTo(0.06, 3);
  });

  it('clamps pitch to +/- pi/2', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    rm._freeCamInput = { forward: true };
    rm.applyMouseLook(0, 100000);
    expect(host._freeCamPitch).toBeCloseTo(1.5707, 3);
    rm.applyMouseLook(0, -100000);
    expect(host._freeCamPitch).toBeCloseTo(-1.5707, 3);
  });
});

// ═══════════════════════════════════════════════════════════
// Ghost lifecycle
// ═══════════════════════════════════════════════════════════
describe('_createGhost and _destroyGhosts', () => {
  it('creates a ghost with mesh, trail, and light', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    const ghost = rm._createGhost(0x00ffff, 0x00cccc, 'bike');
    expect(ghost.alive).toBe(true);
    expect(ghost.mesh).toBeDefined();
    expect(ghost.light).toBeDefined();
    expect(ghost.trail).toBeDefined();
    expect(ghost.lastTrailX).toBeNull();
    expect(ghost.lastTrailZ).toBeNull();
  });

  it('destroys all ghosts and clears array', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    rm._replayGhosts.push(rm._createGhost(0x00ffff, 0x00cccc, 'bike'));
    rm._replayGhosts.push(rm._createGhost(0xff0000, 0xcc0000, 'car'));
    rm._destroyGhosts();
    expect(rm._replayGhosts).toEqual([]);
    expect(spies.destroyTrail).toHaveBeenCalled();
  });
});

describe('_updateGhost', () => {
  it('marks ghost dead and hides mesh when state.alive=false', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    const ghost = rm._createGhost(0x00ffff, 0x00cccc, 'bike');
    const state: PlayerState = { x: 0, z: 0, angle: 0, speed: 0, boosting: false, dashing: false, alive: false };
    rm._updateGhost(ghost, state);
    expect(ghost.alive).toBe(false);
    expect(ghost.mesh.visible).toBe(false);
    expect(ghost.light.intensity).toBe(0);
  });

  it('updates mesh position/rotation for alive state', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    const ghost = rm._createGhost(0x00ffff, 0x00cccc, 'bike');
    const state: PlayerState = { x: 5, z: 7, angle: 1.5, speed: 20, boosting: false, dashing: false, alive: true };
    rm._updateGhost(ghost, state);
    expect(ghost.mesh.position.x).toBe(5);
    expect(ghost.mesh.position.z).toBe(7);
    expect(ghost.mesh.rotation.y).toBe(1.5);
  });

  it('adds trail point when moved > threshold', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    const ghost = rm._createGhost(0x00ffff, 0x00cccc, 'bike');
    const before = spies.addPoint.mock.calls.length;
    const state: PlayerState = { x: 10, z: 10, angle: 0, speed: 20, boosting: false, dashing: false, alive: true };
    rm._updateGhost(ghost, state);
    expect(spies.addPoint.mock.calls.length).toBeGreaterThan(before);
    expect(ghost.lastTrailX).toBe(10);
    expect(ghost.lastTrailZ).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════
// seekTo
// ═══════════════════════════════════════════════════════════
describe('seekTo', () => {
  it('delegates to the replay player and rebuilds ghost trails', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    // Pre-populate ghosts (player + 1 AI)
    rm._replayGhosts.push(rm._createGhost(0x00ffff, 0x00cccc, 'bike'));
    rm._replayGhosts.push(rm._createGhost(0xff0000, 0xcc0000, 'bike'));
    spies.destroyTrail.mockClear();
    rm.seekTo(0.5);
    expect(host._replayPlayer.seekTo).toHaveBeenCalledWith(0.5);
    expect(spies.destroyTrail).toHaveBeenCalled();
  });

  it('returns early when replay data is null', () => {
    const host = createHost();
    host._replayPlayer.data = null;
    const rm = new ReplayMode(asHost(host));
    rm._replayGhosts.push(rm._createGhost(0x00ffff, 0x00cccc, 'bike'));
    expect(() => rm.seekTo(0.25)).not.toThrow();
    expect(host._replayPlayer.seekTo).toHaveBeenCalledWith(0.25);
  });
});

// ═══════════════════════════════════════════════════════════
// cycleReplayCamera
// ═══════════════════════════════════════════════════════════
describe('cycleReplayCamera', () => {
  it('returns early when no replay data loaded', () => {
    const host = createHost();
    host._replayPlayer.data = null;
    const rm = new ReplayMode(asHost(host));
    rm.cycleReplayCamera(1);
    expect(rm._replayCamMode).toBe(0);
  });

  it('advances cam mode with dir=+1', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    rm._replayCamMode = 0;
    rm.cycleReplayCamera(1);
    expect(rm._replayCamMode).toBe(1); // free cam
  });

  it('wraps around when past the last cam mode', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    // Data has 1 aiColor → total cams = 2 + 1 + 1 = 4 (0,1,2,3).
    rm._replayCamMode = 3;
    rm.cycleReplayCamera(1);
    expect(rm._replayCamMode).toBe(0);
  });

  it('wraps around to last when going backwards from 0', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    rm._replayCamMode = 0;
    rm.cycleReplayCamera(-1);
    expect(rm._replayCamMode).toBe(3);
  });

  it('updates the cam label DOM element', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    rm._replayCamMode = 0;
    rm.cycleReplayCamera(1);
    expect(document.getElementById('replay-cam-val')!.textContent).toBe('FREE CAM');
    rm.cycleReplayCamera(1);
    expect(document.getElementById('replay-cam-val')!.textContent).toBe('PLAYER');
  });
});

// ═══════════════════════════════════════════════════════════
// Menu replay
// ═══════════════════════════════════════════════════════════
describe('startMenuReplay and stopMenuReplay', () => {
  it('marks menu replay active, creates ghosts, loads snapshot', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    const snap = makeSnapshot();
    rm.startMenuReplay(snap);
    expect(rm._menuReplayActive).toBe(true);
    expect(rm._replayGhosts.length).toBe(1 + snap.aiColors.length);
    expect(host._replayPlayer.load).toHaveBeenCalledWith(snap);
    expect(host.cleanup).toHaveBeenCalled();
    expect(spies.createArena).toHaveBeenCalled();
  });

  it('stopMenuReplay clears ghosts and disables playing', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    rm.startMenuReplay(makeSnapshot());
    rm.stopMenuReplay();
    expect(rm._menuReplayActive).toBe(false);
    expect(rm._replayGhosts).toEqual([]);
    expect(host._replayPlayer.playing).toBe(false);
  });

  it('stopMenuReplay is a no-op when not active', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    expect(() => rm.stopMenuReplay()).not.toThrow();
    expect(rm._menuReplayActive).toBe(false);
  });

  it('calls onDone callback reference is stored, not invoked by startMenuReplay', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    const onDone = vi.fn();
    rm.startMenuReplay(makeSnapshot(), onDone);
    expect(rm._menuReplayDone).toBe(onDone);
    expect(onDone).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════
// stopBgReplay / stopReplay
// ═══════════════════════════════════════════════════════════
describe('stopBgReplay', () => {
  it('is a no-op when bg replay is not active', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    rm._bgReplayActive = false;
    rm.stopBgReplay();
    expect(rm._bgReplayActive).toBe(false);
  });

  it('destroys ghosts and resets prep state when active', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    rm._bgReplayActive = true;
    rm._replayGhosts.push(rm._createGhost(0x00ffff, 0x00cccc, 'bike'));
    rm.stopBgReplay();
    expect(rm._bgReplayActive).toBe(false);
    expect(rm._replayGhosts).toEqual([]);
    expect(host._prepDone).toBe(false);
    expect(host._radarPreRendered).toBe(false);
  });
});

describe('stopReplay', () => {
  it('destroys ghosts, stops playback, resets camera, hides overlay', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    rm._replayGhosts.push(rm._createGhost(0x00ffff, 0x00cccc, 'bike'));
    rm._replayCamMode = 2;
    rm.stopReplay();
    expect(rm._replayGhosts).toEqual([]);
    expect(host._replayPlayer.playing).toBe(false);
    expect(rm._replayCamMode).toBe(0);
    expect(document.getElementById('replay-overlay')!.classList.contains('hidden')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// exitReplayToMenu
// ═══════════════════════════════════════════════════════════
describe('exitReplayToMenu', () => {
  it('stops the replay and returns to menu', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    rm._replayGhosts.push(rm._createGhost(0x00ffff, 0x00cccc, 'bike'));
    rm.exitReplayToMenu();
    expect(rm._replayGhosts).toEqual([]);
    expect(host._replayPlayer.playing).toBe(false);
    expect(host.returnToMenu).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════
// _resetPrepState
// ═══════════════════════════════════════════════════════════
describe('_resetPrepState', () => {
  it('clears prep flags and result state when no prebuilt ghost', () => {
    const host = createHost({
      _prepDone: true,
      _radarPreRendered: true,
      _prebuiltResultState: { _tag: 'result' } as unknown as IReplayModeHost['_prebuiltResultState'],
    });
    const rm = new ReplayMode(asHost(host));
    rm._resetPrepState();
    expect(host._prepDone).toBe(false);
    expect(host._radarPreRendered).toBe(false);
    expect(host._prebuiltResultState).toBeNull();
    expect(host._prebuiltPlayerGhost).toBeNull();
  });

  it('destroys and clears prebuilt player ghost when set', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    const ghost = rm._createGhost(0x00ffff, 0x00cccc, 'bike');
    host._prebuiltPlayerGhost = ghost as unknown as IReplayModeHost['_prebuiltPlayerGhost'];
    spies.destroyTrail.mockClear();
    rm._resetPrepState();
    expect(host._prebuiltPlayerGhost).toBeNull();
    expect(spies.destroyTrail).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════
// _findLastAlivePos
// ═══════════════════════════════════════════════════════════
describe('_findLastAlivePos', () => {
  it('walks backwards and returns position from last alive player frame', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    const frames: ReplayFrame[] = [
      makeFrame(0, 1, 2, true),
      makeFrame(0.5, 3, 4, true),
      makeFrame(1, 5, 6, false), // dead
    ];
    const pos = rm._findLastAlivePos(frames, 2, 'player');
    expect(pos).toEqual({ x: 3, z: 4 });
  });

  it('returns AI position when type=ai and aiIdx given', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    const aliveAi: PlayerState = { x: 7, z: 8, angle: 0, speed: 0, boosting: false, dashing: false, alive: true };
    const deadAi: PlayerState = { x: 9, z: 9, angle: 0, speed: 0, boosting: false, dashing: false, alive: false };
    const frames: ReplayFrame[] = [
      { t: 0, player: { x: 0, z: 0, angle: 0, speed: 0, boosting: false, dashing: false, alive: true }, ais: [aliveAi] },
      { t: 1, player: { x: 0, z: 0, angle: 0, speed: 0, boosting: false, dashing: false, alive: true }, ais: [deadAi] },
    ];
    const pos = rm._findLastAlivePos(frames, 1, 'ai', 0);
    expect(pos).toEqual({ x: 7, z: 8 });
  });

  it('falls back to ghost mesh position when no alive frames found', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    const ghost = rm._createGhost(0x00ffff, 0x00cccc, 'bike');
    ghost.mesh.position.x = 42;
    ghost.mesh.position.z = -13;
    rm._replayGhosts.push(ghost);
    const frames: ReplayFrame[] = [makeFrame(0, 0, 0, false)];
    const pos = rm._findLastAlivePos(frames, 0, 'player');
    expect(pos).toEqual({ x: 42, z: -13 });
  });

  it('returns origin when no ghost and no alive frames', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    const pos = rm._findLastAlivePos([], 0, 'player');
    expect(pos).toEqual({ x: 0, z: 0 });
  });
});

// ═══════════════════════════════════════════════════════════
// _rebuildGhostTrails
// ═══════════════════════════════════════════════════════════
describe('_rebuildGhostTrails', () => {
  it('is a no-op when no replay data', () => {
    const host = createHost();
    host._replayPlayer.data = null;
    const rm = new ReplayMode(asHost(host));
    expect(() => rm._rebuildGhostTrails(0.5)).not.toThrow();
  });

  it('replays frames up to seekTime into ghost trails', () => {
    const host = createHost();
    const rm = new ReplayMode(asHost(host));
    rm._replayGhosts.push(rm._createGhost(0x00ffff, 0x00cccc, 'bike'));
    rm._replayGhosts.push(rm._createGhost(0xff0000, 0xcc0000, 'bike'));
    spies.addPoint.mockClear();
    // Data has 4 frames at t=0,0.5,1,1.5 — seek to 0.6 should include first 2.
    rm._rebuildGhostTrails(0.6);
    // Player ghost gets 2 addPoints (one per frame <= 0.6).
    // AI list is empty in our mock snapshot, so only player ghost addPoints.
    expect(spies.addPoint.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(rm._replayGhosts[0].lastTrailX).toBe(1);
    expect(rm._replayGhosts[0].lastTrailZ).toBe(1);
  });
});
