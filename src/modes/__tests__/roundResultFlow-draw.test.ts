// ── roundResultFlow draw-duration gate tests ─────────────────
// TASK-305: Verifies that XP is not awarded on draws shorter than
// MIN_DRAW_DURATION_SEC (15 s), but is awarded on draws at/over 15 s,
// and always awarded on win or loss regardless of duration.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IRoundFlowHost } from '../roundFlow';

// ── Mock all heavy/side-effectful dependencies ─────────────────

vi.mock('../../player', () => ({
  Player: class MockPlayer {
    mesh = { position: { x: 0, y: 0, z: 0 } };
    alive = true;
    constructor(_s: unknown, _o: unknown) {}
  },
}));

vi.mock('../../sfx', () => ({
  stopProximitySpark: vi.fn(),
  playDefeat: vi.fn(),
  playVictory: vi.fn(),
}));

vi.mock('../../vehicleAudioEngine', () => ({
  stopVehicleEngine: vi.fn(),
}));

vi.mock('../../sfxAssets', () => ({
  playGameOver: vi.fn(),
  playWinScreen: vi.fn(),
}));

vi.mock('../../ui/streakUI', () => ({
  hideStreakDisplay: vi.fn(),
  hideStreakEndInfo: vi.fn(),
  updateStreakEndInfo: vi.fn(),
}));

vi.mock('../../utils', () => ({
  formatTime: vi.fn((t: number) => `${t}s`),
}));

vi.mock('../../replayStore', () => ({
  saveReplay: vi.fn(() => Promise.resolve('replay-id')),
}));

vi.mock('../../streak', () => ({
  getStreakForMode: vi.fn(() => 0),
}));

vi.mock('../../ui/flowReveal', () => ({
  playFlowReveal: vi.fn(() => Promise.resolve()),
  resetFlowReveal: vi.fn(),
}));

vi.mock('../../flow/flowSubmit', () => ({
  storeLocalFlow: vi.fn(),
  getLocalFlow: vi.fn(() => ({ banked: 0, lifetime: 0 })),
  submitFlowReports: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../flow/flowBridge', () => ({
  bridgeEndRound: vi.fn(() => ({ awarded: 0, died: false, subtotal: 0, multiplier: 1, tierIndex: 0, passiveSubtotal: 0, bonusSubtotal: 0, capApplied: 'none', trickLog: [] })),
}));

vi.mock('../../ui/accountFlowDisplay', () => ({
  updateAccountFlowDisplay: vi.fn(),
}));

vi.mock('../../ui/xpReveal', () => ({
  renderXpBar: vi.fn(),
  cleanupXpBar: vi.fn(),
  skipXpAnimation: vi.fn(),
}));

const mockOnMatchComplete = vi.fn(() => ({ xpGained: 80, level: 1, totalXp: 80 }));
const mockTrackChallengeEvent = vi.fn();
const mockGetProgressionState = vi.fn(() => ({ level: 1, totalXp: 80 }));

vi.mock('../../progression/progressionManager', () => ({
  getProgressionState: mockGetProgressionState,
  onMatchComplete: mockOnMatchComplete,
  trackChallengeEvent: mockTrackChallengeEvent,
}));

vi.mock('../../progression/xpConfig', () => ({
  getXpForLevel: vi.fn(() => 0),
}));

const mockGetAuth = vi.fn();
vi.mock('firebase/auth', () => ({
  getAuth: mockGetAuth,
}));

vi.mock('three', () => {
  class Vector3 {
    x = 0; y = 0; z = 0;
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v: Vector3) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
  }
  return { Vector3 };
});

// ── Import the module under test ───────────────────────────────
const { showResultScreenWaterfall } = await import('../roundResultFlow');
const { renderXpBar } = await import('../../ui/xpReveal');

// ── DOM helpers ────────────────────────────────────────────────
function setupDOM(): void {
  const ids = [
    'result', 'result-text', 'result-duration', 'result-streak',
    'result-streak-ended', 'series-result', 'btn-continue',
    'result-match-selector', 'match-sel-label',
  ];
  for (const id of ids) {
    if (!document.getElementById(id)) {
      const el = document.createElement('div');
      el.id = id;
      document.body.appendChild(el);
    }
  }
  // result-streak needs .streak-num child
  const rs = document.getElementById('result-streak')!;
  if (!rs.querySelector('.streak-num')) {
    const sn = document.createElement('span');
    sn.className = 'streak-num';
    rs.appendChild(sn);
  }
}

