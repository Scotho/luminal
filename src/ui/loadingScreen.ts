/**
 * Loading Screen — progress tracking, asset loading coordination,
 * vapor text animation, and dismissal logic.
 */
import { TOUCH_ENABLED } from '../input';
import { isGamepadConnected } from '../gamepad';
import { startVaporText, triggerVaporText, setVaporText, stopVaporText } from './vaporText';
import { getInstallHint } from './pwa';
import { loadBikeModel } from '../bikeModel';
import { loadCarModel } from '../carModel';
import { loadDroneModel } from '../droneModel';
import { loadArenaModel } from '../arenaModel';
import { loadHoverboardModel } from '../hoverboardModel';
import { getSelectedMap } from './mapSelectUI';

// ── Public state getters ────────────────────────────────────
let _loadProgress: number = 0;
let _loadingDismissed = false;

export function isLoadingDismissed(): boolean { return _loadingDismissed; }
export function getLoadProgress(): number { return _loadProgress; }

// ── Types ───────────────────────────────────────────────────
export interface LoadingScreenDeps {
  game: { state: string; deathWarmup: Promise<void>; _restartDemo: () => void };
  ensureAudio: () => void;
  showScreen: (name: string | null) => void;
  getCurrentScreen: () => string | null;
}

// ── Internal state ──────────────────────────────────────────
let _loadTasks: number = 0;
let _loadDone: number = 0;
let _loadingDismissing = false;

// DOM refs (set during init)
let loadingScreen: HTMLElement;
let loadingStatus: HTMLElement;
let clickPrompt: HTMLElement;
let clickPromptCanvas: HTMLCanvasElement;
let loadingSpinner: HTMLElement;

// Deps (set during init)
let _deps: LoadingScreenDeps;

// ── Private helpers ─────────────────────────────────────────
function _trackLoad(promise: Promise<unknown>, label: string): void {
  _loadTasks++;
  loadingStatus.textContent = label;
  promise.then(() => { _loadDone++; _updateLoadProgress(); }, () => { _loadDone++; _updateLoadProgress(); });
}

function _updateLoadProgress(): void {
  _loadProgress = _loadTasks > 0 ? Math.round((_loadDone / _loadTasks) * 100) : 100;
  if (_loadDone >= _loadTasks) {
    loadingStatus.textContent = 'READY';
    loadingSpinner.classList.add('loading-spinner--done');
    const promptText = TOUCH_ENABLED ? 'TAP TO START' : isGamepadConnected() ? 'PRESS ANY BUTTON TO START' : 'CLICK TO START';
    setVaporText(promptText);
    // Short delay so the spinner fades before the text appears
    setTimeout(() => {
      clickPrompt.classList.add('click-prompt--visible');
      triggerVaporText();
    }, 720);
  }
}

function dismissLoadingKey(_e: KeyboardEvent): void {
  if (_loadProgress < 100) return;
  dismissLoading();
}

// ── Public API ──────────────────────────────────────────────

export function dismissLoading(): void {
  if (_loadProgress < 100 || _loadingDismissed || _loadingDismissing) return;
  _loadingDismissing = true;
  _deps.ensureAudio();
  // Fade out loading screen, reveal menu
  loadingSpinner.classList.add('loading-spinner--done');
  stopVaporText();
  const _installHint = getInstallHint();
  if (_installHint && _installHint.classList.contains('loading-install-hint--visible')) {
    _installHint.animate(
      [
        { opacity: '1', transform: 'translateX(-50%) translateY(0)' },
        { opacity: '0', transform: 'translateX(-50%) translateY(-10px)' }
      ],
      { duration: 500, easing: 'ease-in', fill: 'forwards' }
    );
  }
  loadingScreen.classList.add('loading-screen--fade-out');
  // Respect whatever screen the app has already navigated to (e.g. lobby rejoin)
  _deps.showScreen(_deps.getCurrentScreen() || 'main');
  // Reveal top bar & chat with smooth transitions: start hidden, then slide/fade in
  const authEl = document.getElementById('auth-status')!;
  authEl.classList.add('topbar--hidden');
  authEl.style.display = '';
  const chatEl = document.getElementById('global-chat');
  if (chatEl) chatEl.classList.add('chat--match-hidden');
  document.getElementById('bottom-bar')!.style.display = '';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      authEl.classList.remove('topbar--hidden');
      if (chatEl) chatEl.classList.remove('chat--match-hidden');
    });
  });
  const onFaded = (): void => {
    loadingScreen.removeEventListener('transitionend', onFaded);
    loadingScreen.style.display = 'none';
    _loadingDismissed = true;
  };
  loadingScreen.addEventListener('transitionend', onFaded);
  loadingScreen.removeEventListener('click', dismissLoading);
  window.removeEventListener('keydown', dismissLoadingKey);
}

