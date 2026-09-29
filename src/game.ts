import { Player, warmDeathShader } from './player';
import { createArena, getArenaReactive } from './grid';
import { grid } from './spatialGrid';
import { updateSynthCity } from './arena/arenaSynthCityBuilder';
import { isPhoneScreen } from './input';
import { getGamepadState } from './gamepad';
import { updateCamera } from './scene';
import type { CameraState } from './scene';
import { ReplayRecorder, ReplayPlayer } from './replay';
import { Trail } from './trail';
import * as THREE from 'three';


import { setMusicDampen } from './audio';
import { setSfxDampen } from './sfx';
import { GrindAlertOverlay } from './ui/grindAlertOverlay';
import { getGfx, onSettingsChange } from './graphics';
import { clearEnemySlipstreamVFX } from './core/collisionSystem';
import { checkCollisions as checkCollisionsExternal } from './core/gameCollisions';
import { cleanupGame, pickSeriesAiColors, returnToMenu as returnToMenuExternal, updateAdminFreecam, updateAudioReactivity, updateGameover, updatePlaying } from './gameUpdate';
import type { ColorEntry, AIState, AIInput, GfxSettings, ReplaySnapshot, ReplayFrame, InterpolatedReplayFrame, PlayerState, VehicleType, MapType, GameState, KillcamPhase, KillcamData, GameStats, FreeCamInput, ColorMap, PrebuiltResultState } from './types/index';
import { getSelectedMap } from './ui/mapSelectUI';
import type { OnlineMatch } from './onlineMatch';
import type { BloomPassLike } from './types/index';
import { LockstepManager } from './core/lockstepManager';
import { DelayAdvisor } from './core/inputBuffer';
import { DemoMode, type DemoParticipant } from './modes/demoMode';
import { ReplayMode } from './modes/replayMode';
import { OnlineMode } from './modes/onlineMode';
import { RoundFlow } from './modes/roundFlow';
import { SpectatorMode } from './modes/spectatorMode';
import { PLAYER_COLOR_KEYS, PLAYER_COLOR_MAP } from './playerColors';
import {
  getStreakKey, getStreakForMode, getBestStreakForMode,
  resetStreak, loadStreaks, saveStreaks,
  isNewRecord, getDistanceToBest,
  type StreakKey,
} from './streak';
import type { StreakData } from './types';
import {
  updateStreakDisplay, hideStreakDisplay,
} from './ui/streakUI';
import { drawRadar as _drawRadarImpl, drawSettingsPreview as _drawSettingsPreviewImpl } from './ui/radarRenderer';
import { updateMeterHUD, type HudState } from './ui/meterHUD';
import { initFlowHUD, updateFlowHUD, resetFlowHUD, setFlowStateRef, updateFlowGlitch } from './ui/flowHUD';
import { createSlipstreamPhaseState, updateSlipstreamPhase, getSlipstreamBodyClass, getSlipstreamIntensity, getChromaticStrength, type SlipstreamPhaseState } from './effects/slipstreamVFX';
import { createFlowState, getSnapshot as getFlowSnapshot } from './flow/flowState';
import type { FlowState } from './flow/flowState';
import { bridgeBeginRound, bridgeFrameTick, bridgeElimination, bridgeEndRound } from './flow/flowBridge';
import type { RoundResult as FlowRoundResult } from './flow/flowTypes';
import {
  handleStreakLoss as _handleStreakLossImpl, updateStreakCeremony, updateStreakIncrement, startStreakVaporize,
  type StreakCeremony, type StreakIncrementAnim,
} from './ui/streakCeremony';

interface AudioBands {
  bass: number; lowMid: number; mid: number; upperMid: number; presence: number;
  brilliance: number; high: number; air: number; energy: number; kick: number;
}

interface AIEntry {
  player: Player;
  aiState: AIState | null;
  colorHex: number;
  uid?: string;        // set for remote human players; undefined for lobby AI bots
  _lastInput?: AIInput;
  _wasBoosting?: boolean;
  _wasDashing?: boolean;
  _wasDrifting?: boolean;
  _wasFumes?: boolean;
  _wasGrinding?: boolean;
  _prevAngle?: number;
  _lastSwooshTime?: number;
  _prevRadialV?: number;
}

interface GhostEntry {
  mesh: THREE.Group;
  trail: Trail;
  light: THREE.PointLight;
  lastTrailX: number | null;
  lastTrailZ: number | null;
  alive: boolean;
}

// ── Slipstream overlay driver (used by _clearSlipstreamOverlay wrapper) ──
let _slipOverlay: HTMLElement | null = null;
function clearSlipstreamOverlay(): void {
  if (!_slipOverlay) _slipOverlay = document.getElementById('slipstream-overlay');
  if (!_slipOverlay) return;
  _slipOverlay.classList.remove('slipstream--active');
  _slipOverlay.style.setProperty('--slip-alpha', '0');
  _slipOverlay.style.setProperty('--slip-chroma', '0');
  // SPEC-93: remove phase body classes so they don't persist through killcam/results
  document.body.classList.remove('slipstream-phase-entry', 'slipstream-phase-lockin', 'slipstream-phase-active');
  _slipOverlay.style.setProperty('--slip-offset', '0');
}

