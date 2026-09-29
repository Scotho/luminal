// ── Replay UI (extracted from main.js) ──────────────────
import { playUiReadout } from '../sfx';
import { toggleFavorite, getReplayList, getSeriesById, loadReplay } from '../replayStore';
import { getBinds } from '../input';
import { isGamepadConnected, getGamepadState } from '../gamepad';
import { ico, show, hide, toggleVisible } from './dom';
import { cycleIndex } from './controls';
import { warnDev } from '../swallow';
import type { ActionName, GamepadState, ReplayListEntry, LoadedReplayEntry, ReplaySnapshot } from '../types/index';

// ── Injected dependency types ───────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GameInstance = any;

interface ReplayUIeDeps {
  game: GameInstance;
  getCurrentScreen: () => string | null;
  setCurrentScreen: (s: string | null) => void;
  navigateReset: (screen: string) => void;
  getFocusIndex: () => number;
  setFocusIndex: (i: number) => void;
  updateFocus: () => void;
  canvas: HTMLCanvasElement | null;
}

// ── Injected dependencies ────────────────────────────────
let _game: GameInstance = null;
let _setCurrentScreen: ((s: string | null) => void) | null = null;
let _setFocusIndex: ((i: number) => void) | null = null;
let _updateFocus: (() => void) | null = null;
let _canvas: HTMLCanvasElement | null = null;               // renderer.domElement

// ── Replay constants & state ─────────────────────────────
const REPLAY_SPEEDS: number[] = [-2, -1, 0.25, 0.5, 1, 2, 4];
const REPLAY_SPEED_LABELS: string[] = ['-2x', '-1x', '0.25x', '0.5x', '1x', '2x', '4x'];
const REPLAY_SPEED_DEFAULT: number = 4; // index of 1x
let replaySpeedIdx: number = REPLAY_SPEED_DEFAULT;
let replaySourceScreen: string = 'gameover'; // where to return on exit
let _replayUIHidden: boolean = false;
let _controlsOverlayOpen: boolean = false;
let _replayExpanded: boolean = false;

// ── Mobile portrait header handling ─────────────────────
const _mobilePortraitMql: MediaQueryList = window.matchMedia('(max-width: 480px) and (orientation: portrait)');
const _onMobileHeaderLayoutChange = (): void => _syncMobileHeaderLayout();

// ── Free Cam state ───────────────────────────────────────
const _freeCamKeys: Record<string, boolean> = {};
/** Expose freeCamKeys for testing */
// ts-prune-ignore-next
export function _getFreeCamKeysRef(): Record<string, boolean> { return _freeCamKeys; }
let _freeCamWasActive: boolean = false;
let _freeCamBannerTimeout: ReturnType<typeof setTimeout> | null = null;
let _freeCamLocked: boolean = false;

// Clear freecam keys when window loses focus (prevents stuck movement on alt-tab)
function _clearFreeCamKeys(): void { for (const k in _freeCamKeys) _freeCamKeys[k] = false; }
window.addEventListener('blur', _clearFreeCamKeys);
document.addEventListener('visibilitychange', () => { if (document.hidden) _clearFreeCamKeys(); });

// ── Helpers ──────────────────────────────────────────────
function isBound(code: string, action: ActionName): boolean {
  const b = getBinds()[action];
  return b && b.includes(code);
}

function updateSpeedLabel(): void {
  _game._replayPlayer.speed = REPLAY_SPEEDS[replaySpeedIdx];
  document.getElementById('replay-speed-label')!.textContent = REPLAY_SPEED_LABELS[replaySpeedIdx];
  // Update status text when speed changes
  if (_game._replayPlayer.playing) {
    const s: number = REPLAY_SPEEDS[replaySpeedIdx];
    document.getElementById('replay-status')!.textContent = s < 0 ? 'REWIND' : 'REPLAY';
  }
}

function seekReplay(progress: number): void {
  _game.seekTo(progress);
}

