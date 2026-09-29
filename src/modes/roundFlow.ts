// ── Round Flow ───────────────────────────────────────────
// Phase-transition dispatcher for round lifecycle. Heavy bodies
// (startCountdown, triggerOnlineGameover, result waterfall) live
// in ./roundCountdown.ts and ./roundResultFlow.ts.

import { Player } from '../player';
import { triggerCountdownPulse, updateCountdownPulses, clearCountdownPulses } from '../grid';
import { updateCamera, getCameraParams, seedCameraState } from '../scene';
import { isPhoneScreen } from '../input';
import { getGamepadState } from '../gamepad';
import { playCountdown } from '../sfx';
import { playVehicleStart } from '../sfxAssets';
import { hideStreakDisplay, hideStreakEndInfo, clearKillcamSparkles } from '../ui/streakUI';
import { hexToCSS, formatTime } from '../utils';
import { getStreakForMode } from '../streak';
import { ReplayRecorder } from '../replay';
import { DemoMode } from './demoMode';
import { logLocal } from '../localDiagnostics';
import { startCountdown as startCountdownImpl } from './roundCountdown';
import { triggerOnlineGameover as triggerOnlineGameoverImpl, showResultScreenWaterfall as showResultScreenWaterfallImpl, applyPrebuiltResultScreen as applyPrebuiltResultScreenImpl } from './roundResultFlow';
import type { LockstepManager } from '../core/lockstepManager';
import type { VehicleType, ColorEntry, ReplaySnapshot, KillcamData, PrebuiltResultState, GameStats } from '../types/index';
import type { IGameCore } from './index';
import type { StreakData } from '../types';
import type { StreakKey } from '../streak';
import { bridgeBeginRound } from '../flow/flowBridge';
import { resetFlowHUD, setFlowHudCharacterState } from '../ui/flowHUD';
import { createSlipstreamPhaseState, type SlipstreamPhaseState } from '../effects/slipstreamVFX';
import type { CameraState } from '../scene';
import * as THREE from 'three';
import { Trail } from '../trail';

interface GhostEntry {
  mesh: THREE.Group;
  trail: Trail;
  light: THREE.PointLight;
  lastTrailX: number | null;
  lastTrailZ: number | null;
  alive: boolean;
}

/** Narrow host interface — fields/methods RoundFlow needs from Game. */
export interface IRoundFlowHost extends IGameCore {
  matchTime: number;
  gameOverTimer: number;
  // FLOW state (SPEC-89)
  _flowState: import('../flow/flowState').FlowState;
  _lastFlowRoundResult: import('../flow/flowTypes').RoundResult | null;
  _slipstreamPhase: SlipstreamPhaseState;

