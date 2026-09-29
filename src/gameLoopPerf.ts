// ── Game Loop — gamepad navigation + screen-state tracking ─────
// Extracted from gameLoop.ts. Handles the sizable per-frame gamepad/UI
// navigation dispatch so loop() stays a thin orchestrator. Despite the
// "Perf" filename, this contains the frame-budgeted gamepad dispatch work
// that used to inflate the loop — the actual frame-time sampling lives
// inside updateFPS() / perfStats.

import { getGamepadState, getRawGamepadState, getUINav, isGamepadConnected, getForceKeyboard, setForceKeyboard } from './gamepad';
import { playHover, playTick } from './sfx';
import { playMatchPause } from './sfxAssets';
import { prevTrack, skipTrack } from './audio';
import {
  getCurrentScreen, setCurrentScreen, getFocusIndex, setFocusIndex,
  updateFocus, getMenuButtons, isFocusable, navigateBackFromUI,
} from './ui/navigation';
import { tryCollapseOpenLobbies } from './ui/onlineUI';
import { updateControlUI } from './ui/inputUI';
import { updateReplayGamepad } from './ui/replayUI';
import { cycleSocialTab } from './ui/socialUI';
import { TOUCH_ENABLED } from './input';
import { showTouchControls, hideTouchControls } from './touch';
import { cycleTab, moveFocus, getFocusedRow } from './ui/settingsNav';
import { hideTopBar, showTopBar } from './ui/topbar';
import { isLoadingDismissed } from './ui/loadingScreen';
import type { UINav, GamepadState } from './types/index';

interface PerfDeps {
  game: {
    state: string;
    mode: string;
    camMode: number;
    pause(): void;
    resume(): void;
  };
  ensureAudio: () => void;
}

function _gpNextEnabled(btns: string[], dir: number): void {
  let fi = getFocusIndex();
  for (let i = 0; i < btns.length; i++) {
    fi = (fi + dir + btns.length) % btns.length;
    const el: HTMLElement | null = document.getElementById(btns[fi]);
    if (el && isFocusable(el)) { setFocusIndex(fi); return; }
  }
  setFocusIndex(fi);
}

/** Auto-switch to gamepad mode if any stick/button activity arrives while in KB mode. */
export function maybeSwitchToGamepad(): void {
  if (getForceKeyboard() && isGamepadConnected()) {
    const raw: GamepadState | null = getRawGamepadState();
    if (raw && (raw.a || raw.b || raw.x || raw.y || raw.start || raw.select ||
        raw.lb || raw.rb || raw.lt || raw.rt || raw.dpadUp || raw.dpadDown ||
        raw.dpadLeft || raw.dpadRight ||
        Math.abs(raw.leftStickX) > 0.5 || Math.abs(raw.leftStickY) > 0.5)) {
      setForceKeyboard(false);
      updateControlUI();
    }
  }
}

function _handleStartSelect(nav: UINav, deps: PerfDeps): void {
  if (nav.start) {
    if (deps.game.state === 'playing' && deps.game.mode !== 'online') {
      deps.game.pause(); playMatchPause(); showTopBar(); hideTouchControls(); setCurrentScreen('paused'); setFocusIndex(0); updateFocus(); updateControlUI();
    } else if (deps.game.state === 'playing' && deps.game.mode === 'online' && getCurrentScreen() === 'onlinePause') {
      playTick(); document.getElementById('online-pause-overlay')!.classList.add('hidden');
      setCurrentScreen(null);
    } else if (deps.game.state === 'playing' && deps.game.mode === 'online') {
      playTick(); document.getElementById('online-pause-overlay')!.classList.remove('hidden');
      setCurrentScreen('onlinePause'); setFocusIndex(0); updateFocus();
    } else if (deps.game.state === 'paused') {
      deps.game.resume(); playTick(); hideTopBar(); if (TOUCH_ENABLED) showTouchControls(); setCurrentScreen(null); updateControlUI();
    }
  }

  if (nav.select) {
    // In replay state, SELECT is handled by updateReplayGamepad (toggles
    // the controls summary overlay). Outside replay, it toggles the
    // bottom bar collapse state.
    if (deps.game.state !== 'replay') {
      document.getElementById('bottom-bar')!.classList.toggle('bottom-bar--collapsed');
    }
  }
}