function _buildDeathMarkers(): void {
  // Remove old markers
  const container: HTMLElement | null = document.getElementById('replay-progress');
  if (!container) return;
  container.querySelectorAll('.death-marker').forEach((m: Element) => m.remove());

  const data = _game._replayPlayer.data;
  if (!data || data.duration <= 0) return;

  // Scan frames for alive→dead transitions
  const prevAlive: boolean[] = new Array(1 + data.aiColors.length).fill(true);
  for (let fi: number = 0; fi < data.frames.length; fi++) {
    const f = data.frames[fi];
    const allStates = [f.player, ...f.ais];
    for (let i: number = 0; i < allStates.length; i++) {
      if (prevAlive[i] && !allStates[i].alive) {
        // Death detected — create marker
        const pct: number = (f.t / data.duration) * 100;
        const color: number = i === 0 ? data.playerColor : data.aiColors[i - 1].color;
        const hex: string = '#' + (color & 0xFFFFFF).toString(16).padStart(6, '0');
        const dot: HTMLDivElement = document.createElement('div');
        dot.className = 'death-marker';
        dot.style.left = pct + '%';
        dot.style.background = hex;
        dot.style.boxShadow = `0 0 6px ${hex}`;
        dot.setAttribute('data-tip', (i === 0 ? 'Player' : 'Opponent ' + i) + ' eliminated');
        container.appendChild(dot);
      }
      prevAlive[i] = allStates[i].alive;
    }
  }
}

// ── Free Cam Input (Replay) ─────────────────────────────
export function updateFreeCamInput(): void {
  // Allow free cam in replay mode (any playback state) when cam mode is free
  if (_game.camMode !== 1) {
    _game.setFreeCamInput(null);
    if (_freeCamWasActive && document.pointerLockElement) document.exitPointerLock();
    _freeCamWasActive = false;
    return;
  }
  if (!_freeCamWasActive) {
    // Show exit hint banner
    const banner: HTMLElement | null = document.getElementById('controller-banner');
    if (banner) {
      banner.textContent = 'PRESS ESC TO EXIT FREE CAM';
      banner.style.color = 'rgb(var(--c-teal))';
      banner.style.textShadow = '0 0 12px rgb(var(--c-teal)), 0 0 30px rgb(var(--c-teal))';
      show(banner);
      clearTimeout(_freeCamBannerTimeout!);
      _freeCamBannerTimeout = setTimeout(() => hide(banner), 3000);
    }
    // On entering freecam with keyboard/mouse, deselect any focused button
    if (!isGamepadConnected()) {
      document.querySelectorAll('[class*="--selected"]').forEach((el: Element) => {
        el.className = el.className.replace(/\S*--selected/g, '').trim();
      });
    }
  }
  _freeCamWasActive = true;
  const gp: GamepadState | null = getGamepadState();
  // Controller d-pad only moves camera when replay menu is hidden
  const replayControls: HTMLElement | null = document.getElementById('replay-controls');
  const replayMenuOpen: boolean = replayControls != null && !replayControls.classList.contains('hidden');
  const dpadCam: boolean = gp != null && !replayMenuOpen;
  // Invert left stick axes for freecam (matches expected camera direction)
  _game.setFreeCamInput({
    forward: _freeCamKeys['KeyW'] || _freeCamKeys['ArrowUp'] || (gp && gp.leftStickY > 0.3),
    backward: _freeCamKeys['KeyS'] || _freeCamKeys['ArrowDown'] || (gp && gp.leftStickY < -0.3),
    left: _freeCamKeys['KeyA'] || _freeCamKeys['ArrowLeft'] || (gp && gp.leftStickX > 0.3),
    right: _freeCamKeys['KeyD'] || _freeCamKeys['ArrowRight'] || (gp && gp.leftStickX < -0.3),
    up: _freeCamKeys['Space'] || (gp && gp.rb) || (dpadCam && gp!.dpadDown),
    down: _freeCamKeys['ShiftLeft'] || _freeCamKeys['ShiftRight'] || (gp && gp.lb) || (dpadCam && gp!.dpadUp),
    fast: _freeCamKeys['ControlLeft'] || _freeCamKeys['ControlRight'],
    lookX: gp ? (gp.rightStickX || 0) : 0,
    lookY: gp ? (gp.rightStickY || 0) : 0,
    dpadLookX: dpadCam ? ((gp!.dpadLeft ? -1 : 0) + (gp!.dpadRight ? 1 : 0)) : 0,
    dpadLookY: dpadCam ? ((gp!.dpadUp ? -1 : 0) + (gp!.dpadDown ? 1 : 0)) : 0,
    zoomDelta: 0,
  });
}