  // Online / lockstep
  _lockstep: LockstepManager | null;
  // Countdown
  countdownTimer: number;
  countdownNum: number;
  onCountdownTick: ((num: number) => void) | null;
  // Color
  playerColor: number;
  playerEmissive: number;
  // Transition
  _transitionCamStart: THREE.Vector3;
  _transitionLookScratch: THREE.Vector3;
  _transitionFovStart: number;
  _transitionTimer: number;
  _transitionDuration: number;
  _victoryFireworks: boolean;
  // Spectator
  _spectateTarget: Player | null;
  _spectateCamState: CameraState | null;
  // Radar
  _radarCtx: CanvasRenderingContext2D | null;
  radarEnabled: boolean;
  radarMobileHide: boolean;
  // Series
  opponentCount: number;
  _seriesAiColors: ColorEntry[];
  _seriesAiVehicles: VehicleType[];
  _lastStreakEnd: { streak: number; wasRecord: boolean; distanceToBest: number } | null;
  seriesLength: number;
  seriesPlayerWins: number;
  seriesAiWins: number[];
  seriesOver: boolean;
  /** TASK-292: stable id linking all rounds of a best-of series. */
  readonly currentSeriesId: string | null;
  // Replay
  _replayRecorder: ReplayRecorder;
  // Sub-modes
  _demoMode: DemoMode;
  // Admin
  adminFreecam: boolean;
  // Killcam / result state
  _killcamData: KillcamData | null;
  _killcamDuration: number;
  _pendingOnlineResult: { iWon: boolean; isDraw: boolean; winnerUid?: string } | null;
  _streakSparklesSpawned: boolean;
  _streakCeremony: {
    streak: number;
    wasRecord: boolean;
    distanceToBest: number;
    phase: 'pending' | 'hitstop' | 'record' | 'vaporize' | 'done';
  } | null;
  _streakIncrementAnim: { prevStreak: number; newStreak: number; phase: 'pending' | 'showing' | 'done' } | null;
  // Result screen prep
  _prepDone: boolean;
  _prebuiltPlayerGhost: GhostEntry | null;
  _prebuiltResultState: PrebuiltResultState | null;
  _radarPreRendered: boolean;
  _resultRadarCtx: CanvasRenderingContext2D | null;
  // Streak / stats
  streakData: StreakData;
  stats: GameStats;
  // Replay IDs
  _lastSavedReplayId: string | null;
  _lastReplaySnapshot: ReplaySnapshot | null;
  _seriesReplayIds: string[];
  _selectedMatchIndex: number;
  // Lobby
  _lobbyOrigin: { lobbyId: string; role: 'host' | 'guest'; aiColors: ColorEntry[]; aiVehicles: VehicleType[] } | null;
  // Online opponent
  opponent: Player | null;
  onMatchEnd: ((result: string, matchTime: number, seriesLength: number, opponentCount: number, replayId: string | null) => void) | null;
  // Methods
  _refreshPlayerColor(): void;
  stopBgReplay(): void;
  _resetPrepState(): void;
  stopMenuReplay(): void;
  _updateStreak(): void;
  _updateSeriesHUD(): void;
  _beginWaitingForOpponent(): void;
  _beginCountdown(): void;
  _updateAdminFreecam(dt: number): void;
  _getStreakKey(): StreakKey;
  _drawRadar(targetCtx?: CanvasRenderingContext2D, targetSize?: number): void;
  _createGhost(color: number, emissive: number, vehicleType?: VehicleType): GhostEntry;
  _ensureBgShatterPool(): void;
  startBgReplay(): Promise<void>;
  _refreshMatchSelector(): void;
  _handleStreakLoss(key: StreakKey): void;
  _clearSlipstreamOverlay(): void;
  _clearEnemySlipstreamVFX(): void;
  _getPlayerCSSColor(): string;
  _buildSeriesDotsHTML(): string;
  _applyResultButtonVisibility(): void;
  _prepResultScreenEarly(): void;
  _prepResultScreenLate(): void;
  _prepareResultScreenDuringBlackout(): Promise<void>;
  _showResultScreen(): Promise<void>;
  _applyPrebuiltResultScreen(): void;
  _showResultScreenWaterfall(roundResult: string, playerWonSeries: boolean, anyAiWonSeries: boolean): void;
}

export class RoundFlow {
  private host: IRoundFlowHost;

  constructor(host: IRoundFlowHost) {
    this.host = host;
  }

  // ── Scene fade ─────────────────────────────────────────
  /** Fade-to-black / reveal utility. Pure UI, no game logic. */
  sceneFade(toBlack: boolean, label?: string): Promise<void> {
    const el = document.getElementById('scene-fade')!;
    const loader = el.querySelector('.scene-loader') as HTMLElement;
    const loaderText = el.querySelector('.scene-loader__text') as HTMLElement;

    return new Promise<void>((resolve: () => void) => {
      if (toBlack) {
        // Set label and show the black overlay
        if (label) loaderText.textContent = label;
        el.classList.add('scene-fade--active');

        const onFaded = (): void => {
          el.removeEventListener('transitionend', onFaded);
          // Show the loader after the screen is fully black
          loader.classList.add('scene-loader--visible');
          // Defer resolve by 2 rAF so the browser paints the spinner
          // before heavy sync work in the caller blocks the main thread
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        };
        el.addEventListener('transitionend', onFaded);
        setTimeout(onFaded, 450); // safety fallback
      } else {
        // Hide loader first, then fade from black
        loader.classList.remove('scene-loader--visible');
        setTimeout(() => {
          el.classList.remove('scene-fade--active');
          const onRevealed = (): void => {
            el.removeEventListener('transitionend', onRevealed);
            resolve();
          };
          el.addEventListener('transitionend', onRevealed);
          setTimeout(onRevealed, 450); // safety fallback
        }, 150); // wait for loader fade-out
      }
    });
  }