export function initLoadingScreen(deps: LoadingScreenDeps): void {
  _deps = deps;

  // DOM refs
  loadingScreen = document.getElementById('loading-screen')!;
  loadingStatus = document.getElementById('loading-status')!;
  clickPrompt = document.getElementById('click-prompt')!;
  clickPromptCanvas = document.getElementById('click-prompt-canvas') as HTMLCanvasElement;
  loadingSpinner = document.getElementById('loading-spinner')!;

  // Init vapor text on the click-prompt canvas (idle until triggered)
  const _defaultPromptText = TOUCH_ENABLED ? 'TAP TO START' : 'CLICK TO START';
  startVaporText(clickPromptCanvas, _defaultPromptText, {
    font: 'Orbitron, sans-serif',
    fontSize: 21,
    fontWeight: 700,
    letterSpacing: 6,
    color: 'rgba(255,255,255,0.4)',
    spread: 4,
    density: 6,
    vaporizeDuration: 2.5,
    fadeInDuration: 1.0,
    holdDuration: 1.5,
  });

  // Track font loading
  _trackLoad(document.fonts.ready, 'LOADING FONTS');

  // Track scene/renderer initialization
  _trackLoad(new Promise<void>(r => requestAnimationFrame(() => r())), 'BUILDING WORLD');

  // Track death effect GPU warm-up (avoids shader compile lag on first death)
  _trackLoad(deps.game.deathWarmup, 'WARMING GPU');

  // Track bike + drone loading — restart demo only once both are ready so the arena
  // drone isn't missing (cloneDroneModel() called before loadDroneModel() resolved).
  // On mobile/touch devices, stagger model loads to avoid iOS Safari memory-pressure
  // crashes that cause the "A problem repeatedly occurred" reload loop.
  let _droneLoad: Promise<void>;
  let _arenaLoad: Promise<void>;
  let _bikeReady: Promise<void>;
  let _carLoad: Promise<void>;
  let _hoverboardLoad: Promise<void>;

  if (TOUCH_ENABLED) {
    // Sequential: bike → drone → arena → car → hoverboard (reduces peak memory)
    const _bikeLoad = loadBikeModel();
    _droneLoad = _bikeLoad.then(() => loadDroneModel());
    _arenaLoad = _droneLoad.then(() => loadArenaModel());
    _bikeReady = _arenaLoad.then(() => { if (deps.game.state === 'menu') deps.game._restartDemo(); });
    _carLoad = _arenaLoad.then(() => loadCarModel());
    _hoverboardLoad = _carLoad.then(() => loadHoverboardModel());
  } else {
    _droneLoad = loadDroneModel();
    _arenaLoad = loadArenaModel();
    _bikeReady = Promise.all([loadBikeModel(), _droneLoad, _arenaLoad]).then(() => {
      if (deps.game.state === 'menu') deps.game._restartDemo();
    });
    _carLoad = loadCarModel();
    _hoverboardLoad = loadHoverboardModel();
  }
  _trackLoad(_bikeReady, 'LOADING BIKE MODEL');
  _trackLoad(_carLoad, 'LOADING CAR MODEL');
  _trackLoad(_droneLoad, 'LOADING DRONE');
  _trackLoad(_arenaLoad, 'LOADING ARENA');
  _trackLoad(_hoverboardLoad, 'LOADING HOVERBOARD');

  // Pre-warm synth_city assets only when that map is actually selected.
  // The GLBs + textures are heavy — no reason to download them for other maps.
  if (getSelectedMap() === 'synth_city') {
    const _synthCityWarm = _arenaLoad.then(() => import('../arena/synthcity').then(m => m.getSynthCityAssets()));
    _trackLoad(_synthCityWarm, 'LOADING SYNTH CITY');
  }

  // Fallback: if all tracked promises settled but progress didn't update, finalize
  Promise.allSettled([document.fonts.ready, _bikeReady]).then(() => {
    if (_loadDone >= _loadTasks && _loadProgress < 100) { _loadProgress = 100; _updateLoadProgress(); }
  });

  // Event listeners
  loadingScreen.addEventListener('click', dismissLoading);
  window.addEventListener('keydown', dismissLoadingKey);
}