// ── Gamepad replay controls (called from game loop) ──────
export function updateReplayGamepad(): void {
  const _rcEl: HTMLElement | null = document.getElementById('replay-controls');
  const _replayMenuVisible: boolean = _rcEl != null && !_rcEl.classList.contains('hidden');
  const _inFreeCam: boolean = _game.camMode === 1;
  const _freecamDpadActive: boolean = _inFreeCam && !_replayMenuVisible;

  const gp: GamepadState | null = getGamepadState();
  // SELECT button = toggle controls overlay (does NOT swallow other inputs — playback continues)
  if (gp && gp._edges && gp._edges[8]) toggleControlsOverlay();
  // LB / RB = cycle camera (in non-freecam modes, or always when menu visible)
  if (!_inFreeCam || _replayMenuVisible) {
    if (gp && gp._edges && gp._edges[4]) _game.cycleReplayCamera(-1); // LB
    if (gp && gp._edges && gp._edges[5]) _game.cycleReplayCamera(1);  // RB
  }
  // LT / RT = speed down / up
  if (gp && gp._edges) {
    if (gp._edges[6]) { replaySpeedIdx = Math.max(0, replaySpeedIdx - 1); updateSpeedLabel(); } // LT
    if (gp._edges[7]) { replaySpeedIdx = Math.min(REPLAY_SPEEDS.length - 1, replaySpeedIdx + 1); updateSpeedLabel(); } // RT
  }
  // D-pad left/right = skip time (not songs) when not captured by freecam
  if (!_freecamDpadActive && gp && gp._edges) {
    if (gp._edges[14]) document.getElementById('btn-replay-rw')!.click();  // D-left = rewind 3s
    if (gp._edges[15]) document.getElementById('btn-replay-ff')!.click();  // D-right = FF 3s
  }
  // Y button = toggle UI
  if (gp && gp._edges && gp._edges[3]) {
    _replayUIHidden = !_replayUIHidden;
    if (_rcEl) toggleVisible(_rcEl, !_replayUIHidden);
    const exitBtn: HTMLElement | null = document.getElementById('btn-replay-exit-top');
    if (exitBtn) toggleVisible(exitBtn, !_replayUIHidden);
  }
  // X button = play/pause
  if (gp && gp._edges && gp._edges[2]) {
    document.getElementById('btn-replay-play')!.click();
  }
}

// ── Controls overlay (SELECT button) ─────────────────────
/**
 * Toggle the replay controls summary overlay. Does not pause playback —
 * the replay keeps playing behind the overlay, and every gamepad input
 * (except SELECT itself) still reaches the replay controls.
 */
export function toggleControlsOverlay(): void {
  const overlay: HTMLElement | null = document.getElementById('replay-controls-overlay');
  if (!overlay) return;
  _controlsOverlayOpen = !_controlsOverlayOpen;
  overlay.hidden = !_controlsOverlayOpen;
}

/** Returns whether the controls summary overlay is currently open (for tests). */
// ts-prune-ignore-next
export function _isControlsOverlayOpen(): boolean { return _controlsOverlayOpen; }

// ── Mobile portrait expand toggle (advanced controls) ──
/**
 * Toggle the `.replay--expanded` class on `#replay-overlay`. This reveals the
 * advanced controls (speed, camera, favourite, loop, restart) that are hidden
 * by default in mobile portrait mode. CSS (phone.css) drives the actual
 * visibility changes.
 */
export function _toggleReplayExpanded(): void {
  _replayExpanded = !_replayExpanded;
  const overlay: HTMLElement | null = document.getElementById('replay-overlay');
  if (overlay) overlay.classList.toggle('replay--expanded', _replayExpanded);
  const btn: HTMLElement | null = document.getElementById('replay-expand-toggle');
  if (btn) btn.setAttribute('aria-expanded', _replayExpanded ? 'true' : 'false');
}

/** Expose _replayExpanded for testing. */
// ts-prune-ignore-next
export function _isReplayExpanded(): boolean { return _replayExpanded; }

/**
 * Sync the mobile header bar layout. At mobile portrait (≤480px portrait):
 * - Show `#replay-mobile-header`
 * - If a series match selector is present (non-hidden), move it into the
 *   header center so the top-72px desktop position doesn't clash with the
 *   header bar.
 *
 * Outside mobile portrait: hide the mobile header and move the match selector
 * back to its original parent (`#replay-overlay`) so the desktop `top: 72px`
 * rule applies again.
 *
 * This function is safe to call repeatedly; it is idempotent.
 */