export class Game {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  bloomPass: BloomPassLike | null;
  baseBloomStrength: number;
  _cachedBloomRadius: number;
  _cachedBloomThreshold: number;
  deathWarmup: Promise<void>;
  state: GameState = 'menu'; // menu, countdown, playing, paused, gameover
  mode: string = 'local'; // local, online
  _onlineMatch: OnlineMatch | null = null;
  _lockstep: LockstepManager | null = null;
  _delayAdvisor: DelayAdvisor = new DelayAdvisor();
  _lockstepHumanCount: number = 0;
  _lockstepMyIndex: number = 0;
  _lockstepAiStates: AIState[] = [];
  opponent: Player | null = null; // remote Player in online mode
  player: Player | null = null;
  ais: AIEntry[] = [];      // array of { player, aiState, colorHex }
  gameOverTimer: number = 0;

  // Killcam
  _killcamActive: boolean = false;
  _killcamTimer: number = 0;
  _killcamDuration: number = 1.2;
  _killcamDelay: number = 0.25;
  _killcamDelayTimer: number = 0;
  _killcamPhase: KillcamPhase = 'none'; // none, slowmo, orbit
  _killcamPos: THREE.Vector3 | null = null;
  _killcamStartCamPos: THREE.Vector3 | null = null;
  _killcamData: KillcamData | null = null; // deferred gameover data
  _killcamScratch: THREE.Vector3 | null = null;

  // Spectator (action camera after killcam when AIs still fighting)
  _spectating: boolean = false;
  _spectateTarget: Player | null = null;
  _spectateCamState: CameraState | null = null;
  _spectateRetargetTimer: number = 0;

  opponentCount: number = 1;
  _pendingOnlineResult: { iWon: boolean; isDraw: boolean; winnerUid?: string } | null = null;
  // Lobby origin — set when a local game is started from a lobby
  _lobbyOrigin: { lobbyId: string; role: 'host' | 'guest'; aiColors: ColorEntry[]; aiVehicles: VehicleType[] } | null = null;

  // Countdown
  countdownTimer: number = 0;
  countdownNum: number = 3;

  // Color selection
  _colorMap: ColorMap = PLAYER_COLOR_MAP;
  playerColor: number;
  playerEmissive: number;

  // Streak
  streakData: StreakData;
  _streakCeremony: StreakCeremony | null = null;
  _streakCeremonyTimer: number = 0;
  _lastStreakEnd: { streak: number; wasRecord: boolean; distanceToBest: number } | null = null;
  _streakIncrementAnim: StreakIncrementAnim | null = null;
  _streakIncrementTimer: number = 0;
  _streakSparklesSpawned: boolean = false;
  matchTime: number = 0;
  /** Integer tick counter for single-player grind SimContext (increments per game update frame). */
  _localTick: number = 0;

  // Series (best-of)
  seriesLength: number = 1; // 1 = single, 3 = bo3, 5 = bo5
  seriesPlayerWins: number = 0;
  seriesAiWins: number[] = []; // per-AI win counts
  seriesOver: boolean = false;
  _seriesAiColors: ColorEntry[] = [];
  _seriesAiVehicles: VehicleType[] = [];
  // TASK-292: stable UUID linking all rounds of a best-of; null for BO1.
  // Lives through the end-of-series save; cleared when the next series starts.
  private _currentSeriesId: string | null = null;

  // Stats (persisted)
  stats: GameStats;

  // Callback for post-match leaderboard submission
  onMatchEnd: ((result: string, matchTime: number, seriesLength: number, opponentCount: number, replayId: string | null) => void) | null = null;
  onCountdownTick: ((num: number) => void) | null = null;

  // Radar canvas ref
  _radarCtx: CanvasRenderingContext2D | null;
  _resultRadarCtx: CanvasRenderingContext2D | null;
  radarEnabled: boolean = true;
  radarMobileHide: boolean = true;

  // Cached HUD DOM refs (avoid getElementById per frame)
  _elMeterFill: HTMLElement;
  _elMeterBar: HTMLElement;
  _elMeterSpark: HTMLElement;
  _elMeterLabel: HTMLElement;
  _elMeterWrap: HTMLElement;
  _elMatchTimer: HTMLElement;
  _lastTimerSecs: number = -1;

  // Reusable per-frame arrays (avoid allocation every frame)
  _scratchTrails: Trail[] = [];
  _scratchPlayers: Player[] = [];

  // Menu demo (delegated to DemoMode)
  _demoMode: DemoMode;
  settingsOpen: boolean = false;