  // ── Start countdown ────────────────────────────────────
  /** Delegates to ./roundCountdown.ts — see {@link startCountdownImpl}. */
  startCountdown(): void {
    startCountdownImpl(this.host);
  }

  // ── Begin countdown ────────────────────────────────────
  beginCountdown(): void {
    // Clean up overlay from transition
    // Clean up all faded screens from transition
    document.querySelectorAll('.overlay-screen').forEach((el: Element) => {
      (el as HTMLElement).classList.add('hidden');
      (el as HTMLElement).style.transition = '';
      (el as HTMLElement).style.opacity = '';
      (el as HTMLElement).style.pointerEvents = '';
    });
    ['pause-overlay', 'replay-overlay', 'result', 'series-result'].forEach((id: string) => {
      const el = document.getElementById(id);
      if (el) { el.classList.add('hidden'); el.style.transition = ''; el.style.opacity = ''; el.style.pointerEvents = ''; }
    });

    this.host.state = 'countdown';
    this.host.countdownTimer = 0;
    this.host.countdownNum = 3;
    hideStreakEndInfo();
    this.host._lastStreakEnd = null;

    // Slide top bar out during gameplay
    if (window._hideTopBar) window._hideTopBar();

    document.getElementById('meter-wrap')!.classList.remove('menu-hidden');
    document.getElementById('flow-hud')?.classList.remove('menu-hidden');
    document.getElementById('meter-fill')!.style.width = '100%';
    (document.getElementById('meter-fill') as HTMLElement).style.background = '';
    (document.getElementById('meter-fill') as HTMLElement).style.boxShadow = '';
    (document.getElementById('meter-bar') as HTMLElement).style.borderColor = '';
    const radarEl = document.getElementById('radar')!;
    logLocal('[RADAR-DEBUG] beginCountdown: before unhide, className=', radarEl.className, 'radarEnabled=', this.host.radarEnabled, 'radarMobileHide=', this.host.radarMobileHide, 'isPhoneScreen=', isPhoneScreen(), 'innerWidth=', window.innerWidth);
    radarEl.classList.remove('hidden', 'radar--timer-only', 'radar--preview');
    if (!this.host.radarEnabled) {
      radarEl.classList.add('radar--timer-only');
      logLocal('[RADAR-DEBUG] beginCountdown: added radar--timer-only (radarEnabled=false)');
    } else if (this.host.radarMobileHide && isPhoneScreen()) {
      radarEl.classList.add('hidden');
      logLocal('[RADAR-DEBUG] beginCountdown: added hidden (mobile hide + phone screen)');
    }
    logLocal('[RADAR-DEBUG] beginCountdown: after, className=', radarEl.className);
    document.getElementById('match-timer')!.classList.remove('hidden');

    this.host._updateSeriesHUD();

    // Hide streak HUD during countdown (it shows on result screen instead)
    hideStreakDisplay();

    // Show countdown
    const cd = document.getElementById('countdown')!;
    const cdNum = document.getElementById('countdown-num')!;
    cd.classList.remove('hidden');
    cdNum.textContent = '3';
    cdNum.style.color = 'rgb(var(--c-white))';
    cdNum.style.fontSize = '';
    cdNum.style.marginLeft = '0';
    cdNum.style.animation = 'none';
    void cdNum.offsetWidth; // reflow
    cdNum.style.animation = 'countPop 1s ease-out';
    playCountdown(false);
    triggerCountdownPulse(this.host.scene, 3);
    if (this.host.onCountdownTick) this.host.onCountdownTick(3);
    // Vehicle start-up sound — plays alongside the first countdown beep
    if (this.host.player) playVehicleStart(this.host.player.vehicleType);
  }