function _syncMobileHeaderLayout(): void {
  const header: HTMLElement | null = document.getElementById('replay-mobile-header');
  const overlay: HTMLElement | null = document.getElementById('replay-overlay');
  const selector: HTMLElement | null = document.getElementById('replay-match-selector');
  if (!header || !overlay) return;

  const isMobilePortrait: boolean = _mobilePortraitMql.matches;

  if (isMobilePortrait) {
    header.hidden = false;
    // If the replay has a visible series selector, move it into the header center.
    if (selector && !selector.hidden) {
      const center: HTMLElement | null = header.querySelector('.replay-mobile-header-center');
      if (center && selector.parentElement !== center) {
        center.appendChild(selector);
      }
    }
  } else {
    header.hidden = true;
    // Move the match selector back to the overlay if it currently lives in the header.
    if (selector && selector.parentElement && selector.parentElement.classList.contains('replay-mobile-header-center')) {
      overlay.appendChild(selector);
    }
    // Collapse the expanded state when leaving mobile portrait so desktop layout
    // doesn't get stuck with advanced controls hidden/shown unexpectedly.
    if (_replayExpanded) {
      _replayExpanded = false;
      overlay.classList.remove('replay--expanded');
      const btn: HTMLElement | null = document.getElementById('replay-expand-toggle');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
  }
}

/** Show the "Press SELECT for controls" hint only when a gamepad is connected. */
function _updateControllerHintVisibility(): void {
  const hint = document.getElementById('replay-controller-hint');
  if (!hint) return;
  const connected: boolean = isGamepadConnected();
  hint.hidden = !connected;
}

// Bound handler reference so we can add/remove the same listener
const _onGamepadConnectionChange = (): void => _updateControllerHintVisibility();

// ── Match selector (series replay swap) ─────────────────
/** Cached siblings of the currently-viewed replay's series. Empty when not in a series. */
let _currentSeriesSiblings: ReplayListEntry[] = [];

/** Expose siblings for testing. */
// ts-prune-ignore-next
export function _getCurrentSeriesSiblings(): ReplayListEntry[] { return _currentSeriesSiblings; }

/**
 * Update the `< MATCH X / Y >` selector pill visibility and contents based on
 * `currentReplay`. If the replay has no `seriesInfo.seriesId`, hide it. Else
 * fetch siblings, sort by roundIndex (fallback timestamp), and populate.
 */
export async function _updateMatchSelector(currentReplay: ReplayListEntry | LoadedReplayEntry | null): Promise<void> {
  const selector: HTMLElement | null = document.getElementById('replay-match-selector');
  if (!selector) return;
  const seriesId: string | null | undefined = currentReplay?.seriesInfo?.seriesId;
  if (!currentReplay || !seriesId) {
    _currentSeriesSiblings = [];
    selector.hidden = true;
    return;
  }

  const siblings: ReplayListEntry[] = await getSeriesById(seriesId);
  // Sort by roundIndex ascending; fall back to timestamp for ties or missing roundIndex.
  siblings.sort((a: ReplayListEntry, b: ReplayListEntry) => {
    const ra: number = a.seriesInfo?.roundIndex ?? Number.POSITIVE_INFINITY;
    const rb: number = b.seriesInfo?.roundIndex ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a.timestamp - b.timestamp;
  });
  _currentSeriesSiblings = siblings;

  if (siblings.length === 0) {
    selector.hidden = true;
    return;
  }

  const currentIdx: number = siblings.findIndex((s: ReplayListEntry) => s.id === currentReplay.id);
  const safeIdx: number = currentIdx < 0 ? 0 : currentIdx;
  const total: number = siblings.length;

  const indexEl: HTMLElement | null = document.getElementById('replay-match-index');
  const totalEl: HTMLElement | null = document.getElementById('replay-match-total');
  if (indexEl) indexEl.textContent = String(safeIdx + 1);
  if (totalEl) totalEl.textContent = String(total);

  const prevBtn: HTMLButtonElement | null = document.getElementById('replay-match-prev') as HTMLButtonElement | null;
  const nextBtn: HTMLButtonElement | null = document.getElementById('replay-match-next') as HTMLButtonElement | null;
  if (prevBtn) prevBtn.disabled = safeIdx <= 0;
  if (nextBtn) nextBtn.disabled = safeIdx >= total - 1;

  selector.hidden = false;
}

/**
 * Swap the current replay to a sibling in the cached series. Preserves the
 * play/pause state — if playback was paused before the swap, the new replay
 * is paused after load; otherwise it continues playing.
 */
async function _swapToSiblingMatch(targetIndex: number): Promise<void> {
  if (targetIndex < 0 || targetIndex >= _currentSeriesSiblings.length) return;
  const sibling: ReplayListEntry = _currentSeriesSiblings[targetIndex];
  if (!sibling || sibling.id === _game._lastSavedReplayId) return;

  const wasPaused: boolean = !_game._replayPlayer.playing;

  const entry: LoadedReplayEntry | null = await loadReplay(sibling.id);
  if (!entry) return;

  const snapshot: ReplaySnapshot = {
    frames: entry.frames,
    playerColor: entry.playerColor,
    playerEmissive: entry.playerEmissive,
    playerVehicle: entry.playerVehicle || 'bike',
    aiColors: entry.aiColors,
    aiVehicles: entry.aiVehicles || [],
    duration: entry.duration,
  };

  _game._lastSavedReplayId = sibling.id;
  _game._lastReplaySnapshot = snapshot;
  await _game.startReplayFromSnapshot(snapshot);

  // Preserve paused state if the user had paused before swapping.
  if (wasPaused) {
    _game._replayPlayer.playing = false;
    const playBtn: HTMLElement | null = document.getElementById('btn-replay-play');
    if (playBtn) playBtn.innerHTML = ico('play');
    const statusEl: HTMLElement | null = document.getElementById('replay-status');
    if (statusEl) statusEl.textContent = 'PAUSED';
  }

  await _updateMatchSelector(entry);
}

function wireMatchSelectorButtons(): void {
  const prevBtn: HTMLElement | null = document.getElementById('replay-match-prev');
  const nextBtn: HTMLElement | null = document.getElementById('replay-match-next');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      const curIdx: number = _currentSeriesSiblings.findIndex((s: ReplayListEntry) => s.id === _game._lastSavedReplayId);
      if (curIdx > 0) _swapToSiblingMatch(curIdx - 1).catch(warnDev);
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const curIdx: number = _currentSeriesSiblings.findIndex((s: ReplayListEntry) => s.id === _game._lastSavedReplayId);
      if (curIdx >= 0 && curIdx < _currentSeriesSiblings.length - 1) _swapToSiblingMatch(curIdx + 1).catch(warnDev);
    });
  }
}

