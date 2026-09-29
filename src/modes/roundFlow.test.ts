import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IRoundFlowHost } from './roundFlow';
import { createFlowState } from '../flow/flowState';
import { createSlipstreamPhaseState } from '../effects/slipstreamVFX';

// ── Mock all heavy dependencies ────────────────────────────
vi.mock('../player', () => ({
  Player: class MockPlayer {
    mesh = { position: { x: 0, y: 0, z: 0 } };
    angle = 0;
    alive = true;
    vehicleType = 'bike';
    trail = { warmShaders: vi.fn() };
    constructor(_scene: unknown, _opts: unknown) {}
  },
}));
vi.mock('../grid', () => ({
  createArena: vi.fn(),
  ARENA_SIZE: 100,
  triggerCountdownPulse: vi.fn(),
  updateCountdownPulses: vi.fn(),
  clearCountdownPulses: vi.fn(),
}));
vi.mock('../ai', () => ({ createAIState: vi.fn(() => ({})) }));
vi.mock('../scene', () => ({
  updateCamera: vi.fn(),
  getCameraParams: vi.fn(() => ({ dist: 10, height: 8, fov: 60 })),
  seedCameraState: vi.fn(),
}));
vi.mock('../input', () => ({ TOUCH_ENABLED: false, isPhoneScreen: () => false }));
vi.mock('../gamepad', () => ({ getGamepadState: vi.fn(() => null) }));
vi.mock('../touch', () => ({ setTouchVehicle: vi.fn() }));
vi.mock('../sfx', () => ({
  getCtx: vi.fn(() => ({})),
  playCountdown: vi.fn(),
  stopProximitySpark: vi.fn(),
  playDefeat: vi.fn(),
  playVictory: vi.fn(),
}));
vi.mock('../vehicleAudioEngine', () => ({ stopVehicleEngine: vi.fn() }));
vi.mock('../vehicleSfxLoader', () => ({ preloadVehicleAudio: vi.fn(() => Promise.resolve()) }));
vi.mock('../spatialAudio', () => ({
  initListener: vi.fn(),
  createOpponentAudio: vi.fn(),
  startOpponentEngine: vi.fn(),
}));
vi.mock('../swallow', () => ({ warnDev: vi.fn() }));
vi.mock('../sfxAssets', () => ({
  preloadSfx: vi.fn(),
  playVehicleStart: vi.fn(),
  playGameOver: vi.fn(),
  playWinScreen: vi.fn(),
}));
vi.mock('../ui/mapSelectUI', () => ({ getSelectedMap: vi.fn(() => 'default') }));
vi.mock('../ui/difficultySelectUI', () => ({ getSelectedDifficulty: vi.fn(() => 'medium') }));
vi.mock('../ui/streakUI', () => ({
  hideStreakDisplay: vi.fn(),
  hideStreakEndInfo: vi.fn(),
  updateStreakEndInfo: vi.fn(),
  clearKillcamSparkles: vi.fn(),
}));
vi.mock('../utils', () => ({
  hexToCSS: vi.fn((c: number) => `#${c.toString(16).padStart(6, '0')}`),
  formatTime: vi.fn((t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`),
}));
vi.mock('../replayStore', () => ({ saveReplay: vi.fn(() => Promise.resolve('replay-id')) }));
vi.mock('../streak', () => ({
  getStreakForMode: vi.fn(() => 0),
  getBestStreakForMode: vi.fn(() => 0),
}));
vi.mock('../replay', () => ({ ReplayRecorder: vi.fn() }));
vi.mock('./demoMode', () => ({ DemoMode: vi.fn() }));
vi.mock('../flow/flowBridge', () => ({
  bridgeBeginRound: vi.fn(),
  bridgeEndRound: vi.fn(),
  bridgeElimination: vi.fn(),
  bridgeFrameTick: vi.fn(),
}));
vi.mock('../ui/flowHUD', () => ({
  initFlowHUD: vi.fn(),
  updateFlowHUD: vi.fn(),
  resetFlowHUD: vi.fn(),
  setFlowHudCharacterState: vi.fn(),
  setFlowStateRef: vi.fn(),
}));
vi.mock('../trail', () => ({ Trail: vi.fn() }));
vi.mock('three', () => {
  class Vector3 {
    x: number; y: number; z: number;
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    copy(v: Vector3) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  }
  class Quaternion {
    x = 0; y = 0; z = 0; w = 1;
    copy() { return this; }
    set() { return this; }
  }
  class Scene {}
  class PerspectiveCamera {
    position = new Vector3();
    fov = 60;
    lookAt = vi.fn();
    updateProjectionMatrix = vi.fn();
  }
  class PointLight {}
  class Group {
    visible = true;
    position = new Vector3();
  }
  return { Vector3, Quaternion, Scene, PerspectiveCamera, PointLight, Group };
});

const { RoundFlow } = await import('./roundFlow');
const { triggerCountdownPulse, updateCountdownPulses, clearCountdownPulses } = await import('../grid');
const { playCountdown } = await import('../sfx');
const { playVehicleStart } = await import('../sfxAssets');
const { hideStreakDisplay, hideStreakEndInfo, clearKillcamSparkles } = await import('../ui/streakUI');
const { seedCameraState, updateCamera } = await import('../scene');
const { stopProximitySpark } = await import('../sfx');
const { stopVehicleEngine } = await import('../vehicleAudioEngine');

// ── DOM helpers ─────────────────────────────────────────────
function ensureEl(id: string, tag = 'div'): HTMLElement {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement(tag);
    el.id = id;
    document.body.appendChild(el);
  }
  return el;
}

/** Create all DOM elements that RoundFlow methods read/write. */
function setupDOM(): void {
  const ids = [
    'scene-fade', 'countdown', 'countdown-num', 'meter-wrap', 'meter-fill',
    'meter-bar', 'radar', 'radar-wrap', 'match-timer', 'bottom-bar',
    'result', 'result-text', 'result-duration', 'result-streak',
    'result-streak-ended', 'series-result', 'spectator-label',
    'btn-continue', 'btn-result-loadout', 'btn-go-settings', 'btn-mainmenu',
    'btn-online-leave', 'btn-online-next', 'btn-online-rematch',
    'btn-return-lobby-result', 'online-next-timer', 'btn-replay-fav-result',
    'killcam-streak-overlay', 'killcam-new-record', 'killcam-streak-value',
    'result-match-selector', 'match-sel-label',
  ];
  for (const id of ids) ensureEl(id);

  // scene-fade needs a child with class scene-loader and scene-loader__text
  const fade = document.getElementById('scene-fade')!;
  if (!fade.querySelector('.scene-loader')) {
    const loader = document.createElement('div');
    loader.className = 'scene-loader';
    fade.appendChild(loader);
    const loaderText = document.createElement('div');
    loaderText.className = 'scene-loader__text';
    fade.appendChild(loaderText);
  }

  // result-streak needs a child .streak-num
  const rs = document.getElementById('result-streak')!;
  if (!rs.querySelector('.streak-num')) {
    const sn = document.createElement('span');
    sn.className = 'streak-num';
    rs.appendChild(sn);
  }
}

// ── Mock host factory ───────────────────────────────────────
function createMockHost(overrides: Partial<IRoundFlowHost> = {}): IRoundFlowHost {
  const camera = {
    position: { x: 0, y: 0, z: 0, clone: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }), set: vi.fn(), copy: vi.fn() },
    fov: 60,
    lookAt: vi.fn(),
    updateProjectionMatrix: vi.fn(),
  };

  const base: IRoundFlowHost = {
    // IGameCore
    scene: {} as any,
    camera: camera as any,
    state: 'menu' as any,
    mode: 'local',
    _fading: false,
    player: null,
    ais: [],
    _onlineMatch: null,
    _killcamPhase: 'none' as any,
    _killcamActive: false,
    _killcamPos: null,
    _killcamStartCamPos: null,
    _killcamTimer: 0,
    _killcamDelayTimer: 0,
    _spectating: false,
    cleanup: vi.fn(),
    _sceneFade: vi.fn(() => Promise.resolve()),

    // IRoundFlowHost specific
    matchTime: 0,
    gameOverTimer: 0,
    _lockstep: null,
    countdownTimer: 0,
    countdownNum: 3,
    onCountdownTick: null,
    playerColor: 0x00ffff,
    playerEmissive: 0x00cccc,
    _transitionCamStart: { x: 0, y: 0, z: 0, clone: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }), set: vi.fn(), copy: vi.fn() } as any,
    _transitionLookScratch: { x: 0, y: 0, z: 0, set: vi.fn() } as any,
    _transitionFovStart: 60,
    _transitionTimer: 0,
    _transitionDuration: 1.2,
    _victoryFireworks: false,
    _spectateTarget: null,
    _spectateCamState: null,
    _radarCtx: null,
    radarEnabled: true,
    radarMobileHide: false,
    opponentCount: 1,
    _seriesAiColors: [{ color: 0xff0000, emissive: 0xcc0000 }],
    _seriesAiVehicles: ['bike'],
    _lastStreakEnd: null,
    seriesLength: 1,
    seriesPlayerWins: 0,
    seriesAiWins: [0],
    seriesOver: false,
    _replayRecorder: { reset: vi.fn(), hasData: vi.fn(() => false), getSnapshot: vi.fn(() => ({})) } as any,
    _demoMode: { teardown: vi.fn() } as any,
    adminFreecam: false,
    _killcamData: null,
    _killcamDuration: 3,
    _pendingOnlineResult: null,
    _streakSparklesSpawned: false,
    _streakCeremony: null,
    _streakIncrementAnim: null,
    _prepDone: false,
    _prebuiltPlayerGhost: null,
    _prebuiltResultState: null,
    _radarPreRendered: false,
    _resultRadarCtx: null,
    streakData: { bo1: { currentStreak: 0, bestStreak: 0 }, bo3: { currentStreak: 0, bestStreak: 0 }, bo5: { currentStreak: 0, bestStreak: 0 } },
    stats: {} as any,
    _lastSavedReplayId: null,
    _lastReplaySnapshot: null,
    _seriesReplayIds: [],
    _selectedMatchIndex: 0,
    _lobbyOrigin: null,
    opponent: null,
    onMatchEnd: null,
    _flowState: createFlowState(),
    _lastFlowRoundResult: null,
    _slipstreamPhase: createSlipstreamPhaseState(),

    // Methods
    _refreshPlayerColor: vi.fn(),
    stopBgReplay: vi.fn(),
    _resetPrepState: vi.fn(),
    stopMenuReplay: vi.fn(),
    _updateStreak: vi.fn(),
    _updateSeriesHUD: vi.fn(),
    _beginWaitingForOpponent: vi.fn(),
    _beginCountdown: vi.fn(),
    _updateAdminFreecam: vi.fn(),
    _getStreakKey: vi.fn(() => 'bo1'),
    _drawRadar: vi.fn(),
    _createGhost: vi.fn(() => ({ mesh: { visible: true }, trail: {}, light: {}, lastTrailX: null, lastTrailZ: null, alive: true })),
    _ensureBgShatterPool: vi.fn(),
    startBgReplay: vi.fn(() => Promise.resolve()),
    _refreshMatchSelector: vi.fn(),
    _handleStreakLoss: vi.fn(),
    _clearSlipstreamOverlay: vi.fn(),
    _clearEnemySlipstreamVFX: vi.fn(),
    _getPlayerCSSColor: vi.fn(() => '#00ffff'),
    _buildSeriesDotsHTML: vi.fn(() => '<div class="series-dot"></div>'),
    _applyResultButtonVisibility: vi.fn(),
    _prepResultScreenEarly: vi.fn(),
    _prepResultScreenLate: vi.fn(),
    _prepareResultScreenDuringBlackout: vi.fn(() => Promise.resolve()),
    _showResultScreen: vi.fn(() => Promise.resolve()),
    _applyPrebuiltResultScreen: vi.fn(),
    _showResultScreenWaterfall: vi.fn(),
    _beginFlowRound: vi.fn(),
  };

  return Object.assign(base, overrides);
}

// ═══════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════

beforeEach(() => {
  setupDOM();
  vi.clearAllMocks();
});

afterEach(() => {
  // Clean up DOM
  document.body.innerHTML = '';
});

// ── Construction ────────────────────────────────────────────
describe('RoundFlow construction', () => {
  it('can be instantiated with a mock host', () => {
    const host = createMockHost();
    const flow = new RoundFlow(host);
    expect(flow).toBeDefined();
    expect(flow).toBeInstanceOf(RoundFlow);
  });
});

// ── beginCountdown ──────────────────────────────────────────
describe('beginCountdown', () => {
  it('sets state to countdown and resets timer', () => {
    const host = createMockHost({ state: 'transition' as any });
    const flow = new RoundFlow(host);

    flow.beginCountdown();

    expect(host.state).toBe('countdown');
    expect(host.countdownTimer).toBe(0);
    expect(host.countdownNum).toBe(3);
  });

  it('hides streak display', () => {
    const host = createMockHost();
    const flow = new RoundFlow(host);

    flow.beginCountdown();

    expect(hideStreakDisplay).toHaveBeenCalled();
  });

  it('hides streak end info and clears _lastStreakEnd', () => {
    const host = createMockHost({ _lastStreakEnd: { streak: 5, wasRecord: true, distanceToBest: 0 } });
    const flow = new RoundFlow(host);

    flow.beginCountdown();

    expect(hideStreakEndInfo).toHaveBeenCalled();
    expect(host._lastStreakEnd).toBeNull();
  });

  it('shows countdown element with number 3', () => {
    const host = createMockHost();
    const flow = new RoundFlow(host);

    flow.beginCountdown();

    const cd = document.getElementById('countdown')!;
    const cdNum = document.getElementById('countdown-num')!;
    expect(cd.classList.contains('hidden')).toBe(false);
    expect(cdNum.textContent).toBe('3');
  });

  it('triggers countdown pulse for 3', () => {
    const host = createMockHost();
    const flow = new RoundFlow(host);

    flow.beginCountdown();

    expect(triggerCountdownPulse).toHaveBeenCalledWith(host.scene, 3);
    expect(playCountdown).toHaveBeenCalledWith(false);
  });

  it('calls onCountdownTick callback with 3 if set', () => {
    const tickCb = vi.fn();
    const host = createMockHost({ onCountdownTick: tickCb });
    const flow = new RoundFlow(host);

    flow.beginCountdown();

    expect(tickCb).toHaveBeenCalledWith(3);
  });

  it('does not call onCountdownTick if null', () => {
    const host = createMockHost({ onCountdownTick: null });
    const flow = new RoundFlow(host);

    // Should not throw
    expect(() => flow.beginCountdown()).not.toThrow();
  });

  it('plays vehicle start sound when player exists', () => {
    const mockPlayer = { vehicleType: 'car', mesh: { position: { x: 0, y: 0, z: 0 } }, trail: { warmShaders: vi.fn() } };
    const host = createMockHost({ player: mockPlayer as any });
    const flow = new RoundFlow(host);

    flow.beginCountdown();

    expect(playVehicleStart).toHaveBeenCalledWith('car');
  });

  it('unhides meter-wrap and radar elements', () => {
    const host = createMockHost();
    const flow = new RoundFlow(host);

    document.getElementById('meter-wrap')!.classList.add('menu-hidden');
    document.getElementById('radar')!.classList.add('hidden');
    document.getElementById('match-timer')!.classList.add('hidden');

    flow.beginCountdown();

    expect(document.getElementById('meter-wrap')!.classList.contains('menu-hidden')).toBe(false);
    expect(document.getElementById('match-timer')!.classList.contains('hidden')).toBe(false);
  });

  it('updates series HUD', () => {
    const host = createMockHost();
    const flow = new RoundFlow(host);

    flow.beginCountdown();

    expect(host._updateSeriesHUD).toHaveBeenCalled();
  });
});

// ── updateTransition ────────────────────────────────────────
describe('updateTransition', () => {
  it('advances transition timer by dt', () => {
    const host = createMockHost({ _transitionTimer: 0, _transitionDuration: 1.0 });
    const flow = new RoundFlow(host);

    flow.updateTransition(0.5);

    expect(host._transitionTimer).toBe(0.5);
  });

  it('calls _beginCountdown when transition completes (local mode)', () => {
    const host = createMockHost({
      _transitionTimer: 0,
      _transitionDuration: 1.0,
      mode: 'local',
    });
    const flow = new RoundFlow(host);

    flow.updateTransition(1.0);

    expect(host._beginCountdown).toHaveBeenCalled();
  });

  it('calls _beginWaitingForOpponent when transition completes (online mode)', () => {
    const host = createMockHost({
      _transitionTimer: 0,
      _transitionDuration: 1.0,
      mode: 'online',
      _onlineMatch: {} as any,
    });
    const flow = new RoundFlow(host);

    flow.updateTransition(1.0);

    expect(host._beginWaitingForOpponent).toHaveBeenCalled();
    expect(host._beginCountdown).not.toHaveBeenCalled();
  });

  it('does not call begin methods when transition is incomplete', () => {
    const host = createMockHost({
      _transitionTimer: 0,
      _transitionDuration: 2.0,
    });
    const flow = new RoundFlow(host);

    flow.updateTransition(0.5);

    expect(host._beginCountdown).not.toHaveBeenCalled();
    expect(host._beginWaitingForOpponent).not.toHaveBeenCalled();
  });

  it('seeds camera state when transition reaches 1.0 and player exists', () => {
    const mockPlayer = {
      mesh: { position: { x: 5, y: 0, z: 5 } },
      angle: 0,
      trail: { warmShaders: vi.fn() },
    };
    const host = createMockHost({
      _transitionTimer: 0,
      _transitionDuration: 1.0,
      player: mockPlayer as any,
    });
    const flow = new RoundFlow(host);

    flow.updateTransition(1.0);

    expect(seedCameraState).toHaveBeenCalled();
  });

  it('interpolates camera position during transition with player', () => {
    const mockPlayer = {
      mesh: { position: { x: 10, y: 0, z: 10 } },
      angle: Math.PI / 4,
      trail: { warmShaders: vi.fn() },
    };
    const host = createMockHost({
      _transitionTimer: 0,
      _transitionDuration: 2.0,
      player: mockPlayer as any,
    });
    const flow = new RoundFlow(host);

    flow.updateTransition(1.0); // halfway

    // Camera position.set should have been called
    expect(host.camera.position.set).toHaveBeenCalled();
    expect(host.camera.updateProjectionMatrix).toHaveBeenCalled();
  });
});

// ── updateCountdown ─────────────────────────────────────────
describe('updateCountdown', () => {
  it('advances countdown timer by dt', () => {
    const host = createMockHost({ countdownTimer: 0, countdownNum: 3 });
    const flow = new RoundFlow(host);

    flow.updateCountdown(0.5);

    expect(host.countdownTimer).toBe(0.5);
  });

  it('transitions from 3 to 2 after 1 second', () => {
    const host = createMockHost({ countdownTimer: 0.9, countdownNum: 3 });
    const flow = new RoundFlow(host);

    flow.updateCountdown(0.2); // timer = 1.1, newNum = 3 - floor(1.1) = 2

    expect(host.countdownNum).toBe(2);
    expect(playCountdown).toHaveBeenCalledWith(false);
    expect(triggerCountdownPulse).toHaveBeenCalledWith(host.scene, 2);
  });

  it('transitions from 2 to 1 after 2 seconds', () => {
    const host = createMockHost({ countdownTimer: 1.9, countdownNum: 2 });
    const flow = new RoundFlow(host);

    flow.updateCountdown(0.2); // timer = 2.1, newNum = 3 - floor(2.1) = 1

    expect(host.countdownNum).toBe(1);
    expect(document.getElementById('countdown-num')!.textContent).toBe('1');
  });

  it('shows GO at 2.85 seconds', () => {
    const host = createMockHost({ countdownTimer: 2.8, countdownNum: 1 });
    const flow = new RoundFlow(host);

    flow.updateCountdown(0.1); // timer = 2.9 >= 2.85

    expect(host.countdownNum).toBe(0);
    expect(document.getElementById('countdown-num')!.textContent).toBe('GO');
    expect(playCountdown).toHaveBeenCalledWith(true);
    expect(triggerCountdownPulse).toHaveBeenCalledWith(host.scene, 0);
  });

  it('transitions to playing state at 3.5 seconds', () => {
    const host = createMockHost({ countdownTimer: 3.4, countdownNum: 0, state: 'countdown' as any });
    const flow = new RoundFlow(host);

    flow.updateCountdown(0.2); // timer = 3.6 >= 3.5

    expect(host.state).toBe('playing');
    expect(host.gameOverTimer).toBe(0);
    expect(clearCountdownPulses).toHaveBeenCalled();
  });

  it('hides countdown element when transitioning to playing', () => {
    const host = createMockHost({ countdownTimer: 3.4, countdownNum: 0, state: 'countdown' as any });
    const flow = new RoundFlow(host);

    flow.updateCountdown(0.2);

    expect(document.getElementById('countdown')!.classList.contains('hidden')).toBe(true);
  });

  it('calls onCountdownTick when number changes', () => {
    const tickCb = vi.fn();
    const host = createMockHost({ countdownTimer: 0.9, countdownNum: 3, onCountdownTick: tickCb });
    const flow = new RoundFlow(host);

    flow.updateCountdown(0.2);

    expect(tickCb).toHaveBeenCalledWith(2);
  });

  it('calls onCountdownTick with 0 for GO', () => {
    const tickCb = vi.fn();
    const host = createMockHost({ countdownTimer: 2.8, countdownNum: 1, onCountdownTick: tickCb });
    const flow = new RoundFlow(host);

    flow.updateCountdown(0.1);

    expect(tickCb).toHaveBeenCalledWith(0);
  });

  it('uses admin freecam when enabled', () => {
    const host = createMockHost({ adminFreecam: true, countdownTimer: 0, countdownNum: 3 });
    const flow = new RoundFlow(host);

    flow.updateCountdown(0.1);

    expect(host._updateAdminFreecam).toHaveBeenCalledWith(0.1);
    expect(updateCamera).not.toHaveBeenCalled();
  });

  it('updates camera with player when not admin freecam', () => {
    const mockPlayer = { mesh: { position: { x: 0, y: 0, z: 0 } }, angle: 0, trail: { warmShaders: vi.fn() } };
    const host = createMockHost({
      adminFreecam: false,
      countdownTimer: 0,
      countdownNum: 3,
      player: mockPlayer as any,
    });
    const flow = new RoundFlow(host);

    flow.updateCountdown(0.1);

    expect(updateCamera).toHaveBeenCalled();
    expect(host._updateAdminFreecam).not.toHaveBeenCalled();
  });

  it('starts online match playing and lockstep when transitioning to playing in online mode', () => {
    const startPlaying = vi.fn();
    const lockstepStart = vi.fn();
    const host = createMockHost({
      countdownTimer: 3.4,
      countdownNum: 0,
      state: 'countdown' as any,
      mode: 'online',
      _onlineMatch: { startPlaying } as any,
      _lockstep: { start: lockstepStart } as any,
    });
    const flow = new RoundFlow(host);

    flow.updateCountdown(0.2);

    expect(startPlaying).toHaveBeenCalled();
    expect(lockstepStart).toHaveBeenCalled();
  });

  it('does not change countdownNum when number stays the same', () => {
    const host = createMockHost({ countdownTimer: 0.1, countdownNum: 3 });
    const flow = new RoundFlow(host);

    flow.updateCountdown(0.1); // timer = 0.2, newNum = 3 - floor(0.2) = 3, same as current

    expect(host.countdownNum).toBe(3);
    // playCountdown should not be called again for same number
    expect(playCountdown).not.toHaveBeenCalled();
  });
});

// ── startCountdown ──────────────────────────────────────────
describe('startCountdown', () => {
  it('returns early if already fading', () => {
    const host = createMockHost({ _fading: true });
    const flow = new RoundFlow(host);

    flow.startCountdown();

    expect(host._refreshPlayerColor).not.toHaveBeenCalled();
  });

  it('sets _fading to true and calls _refreshPlayerColor', () => {
    const host = createMockHost({ _fading: false });
    const flow = new RoundFlow(host);

    flow.startCountdown();

    expect(host._fading).toBe(true);
    expect(host._refreshPlayerColor).toHaveBeenCalled();
  });

  it('saves camera start position for transition', () => {
    const host = createMockHost({ _fading: false });
    const flow = new RoundFlow(host);

    flow.startCountdown();

    expect(host.camera.position.clone).toHaveBeenCalled();
  });

  it('hides HUD elements during fade', () => {
    const host = createMockHost({ _fading: false });
    const flow = new RoundFlow(host);

    flow.startCountdown();

    expect(document.getElementById('meter-wrap')!.classList.contains('menu-hidden')).toBe(true);
    expect(document.getElementById('radar')!.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('match-timer')!.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('countdown')!.classList.contains('hidden')).toBe(true);
  });

  it('calls _sceneFade with true and label', () => {
    const host = createMockHost({ _fading: false });
    const flow = new RoundFlow(host);

    flow.startCountdown();

    expect(host._sceneFade).toHaveBeenCalledWith(true, 'ENTERING MATCH');
  });

  it('clears radar context if available', () => {
    const clearRect = vi.fn();
    const host = createMockHost({
      _fading: false,
      _radarCtx: { canvas: { width: 200 }, clearRect } as any,
    });
    const flow = new RoundFlow(host);

    flow.startCountdown();

    expect(clearRect).toHaveBeenCalledWith(0, 0, 200, 200);
  });
});

// ── prepResultScreenEarly ───────────────────────────────────
describe('prepResultScreenEarly', () => {
  it('creates ghost when replay data exists and no ghost yet', () => {
    const host = createMockHost({
      _prebuiltPlayerGhost: null,
      _replayRecorder: {
        hasData: vi.fn(() => true),
        getSnapshot: vi.fn(() => ({
          playerColor: 0x00ffff,
          playerEmissive: 0x00cccc,
          playerVehicle: 'bike',
        })),
        reset: vi.fn(),
      } as any,
    });
    const flow = new RoundFlow(host);

    flow.prepResultScreenEarly();

    expect(host._createGhost).toHaveBeenCalledWith(0x00ffff, 0x00cccc, 'bike');
    expect(host._prebuiltPlayerGhost).not.toBeNull();
  });

  it('does not create ghost when one already exists', () => {
    const host = createMockHost({
      _prebuiltPlayerGhost: { mesh: {}, trail: {}, light: {}, lastTrailX: null, lastTrailZ: null, alive: true } as any,
      _replayRecorder: { hasData: vi.fn(() => true), getSnapshot: vi.fn(), reset: vi.fn() } as any,
    });
    const flow = new RoundFlow(host);

    flow.prepResultScreenEarly();

    expect(host._createGhost).not.toHaveBeenCalled();
  });

  it('pre-renders radar when context exists', () => {
    const host = createMockHost({
      _resultRadarCtx: {} as any,
    });
    const flow = new RoundFlow(host);

    flow.prepResultScreenEarly();

    expect(host._drawRadar).toHaveBeenCalledWith(host._resultRadarCtx, 180);
    expect(host._radarPreRendered).toBe(true);
  });

  it('warms shatter pool', () => {
    const host = createMockHost();
    const flow = new RoundFlow(host);

    flow.prepResultScreenEarly();

    expect(host._ensureBgShatterPool).toHaveBeenCalled();
  });
});

// ── prepResultScreenLate ────────────────────────────────────
describe('prepResultScreenLate', () => {
  it('returns early if no killcam data', () => {
    const host = createMockHost({ _killcamData: null });
    const flow = new RoundFlow(host);

    flow.prepResultScreenLate();

    expect(host._prebuiltResultState).toBeNull();
  });

  it('builds result state for player victory', () => {
    const host = createMockHost({
      _killcamData: { roundResult: 'player', playerWonSeries: false, anyAiWonSeries: false },
      seriesLength: 1,
      matchTime: 42,
    });
    const flow = new RoundFlow(host);

    flow.prepResultScreenLate();

    expect(host._prebuiltResultState).not.toBeNull();
    expect(host._prebuiltResultState!.resultText).toBe('VICTORY');
    expect(host._prebuiltResultState!.audioCall).toBe('victory');
    expect(host._prebuiltResultState!.continueText).toBe('CONTINUE');
  });

  it('builds result state for AI win (FRIED)', () => {
    const host = createMockHost({
      _killcamData: { roundResult: 'ai', playerWonSeries: false, anyAiWonSeries: false },
      seriesLength: 1,
      matchTime: 30,
    });
    const flow = new RoundFlow(host);

    flow.prepResultScreenLate();

    expect(host._prebuiltResultState!.resultText).toBe('FRIED');
    expect(host._prebuiltResultState!.audioCall).toBe('defeat');
    expect(host._prebuiltResultState!.continueText).toBe('RESTART');
  });

  it('builds result state for draw', () => {
    const host = createMockHost({
      _killcamData: { roundResult: 'draw', playerWonSeries: false, anyAiWonSeries: false },
      seriesLength: 1,
    });
    const flow = new RoundFlow(host);

    flow.prepResultScreenLate();

    expect(host._prebuiltResultState!.resultText).toBe('DRAW');
    expect(host._prebuiltResultState!.audioCall).toBe('draw');
  });

  it('sets NEXT ROUND for multi-round series in progress', () => {
    const host = createMockHost({
      _killcamData: { roundResult: 'player', playerWonSeries: false, anyAiWonSeries: false },
      seriesLength: 3,
      matchTime: 15,
    });
    const flow = new RoundFlow(host);

    flow.prepResultScreenLate();

    expect(host._prebuiltResultState!.continueText).toBe('NEXT ROUND');
  });

  it('sets NEW SERIES when player won series', () => {
    const host = createMockHost({
      _killcamData: { roundResult: 'player', playerWonSeries: true, anyAiWonSeries: false },
      seriesLength: 3,
    });
    const flow = new RoundFlow(host);

    flow.prepResultScreenLate();

    expect(host._prebuiltResultState!.continueText).toBe('NEW SERIES');
  });

  it('sets NEW SERIES when AI won series', () => {
    const host = createMockHost({
      _killcamData: { roundResult: 'ai', playerWonSeries: false, anyAiWonSeries: true },
      seriesLength: 3,
    });
    const flow = new RoundFlow(host);

    flow.prepResultScreenLate();

    expect(host._prebuiltResultState!.continueText).toBe('NEW SERIES');
  });

  it('includes series HTML for multi-round', () => {
    const host = createMockHost({
      _killcamData: { roundResult: 'player', playerWonSeries: false, anyAiWonSeries: false },
      seriesLength: 3,
    });
    const flow = new RoundFlow(host);

    flow.prepResultScreenLate();

    expect(host._prebuiltResultState!.seriesHTML).not.toBeNull();
    expect(host._buildSeriesDotsHTML).toHaveBeenCalled();
  });

  it('sets seriesHTML to null for single-round', () => {
    const host = createMockHost({
      _killcamData: { roundResult: 'player', playerWonSeries: false, anyAiWonSeries: false },
      seriesLength: 1,
    });
    const flow = new RoundFlow(host);

    flow.prepResultScreenLate();

    expect(host._prebuiltResultState!.seriesHTML).toBeNull();
  });

  it('flags playGameOver when AI wins series', () => {
    const host = createMockHost({
      _killcamData: { roundResult: 'ai', playerWonSeries: false, anyAiWonSeries: false },
      seriesLength: 1,
      seriesOver: true,
    });
    const flow = new RoundFlow(host);

    flow.prepResultScreenLate();

    expect(host._prebuiltResultState!.playGameOver).toBe(true);
    expect(host._prebuiltResultState!.playWinScreen).toBe(false);
  });

  it('flags playWinScreen when player wins series', () => {
    const host = createMockHost({
      _killcamData: { roundResult: 'player', playerWonSeries: true, anyAiWonSeries: false },
      seriesLength: 1,
      seriesOver: true,
    });
    const flow = new RoundFlow(host);

    flow.prepResultScreenLate();

    expect(host._prebuiltResultState!.playWinScreen).toBe(true);
    expect(host._prebuiltResultState!.playGameOver).toBe(false);
  });
});

// ── prepareResultScreenDuringBlackout ───────────────────────
describe('prepareResultScreenDuringBlackout', () => {
  it('calls early prep when not done', async () => {
    const host = createMockHost({ _prepDone: false });
    const flow = new RoundFlow(host);

    await flow.prepareResultScreenDuringBlackout();

    expect(host._prepResultScreenEarly).toHaveBeenCalled();
    expect(host._prepDone).toBe(true);
  });

  it('does not call early prep when already done', async () => {
    const host = createMockHost({ _prepDone: true });
    const flow = new RoundFlow(host);

    await flow.prepareResultScreenDuringBlackout();

    expect(host._prepResultScreenEarly).not.toHaveBeenCalled();
  });

  it('calls late prep when no prebuilt state exists', async () => {
    const host = createMockHost({ _prepDone: true, _prebuiltResultState: null });
    const flow = new RoundFlow(host);

    await flow.prepareResultScreenDuringBlackout();

    expect(host._prepResultScreenLate).toHaveBeenCalled();
  });

  it('starts bg replay when recorder has data', async () => {
    const host = createMockHost({
      _prepDone: true,
      _prebuiltResultState: {} as any,
      _replayRecorder: { hasData: vi.fn(() => true), reset: vi.fn(), getSnapshot: vi.fn() } as any,
    });
    const flow = new RoundFlow(host);

    await flow.prepareResultScreenDuringBlackout();

    expect(host.startBgReplay).toHaveBeenCalled();
  });

  it('does not start bg replay when recorder has no data', async () => {
    const host = createMockHost({
      _prepDone: true,
      _prebuiltResultState: {} as any,
      _replayRecorder: { hasData: vi.fn(() => false), reset: vi.fn(), getSnapshot: vi.fn() } as any,
    });
    const flow = new RoundFlow(host);

    await flow.prepareResultScreenDuringBlackout();

    expect(host.startBgReplay).not.toHaveBeenCalled();
  });
});

// ── showResultScreen ────────────────────────────────────────
describe('showResultScreen', () => {
  it('returns early if already fading', async () => {
    const host = createMockHost({ _fading: true, _killcamData: { roundResult: 'player', playerWonSeries: false, anyAiWonSeries: false } });
    const flow = new RoundFlow(host);

    await flow.showResultScreen();

    expect(host._sceneFade).not.toHaveBeenCalled();
  });

  it('sets _fading and clears killcam state', async () => {
    const host = createMockHost({
      _fading: false,
      _killcamActive: true,
      _killcamData: { roundResult: 'player', playerWonSeries: false, anyAiWonSeries: false },
      _streakSparklesSpawned: true,
      _streakCeremony: { streak: 3, wasRecord: false, distanceToBest: 2, phase: 'pending' as const },
      _streakIncrementAnim: { prevStreak: 2, newStreak: 3, phase: 'pending' as const },
    });
    const flow = new RoundFlow(host);

    await flow.showResultScreen();

    expect(host._fading).toBe(false); // reset after completion
    expect(host._killcamActive).toBe(false);
    expect(host._streakSparklesSpawned).toBe(false);
    expect(host._streakCeremony).toBeNull();
    expect(host._streakIncrementAnim).toBeNull();
    expect(clearKillcamSparkles).toHaveBeenCalled();
  });

  it('calls sceneFade to black then from black', async () => {
    const host = createMockHost({
      _fading: false,
      _killcamData: { roundResult: 'player', playerWonSeries: false, anyAiWonSeries: false },
    });
    const flow = new RoundFlow(host);

    await flow.showResultScreen();

    // First call: fade to black
    expect(host._sceneFade).toHaveBeenCalledWith(true, 'MATCH RESULTS');
    // Second call: fade from black
    expect(host._sceneFade).toHaveBeenCalledWith(false);
  });

  it('uses prebuilt result screen when available', async () => {
    const host = createMockHost({
      _fading: false,
      _killcamData: { roundResult: 'player', playerWonSeries: false, anyAiWonSeries: false },
      _prebuiltResultState: { resultText: 'VICTORY' } as any,
    });
    const flow = new RoundFlow(host);

    await flow.showResultScreen();

    expect(host._applyPrebuiltResultScreen).toHaveBeenCalled();
  });

  it('falls back to waterfall when no prebuilt state', async () => {
    const host = createMockHost({
      _fading: false,
      _killcamData: { roundResult: 'ai', playerWonSeries: false, anyAiWonSeries: false },
      _prebuiltResultState: null,
      _prepareResultScreenDuringBlackout: vi.fn(async () => {
        // Simulate not setting _prebuiltResultState
      }),
    });
    const flow = new RoundFlow(host);

    await flow.showResultScreen();

    expect(host._showResultScreenWaterfall).toHaveBeenCalledWith('ai', false, false);
  });

  it('clears _killcamData after showing result', async () => {
    const host = createMockHost({
      _fading: false,
      _killcamData: { roundResult: 'player', playerWonSeries: false, anyAiWonSeries: false },
    });
    const flow = new RoundFlow(host);

    await flow.showResultScreen();

    expect(host._killcamData).toBeNull();
  });
});

// ── applyResultButtonVisibility ─────────────────────────────
describe('applyResultButtonVisibility', () => {
  it('hides online buttons in local mode', () => {
    const host = createMockHost({ mode: 'local' });
    const flow = new RoundFlow(host);

    flow.applyResultButtonVisibility();

    expect(document.getElementById('btn-online-leave')!.style.display).toBe('none');
    expect(document.getElementById('online-next-timer')!.style.display).toBe('none');
    expect(document.getElementById('btn-online-next')!.style.display).toBe('none');
    expect(document.getElementById('btn-online-rematch')!.style.display).toBe('none');
  });

  it('shows online buttons in online mode', () => {
    const host = createMockHost({ mode: 'online', seriesOver: false });
    const flow = new RoundFlow(host);

    flow.applyResultButtonVisibility();

    expect(document.getElementById('btn-continue')!.style.display).toBe('none');
    expect(document.getElementById('btn-result-loadout')!.style.display).toBe('none');
    expect(document.getElementById('btn-go-settings')!.style.display).toBe('none');
    expect(document.getElementById('btn-mainmenu')!.style.display).toBe('none');
    expect(document.getElementById('btn-online-leave')!.style.display).toBe('');
    expect(document.getElementById('online-next-timer')!.style.display).toBe('');
  });

  it('shows next button when series is not over (online)', () => {
    const host = createMockHost({ mode: 'online', seriesOver: false });
    const flow = new RoundFlow(host);

    flow.applyResultButtonVisibility();

    expect(document.getElementById('btn-online-next')!.style.display).toBe('');
    expect(document.getElementById('btn-online-rematch')!.style.display).toBe('none');
  });

  it('shows rematch button when series is over (online)', () => {
    const host = createMockHost({ mode: 'online', seriesOver: true });
    const flow = new RoundFlow(host);

    flow.applyResultButtonVisibility();

    expect(document.getElementById('btn-online-next')!.style.display).toBe('none');
    expect(document.getElementById('btn-online-rematch')!.style.display).toBe('');
  });

  it('shows return-to-lobby for local game started from lobby', () => {
    const host = createMockHost({
      mode: 'local',
      _lobbyOrigin: { lobbyId: 'test', role: 'host', aiColors: [], aiVehicles: [] },
    });
    const flow = new RoundFlow(host);

    flow.applyResultButtonVisibility();

    expect(document.getElementById('btn-return-lobby-result')!.style.display).toBe('');
  });

  it('hides return-to-lobby when no lobby origin', () => {
    const host = createMockHost({ mode: 'local', _lobbyOrigin: null });
    const flow = new RoundFlow(host);

    flow.applyResultButtonVisibility();

    expect(document.getElementById('btn-return-lobby-result')!.style.display).toBe('none');
  });
});

// ── buildSeriesDotsHTML ─────────────────────────────────────
describe('buildSeriesDotsHTML', () => {
  it('generates dots based on winsNeeded (bo3 = 2 dots)', () => {
    const host = createMockHost({
      seriesLength: 3,
      seriesPlayerWins: 1,
      seriesAiWins: [0],
      _seriesAiColors: [{ color: 0xff0000, emissive: 0xcc0000 }],
    });
    const flow = new RoundFlow(host);

    const html = flow.buildSeriesDotsHTML();

    // Should contain series-dot classes
    expect(html).toContain('series-dot');
    // One won dot for player
    expect(html).toContain('series-dot--won');
    // VS divider
    expect(html).toContain('VS');
  });

  it('generates dots for bo5 (3 dots needed)', () => {
    const host = createMockHost({
      seriesLength: 5,
      seriesPlayerWins: 2,
      seriesAiWins: [1],
      _seriesAiColors: [{ color: 0xff0000, emissive: 0xcc0000 }],
    });
    const flow = new RoundFlow(host);

    const html = flow.buildSeriesDotsHTML();

    // Count dots: 3 player + 3 AI = 6
    const dotCount = (html.match(/series-dot/g) || []).length;
    // Each dot class appears once per dot, won dots have both series-dot and series-dot--won
    expect(dotCount).toBeGreaterThanOrEqual(6);
  });
});

// ── triggerOnlineGameover ───────────────────────────────────
describe('triggerOnlineGameover', () => {
  it('sets state to gameover when not already in gameover', () => {
    const host = createMockHost({ state: 'playing' as any });
    const flow = new RoundFlow(host);

    flow.triggerOnlineGameover(true, false);

    expect(host.state).toBe('gameover');
  });

  it('activates killcam on first trigger', () => {
    const host = createMockHost({
      state: 'playing' as any,
      player: { mesh: { position: { x: 5, y: 0, z: 5 } }, alive: false } as any,
    });
    const flow = new RoundFlow(host);

    flow.triggerOnlineGameover(false, false);

    expect(host._killcamActive).toBe(true);
    expect(host._killcamPhase).toBe('slowmo');
    expect(host._killcamTimer).toBe(0);
  });

  it('sets roundResult to player on win', () => {
    const host = createMockHost({ state: 'playing' as any });
    const flow = new RoundFlow(host);

    flow.triggerOnlineGameover(true, false);

    expect(host._killcamData!.roundResult).toBe('player');
    expect(host._victoryFireworks).toBe(true);
  });

  it('sets roundResult to ai on loss', () => {
    const host = createMockHost({
      state: 'playing' as any,
      player: { mesh: { position: { x: 0, y: 0, z: 0 } }, alive: false } as any,
    });
    const flow = new RoundFlow(host);

    flow.triggerOnlineGameover(false, false);

    expect(host._killcamData!.roundResult).toBe('ai');
  });

  it('sets roundResult to draw', () => {
    const host = createMockHost({ state: 'playing' as any });
    const flow = new RoundFlow(host);

    flow.triggerOnlineGameover(false, true);

    expect(host._killcamData!.roundResult).toBe('draw');
  });

  it('computes seriesOver for single-round game', () => {
    const host = createMockHost({
      state: 'playing' as any,
      seriesLength: 1,
      seriesPlayerWins: 0,
      seriesAiWins: [0],
    });
    const flow = new RoundFlow(host);

    flow.triggerOnlineGameover(true, false);

    expect(host.seriesOver).toBe(true);
  });

  it('computes seriesOver for best-of-3 when player wins enough', () => {
    const host = createMockHost({
      state: 'playing' as any,
      seriesLength: 3,
      seriesPlayerWins: 2,
      seriesAiWins: [0],
    });
    const flow = new RoundFlow(host);

    flow.triggerOnlineGameover(true, false);

    expect(host.seriesOver).toBe(true);
    expect(host._killcamData!.playerWonSeries).toBe(true);
  });

  it('series not over when no one has enough wins in bo3', () => {
    const host = createMockHost({
      state: 'playing' as any,
      seriesLength: 3,
      seriesPlayerWins: 1,
      seriesAiWins: [0],
    });
    const flow = new RoundFlow(host);

    flow.triggerOnlineGameover(true, false);

    expect(host.seriesOver).toBe(false);
    expect(host._killcamData!.playerWonSeries).toBe(false);
    expect(host._killcamData!.anyAiWonSeries).toBe(false);
  });

  it('stores pending result when already in gameover', () => {
    const host = createMockHost({
      state: 'gameover' as any,
      seriesLength: 1,
      seriesPlayerWins: 0,
      seriesAiWins: [0],
    });
    const flow = new RoundFlow(host);

    flow.triggerOnlineGameover(true, false, 'uid-1');

    expect(host._pendingOnlineResult).toEqual({ iWon: true, isDraw: false, winnerUid: 'uid-1' });
  });

  it('calls _showResultScreen when already gameover and not in killcam or spectating', () => {
    const host = createMockHost({
      state: 'gameover' as any,
      _killcamActive: false,
      _spectating: false,
      seriesLength: 1,
      seriesPlayerWins: 0,
      seriesAiWins: [0],
    });
    const flow = new RoundFlow(host);

    flow.triggerOnlineGameover(true, false);

    expect(host._showResultScreen).toHaveBeenCalled();
  });

  it('does not call _showResultScreen when killcam is active', () => {
    const host = createMockHost({
      state: 'gameover' as any,
      _killcamActive: true,
      _spectating: false,
      seriesLength: 1,
      seriesPlayerWins: 0,
      seriesAiWins: [0],
    });
    const flow = new RoundFlow(host);

    flow.triggerOnlineGameover(true, false);

    expect(host._showResultScreen).not.toHaveBeenCalled();
  });

  it('clears slipstream and proximity effects on first trigger', () => {
    const host = createMockHost({ state: 'playing' as any });
    const flow = new RoundFlow(host);

    flow.triggerOnlineGameover(true, false);

    expect(host._clearEnemySlipstreamVFX).toHaveBeenCalled();
    expect(host._clearSlipstreamOverlay).toHaveBeenCalled();
  });

  it('calls onMatchEnd when no replay data', () => {
    const onMatchEnd = vi.fn();
    const host = createMockHost({
      state: 'playing' as any,
      _replayRecorder: { hasData: vi.fn(() => false), reset: vi.fn(), getSnapshot: vi.fn() } as any,
      onMatchEnd,
      matchTime: 25,
    });
    const flow = new RoundFlow(host);

    flow.triggerOnlineGameover(true, false);

    expect(onMatchEnd).toHaveBeenCalledWith('player', 25, 1, 1, null);
  });

  it('focuses killcam on player position when player lost', () => {
    const mockPlayer = {
      mesh: { position: { x: 15, y: 0, z: 20 } },
      alive: false,
    };
    const host = createMockHost({
      state: 'playing' as any,
      player: mockPlayer as any,
      _killcamPos: null,
      _killcamStartCamPos: null,
    });
    const flow = new RoundFlow(host);

    flow.triggerOnlineGameover(false, false); // player lost

    expect(host._killcamPos).not.toBeNull();
    expect(host._killcamPos!.x).toBe(15);
    expect(host._killcamPos!.y).toBe(0.7);
    expect(host._killcamPos!.z).toBe(20);
  });
});

// ── getPlayerCSSColor ───────────────────────────────────────
describe('getPlayerCSSColor', () => {
  it('returns hex CSS string from playerColor', () => {
    const host = createMockHost({ playerColor: 0x00ffff });
    const flow = new RoundFlow(host);

    const result = flow.getPlayerCSSColor();

    expect(result).toBe('#00ffff');
  });
});

// ── sceneFade ───────────────────────────────────────────────
describe('sceneFade', () => {
  it('adds active class for fade to black', () => {
    const host = createMockHost();
    const flow = new RoundFlow(host);

    // Start the fade (async, resolves on transitionend)
    const promise = flow.sceneFade(true, 'LOADING');

    const el = document.getElementById('scene-fade')!;
    expect(el.classList.contains('scene-fade--active')).toBe(true);

    // Simulate transitionend to resolve
    el.dispatchEvent(new Event('transitionend'));
    return promise;
  });

  it('sets label text for fade to black', () => {
    const host = createMockHost();
    const flow = new RoundFlow(host);

    flow.sceneFade(true, 'TEST LABEL');

    const loaderText = document.getElementById('scene-fade')!.querySelector('.scene-loader__text') as HTMLElement;
    expect(loaderText.textContent).toBe('TEST LABEL');
  });

  it('removes active class for fade from black', async () => {
    vi.useFakeTimers();
    const host = createMockHost();
    const flow = new RoundFlow(host);

    const el = document.getElementById('scene-fade')!;
    el.classList.add('scene-fade--active');

    const promise = flow.sceneFade(false);

    // Wait for the 150ms loader fade-out delay
    vi.advanceTimersByTime(150);
    expect(el.classList.contains('scene-fade--active')).toBe(false);

    // Simulate transitionend or safety timeout
    vi.advanceTimersByTime(450);
    vi.useRealTimers();

    await promise;
  });
});