function _handleMusicDpad(nav: UINav, inReplay: boolean, freecamDpadActive: boolean, deps: PerfDeps): void {
  if (inReplay || freecamDpadActive) return;
  let onInteractive: boolean = false;
  const _gpScreen = getCurrentScreen();
  if (_gpScreen) {
    const btns: string[] | undefined = getMenuButtons()[_gpScreen];
    if (btns) {
      const elId: string = btns[getFocusIndex()];
      const el: HTMLElement | null = document.getElementById(elId);
      if (el && (el as HTMLInputElement).type === 'range') onInteractive = true;
      if (el && el.classList.contains('control-toggle')) onInteractive = true;
      // Any element in the arrowMap is interactive (selectors, filters, etc.)
      if (['input-label',
           'gfx-bloom-label', 'gfx-pr-label', 'gfx-arena-label', 'gfx-rave-label',
           'gfx-react-label', 'gfx-vfx-label', 'gfx-light-label',
           'lb-series-label', 'lb-opp-label', 'lb-mode-label',
           'playlist-mode-label', 'lobby-size-label', 'lobby-bestof-label',
           'lobby-invite-perm-label',
      ].includes(elId)) onInteractive = true;
    }
  }
  if (!onInteractive) {
    const gp: GamepadState | null = getGamepadState();
    if (gp && gp._edges) {
      if (gp._edges[14]) { deps.ensureAudio(); prevTrack(); }
      if (gp._edges[15]) { deps.ensureAudio(); skipTrack(); }
    }
  }
}

function _handleSettingsNav(nav: UINav): void {
  if (nav.lb) { cycleTab(-1); }
  if (nav.rb) { cycleTab(1); }
  if (nav.up) { moveFocus(-1); playHover(); }
  if (nav.down) { moveFocus(1); playHover(); }

  const row = getFocusedRow();
  if (row) {
    // Slider adjust
    const rangeInput = row.querySelector('input[type="range"]') as HTMLInputElement | null;
    if (rangeInput) {
      const sMin = Number(rangeInput.min) || 0;
      const sMax = Number(rangeInput.max) || 100;
      const step = Math.max(1, Math.round((sMax - sMin) / 20));
      if (nav.left) { rangeInput.value = String(Math.max(sMin, Number(rangeInput.value) - step)); rangeInput.dispatchEvent(new Event('input')); rangeInput.dispatchEvent(new Event('change')); }
      if (nav.right) { rangeInput.value = String(Math.min(sMax, Number(rangeInput.value) + step)); rangeInput.dispatchEvent(new Event('input')); rangeInput.dispatchEvent(new Event('change')); }
    }
    // Toggle: left/right cycles options
    const toggle = row.querySelector('.control-toggle') as HTMLElement | null;
    if (toggle) {
      const opts = Array.from(toggle.querySelectorAll('.control-toggle__option')) as HTMLElement[];
      const activeIdx = opts.findIndex(o => o.classList.contains('control-toggle__option--active'));
      if (nav.left && activeIdx > 0) opts[activeIdx - 1].click();
      if (nav.right && activeIdx < opts.length - 1) opts[activeIdx + 1].click();
    }
    // Arrow selector: left/right clicks arrow buttons
    const leftArrow = row.querySelector('.setting-select-left') as HTMLElement | null;
    const rightArrow = row.querySelector('.setting-select-right') as HTMLElement | null;
    if (nav.left && leftArrow) leftArrow.click();
    if (nav.right && rightArrow) rightArrow.click();
    // Keybind row: A enters rebind
    if (nav.confirm && row.classList.contains('keybind-row')) {
      row.click();
    }
  }

  // X button = reset defaults
  const gpState = getGamepadState();
  if (gpState?._edges[2]) {
    document.getElementById('btn-settings-reset')?.click();
  }
}

function _handleRightStickScroll(gpNavScreen: string): void {
  const _gpScroll: GamepadState | null = getGamepadState();
  if (_gpScroll && (Math.abs(_gpScroll.rightStickY) > 0.15)) {
    const _scrollMap: Record<string, string> = {
      settings: 'settings-content-body', history: 'history-list',
      leaderboard: 'lb-table-wrap', friends: 'friends-list',
      social: 'social-overlay', debug: 'debug-overlay',
      profile: 'profile-overlay',
    };
    const containerId: string | undefined = _scrollMap[gpNavScreen];
    if (containerId) {
      const scrollEl: HTMLElement | null = document.getElementById(containerId);
      if (scrollEl) {
        // Find the first actually scrollable child, or use the element itself
        const target: HTMLElement = scrollEl.scrollHeight > scrollEl.clientHeight ? scrollEl
          : (scrollEl.querySelector('.content') as HTMLElement) || scrollEl;
        if (target.scrollHeight > target.clientHeight) {
          target.scrollTop += _gpScroll.rightStickY * 12;
        }
      }
    }
  }
}