// ── Toggle replay UI visibility (available for future callers / tests) ──
// ts-prune-ignore-next
export function toggleReplayUIVisibility(): void {
  _replayUIHidden = !_replayUIHidden;
  const rc: HTMLElement | null = document.getElementById('replay-controls');
  const exitBtn: HTMLElement | null = document.getElementById('btn-replay-exit-top');
  if (rc) toggleVisible(rc, !_replayUIHidden);
  if (exitBtn) toggleVisible(exitBtn, !_replayUIHidden);
}

// ── Set replay source screen ─────────────────────────────
export function setReplaySourceScreen(screen: string): void {
  replaySourceScreen = screen;
}

// ── Init ─────────────────────────────────────────────────
function wireCameraArrows(game: GameInstance): void {
  document.getElementById('btn-replay-cam-left')!.addEventListener('click', () => game.cycleReplayCamera(-1));
  document.getElementById('btn-replay-cam-right')!.addEventListener('click', () => game.cycleReplayCamera(1));
}

function wireSpeedButtons(): void {
  document.getElementById('btn-replay-speed-left')!.addEventListener('click', () => {
    replaySpeedIdx = cycleIndex(replaySpeedIdx, -1, REPLAY_SPEEDS.length);
    updateSpeedLabel();
  });
  document.getElementById('btn-replay-speed-right')!.addEventListener('click', () => {
    replaySpeedIdx = cycleIndex(replaySpeedIdx, 1, REPLAY_SPEEDS.length);
    updateSpeedLabel();
  });
}

function wirePlaybackButtons(game: GameInstance): void {
  // ── Play / Pause ────────────────────────────────────────
  document.getElementById('btn-replay-play')!.addEventListener('click', () => {
    if (game._replayPlayer.isFinished()) {
      seekReplay(0);
      game._replayPlayer.playing = true;
    } else {
      game._replayPlayer.playing = !game._replayPlayer.playing;
    }
    document.getElementById('btn-replay-play')!.innerHTML = game._replayPlayer.playing ? ico('pause') : ico('play');
    hide('btn-replay-restart');
    const spd: number = REPLAY_SPEEDS[replaySpeedIdx];
    document.getElementById('replay-status')!.textContent = game._replayPlayer.playing ? (spd < 0 ? 'REWIND' : 'REPLAY') : 'PAUSED';
  });

  // ── Rewind 3s ───────────────────────────────────────────
  document.getElementById('btn-replay-rw')!.addEventListener('click', () => {
    const cur: number = game._replayPlayer.time;
    const newTime: number = Math.max(0, cur - 3);
    seekReplay(game._replayPlayer.data ? newTime / game._replayPlayer.data.duration : 0);
    hide('btn-replay-restart');
  });

  // ── Forward 3s ──────────────────────────────────────────
  document.getElementById('btn-replay-ff')!.addEventListener('click', () => {
    if (!game._replayPlayer.data) return;
    const cur: number = game._replayPlayer.time;
    const newTime: number = Math.min(game._replayPlayer.data.duration, cur + 3);
    seekReplay(newTime / game._replayPlayer.data.duration);
    hide('btn-replay-restart');
  });

  // ── Restart ─────────────────────────────────────────────
  document.getElementById('btn-replay-restart')!.addEventListener('click', () => {
    seekReplay(0);
    game._replayPlayer.playing = true;
    document.getElementById('btn-replay-play')!.innerHTML = ico('pause');
    hide('btn-replay-restart');
    document.getElementById('replay-status')!.textContent = 'REPLAY';
  });
}