  // ── Update transition ──────────────────────────────────
  updateTransition(dt: number): void {
    this.host._transitionTimer += dt;
    const t: number = Math.min(this.host._transitionTimer / this.host._transitionDuration, 1);
    // Smooth ease-in-out
    const ease: number = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    if (this.host.player) {
      const pos = this.host.player.mesh.position;
      const angle: number = this.host.player.angle;
      const cam = getCameraParams();
      const targetX: number = pos.x + Math.sin(angle) * cam.dist;
      const targetY: number = pos.y + cam.height;
      const targetZ: number = pos.z + Math.cos(angle) * cam.dist;

      // Lerp from start position to target
      this.host.camera.position.set(
        this.host._transitionCamStart.x + (targetX - this.host._transitionCamStart.x) * ease,
        this.host._transitionCamStart.y + (targetY - this.host._transitionCamStart.y) * ease,
        this.host._transitionCamStart.z + (targetZ - this.host._transitionCamStart.z) * ease,
      );

      // Look at player throughout
      this.host._transitionLookScratch.set(pos.x, pos.y + 1.8, pos.z);
      this.host.camera.lookAt(this.host._transitionLookScratch);

      // FOV sweep: ease to gameplay FOV
      this.host.camera.fov = this.host._transitionFovStart + (cam.fov - this.host._transitionFovStart) * ease;
      this.host.camera.updateProjectionMatrix();

      // At the end, seed the camera state so updateCamera continues seamlessly
      if (t >= 1) {
        seedCameraState(this.host.camera, this.host._transitionLookScratch);
      }
    }

    if (t >= 1) {
      if (this.host.mode === 'online' && this.host._onlineMatch) {
        // Online: wait for both players to finish loading before countdown
        this.host._beginWaitingForOpponent();
      } else {
        this.host._beginCountdown();
      }
    }
  }