  // EQ bars
  _eqBars: (HTMLElement | null)[] = [];

  // Online mode (delegated to OnlineMode)
  _onlineMode: OnlineMode;

  // Round flow (delegated to RoundFlow)
  _roundFlow: RoundFlow;

  // Spectator mode (delegated to SpectatorMode)
  _spectatorMode: SpectatorMode;

  // Replay system (delegated to ReplayMode)
  _replayMode: ReplayMode;
  _replayRecorder: ReplayRecorder = new ReplayRecorder();
  _replayPlayer: ReplayPlayer = new ReplayPlayer();
  _freeCamPos: THREE.Vector3 = new THREE.Vector3(0, 60, 80);
  _freeCamYaw: number = 0;
  _freeCamPitch: number = 0.6;
  _freeCamVel: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  adminFreecam: boolean = false;
  adminFreecamInput: FreeCamInput = {};
  _lastSavedReplayId: string | null = null;
  _seriesReplayIds: string[] = [];
  _selectedMatchIndex: number = 0;
  _lastReplaySnapshot: ReplaySnapshot | null = null;

  // Result screen prep (shared with result flow)
  _prepDone: boolean = false;
  _prebuiltPlayerGhost: GhostEntry | null = null;
  _prebuiltResultState: PrebuiltResultState | null = null;
  _radarPreRendered: boolean = false;

  // Menu background mode
  _menuBgMode: string = 'ai';

  // Grind alert overlay
  _grindAlertOverlay: GrindAlertOverlay = new GrindAlertOverlay();
  _grindAlertCooldown: number = 0;

  // Transition
  _fading: boolean = false;
  _lastTurnSwooshTime: number = 0;
  _transitionCamStart: THREE.Vector3 = new THREE.Vector3();
  _transitionLookScratch: THREE.Vector3 = new THREE.Vector3();
  _transitionFovStart: number = 55;
  _transitionTimer: number = 0;
  _transitionDuration: number = 1.2;

  // Victory fireworks
  _victoryFireworks: boolean = false;

  // Audio bands
  _lastBands: AudioBands | null = null;

  // AI frame counter
  _aiFrame: number = 0;

  // Admin panel freeze — skip audio-reactive bloom writes
  adminBloomFreeze: boolean = false;
  // Admin god mode — freeze AI, disable player collision & trail
  adminGodMode: boolean = false;
  // Admin time scale (1 = normal, <1 = slow-mo, >1 = fast-forward)
  timeScale: number = 1;

  // Paused state
  _pausedFrom: GameState = 'playing';