function wireFavoriteAndLoop(game: GameInstance): void {
  // ── Favorite (replay bar) ──────────────────────────────
  document.getElementById('btn-replay-fav')!.addEventListener('click', () => {
    if (!game._lastSavedReplayId) return;
    toggleFavorite(game._lastSavedReplayId).then((isFav: boolean) => {
      const btn: HTMLElement = document.getElementById('btn-replay-fav')!;
      btn.classList.toggle('replay-btn--active', isFav);
      btn.innerHTML = isFav ? ico('star', 'icon--fill-stroke') : ico('star');
    });
  });

  // ── Loop toggle ─────────────────────────────────────────
  document.getElementById('btn-replay-loop')!.addEventListener('click', () => {
    game._replayPlayer.loop = !game._replayPlayer.loop;
    document.getElementById('btn-replay-loop')!.classList.toggle('replay-btn--active', game._replayPlayer.loop);
  });

  // ── Fav button on result screen ─────────────────────────
  document.getElementById('btn-replay-fav-result')!.addEventListener('click', () => {
    if (!game._lastSavedReplayId) return;
    toggleFavorite(game._lastSavedReplayId).then((isFav: boolean) => {
      const btn: HTMLElement = document.getElementById('btn-replay-fav-result')!;
      btn.innerHTML = isFav ? ico('star', 'icon--fill-stroke') : ico('star');
    });
  });
}

function _handleReplayExit(game: GameInstance): void {
  replaySpeedIdx = REPLAY_SPEED_DEFAULT;
  if (replaySourceScreen === 'history' || replaySourceScreen === 'profile') {
    game.exitReplayToMenu();
  } else {
    game.exitReplayToResults().then(() => {
      _setCurrentScreen!('gameover'); _setFocusIndex!(0); _updateFocus!();
    }).catch(() => {
      // Fallback: force result screen visible even if fade failed
      if (window.showScreen) window.showScreen('gameover');
      _setCurrentScreen!('gameover'); _setFocusIndex!(0); _updateFocus!();
    });
  }
}

function wireExitButton(game: GameInstance): void {
  document.getElementById('btn-replay-exit-top')!.addEventListener('click', () => _handleReplayExit(game));
  // Mobile portrait header back button — shares the same exit handler.
  const mobileBack: HTMLElement | null = document.getElementById('replay-mobile-back');
  if (mobileBack) {
    mobileBack.addEventListener('click', () => _handleReplayExit(game));
  }
}

function wireExpandToggle(): void {
  const btn: HTMLElement | null = document.getElementById('replay-expand-toggle');
  if (btn) {
    btn.addEventListener('click', () => _toggleReplayExpanded());
  }
}

function wireScrubber(game: GameInstance): void {
  const progressBar: HTMLElement = document.getElementById('replay-progress')!;
  let _lastSeekBeep = 0;
  const _seekFromEvent = (clientX: number): void => {
    const rect: DOMRect = progressBar.getBoundingClientRect();
    const progress: number = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const wasPlaying: boolean = game._replayPlayer.playing;
    seekReplay(progress);
    game._replayPlayer.playing = wasPlaying;
    hide('btn-replay-restart');
    const now = performance.now();
    if (now - _lastSeekBeep > 200) { _lastSeekBeep = now; playUiReadout(); }
  };
  progressBar.addEventListener('click', (e: MouseEvent) => _seekFromEvent(e.clientX));
  progressBar.addEventListener('touchstart', (e: TouchEvent) => { e.preventDefault(); _seekFromEvent(e.touches[0].clientX); }, { passive: false });
  progressBar.addEventListener('touchmove', (e: TouchEvent) => { e.preventDefault(); _seekFromEvent(e.touches[0].clientX); }, { passive: false });
}