  // ── Update countdown ───────────────────────────────────
  updateCountdown(dt: number): void {
    this.host.countdownTimer += dt;
    const cd = document.getElementById('countdown')!;
    const cdNum = document.getElementById('countdown-num')!;

    const newNum: number = 3 - Math.floor(this.host.countdownTimer);

    if (newNum !== this.host.countdownNum && newNum >= 1) {
      this.host.countdownNum = newNum;
      cdNum.textContent = String(newNum);
      cdNum.style.marginLeft = newNum === 1 ? '-20px' : '0';
      cdNum.style.animation = 'none';
      void cdNum.offsetWidth;
      cdNum.style.animation = 'countPop 1s ease-out';
      playCountdown(false);
      triggerCountdownPulse(this.host.scene, newNum);
      if (this.host.onCountdownTick) this.host.onCountdownTick(newNum);
    }

    if (this.host.countdownTimer >= 2.85 && this.host.countdownNum !== 0) {
      this.host.countdownNum = 0;
      cdNum.textContent = 'GO';
      cdNum.style.color = 'rgb(var(--c-white))';
      cdNum.style.marginLeft = '0';
      cdNum.style.fontSize = '180px';
      playCountdown(true);
      triggerCountdownPulse(this.host.scene, 0);
      cdNum.style.animation = 'none';
      void cdNum.offsetWidth;
      cdNum.style.animation = 'countPop 1s ease-out';
      if (this.host.onCountdownTick) this.host.onCountdownTick(0);
    }

    updateCountdownPulses(dt);

    if (this.host.countdownTimer >= 3.5) {
      cd.classList.add('hidden');
      cdNum.style.color = 'rgb(var(--c-white))';
      cdNum.style.fontSize = '';
      this.host.state = 'playing';
      this.host.gameOverTimer = 0;
      clearCountdownPulses();

      // FLOW round begin (SPEC-89/90) — lock multiplier from current streak
      const streakKey = this.host._getStreakKey();
      const currentStreak = getStreakForMode(this.host.streakData, streakKey);
      bridgeBeginRound(this.host._flowState, currentStreak, performance.now());
      resetFlowHUD();
      // Reset slipstream phase for new round
      this.host._slipstreamPhase = createSlipstreamPhaseState();
      // Remove any lingering slipstream body classes
      document.body.classList.remove('slipstream-phase-entry', 'slipstream-phase-lockin', 'slipstream-phase-active');
      // Set character-specific HUD styling
      const vt = this.host.player?.vehicleType;
      const charKind = vt === 'bike' ? 'spectre' as const
        : vt === 'car' ? 'slingshot' as const
        : vt === 'hoverboard' ? 'vector' as const : null;
      setFlowHudCharacterState(charKind);

      // Streak is already hidden during countdown; _updateStreak shows it now via 'playing' state
      if (this.host.mode === 'online' && this.host._onlineMatch) {
        this.host._onlineMatch.startPlaying();
        if (this.host._lockstep) this.host._lockstep.start();
      }
    }

    // Camera follows player during countdown
    if (this.host.adminFreecam) {
      this.host._updateAdminFreecam(dt);
    } else if (this.host.player) {
      const _gp = getGamepadState();
      updateCamera(this.host.camera, this.host.player, dt, undefined, _gp?.rightStickX || 0, _gp?.rightStickY || 0);
    }
  }

  // ── Result Screen Flow ─── helpers ──────────────────────
  getPlayerCSSColor(): string {
    return hexToCSS(this.host.playerColor);
  }

  buildSeriesDotsHTML(): string {
    const winsNeeded: number = Math.ceil(this.host.seriesLength / 2);
    const playerColor: string = this.host._getPlayerCSSColor();
    let html = '';
    for (let i = 0; i < winsNeeded; i++) {
      const won: boolean = i < this.host.seriesPlayerWins;
      html += `<div class="series-dot${won ? ' series-dot--won' : ''}" style="${won ? `background:${playerColor};box-shadow:0 0 8px ${playerColor};` : ''}"></div>`;
    }
    const aiColors: ColorEntry[] = this.host._seriesAiColors || [];
    for (let a = 0; a < aiColors.length; a++) {
      const aiColor: string = hexToCSS(aiColors[a].color);
      html += '<span class="series-divider">VS</span>';
      const aiWins: number = this.host.seriesAiWins[a] || 0;
      for (let i = 0; i < winsNeeded; i++) {
        const won: boolean = i < aiWins;
        html += `<div class="series-dot${won ? ' series-dot--won' : ''}" style="${won ? `background:${aiColor};box-shadow:0 0 8px ${aiColor};` : ''}"></div>`;
      }
    }
    return html;
  }

  applyResultButtonVisibility(): void {
    const isOnline: boolean = this.host.mode === 'online';
    // Disable fav button until replay is saved and _lastSavedReplayId is set
    document.getElementById('btn-replay-fav-result')!.classList.add('quickstart-toggle--disabled');
    document.getElementById('btn-continue')!.style.display = isOnline ? 'none' : '';
    document.getElementById('btn-result-loadout')!.style.display = isOnline ? 'none' : '';
    document.getElementById('btn-go-settings')!.style.display = isOnline ? 'none' : '';
    document.getElementById('btn-mainmenu')!.style.display = isOnline ? 'none' : '';
    document.getElementById('btn-online-leave')!.style.display = isOnline ? '' : 'none';
    document.getElementById('online-next-timer')!.style.display = isOnline ? '' : 'none';
    if (isOnline) {
      if (!this.host.seriesOver) {
        document.getElementById('btn-online-next')!.style.display = '';
        document.getElementById('btn-online-rematch')!.style.display = 'none';
      } else {
        document.getElementById('btn-online-next')!.style.display = 'none';
        document.getElementById('btn-online-rematch')!.style.display = '';
      }
      document.getElementById('btn-return-lobby-result')!.style.display =
        (this.host._onlineMatch?.lobbyId && this.host._onlineMatch.lobbyRole === 'host') ? '' : 'none';
    } else {
      document.getElementById('btn-online-next')!.style.display = 'none';
      document.getElementById('btn-online-rematch')!.style.display = 'none';
      // Show return-to-lobby for local games started from a lobby
      document.getElementById('btn-return-lobby-result')!.style.display =
        this.host._lobbyOrigin ? '' : 'none';
    }
  }