function _handleBackNav(gpNavScreen: string, deps: PerfDeps): void {
  // Try to collapse lobby list first (only on 'online' screen)
  if (tryCollapseOpenLobbies()) {
    // Lobby list was open and collapsed, stop here
  } else if (gpNavScreen === 'queue') document.getElementById('btn-queue-cancel')!.click();
  else if (gpNavScreen === 'joinLobby') document.getElementById('btn-join-lobby-leave')!.click();
  else if (gpNavScreen === 'lobby') {
    document.getElementById('btn-lobby-leave')!.click();
  }
  else if (gpNavScreen === 'paused') { deps.game.resume(); hideTopBar(); if (TOUCH_ENABLED) showTouchControls(); setCurrentScreen(null); updateControlUI(); }
  else if (gpNavScreen === 'onlinePause') { document.getElementById('online-pause-overlay')!.classList.add('hidden'); setCurrentScreen(null); }
  else if (gpNavScreen === 'replay') document.getElementById('btn-replay-exit-top')!.click();
  else if (gpNavScreen === 'gameover') { /* blocked — must click a button */ }
  else if (gpNavScreen && gpNavScreen !== 'main') navigateBackFromUI();
}

function _handleMenuButtons(nav: UINav, gpNavScreen: string, deps: PerfDeps): void {
  const btns: string[] | undefined = getMenuButtons()[gpNavScreen];
  if (!btns) return;

  if (nav.down) {
    _gpNextEnabled(btns, 1);
    updateFocus(); playHover();
  }
  if (nav.up) {
    _gpNextEnabled(btns, -1);
    updateFocus(); playHover();
  }
  if (nav.confirm) { deps.ensureAudio(); const el: HTMLElement | null = document.getElementById(btns[getFocusIndex()]); if (el) el.click(); }
  if (nav.back) {
    _handleBackNav(gpNavScreen, deps);
  }
  // Slider adjust
  const el: HTMLElement | null = document.getElementById(btns[getFocusIndex()]);
  if (el && (el as HTMLInputElement).type === 'range') {
    const inputEl: HTMLInputElement = el as HTMLInputElement;
    const sMin: number = Number(inputEl.min) || 0, sMax: number = Number(inputEl.max) || 100;
    const step: number = Math.max(1, Math.round((sMax - sMin) / 20));
    if (nav.left) { inputEl.value = String(Math.max(sMin, Number(inputEl.value) - step)); inputEl.dispatchEvent(new Event('input')); inputEl.dispatchEvent(new Event('change')); }
    if (nav.right) { inputEl.value = String(Math.min(sMax, Number(inputEl.value) + step)); inputEl.dispatchEvent(new Event('input')); inputEl.dispatchEvent(new Event('change')); }
  }
  // Arrow selector adjust
  const arrowMap: Record<string, [string, string]> = {
    'input-label': ['input-left', 'input-right'],
    'gfx-bloom-label': ['gfx-bloom-left', 'gfx-bloom-right'], 'gfx-pr-label': ['gfx-pr-left', 'gfx-pr-right'],
    'gfx-arena-label': ['gfx-arena-left', 'gfx-arena-right'], 'gfx-rave-label': ['gfx-rave-left', 'gfx-rave-right'],
    'gfx-react-label': ['gfx-react-left', 'gfx-react-right'], 'gfx-vfx-label': ['gfx-vfx-left', 'gfx-vfx-right'],
    'gfx-light-label': ['gfx-light-left', 'gfx-light-right'],
    'playlist-mode-label': ['playlist-mode-left', 'playlist-mode-right'],
    'lobby-size-label': ['lobby-size-left', 'lobby-size-right'],
    'lobby-bestof-label': ['lobby-bestof-left', 'lobby-bestof-right'],
    'lobby-invite-perm-label': ['lobby-invite-perm-left', 'lobby-invite-perm-right'],
  };
  const curFocusId: string = btns[getFocusIndex()];
  if (arrowMap[curFocusId]) {
    if (nav.left) document.getElementById(arrowMap[curFocusId][0])!.click();
    if (nav.right) document.getElementById(arrowMap[curFocusId][1])!.click();
  }
  // Segmented toggle gamepad nav
  const focusEl: HTMLElement | null = document.getElementById(curFocusId);
  if (focusEl && focusEl.classList.contains('control-toggle')) {
    const opts: HTMLElement[] = Array.from(focusEl.querySelectorAll('.control-toggle__option')) as HTMLElement[];
    const activeIdx: number = opts.findIndex((o: HTMLElement) => o.classList.contains('control-toggle__option--active'));
    if (nav.left && activeIdx > 0) opts[activeIdx - 1].click();
    if (nav.right && activeIdx < opts.length - 1) opts[activeIdx + 1].click();
  }
  // Icon bar: left/right moves between icon buttons
  if (focusEl && focusEl.classList.contains('menu-icon-btn')) {
    if (nav.left) { _gpNextEnabled(btns, -1); updateFocus(); playHover(); }
    if (nav.right) { _gpNextEnabled(btns, 1); updateFocus(); playHover(); }
  }
}