function wireKeyboardShortcuts(game: GameInstance): void {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (game.state !== 'replay') return;
    if ((document.activeElement as HTMLElement).tagName === 'INPUT') return;
    const inFreeCam: boolean = game.camMode === 1;

    // Play/pause (skip in freecam — freecam uses Space for vertical movement)
    if (isBound(e.code, 'rPlayPause') && !inFreeCam) {
      document.getElementById('btn-replay-play')!.click();
      e.preventDefault();
      return;
    }

    // Cycle camera
    if (isBound(e.code, 'rCamPrev')) { game.cycleReplayCamera(-1); return; }
    if (isBound(e.code, 'rCamNext')) { game.cycleReplayCamera(1); return; }

    // Skip 3s (skip in freecam — freecam uses arrows for strafe)
    if (isBound(e.code, 'rSkipBack') && !inFreeCam) {
      document.getElementById('btn-replay-rw')!.click();
      e.preventDefault();
      return;
    }
    if (isBound(e.code, 'rSkipFwd') && !inFreeCam) {
      document.getElementById('btn-replay-ff')!.click();
      e.preventDefault();
      return;
    }

    // Toggle replay UI visibility
    if (isBound(e.code, 'rToggleUI')) {
      _replayUIHidden = !_replayUIHidden;
      const rc: HTMLElement | null = document.getElementById('replay-controls');
      const exitBtn: HTMLElement | null = document.getElementById('btn-replay-exit-top');
      if (rc) toggleVisible(rc, !_replayUIHidden);
      if (exitBtn) toggleVisible(exitBtn, !_replayUIHidden);
      return;
    }

    // 1-7 = speed presets (fixed, not rebindable)
    const digitMap: Record<string, number> = { 'Digit1': 0, 'Digit2': 1, 'Digit3': 2, 'Digit4': 3, 'Digit5': 4, 'Digit6': 5, 'Digit7': 6 };
    if (digitMap[e.code] !== undefined && digitMap[e.code] < REPLAY_SPEEDS.length) {
      replaySpeedIdx = digitMap[e.code];
      updateSpeedLabel();
      return;
    }

    // Fine skip (1 second back / forward)
    if (isBound(e.code, 'rFineBack') && game._replayPlayer.data) {
      const t: number = Math.max(0, game._replayPlayer.time - 1);
      seekReplay(t / game._replayPlayer.data.duration);
      return;
    }
    if (isBound(e.code, 'rFineFwd') && game._replayPlayer.data) {
      const t: number = Math.min(game._replayPlayer.data.duration, game._replayPlayer.time + 1);
      seekReplay(t / game._replayPlayer.data.duration);
      return;
    }

    // [ / ] = previous / next match in series
    if (e.code === 'BracketLeft' && _currentSeriesSiblings.length > 0) {
      const curIdx: number = _currentSeriesSiblings.findIndex((s: ReplayListEntry) => s.id === _game._lastSavedReplayId);
      if (curIdx > 0) {
        _swapToSiblingMatch(curIdx - 1).catch(warnDev);
        e.preventDefault();
      }
      return;
    }
    if (e.code === 'BracketRight' && _currentSeriesSiblings.length > 0) {
      const curIdx: number = _currentSeriesSiblings.findIndex((s: ReplayListEntry) => s.id === _game._lastSavedReplayId);
      if (curIdx >= 0 && curIdx < _currentSeriesSiblings.length - 1) {
        _swapToSiblingMatch(curIdx + 1).catch(warnDev);
        e.preventDefault();
      }
      return;
    }
  });
}

function wireFreeCamInput(game: GameInstance): void {
  // ── Free Cam key tracking ───────────────────────────────
  window.addEventListener('keydown', (e: KeyboardEvent) => { _freeCamKeys[e.code] = true; });
  window.addEventListener('keyup', (e: KeyboardEvent) => { _freeCamKeys[e.code] = false; });

  // ── Free Cam Pointer Lock ──────────────────────────────
  // Click canvas to enter free cam (if not already) and lock pointer
  window.addEventListener('mousedown', (e: MouseEvent) => {
    if (!_canvas || _freeCamLocked || game.state !== 'replay') return;
    if ((e.target as HTMLElement).closest('.ui-layer, .overlay-screen')) return;
    // Switch to free cam if not already in it
    if (game.camMode !== 1) {
      // Cycle until we reach free cam (mode 1), with a safety bound
      for (let i = 0; i < 10 && game.camMode !== 1; i++) game.cycleReplayCamera(1);
      if (game.camMode !== 1) return;
    }
    _canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    _freeCamLocked = document.pointerLockElement === _canvas;
  });
  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (_freeCamLocked) {
      game.applyMouseLook(e.movementX, e.movementY);
    }
  });
  window.addEventListener('contextmenu', (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('#chat-input-row')) return;
    e.preventDefault();
  });
}