  // ── Prep methods ──────────────────────────────────────────

  /** Pre-build expensive assets behind the blackout before results are revealed. */
  prepResultScreenEarly(): void {
    // 1. Pre-clone player ghost (hidden) for background replay startup
    if (!this.host._prebuiltPlayerGhost && this.host._replayRecorder.hasData()) {
      const snapshot: ReplaySnapshot = this.host._replayRecorder.getSnapshot();
      const ghost = this.host._createGhost(
        snapshot.playerColor,
        snapshot.playerEmissive || snapshot.playerColor,
        snapshot.playerVehicle || 'bike',
      );
      ghost.mesh.visible = false;
      this.host._prebuiltPlayerGhost = ghost;
    }

    // 2. Pre-render radar canvas (trails are frozen after death)
    if (this.host._resultRadarCtx) {
      this.host._drawRadar(this.host._resultRadarCtx, 180);
      this.host._radarPreRendered = true;
    }

    // 3. Warm shatter particle pool (compiles shader if not cached)
    this.host._ensureBgShatterPool();
  }

  /** Pre-compute all DOM values once round result is known. */
  prepResultScreenLate(): void {
    if (!this.host._killcamData) return;
    const { roundResult, playerWonSeries, anyAiWonSeries } = this.host._killcamData;

    // Result text + color
    let resultText: string;
    let resultColor: string;
    let audioCall: 'victory' | 'defeat' | 'draw';
    if (roundResult === 'draw') {
      resultText = 'DRAW';
      resultColor = 'rgba(var(--c-white), 0.53)';
      audioCall = 'draw';
    } else if (roundResult === 'ai') {
      resultText = 'FRIED';
      resultColor = 'rgb(var(--c-orange-deep))';
      audioCall = 'defeat';
    } else {
      resultText = 'VICTORY';
      resultColor = 'rgb(var(--c-teal))';
      audioCall = 'victory';
    }

    // Series HTML
    let seriesHTML: string | null = null;
    let seriesLabelHTML = '';
    let continueText: string;
    if (this.host.seriesLength > 1) {
      continueText = (playerWonSeries || anyAiWonSeries) ? 'NEW SERIES' : 'NEXT ROUND';
      seriesHTML = this.host._buildSeriesDotsHTML();
      if (playerWonSeries) seriesLabelHTML = '<div class="series-label series-label--won">SERIES WON</div>';
      else if (anyAiWonSeries) seriesLabelHTML = '<div class="series-label series-label--lost">SERIES LOST</div>';
    } else {
      continueText = roundResult === 'player' ? 'CONTINUE' : 'RESTART';
    }

    // Streak
    const streakKey = this.host._getStreakKey();
    const currentStreak = getStreakForMode(this.host.streakData, streakKey);
    const showStreak = currentStreak >= 1 && roundResult === 'player';
    const streakNum = String(currentStreak);

    // Streak ended
    const lastEnd = this.host._lastStreakEnd;
    const showStreakEnded = !!(roundResult === 'ai' && lastEnd && lastEnd.streak >= 1);

    // Match selector
    const matchSelectorVisible = this.host.seriesLength > 1 && this.host._seriesReplayIds.length > 1;
    const selectedIdx = Math.max(0, this.host._seriesReplayIds.length - 1);
    const matchSelectorLabel = `MATCH ${selectedIdx + 1}`;

    this.host._prebuiltResultState = {
      resultText,
      resultColor,
      seriesHTML,
      seriesLabelHTML,
      continueText,
      showStreak,
      streakNum,
      showStreakEnded,
      statsJSON: JSON.stringify(this.host.stats),
      matchSelectorVisible,
      matchSelectorLabel,
      durationText: formatTime(this.host.matchTime),
      audioCall,
      playGameOver: (roundResult === 'ai' && this.host.seriesOver),
      playWinScreen: (roundResult === 'player' && this.host.seriesOver),
    };
  }