  // HUD state debounce
  _hudState: HudState | null = null;
  _hudStateTimer: number = 0;
  _sparkBurst: number = 1;
  _prevLocked: boolean = false;
  _flowState: FlowState = createFlowState();
  _lastFlowRoundResult: FlowRoundResult | null = null;
  _slipstreamPhase: SlipstreamPhaseState = createSlipstreamPhaseState();

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, bloomPass: BloomPassLike | null) {
    this.scene = scene;
    this.camera = camera;
    this.bloomPass = bloomPass;
    scene.userData._bloomPass = this.bloomPass;
    this.baseBloomStrength = getGfx().bloom.strength || 1.0;
    this._cachedBloomRadius = getGfx().bloom.radius || 0.16;
    this._cachedBloomThreshold = getGfx().bloom.threshold || 0.7;
    this.deathWarmup = warmDeathShader(scene);

    // Color selection — random if none saved
    const saved: string | null = localStorage.getItem('luminal-color');
    const colorKeys: string[] = [...PLAYER_COLOR_KEYS];
    const activeKey: string = saved && this._colorMap[saved]
      ? saved
      : colorKeys[Math.floor(Math.random() * colorKeys.length)];
    this.playerColor = this._colorMap[activeKey].color;
    this.playerEmissive = this._colorMap[activeKey].emissive;

    // Streak + persisted stats
    this.streakData = loadStreaks();
    this.stats = JSON.parse(localStorage.getItem('luminal-stats') || '{"wins":0,"losses":0,"draws":0,"bestStreak":0,"totalTime":0,"matchCount":0}');

    // Radar canvas ref
    this._radarCtx = (document.getElementById('radar-canvas') as HTMLCanvasElement | null)?.getContext('2d') || null;
    this._resultRadarCtx = (document.getElementById('result-radar') as HTMLCanvasElement | null)?.getContext('2d') || null;

    // Cache HUD DOM refs to avoid per-frame getElementById
    this._elMeterFill = document.getElementById('meter-fill')!;
    this._elMeterBar = document.getElementById('meter-bar')!;
    this._elMeterSpark = document.getElementById('meter-spark')!;
    this._elMeterLabel = document.getElementById('meter-label')!;
    this._elMeterWrap = document.getElementById('meter-wrap')!;
    this._elMatchTimer = document.getElementById('match-timer')!;

    // FLOW HUD refs (SPEC-90)
    const flowWrap = document.getElementById('flow-hud');
    const flowValue = document.getElementById('flow-hud-value');
    const flowMult = document.getElementById('flow-hud-mult');
    const flowBankLayer = document.getElementById('flow-hud-bank-layer');
    if (flowWrap && flowValue && flowMult && flowBankLayer) {
      initFlowHUD({ wrap: flowWrap, value: flowValue, mult: flowMult, bankLayer: flowBankLayer });
      setFlowStateRef(this._flowState);
    }

    // Mode / round / spectator / demo / replay sub-systems
    this._onlineMode = new OnlineMode(this);
    this._roundFlow = new RoundFlow(this);
    this._spectatorMode = new SpectatorMode(this);
    this._demoMode = new DemoMode(this);
    this._replayMode = new ReplayMode(this);

    // Cache EQ bar elements
    for (let i = 1; i <= 5; i++) {
      this._eqBars.push(document.getElementById('eq' + i));
    }

    // React to graphics quality changes — rebuild arena for immediate feedback
    onSettingsChange((g: GfxSettings) => {
      this.baseBloomStrength = g.bloom.strength || 1.0;
      this._cachedBloomRadius = g.bloom.radius || 0.16;
      this._cachedBloomThreshold = g.bloom.threshold || 0.7;
      // Rebuild arena if in menu/demo (safe to tear down and recreate)
      if (this.state === 'menu') {
        this.cleanup();
        createArena(this.scene, getSelectedMap());
        this._demoMode.start();
      }
    });

    // Kick off menu demo
    this._demoMode.start();
  }

  // ── Menu Demo (delegated to DemoMode) ──────────────────
  get demoPlayer1(): Player | null { return this._demoMode.demoPlayer1; }
  set demoPlayer1(v: Player | null) { this._demoMode.demoPlayer1 = v; }
  get demoPlayer2(): Player | null { return this._demoMode.demoPlayer2; }
  set demoPlayer2(v: Player | null) { this._demoMode.demoPlayer2 = v; }
  get _demoCurrentMap(): MapType { return this._demoMode._demoCurrentMap; }
  get _demoTransitionTimer(): ReturnType<typeof setTimeout> | null { return this._demoMode._demoTransitionTimer; }
  set _demoTransitionTimer(v: ReturnType<typeof setTimeout> | null) { this._demoMode._demoTransitionTimer = v; }

  _restartDemo(): void { this._demoMode.restart(); }
  startMenuReplay(snapshot: ReplaySnapshot, onDone?: () => void): void { this._demoMode.teardown(); this._replayMode.startMenuReplay(snapshot, onDone); }
  stopMenuReplay(): void { this._replayMode.stopMenuReplay(); }
  enableDemoChaseCam(seconds: number = 10): void { this._demoMode.enableChaseCam(seconds); }

  /** Start a match-preview demo using the player's next vehicle + series AI configs.
   *  Falls back to default 2-player demo if no series config is available. */
  _startMatchPreviewDemo(): void {
    const playerVehicle = (localStorage.getItem('luminal-vehicle') || 'bike') as VehicleType;
    const savedColorKey = localStorage.getItem('luminal-color') || 'red';

    // Build participant list: human player's next config + all AIs from the series
    if (this._seriesAiColors.length > 0) {
      const participants: DemoParticipant[] = [
        { colorKey: savedColorKey, vehicle: playerVehicle },
      ];
      for (let i = 0; i < this._seriesAiColors.length; i++) {
        participants.push({
          color: this._seriesAiColors[i],
          vehicle: this._seriesAiVehicles[i] || 'bike',
        });
      }
      this._demoMode.startWithConfig(participants);
    } else {
      // No series config — fall back to default demo
      this._demoMode.start();
    }
  }

  // ── Replay Mode API (encapsulated) ────────────────────
  get camMode(): number { return this._replayMode.camMode; }
  handleWheelZoom(deltaY: number): void { this._replayMode.handleWheelZoom(deltaY); }
  setFreeCamInput(input: FreeCamInput | null): void { this._replayMode.setFreeCamInput(input); }
  applyMouseLook(mx: number, my: number): void { this._replayMode.applyMouseLook(mx, my); }
  seekTo(progress: number): void { this._replayMode.seekTo(progress); }

  // ── Start countdown ────────────────────────────────────
  _sceneFade(toBlack: boolean, label?: string): Promise<void> {
    return this._roundFlow.sceneFade(toBlack, label);
  }

  /** Re-read the player's chosen color from localStorage so it stays
   *  in sync with the character-select UI (which writes to localStorage
   *  but never updates Game fields directly). */
  _refreshPlayerColor(): void {
    const saved: string | null = localStorage.getItem('luminal-color');
    const key: string = saved && this._colorMap[saved] ? saved : PLAYER_COLOR_KEYS[0];
    this.playerColor = this._colorMap[key].color;
    this.playerEmissive = this._colorMap[key].emissive;
  }

  startCountdown(): void { this._roundFlow.startCountdown(); }

  // ── Online waiting/countdown (delegated to OnlineMode) ──
  _beginWaitingForOpponent(): void { this._onlineMode._beginWaitingForOpponent(); }
  beginOnlineCountdown(): void { this._onlineMode.beginOnlineCountdown(); }

  _beginCountdown(): void { this._roundFlow.beginCountdown(); }


  // ── Series ─────────────────────────────────────────────
  // ── Online Match Start (delegated to OnlineMode) ──────
  startOnlineMatch(onlineMatch: OnlineMatch): void { this._onlineMode.startOnlineMatch(onlineMatch); }

  /**
   * TASK-292: public read-only access to the current series id so save
   * call-sites in other modules can stamp it onto `SeriesInfo.seriesId`.
   */
  get currentSeriesId(): string | null { return this._currentSeriesId; }

  /**
   * TASK-292: assign/refresh `_currentSeriesId` based on `seriesLength`.
   * - BO3/BO5 → fresh UUID (links all rounds of the series).
   * - BO1 → null (single-match replays are never grouped).
   * Called from `startSeries()` and from the online-state-sync path, and
   * directly exposed for tests via `game['_startSeriesIfNeeded']()`.
   */
  private _startSeriesIfNeeded(): void {
    if (this.seriesLength > 1) {
      this._currentSeriesId = crypto.randomUUID();
    } else {
      this._currentSeriesId = null;
    }
  }

  /**
   * TASK-292: public entry point for the online match flow. Called on round 1
   * of an online series so every subsequent round shares the same seriesId.
   */
  startSeriesIdForOnline(): void { this._startSeriesIfNeeded(); }

  startSeries(): void {
    if (this.state !== 'menu' && this.state !== 'gameover') return;
    this._refreshPlayerColor();
    this.seriesPlayerWins = 0;
    this.seriesAiWins = new Array(this.opponentCount).fill(0);
    this.seriesOver = false;
    this._seriesReplayIds = [];
    this._seriesAiVehicles = [];
    // TASK-292: generate a stable seriesId that links every round of a BO3/BO5.
    this._startSeriesIfNeeded();
    // Pick AI colors so each enemy is visually distinct from the player and other enemies.
    this._seriesAiColors = pickSeriesAiColors(this._colorMap, this.playerColor, this.opponentCount);
    // Lobby-started games: restore lobby-chosen AI colors/vehicles
    if (this._lobbyOrigin) {
      this._seriesAiColors = [...this._lobbyOrigin.aiColors];
      this._seriesAiVehicles = [...this._lobbyOrigin.aiVehicles];
    }
    // TASK-267: safety backstop — the lobby origin path + any stale color reads
    // can land an AI on the same color as the player. Re-run the distance-based
    // picker for any AI whose color matches the human exactly so they never
    // share hex values.
    this._enforceOpposingAiColors();
    this._updateSeriesHUD();
    this.start();
  }

  /** TASK-267: ensure no series AI ends up on the exact same color as the player. */
  private _enforceOpposingAiColors(): void {
    let needsRepick = false;
    for (let i = 0; i < this._seriesAiColors.length; i++) {
      if (this._seriesAiColors[i].color === this.playerColor) {
        needsRepick = true;
        break;
      }
    }
    if (!needsRepick) return;
    // Rebuild only the offending slots via pickSeriesAiColors to keep variety intact.
    const fresh = pickSeriesAiColors(this._colorMap, this.playerColor, this.opponentCount);
    for (let i = 0; i < this._seriesAiColors.length; i++) {
      if (this._seriesAiColors[i].color === this.playerColor && fresh[i]) {
        this._seriesAiColors[i] = fresh[i];
      }
    }
  }

  start(): void {
    this.startCountdown();
  }


  update(dt: number): void {
    // Admin time scale
    dt *= this.timeScale;

    updateAudioReactivity(this, dt);

    // synth_city procgen streamer — no-op on every other map.
    const _reactive = getArenaReactive();
    if (_reactive?.synthCity) updateSynthCity(_reactive);

    // Menu background: AI demo or replay cycling
    if (this.state === 'menu') {
      if (this._replayMode._menuReplayActive) {
        this._updateMenuReplay(dt);
      } else {
        this._demoMode.update(dt);
      }
      return;
    }

    // Transition (camera sweep before countdown)
    if (this.state === 'transition') {
      this._roundFlow.updateTransition(dt);
      return;
    }

    // Waiting for both online players to load before countdown
    if (this.state === 'waitingOnline') {
      if (this.adminFreecam) this._updateAdminFreecam(dt);
      else if (this.player) { const _gp = getGamepadState(); updateCamera(this.camera, this.player, dt, undefined, _gp?.rightStickX || 0, _gp?.rightStickY || 0); }
      return;
    }

    // Countdown
    if (this.state === 'countdown') {
      this._roundFlow?.updateCountdown(dt);
      return;
    }

    if (this.state === 'paused') return; // freeze game logic
    if (this.state === 'replay') { this._updateReplay(dt); return; }
    if (this.state !== 'playing' && this.state !== 'gameover') return;

    if (this.state === 'playing') updatePlaying(this, dt);

    // ── Camera & visual smoothing ─────────────────────────
    if (this.adminFreecam) {
      this._updateAdminFreecam(dt);
    } else if (this.player) {
      const _gp = getGamepadState();
      updateCamera(this.camera, this.player, dt, undefined, _gp?.rightStickX || 0, _gp?.rightStickY || 0);
    }

    // Apply lockstep visual smoothing offsets AFTER camera update to prevent jitter
    if (this._lockstep && this._lockstep.started) {
      this._onlineMode.applyVisualOffsets();
    }

    // Update death animations — killcam handles its own timing when active
    if (!this._killcamActive) {
      if (this.player && !this.player.alive) this.player.updateDeath(dt);
      for (const ai of this.ais) {
        if (ai.player && !ai.player.alive) ai.player.updateDeath(dt);
      }
    }

    if (this.state === 'gameover') updateGameover(this, dt);
  }

  _drawRadar(targetCtx?: CanvasRenderingContext2D, targetSize?: number): void {
    _drawRadarImpl({
      player: this.player,
      ais: this.ais,
      playerColor: this.playerColor,
      targetCtx,
      targetSize,
      radarCtx: this._radarCtx,
    });
  }

  _drawSettingsPreview(): void {
    _drawSettingsPreviewImpl({
      demoPlayer1: this.demoPlayer1,
      demoPlayer2: this.demoPlayer2,
      radarCtx: this._radarCtx,
    });
  }

  _getPlayerCSSColor(): string { return this._roundFlow.getPlayerCSSColor(); }

  _buildSeriesDotsHTML(): string { return this._roundFlow.buildSeriesDotsHTML(); }

  _updateSeriesHUD(): void {
    const el = document.getElementById('series-score')!;
    if (this.state === 'menu') { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = this._buildSeriesDotsHTML();
  }

  _getStreakKey(): StreakKey {
    return getStreakKey(this.seriesLength);
  }

  _updateStreak(): void {
    const key = this._getStreakKey();
    const streak = getStreakForMode(this.streakData, key);
    const best = getBestStreakForMode(this.streakData, key);
    const inGame: boolean = this.state === 'playing' || this.state === 'transition';
    if (inGame) {
      updateStreakDisplay(streak, 0, best);
    } else {
      hideStreakDisplay();
    }
  }

  _handleStreakLoss(key: StreakKey): void {
    const streak = getStreakForMode(this.streakData, key);
    if (streak < 1) {
      this.streakData = resetStreak(this.streakData, key);
      return;
    }

    const wasRecord = isNewRecord(this.streakData, key);
    const distanceToBest = getDistanceToBest(this.streakData, key);
    const result = _handleStreakLossImpl(streak, wasRecord, distanceToBest);

    this._killcamDuration += result.killcamDurationDelta;
    this._streakCeremony = result.ceremony;
    this._lastStreakEnd = result.lastStreakEnd;

    this.streakData = resetStreak(this.streakData, key);
    saveStreaks(this.streakData);
  }

  _updateStreakCeremony(dt: number): void {
    if (!this._streakCeremony) return;
    const result = updateStreakCeremony(
      this._streakCeremony, dt, this._streakCeremonyTimer,
      this._killcamTimer, this._killcamDuration, startStreakVaporize,
    );
    this._streakCeremony = result.ceremony;
    this._streakCeremonyTimer = result.timer;
  }

  _updateStreakIncrement(dt: number): void {
    if (!this._streakIncrementAnim) return;
    const result = updateStreakIncrement(
      this._streakIncrementAnim, dt, this._streakIncrementTimer,
      this._streakSparklesSpawned, this._killcamTimer, this._killcamDuration,
    );
    this._streakIncrementAnim = result.anim;
    this._streakIncrementTimer = result.timer;
    this._streakSparklesSpawned = result.sparklesSpawned;
  }

  _findLastAlivePos(frames: ReplayFrame[], deathFrameIdx: number, type: 'player' | 'ai', aiIdx?: number): { x: number; z: number } {
    return this._replayMode._findLastAlivePos(frames, deathFrameIdx, type, aiIdx);
  }
  _destroyGhosts(): void { this._replayMode._destroyGhosts(); }

  _updateHUD(): void {
    const p = this.player!;
    const result = updateMeterHUD(
      {
        meterPercent: p.getMeterPercent(),
        dashing: p.dashing,
        driftBoosting: p.driftBoosting,
        drifting: p.drifting,
        wBoosting: p.wBoosting,
        boostLocked: p.boostLocked,
        meterGaining: p.meterGaining,
        proximitySpeedBoost: p.proximitySpeedBoost,
      },
      {
        fill: this._elMeterFill,
        bar: this._elMeterBar,
        spark: this._elMeterSpark,
        label: this._elMeterLabel,
      },
      { hudState: this._hudState, hudStateTimer: this._hudStateTimer, sparkBurst: this._sparkBurst, prevLocked: this._prevLocked },
    );
    this._hudState = result.hudState;
    this._hudStateTimer = result.hudStateTimer;
    this._sparkBurst = result.sparkBurst;
    this._prevLocked = result.prevLocked;

    // FLOW per-frame tick + HUD update (SPEC-89/90)
    const pos = p.getPosition();
    // Near-miss: query nearest trail within 3 units, skipping tail of own trail
    const nearestTrailDist = p.alive
      ? grid.nearestDist(pos.x, pos.z, 3, p.trail, 12)
      : -1;
    bridgeFrameTick(this._flowState, {
      alive: p.alive,
      drifting: p.drifting,
      grinding: p.grinding,
      dashing: p.dashing,
      proximitySpeedBoost: p.proximitySpeedBoost,
      slipAngle: p.slipAngle,
      speed: p.speed,
      vehicleType: p.vehicleType,
      nearestTrailDist,
    }, 1 / 60, performance.now());
    updateFlowHUD(getFlowSnapshot(this._flowState), 16.67);

    // SPEC-93: Slipstream visual phase for SPECTRE (bike)
    if (p.vehicleType === 'bike') {
      const now = performance.now();
      const prevClass = getSlipstreamBodyClass(this._slipstreamPhase);
      updateSlipstreamPhase(this._slipstreamPhase, p.proximitySpeedBoost, now);
      const newClass = getSlipstreamBodyClass(this._slipstreamPhase);
      if (prevClass !== newClass) {
        if (prevClass) document.body.classList.remove(prevClass);
        if (newClass) document.body.classList.add(newClass);
      }
      // Override overlay CSS vars with phase-based intensity (replaces raw proximity)
      const intensity = getSlipstreamIntensity(this._slipstreamPhase, now);
      const chroma = getChromaticStrength(this._slipstreamPhase, now);
      if (!_slipOverlay) _slipOverlay = document.getElementById('slipstream-overlay');
      if (_slipOverlay) {
        if (intensity > 0.01) {
          _slipOverlay.classList.add('slipstream--active');
          _slipOverlay.style.setProperty('--slip-alpha', (intensity * 0.15).toFixed(3));
          _slipOverlay.style.setProperty('--slip-chroma', chroma.toFixed(2));
          _slipOverlay.style.setProperty('--slip-offset', (chroma * 3).toFixed(1));
        } else {
          _slipOverlay.classList.remove('slipstream--active');
        }
      }
    }

    // SPEC-95: Grind glitch intensity for VECTOR (hoverboard)
    if (p.vehicleType === 'hoverboard') {
      updateFlowGlitch(p.grinding, p.grindDuration);
    }
  }

  // Proximity, trail VFX, and wall repulsion extracted to core/collisionSystem.js


  _checkCollisions(): void {
    checkCollisionsExternal(this);
  }

  _applyResultButtonVisibility(): void { this._roundFlow.applyResultButtonVisibility(); }

  /** Pre-build expensive assets behind the blackout before results are revealed. */
  _prepResultScreenEarly(): void { this._roundFlow.prepResultScreenEarly(); }

  /** Pre-compute all DOM values once round result is known. */
  _prepResultScreenLate(): void { this._roundFlow.prepResultScreenLate(); }

  async _prepareResultScreenDuringBlackout(): Promise<void> { return this._roundFlow.prepareResultScreenDuringBlackout(); }

  async _showResultScreen(): Promise<void> { return this._roundFlow.showResultScreen(); }

  /** Apply pre-built result state — near-zero frame cost. */
  _applyPrebuiltResultScreen(): void { this._roundFlow.applyPrebuiltResultScreen(); }

  /** Fallback for no-killcam paths: spread work across 3 frames. */
  _showResultScreenWaterfall(roundResult: string, playerWonSeries: boolean, anyAiWonSeries: boolean): void { this._roundFlow.showResultScreenWaterfall(roundResult, playerWonSeries, anyAiWonSeries); }

  // Refresh the match selector on the result screen to reflect newly saved replays
  _refreshMatchSelector(): void {
    if (this.state !== 'gameover') return;
    this._selectedMatchIndex = Math.max(0, this._seriesReplayIds.length - 1);
    const matchSel = document.getElementById('result-match-selector');
    if (matchSel) {
      if (this.seriesLength > 1 && this._seriesReplayIds.length > 1) {
        matchSel.classList.remove('hidden');
        document.getElementById('match-sel-label')!.textContent = `MATCH ${this._selectedMatchIndex + 1}`;
      } else {
        matchSel.classList.add('hidden');
      }
    }
  }

  // Called by OnlineMatch when both clients confirm round end
  triggerOnlineGameover(iWon: boolean, isDraw: boolean, winnerUid?: string): void { this._roundFlow.triggerOnlineGameover(iWon, isDraw, winnerUid); }

  pause(): void {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this._pausedFrom = this.state;
    this.state = 'paused';
    setMusicDampen(true); setSfxDampen(true);
    if (window.showScreen) window.showScreen('paused');
    else document.getElementById('pause-overlay')!.classList.remove('hidden');
    // Show radar on pause if it was hidden for mobile
    if (this.radarMobileHide && isPhoneScreen() && this.radarEnabled) {
      document.getElementById('radar')!.classList.remove('hidden');
    }
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = this._pausedFrom || 'playing';
    setMusicDampen(false); setSfxDampen(false);
    if (window.showScreen) window.showScreen(null);
    else document.getElementById('pause-overlay')!.classList.add('hidden');
    // Re-hide radar on mobile during gameplay
    if (this.radarMobileHide && isPhoneScreen() && this.radarEnabled) {
      document.getElementById('radar')!.classList.add('hidden');
    }
  }

  canRestart(): boolean {
    return this.state === 'gameover' && this.gameOverTimer > 0.5 && !this._killcamActive;
  }

  /** If true, returnToMenu will skip showScreen('main') — used by return-to-lobby
   *  so the lobby screen isn't immediately overridden by the post-fade 'main' nav. */
  _skipMenuScreen = false;

  returnToMenu(): void {
    returnToMenuExternal(this);
  }

  // ── Replay System (delegated to ReplayMode) ────────────
  startReplay(): void { this._replayMode.startReplay(); }
  async startReplayFromSnapshot(snapshot: ReplaySnapshot): Promise<void> { return this._replayMode.startReplayFromSnapshot(snapshot); }
  _createGhost(color: number, emissive: number, vehicleType: VehicleType = 'bike'): GhostEntry { return this._replayMode._createGhost(color, emissive, vehicleType) as GhostEntry; }
  _updateGhost(ghost: GhostEntry | null, state: PlayerState | null): void { this._replayMode._updateGhost(ghost, state); }
  _rebuildGhostTrails(seekTime: number): void { this._replayMode._rebuildGhostTrails(seekTime); }
  _updateReplay(dt: number): void { this._replayMode._updateReplay(dt); }
  _updateReplayCamera(dt: number, frame: InterpolatedReplayFrame): void { this._replayMode._updateReplayCamera(dt, frame); }
  cycleReplayCamera(dir: number = 1): void { this._replayMode.cycleReplayCamera(dir); }
  _updateReplayCamLabel(): void { this._replayMode._updateReplayCamLabel(); }
  stopReplay(): void { this._replayMode.stopReplay(); }
  exitReplayToMenu(): void { this._replayMode.exitReplayToMenu(); }
  async exitReplayToResults(): Promise<void> { return this._replayMode.exitReplayToResults(); }
  async startBgReplay(): Promise<void> { return this._replayMode.startBgReplay(); }
  stopBgReplay(): void { this._replayMode.stopBgReplay(); }
  _resetPrepState(): void { this._replayMode._resetPrepState(); }
  _updateBgReplay(dt: number): void { this._replayMode._updateBgReplay(dt); }
  _updateMenuReplay(dt: number): void { this._replayMode._updateMenuReplay(dt); }
  _updateBgDeathCamera(dt: number): void { this._replayMode._updateBgDeathCamera(dt); }
  _ensureBgShatterPool(): void { this._replayMode._ensureBgShatterPool(); }
  _spawnBgShatter(pos: THREE.Vector3, color: number): void { this._replayMode._spawnBgShatter(pos, color); }
  _updateBgShatter(dt: number): void { this._replayMode._updateBgShatter(dt); }
  _cleanupBgShatter(): void { this._replayMode._cleanupBgShatter(); }
  _resetBgSlowMo(): void { this._replayMode._resetBgSlowMo(); }
  _loopBgReplay(): void { this._replayMode._loopBgReplay(); }

  _updateAdminFreecam(dt: number): void {
    updateAdminFreecam(this, dt);
  }

  // ── Slipstream helpers (wrappers for module-level functions, used by RoundFlow host) ──
  _clearSlipstreamOverlay(): void { clearSlipstreamOverlay(); }
  _clearEnemySlipstreamVFX(): void { clearEnemySlipstreamVFX(); }

  /** Tear down online match state (delegated to OnlineMode). */
  _teardownOnline(): void { this._onlineMode._teardownOnline(); }

  cleanup(): void {
    cleanupGame(this);
  }
}