export function initReplayUI({ game, setCurrentScreen, setFocusIndex, updateFocus, canvas }: ReplayUIeDeps): void {
  _game = game;
  _setCurrentScreen = setCurrentScreen;
  _setFocusIndex = setFocusIndex;
  _updateFocus = updateFocus;
  _canvas = canvas;

  // Replay button handler lives in main.ts (match-selector-aware)
  wireCameraArrows(game);
  wireSpeedButtons();
  wirePlaybackButtons(game);
  wireFavoriteAndLoop(game);
  wireExitButton(game);
  wireScrubber(game);
  wireKeyboardShortcuts(game);
  wireFreeCamInput(game);
  wireMatchSelectorButtons();
  wireExpandToggle();

  // Controller hint visibility reacts to connect/disconnect events app-wide.
  // A single listener pair is installed here; the hint element is inside the
  // replay overlay, so updating its hidden state outside replay is harmless.
  window.addEventListener('gamepadconnected', _onGamepadConnectionChange);
  window.addEventListener('gamepaddisconnected', _onGamepadConnectionChange);

  // Mobile portrait header: re-layout on resize / orientation change.
  window.addEventListener('resize', _onMobileHeaderLayoutChange);
  window.addEventListener('orientationchange', _onMobileHeaderLayoutChange);
  // Listen to the media query directly as a belt-and-braces for platforms
  // where `resize` doesn't always fire on orientation changes.
  if (typeof _mobilePortraitMql.addEventListener === 'function') {
    _mobilePortraitMql.addEventListener('change', _onMobileHeaderLayoutChange);
  }
}

// ── Reset (called when entering replay) ──────────────────
export function resetReplayUI(): void {
  replaySpeedIdx = REPLAY_SPEED_DEFAULT; // 1x
  _replayUIHidden = false;
  _controlsOverlayOpen = false;
  _replayExpanded = false;
  const overlayRoot: HTMLElement | null = document.getElementById('replay-overlay');
  if (overlayRoot) overlayRoot.classList.remove('replay--expanded');
  const expandBtn: HTMLElement | null = document.getElementById('replay-expand-toggle');
  if (expandBtn) expandBtn.setAttribute('aria-expanded', 'false');
  const overlayEl: HTMLElement | null = document.getElementById('replay-controls-overlay');
  if (overlayEl) overlayEl.hidden = true;
  // Hide match selector until we know the replay is part of a series.
  const matchSelector: HTMLElement | null = document.getElementById('replay-match-selector');
  if (matchSelector) matchSelector.hidden = true;
  _currentSeriesSiblings = [];
  document.getElementById('replay-speed-label')!.textContent = '1x';
  document.getElementById('btn-replay-play')!.innerHTML = ico('pause');
  hide('btn-replay-restart');
  document.getElementById('btn-replay-fav')!.classList.remove('replay-btn--active');
  document.getElementById('btn-replay-fav')!.innerHTML = ico('star');
  document.getElementById('replay-status')!.textContent = 'REPLAY';
  show('replay-controls');
  show('btn-replay-exit-top');
  document.getElementById('btn-replay-loop')!.classList.remove('replay-btn--active');
  _buildDeathMarkers();
  _updateControllerHintVisibility();
  _syncMobileHeaderLayout();
  // Check if current replay is favorited + populate match selector for series replays.
  if (_game._lastSavedReplayId) {
    getReplayList().then((list: ReplayListEntry[]) => {
      const entry: ReplayListEntry | undefined = list.find((e: ReplayListEntry) => e.id === _game._lastSavedReplayId);
      if (entry && entry.favorite) {
        document.getElementById('btn-replay-fav')!.classList.add('replay-btn--active');
        document.getElementById('btn-replay-fav')!.innerHTML = ico('star', 'icon--fill-stroke');
      }
      _updateMatchSelector(entry ?? null).then(() => {
        // After the match selector may have become visible (or not), re-sync
        // the mobile header so it gets moved into place at mobile portrait.
        _syncMobileHeaderLayout();
      }).catch(warnDev);
    });
  }
}