  async prepareResultScreenDuringBlackout(): Promise<void> {
    if (!this.host._prepDone) {
      this.host._prepResultScreenEarly();
      this.host._prepDone = true;
    }
    if (!this.host._prebuiltResultState) this.host._prepResultScreenLate();
    if (this.host._replayRecorder.hasData()) {
      await this.host.startBgReplay();
    }
  }

  // ── Show / apply methods ──────────────────────────────────

  async showResultScreen(): Promise<void> {
    if (this.host._fading) return;
    this.host._fading = true;

    const { roundResult, playerWonSeries, anyAiWonSeries } = this.host._killcamData!;
    this.host._killcamActive = false;

    // Force-clear any streak overlay still visible from killcam hold
    const streakOverlay = document.getElementById('killcam-streak-overlay');
    if (streakOverlay) streakOverlay.classList.remove('visible');
    const recordEl = document.getElementById('killcam-new-record');
    if (recordEl) recordEl.classList.remove('active');
    const streakVal = document.getElementById('killcam-streak-value');
    if (streakVal) streakVal.classList.remove('streak-slide-down');
    clearKillcamSparkles();
    this.host._streakSparklesSpawned = false;
    this.host._streakCeremony = null;
    this.host._streakIncrementAnim = null;

    // Fade to black to mask killcam → result transition
    const holdDone = new Promise<void>(r => setTimeout(r, 600));
    await this.host._sceneFade(true, 'MATCH RESULTS');

    document.getElementById('bottom-bar')!.classList.remove('hidden');

    // Pre-set topbar offset so layout is correct behind the blackout,
    // but keep the bar hidden — it slides in after the reveal.
    document.documentElement.style.setProperty('--topbar-offset', '40px');

    await this.host._prepareResultScreenDuringBlackout();

    if (this.host._prebuiltResultState) {
      this.host._applyPrebuiltResultScreen();
    } else {
      this.host._showResultScreenWaterfall(roundResult, playerWonSeries, anyAiWonSeries);
    }

    // Fade from black to reveal result screen
    await holdDone;
    await this.host._sceneFade(false);

    // Slide top bar in *after* reveal so the animation is visible
    if (window._showTopBar) window._showTopBar();

    this.host._killcamData = null;
    this.host._fading = false;
  }

  /** Apply pre-built result state — delegates to ./roundResultFlow.ts. */
  applyPrebuiltResultScreen(): void {
    applyPrebuiltResultScreenImpl(this.host);
  }

  /** Fallback for no-killcam paths — delegates to ./roundResultFlow.ts. */
  showResultScreenWaterfall(roundResult: string, playerWonSeries: boolean, anyAiWonSeries: boolean): void {
    showResultScreenWaterfallImpl(this.host, roundResult, playerWonSeries, anyAiWonSeries);
  }

  // ── Online gameover ───────────────────────────────────────
  /** Delegates to ./roundResultFlow.ts. */
  triggerOnlineGameover(iWon: boolean, isDraw: boolean, winnerUid?: string): void {
    triggerOnlineGameoverImpl(this.host, iWon, isDraw, winnerUid);
  }
}