// ── Mock host factory ──────────────────────────────────────────
function createMockHost(matchTime: number): IRoundFlowHost {
  return {
    // IGameCore stubs
    scene: {} as any,
    camera: { position: { x: 0, y: 0, z: 0 } } as any,
    state: 'gameover' as any,
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

    // Round-flow fields
    matchTime,
    gameOverTimer: 0,
    _lockstep: null,
    countdownTimer: 0,
    countdownNum: 3,
    onCountdownTick: null,
    playerColor: 0x00ffff,
    playerEmissive: 0x00cccc,
    _transitionCamStart: { x: 0, y: 0, z: 0 } as any,
    _transitionLookScratch: { x: 0, y: 0, z: 0 } as any,
    _transitionFovStart: 60,
    _transitionTimer: 0,
    _transitionDuration: 1.2,
    _victoryFireworks: false,
    _spectateTarget: null,
    _spectateCamState: null,
    _radarCtx: null,
    radarEnabled: false,
    radarMobileHide: false,
    opponentCount: 1,
    _seriesAiColors: [],
    _seriesAiVehicles: [],
    _lastStreakEnd: null,
    seriesLength: 1,
    seriesPlayerWins: 0,
    seriesAiWins: [0],
    seriesOver: false,
    currentSeriesId: null,
    _replayRecorder: { reset: vi.fn(), hasData: vi.fn(() => false), getSnapshot: vi.fn() } as any,
    _demoMode: {} as any,
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
    streakData: {
      bo1: { currentStreak: 0, bestStreak: 0 },
      bo3: { currentStreak: 0, bestStreak: 0 },
      bo5: { currentStreak: 0, bestStreak: 0 },
    },
    stats: {} as any,
    _lastSavedReplayId: null,
    _lastReplaySnapshot: null,
    _seriesReplayIds: [],
    _selectedMatchIndex: 0,
    _lobbyOrigin: null,
    opponent: null,
    onMatchEnd: null,
    _flowState: {} as any,
    _lastFlowRoundResult: null,
    _slipstreamPhase: { phase: 'idle', phaseStart: 0, proximityBoost: 0, active: false },

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
    _createGhost: vi.fn(),
    _ensureBgShatterPool: vi.fn(),
    startBgReplay: vi.fn(() => Promise.resolve()),
    _refreshMatchSelector: vi.fn(),
    _handleStreakLoss: vi.fn(),
    _clearSlipstreamOverlay: vi.fn(),
    _clearEnemySlipstreamVFX: vi.fn(),
    _getPlayerCSSColor: vi.fn(() => '#00ffff'),
    _buildSeriesDotsHTML: vi.fn(() => ''),
    _applyResultButtonVisibility: vi.fn(),
    _prepResultScreenEarly: vi.fn(),
    _prepResultScreenLate: vi.fn(),
    _prepareResultScreenDuringBlackout: vi.fn(() => Promise.resolve()),
    _showResultScreen: vi.fn(() => Promise.resolve()),
    _applyPrebuiltResultScreen: vi.fn(),
    _showResultScreenWaterfall: vi.fn(),
    _beginFlowRound: vi.fn(),
  };
}

// ── Test suite ─────────────────────────────────────────────────
describe('showResultScreenWaterfall — draw duration gate (TASK-305)', () => {
  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    // Default: logged-in user
    mockGetAuth.mockReturnValue({
      currentUser: { isAnonymous: false },
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does NOT call onMatchComplete on draw under 15 seconds', () => {
    const host = createMockHost(14); // 14 s — under threshold
    showResultScreenWaterfall(host, 'draw', false, false);
    expect(mockOnMatchComplete).not.toHaveBeenCalled();
  });

  it('calls renderXpBar with null result on draw under 15 seconds', () => {
    const host = createMockHost(10); // 10 s
    showResultScreenWaterfall(host, 'draw', false, false);
    expect(renderXpBar).toHaveBeenCalledWith(
      null,         // xpResult must be null
      false,        // isAnon
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('does NOT track challenge events on draw under 15 seconds', () => {
    const host = createMockHost(5);
    showResultScreenWaterfall(host, 'draw', false, false);
    expect(mockTrackChallengeEvent).not.toHaveBeenCalled();
  });

  it('calls onMatchComplete on draw exactly at 15 seconds', () => {
    const host = createMockHost(15); // exactly at threshold
    showResultScreenWaterfall(host, 'draw', false, false);
    expect(mockOnMatchComplete).toHaveBeenCalledOnce();
  });

  it('calls onMatchComplete on draw over 15 seconds', () => {
    const host = createMockHost(30); // well above threshold
    showResultScreenWaterfall(host, 'draw', false, false);
    expect(mockOnMatchComplete).toHaveBeenCalledOnce();
  });

  it('calls onMatchComplete on win regardless of duration (short match)', () => {
    const host = createMockHost(5); // very short win
    showResultScreenWaterfall(host, 'player', false, false);
    expect(mockOnMatchComplete).toHaveBeenCalledOnce();
  });

  it('calls onMatchComplete on loss regardless of duration (short match)', () => {
    const host = createMockHost(3); // very short loss
    showResultScreenWaterfall(host, 'ai', false, false);
    expect(mockOnMatchComplete).toHaveBeenCalledOnce();
  });

  it('never calls onMatchComplete for anonymous user even on win', () => {
    mockGetAuth.mockReturnValue({
      currentUser: { isAnonymous: true },
    });
    const host = createMockHost(60);
    showResultScreenWaterfall(host, 'player', false, false);
    expect(mockOnMatchComplete).not.toHaveBeenCalled();
  });

  it('passes correct won flag to onMatchComplete on draw >= 15 s', () => {
    const host = createMockHost(15);
    showResultScreenWaterfall(host, 'draw', false, false);
    expect(mockOnMatchComplete).toHaveBeenCalledWith(
      expect.objectContaining({ won: false }),
    );
  });
});