/**
 * Per-frame gamepad / UI navigation dispatch. Returns early if the UI nav
 * state is null (e.g. loading screen still up). Mirrors exact original
 * ordering of the extracted block from gameLoop.ts.
 */
export function updateGamepadNav(deps: PerfDeps): void {
  const nav: UINav | null = isLoadingDismissed() ? getUINav() : null;
  if (!nav) return;

  _handleStartSelect(nav, deps);

  // Replay-specific gamepad controls
  const _rcEl: HTMLElement | null = document.getElementById('replay-controls');
  const _replayMenuVisible: boolean = !!(_rcEl && !_rcEl.classList.contains('hidden'));
  const _inReplay: boolean = deps.game.state === 'replay';
  const _inFreeCam: boolean = deps.game.camMode === 1;
  const _freecamDpadActive: boolean = _inFreeCam && !_replayMenuVisible;

  if (_inReplay) {
    updateReplayGamepad();
  }

  // D-pad left/right = prev/next song (only when NOT in replay)
  _handleMusicDpad(nav, _inReplay, _freecamDpadActive, deps);

  const _replayNavBlocked: boolean = _inReplay && !_replayMenuVisible;
  const _gpNavScreen = getCurrentScreen();
  if (_replayNavBlocked && nav.back && _gpNavScreen === 'replay') {
    document.getElementById('btn-replay-exit-top')!.click();
  }

  if (_gpNavScreen && !_replayNavBlocked) {
    // Settings page: custom tab/focus navigation
    if (_gpNavScreen === 'settings') {
      _handleSettingsNav(nav);
    }

    // Shoulder buttons switch social tabs
    if (_gpNavScreen === 'social') {
      const gpState = getGamepadState();
      if (gpState?._edges[4]) { cycleSocialTab(-1); setFocusIndex(0); updateFocus(); } // LB
      if (gpState?._edges[5]) { cycleSocialTab(1);  setFocusIndex(0); updateFocus(); } // RB
    }

    _handleRightStickScroll(_gpNavScreen);
    _handleMenuButtons(nav, _gpNavScreen, deps);
  }
}

/** Keep game screen state in sync when game.state changes out from under the UI. */
export function trackScreenState(gameState: string): void {
  const _loopScreen = getCurrentScreen();
  if (gameState === 'gameover' && _loopScreen !== 'gameover') {
    setCurrentScreen('gameover'); setFocusIndex(0); updateFocus(); updateControlUI();
  }
  if (gameState === 'menu' && _loopScreen !== 'main' && _loopScreen !== 'settings' && _loopScreen !== 'login' && _loopScreen !== 'history' && _loopScreen !== 'stats' && _loopScreen !== 'online' && _loopScreen !== 'queue' && _loopScreen !== 'matchFound' && _loopScreen !== 'lobby' && _loopScreen !== 'joinLobby' && _loopScreen !== 'friends' && _loopScreen !== 'music' && _loopScreen !== 'leaderboard' && _loopScreen !== 'bugreport' && _loopScreen !== 'debug' && _loopScreen !== 'characterSelect') {
    setCurrentScreen('main'); setFocusIndex(0); updateFocus(); updateControlUI();
  }
}
