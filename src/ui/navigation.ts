// ── Menu Navigation ───────────────────────────────────────
// Extracted from main.ts to enable direct testing.
// Manages overlay-screen visibility, navigation stack, screen hooks,
// focus management, keyboard menu navigation, UI sounds, and swipe-back.

import { show, hide } from './dom';

// ── Screen Maps ─────────────────────────────────────────
export const SCREEN_IDS: Record<string, string> = {
  main: 'overlay', settings: 'settings-overlay',
  online: 'online-overlay', queue: 'queue-overlay', matchFound: 'match-found-overlay',
  login: 'login-overlay', stats: 'stats-overlay', profile: 'profile-overlay',
  friends: 'friends-overlay', music: 'music-overlay',
  social: 'social-overlay',
  gameover: 'result', joinLobby: 'join-lobby-overlay', lobby: 'lobby-overlay',
  matchInProgress: 'match-in-progress',
  debug: 'debug-overlay', bugreport: 'bugreport-overlay',
  characterSelect: 'character-select-overlay',
};

export const EXTRA_SCREEN_IDS: Record<string, string> = {
  paused: 'pause-overlay',
  replay: 'replay-overlay',
};

// ── State ───────────────────────────────────────────────
let currentScreen: string | null = 'main';
const _navStack: (string | null)[] = [];

// ── Screen hooks — optional enter/exit callbacks ────────
let _screenHooks: Record<string, { enter?: () => void; exit?: () => void }> = {};

// ── Announcement Panel (optional) ───────────────────────
const _annPanel: HTMLElement | null = document.getElementById('announcement-panel');
let _annDismissed = false;

// ── History API ─────────────────────────────────────────
let _pendingHistoryBack = 0;

function _pushHistoryState(): void {
  window.history.pushState({ screen: true }, '');
}

// ── Focus Management ────────────────────────────────────
let _focusIndex: number = 0;

const _menuButtons: Record<string, string[]> = {
  main: ['btn-quickstart', 'btn-character-select', 'btn-online', 'btn-create-lobby', 'btn-settings', 'btn-social', 'btn-leaderboard', 'btn-stats', 'btn-music'],
  music: ['music-shuffle-btn', 'music-prev', 'music-playpause', 'music-next', 'music-repeat-btn', 'playlist-mode-label', 'dyn-back'],
  online: ['btn-casual-match', 'dyn-back'],
  queue: ['btn-queue-cancel'],
  matchFound: ['btn-match-accept'],
  login: [
    // Sign-in mode
    'login-email', 'login-password', 'btn-signin-submit', 'btn-email-link-signin',
    'btn-forgot-password', 'btn-show-signup',
    // Sign-up mode (hidden when signin active — gpNextEnabled skips via .hidden)
    'signup-username', 'signup-email', 'signup-password', 'signup-consent',
    'btn-signup-submit', 'btn-show-signin',
    // Forgot password sub-screen
    'btn-forgot-back', 'forgot-pw-email', 'btn-send-reset',
    // Username picker sub-screen
    'sso-username', 'btn-username-submit',
    // Shared SSO row (always visible on root screens)
    'btn-google-sso', 'btn-github-sso', 'btn-microsoft-sso', 'btn-phone-sso',
  ],
  friends: ['friends-add-input', 'btn-friends-add', 'dyn-back'],
  social: ['social-tab-party', 'social-tab-friends', 'social-tab-notifs', 'btn-social-create-party', 'btn-social-signin', 'btn-social-copy-invite', 'btn-social-party-lobby', 'btn-social-leave-party', 'social-friends-add-input', 'btn-social-friends-add', 'btn-social-invite-friend', 'btn-social-remove-friend', 'dyn-back'],
  stats: ['stats-tab-mystats', 'stats-tab-history', 'stats-tab-leaderboard', 'dyn-back'],
  gameover: ['map-tile-midtown_bowl', 'map-tile-synth_pit', 'btn-continue', 'btn-replay', 'btn-go-settings', 'btn-submit-match', 'btn-mainmenu'],
  paused: ['btn-resume', 'btn-pause-settings', 'btn-pause-menu'],
  onlinePause: ['btn-online-resume', 'btn-online-pause-settings', 'btn-online-forfeit', 'btn-return-lobby-pause'],
  lobby: ['btn-lobby-invite', 'btn-lobby-ready', 'btn-lobby-start', 'btn-lobby-leave', 'dyn-back'],
  joinLobby: ['btn-join-lobby-leave'],
  characterSelect: [
    'hub-back',
    'hub-tab-garage', 'hub-tab-match', 'hub-tab-unlocks', 'hub-tab-shop',
    'cs-card-bike', 'cs-card-car', 'cs-card-hoverboard',
    // Dynamic elements (color swatches, emissive swatches, shop cards, level track nodes)
    // get tabindex="0" in their render functions and are discovered by _isFocusable scan
  ],
  replay: ['btn-replay-rw', 'btn-replay-play', 'btn-replay-ff', 'btn-replay-fav', 'btn-replay-cam-left', 'btn-replay-cam-right', 'btn-replay-speed-left', 'btn-replay-speed-right', 'btn-replay-exit-top'],
  bugreport: ['bugreport-input', 'bugreport-submit', 'dyn-back'],
  debug: ['dyn-back'],
  profile: ['profile-edit-btn', 'profile-tab-stats', 'profile-tab-history', 'profile-mode-ai', 'profile-mode-casual', 'profile-mode-ranked', 'profile-series-1', 'profile-series-3', 'profile-series-5', 'dyn-back'],
};

/** Map an element to its BEM --selected modifier class. */
const _selectedClassMap: [string, string][] = [
  ['menu-btn', 'menu-btn--selected'],
  ['menu-item', 'menu-item--selected'],
  ['menu-icon-btn', 'menu-icon-btn--selected'],
  ['menu-primary', 'menu-primary--selected'],
  ['control-toggle', 'control-toggle--selected'],
  ['auth-input', 'auth-input--selected'],
  ['auth-oauth-btn', 'auth-oauth-btn--selected'],
  ['auth-google', 'auth-google--selected'],
  ['color-opt', 'color-opt--selected'],
  ['online-option', 'online-option--selected'],
  ['replay-btn', 'replay-btn--selected'],
  ['lobby-color-opt', 'lobby-color-opt--selected'],
  ['cs-card', 'cs-card--nav-focus'],
  ['cs-color', 'cs-color--selected'],
  ['map-carousel-tile', 'map-carousel-tile--nav-focus'],
  ['social-tab', 'social-tab--selected'],
  ['profile-tab', 'profile-tab--selected'],
  ['stats-mode-tab', 'stats-mode-tab--selected'],
  ['stats-series-pill', 'stats-series-pill--selected'],
];

/** All possible BEM --selected classes for clearing. */
const _allSelectedClasses: string[] = [
  'menu-btn--selected', 'control-toggle--selected', 'range--selected',
  'auth-input--selected', 'auth-oauth-btn--selected', 'auth-google--selected',
  'color-opt--selected', 'bestof-label--selected',
  'online-option--selected', 'replay-btn--selected', 'lobby-color-opt--selected',
  'social-tab--selected', 'cs-card--nav-focus',
  'profile-tab--selected', 'stats-mode-tab--selected', 'stats-series-pill--selected',
  'map-carousel-tile--nav-focus',
];

function _getSelectedClass(el: HTMLElement): string {
  if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'range') return 'range--selected';
  for (const [base, bem] of _selectedClassMap) {
    if (el.classList.contains(base)) return bem;
  }
  return 'menu-btn--selected'; // fallback
}

function _clearSelected(el: HTMLElement): void {
  el.classList.remove(..._allSelectedClasses);
}

function _isFocusable(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.classList.contains('menu-btn--disabled') ||
      el.classList.contains('lb-page-btn--disabled') ||
      el.classList.contains('setting-arrow--disabled')) return false;
  // Skip elements inside collapsed settings sections (hidden, not interactive)
  if (el.closest('.settings-section-body.settings-section-body--collapsed')) return false;
  // Skip elements inside collapsed lobby settings
  if (el.closest('#lobby-settings.lobby-settings--collapsed')) return false;
  // Skip elements inside hidden containers (e.g. inactive social tab panels)
  if (el.closest('.hidden')) return false;
  // Skip elements hidden via inline display:none (e.g. install button when unavailable)
  if (el.style.display === 'none') return false;
  return true;
}

// ── Callbacks for integration with main.ts ──────────────
interface NavigationCallbacks {
  onHideTopBar?: () => void;
  onShowTopBar?: () => void;
  getGameState?: () => string;
  onShowGlobe?: () => void;
  onHideGlobe?: () => void;
  onRestoreChatAfterMatch?: () => void;
  onHideChatForMatch?: () => void;
  playNavigate?: () => void;
  playNavigateBack?: () => void;
  playHover?: () => void;
  playConfirm?: () => void;
  vibrate?: (ms: number) => void;
  isAudioStarted?: () => boolean;
  cycleTab?: (dir: number) => void;
  cycleHubTab?: (dir: number) => void;
  moveFocus?: (dir: number) => void;
  getFocusedRow?: () => HTMLElement | null;
  resetFocus?: () => void;
  isMobileSubpageOpen?: () => boolean;
  closeMobileSubpage?: () => void;
}
let _callbacks: NavigationCallbacks = {};

// ── UI sound selector ───────────────────────────────────
const _uiSoundSel: string = '.menu-btn, .replay-btn, .control-toggle, .setting-arrow, .keybind-key, .color-opt, .lobby-color-opt, .bestof-arrow, .mute-btn, .pause-btn, .skip-btn, .repeat-btn, .playlist-drop-btn, #fullscreen-btn, .bb-visual, .cl-close, #btn-login, #btn-signout, #auth-username, .online-option, .auth-google, .lb-tab, .lb-arrow, .friend-action-btn, #btn-friends-add, .notif-accept, .notif-deny, .friend-remove, #btn-chat-send, #btn-friends-social, #lobby-link-wrap, .vol-settings-btn';

// Track whether touch is enabled (passed from outside or detected)
let _touchEnabled = false;

// ── Init ────────────────────────────────────────────────
export function initNavigation(
  hooks: Record<string, { enter?: () => void; exit?: () => void }>,
  callbacks?: NavigationCallbacks,
  options?: { touchEnabled?: boolean },
): void {
  _screenHooks = hooks;
  _callbacks = callbacks || {};
  _touchEnabled = options?.touchEnabled ?? ('ontouchstart' in window);

  // Announcement close button
  if (_annPanel) {
    _annPanel.querySelector('.ann-close')?.addEventListener('click', () => {
      _annDismissed = true;
      _annPanel.classList.remove('announcement--visible');
    });
  }

  // ── Back Button (permanent element — single handler) ──
  document.getElementById('dyn-back')?.addEventListener('click', () => {
    // Mobile settings: return to category list instead of leaving settings
    if (currentScreen === 'settings' && _callbacks.isMobileSubpageOpen?.()) {
      _callbacks.closeMobileSubpage?.();
      return;
    }
    navigateBackFromUI();
  });

  // ── UI Sounds ──────────────────────────────────────────
  // Hover sound (mouseenter doesn't bubble — bind directly)
  document.querySelectorAll(_uiSoundSel).forEach((el: Element) => {
    el.addEventListener('mouseenter', () => _callbacks.playHover?.());
  });
  // Click sound + haptic (delegated — covers dynamically added elements too)
  document.addEventListener('click', (e: MouseEvent) => {
    const gs = _callbacks.getGameState?.();
    if (gs === 'transition' || gs === 'countdown') return;
    if (e.target instanceof Element && e.target.closest(_uiSoundSel)) {
      _callbacks.playConfirm?.();
      _callbacks.vibrate?.(8);
    }
  });

  // ── Swipe-Back Gesture (touch) ─────────────────────────
  if (_touchEnabled) {
    const EDGE_ZONE = 24;       // px from left edge to start tracking
    const SWIPE_THRESHOLD = 0.3; // fraction of screen width to trigger
    let _swTrack = false, _swX = 0, _swY = 0;
    document.addEventListener('touchstart', (e: TouchEvent) => {
      if (_navStack.length === 0) return;
      const t = e.touches[0];
      if (t.clientX > EDGE_ZONE) return;
      _swTrack = true; _swX = t.clientX; _swY = t.clientY;
    }, { passive: true });
    document.addEventListener('touchmove', (e: TouchEvent) => {
      if (!_swTrack) return;
      const dy = e.touches[0].clientY - _swY;
      const dx = e.touches[0].clientX - _swX;
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) _swTrack = false;
    }, { passive: true });
    document.addEventListener('touchend', (e: TouchEvent) => {
      if (!_swTrack) return;
      _swTrack = false;
      if (e.changedTouches[0].clientX - _swX > window.innerWidth * SWIPE_THRESHOLD) navigateBackFromUI();
    }, { passive: true });
    document.addEventListener('touchcancel', () => { _swTrack = false; }, { passive: true });
  }

  // ── Keyboard Menu Navigation (WASD / Arrows / Space / Enter) ──
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    // Skip if an input is focused
    if ((document.activeElement as HTMLElement)?.tagName === 'INPUT') return;
    if (!currentScreen) return;
    // During gameplay states, don't hijack game input keys for menu navigation
    const gs = _callbacks.getGameState?.();
    if (gs === 'playing' || gs === 'countdown' || gs === 'transition' || gs === 'waitingOnline') return;
    // During replay, dedicated replay shortcuts handle all input — skip menu nav
    if (gs === 'replay') return;

    // Settings page: custom keyboard navigation
    if (currentScreen === 'settings') {
      let settingsHandled = false;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { _callbacks.moveFocus?.(-1); _callbacks.playHover?.(); settingsHandled = true; }
      if (e.code === 'ArrowDown' || e.code === 'KeyS') { _callbacks.moveFocus?.(1); _callbacks.playHover?.(); settingsHandled = true; }
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'KeyA' || e.code === 'KeyD') {
        const row = _callbacks.getFocusedRow?.();
        if (row) {
          const dir = (e.code === 'ArrowLeft' || e.code === 'KeyA') ? -1 : 1;
          const rangeInput = row.querySelector('input[type="range"]') as HTMLInputElement | null;
          if (rangeInput) {
            const sMin = Number(rangeInput.min) || 0, sMax = Number(rangeInput.max) || 100;
            const step = Math.max(1, Math.round((sMax - sMin) / 20));
            rangeInput.value = String(Math.max(sMin, Math.min(sMax, Number(rangeInput.value) + step * dir)));
            rangeInput.dispatchEvent(new Event('input'));
            rangeInput.dispatchEvent(new Event('change'));
          }
          const toggle = row.querySelector('.control-toggle') as HTMLElement | null;
          if (toggle) {
            const opts = Array.from(toggle.querySelectorAll('.control-toggle__option')) as HTMLElement[];
            const activeIdx = opts.findIndex(o => o.classList.contains('control-toggle__option--active'));
            if (dir === -1 && activeIdx > 0) opts[activeIdx - 1].click();
            if (dir === 1 && activeIdx < opts.length - 1) opts[activeIdx + 1].click();
          }
          const leftArrow = row.querySelector('.setting-select-left') as HTMLElement | null;
          const rightArrow = row.querySelector('.setting-select-right') as HTMLElement | null;
          if (dir === -1 && leftArrow) leftArrow.click();
          if (dir === 1 && rightArrow) rightArrow.click();
          settingsHandled = true;
        }
      }
      if (e.code === 'Tab') {
        e.preventDefault();
        _callbacks.cycleTab?.(e.shiftKey ? -1 : 1);
        settingsHandled = true;
      }
      if (e.code === 'Enter' || e.code === 'Space') {
        const row = _callbacks.getFocusedRow?.();
        if (row && row.classList.contains('keybind-row')) {
          const firstKey = row.querySelector('.keybind-key') as HTMLElement | null;
          if (firstKey) firstKey.click();
          settingsHandled = true;
        }
      }
      if (settingsHandled) { e.preventDefault(); return; }
      // Fall through to generic handler if no settings-specific action matched
    }

    // Character-select (hub): Tab / Shift+Tab cycles hub tabs (LB/RB equivalent)
    if (currentScreen === 'characterSelect' && e.code === 'Tab') {
      e.preventDefault();
      _callbacks.cycleHubTab?.(e.shiftKey ? -1 : 1);
    }

    const btns: string[] | undefined = _menuButtons[currentScreen!];
    if (!btns || btns.length === 0) return;

    let handled: boolean = false;

    function nextEnabled(dir: number): void {
      for (let i = 0; i < btns!.length; i++) {
        _focusIndex = (_focusIndex + dir + btns!.length) % btns!.length;
        const el: HTMLElement | null = document.getElementById(btns![_focusIndex]);
        if (el && _isFocusable(el)) return;
      }
    }

    // Navigate down: S, ArrowDown
    if (e.code === 'KeyS' || e.code === 'ArrowDown') {
      nextEnabled(1);
      updateFocus(); _callbacks.playHover?.();
      handled = true;
    }
    // Navigate up: W, ArrowUp
    if (e.code === 'KeyW' || e.code === 'ArrowUp') {
      nextEnabled(-1);
      updateFocus(); _callbacks.playHover?.();
      handled = true;
    }
    // Activate: Space, Enter
    if (e.code === 'Space' || e.code === 'Enter') {
      const el: HTMLElement | null = document.getElementById(btns[_focusIndex]);
      if (el) el.click();
      handled = true;
    }
    // Left/right for sliders, arrow selectors, and segmented toggles
    if (!handled && (e.code === 'KeyA' || e.code === 'ArrowLeft' || e.code === 'KeyD' || e.code === 'ArrowRight')) {
      const isLeft: boolean = e.code === 'KeyA' || e.code === 'ArrowLeft';
      const focusedId: string = btns[_focusIndex];
      const el: HTMLElement | null = document.getElementById(focusedId);
      if (el && (el as HTMLInputElement).type === 'range') {
        // Slider adjust
        const inputEl: HTMLInputElement = el as HTMLInputElement;
        const sMin: number = Number(inputEl.min) || 0;
        const sMax: number = Number(inputEl.max) || 100;
        const step: number = Math.max(1, Math.round((sMax - sMin) / 20));
        if (isLeft) inputEl.value = String(Math.max(sMin, Number(inputEl.value) - step));
        else inputEl.value = String(Math.min(sMax, Number(inputEl.value) + step));
        inputEl.dispatchEvent(new Event('input'));
        inputEl.dispatchEvent(new Event('change'));
        handled = true;
      }
      // Arrow selector adjust (label with left/right arrow siblings)
      const _kbArrowMap: Record<string, [string, string]> = {
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
      if (!handled && _kbArrowMap[focusedId]) {
        const arrowId: string = isLeft ? _kbArrowMap[focusedId][0] : _kbArrowMap[focusedId][1];
        document.getElementById(arrowId)?.click();
        handled = true;
      }
      // Segmented toggle (control-toggle with .control-toggle__option children)
      if (!handled && el && el.classList.contains('control-toggle')) {
        const opts: HTMLElement[] = Array.from(el.querySelectorAll('.control-toggle__option')) as HTMLElement[];
        const activeIdx: number = opts.findIndex(o => o.classList.contains('control-toggle__option--active'));
        if (isLeft && activeIdx > 0) { opts[activeIdx - 1].click(); handled = true; }
        if (!isLeft && activeIdx < opts.length - 1) { opts[activeIdx + 1].click(); handled = true; }
      }
      // Icon bar: left/right moves between icon buttons
      if (!handled && el && el.classList.contains('menu-icon-btn')) {
        nextEnabled(isLeft ? -1 : 1);
        updateFocus(); _callbacks.playHover?.();
        handled = true;
      }
    }

    if (handled) e.preventDefault();
  });
}

// ── Core: show a single screen ──────────────────────────
export function showScreen(name: string | null): void {
  // Hide all overlay-screen elements
  document.querySelectorAll('.overlay-screen').forEach((el: Element) => {
    hide(el as HTMLElement);
  });
  // Also hide extra screens (pause, replay)
  Object.values(EXTRA_SCREEN_IDS).forEach((id: string) => {
    const el = document.getElementById(id);
    if (el) hide(el);
  });

  // Show target
  const targetId: string | undefined = (name ? SCREEN_IDS[name] : undefined) || (name ? EXTRA_SCREEN_IDS[name] : undefined);
  if (targetId) {
    show(targetId);
  }

  // Globe backdrop: only visible on FIND MATCH screen
  if (name === 'online') _callbacks.onShowGlobe?.(); else _callbacks.onHideGlobe?.();

  // Announcement: only visible on main screen
  if (_annPanel && !_annDismissed) _annPanel.classList.toggle('announcement--visible', name === 'main');
  else if (_annPanel) _annPanel.classList.remove('announcement--visible');

  // Chat: auto-hide when entering gameplay, restore when any menu/overlay opens
  if (name) _callbacks.onRestoreChatAfterMatch?.();
  else _callbacks.onHideChatForMatch?.();
}

// ── Navigate to a screen (push current onto stack) ──────
export function navigateTo(screen: string): void {
  if (screen === currentScreen) return;
  hideDynBack();
  _screenHooks[currentScreen!]?.exit?.();
  _navStack.push(currentScreen);
  _pushHistoryState();
  _applyScreen(screen, 'forward');
}

// ── Go back to previous screen ──────────────────────────
export function navigateBack(): void {
  if (_navStack.length === 0) return;
  hideDynBack();
  _screenHooks[currentScreen!]?.exit?.();
  const prev: string | null | undefined = _navStack.pop();
  if (prev == null) {
    // Returning to gameplay (no menu) — just hide everything
    showScreen(null);
    currentScreen = null;
    if (_callbacks.isAudioStarted?.()) _callbacks.playNavigateBack?.();
    // Hide top bar if mid-match
    const gs = _callbacks.getGameState?.();
    if (gs === 'playing' || gs === 'countdown') _callbacks.onHideTopBar?.();
    return;
  }
  _applyScreen(prev, 'back');
}

// ── Programmatic back (dyn-back button, ESC key) ────────
export function navigateBackFromUI(): void {
  if (_navStack.length === 0) return;
  _pendingHistoryBack++;
  window.history.back();
  navigateBack();
}

// ── Reset stack and jump directly ───────────────────────
export function navigateReset(screen?: string | null): void {
  hideDynBack();
  _screenHooks[currentScreen!]?.exit?.();
  const depth = _navStack.length;
  _navStack.length = 0;
  if (depth > 0) {
    _pendingHistoryBack++;
    window.history.go(-depth);
  }
  _applyScreen(screen || 'main', 'back');
}

// ── Internal: apply a screen with hooks ─────────────────
function _applyScreen(screen: string, dir: 'forward' | 'back' = 'forward'): void {
  showScreen(screen);
  currentScreen = screen;
  _focusIndex = 0;

  _screenHooks[screen]?.enter?.();
  if (_navStack.length > 0 && screen !== 'main' && screen !== 'queue' && screen !== 'characterSelect') _showDynBack(screen);
  updateFocus();
  // Show top bar whenever a menu/overlay is open
  if (screen) _callbacks.onShowTopBar?.();
  // Directional sound + haptic on screen transitions
  if (_callbacks.isAudioStarted?.()) {
    if (dir === 'back') _callbacks.playNavigateBack?.();
    else _callbacks.playNavigate?.();
  }
  _callbacks.vibrate?.(10);

  // Re-trigger content entrance transition on each navigation
  const overlayId = SCREEN_IDS[screen] || EXTRA_SCREEN_IDS[screen];
  if (overlayId) {
    const content = document.getElementById(overlayId)?.querySelector('.content') as HTMLElement | null;
    if (content) {
      // Snap to hidden state, force layout, then let CSS transition animate in
      content.style.transition = 'none';
      content.style.transform = 'scale(0.95)';
      content.style.opacity = '0';
      void content.offsetWidth;
      content.style.transition = '';
      content.style.transform = '';
      content.style.opacity = '';
    }
  }
}

// ── Dynamic Back Button ─────────────────────────────────
function _showDynBack(screen: string): void {
  const btn = document.getElementById('dyn-back');
  if (!btn) return;
  const overlayId = SCREEN_IDS[screen] || EXTRA_SCREEN_IDS[screen];
  if (!overlayId) return;
  const overlay = document.getElementById(overlayId);
  if (!overlay) return;
  // Settings has multiple header bars — pick the one for the current layout
  let headerBar: Element | null;
  if (overlayId === 'settings-overlay') {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    headerBar = isMobile
      ? overlay.querySelector('.settings-category-list > .overlay-header-bar')
      : overlay.querySelector('.settings-sidebar-back');
  } else {
    headerBar = overlay.querySelector('.overlay-header-bar');
  }
  headerBar = headerBar || overlay.querySelector('.settings-content-header');
  if (headerBar) {
    headerBar.prepend(btn);
  } else {
    // Overlay has no header bar (e.g. full-page layouts) — show button at root level
    overlay.prepend(btn);
  }
  btn.style.display = '';
}

export function hideDynBack(): void {
  const btn = document.getElementById('dyn-back');
  if (!btn) return;
  btn.style.display = 'none';
  document.getElementById('top-left')?.prepend(btn);
}

// ── Focus ───────────────────────────────────────────────
export function updateFocus(): void {
  // Only clear selected classes on the CURRENT screen's elements
  const btns: string[] | undefined = _menuButtons[currentScreen!];
  if (!btns) return;
  btns.forEach((id: string) => {
    const el: HTMLElement | null = document.getElementById(id);
    if (el) _clearSelected(el);
  });
  // Skip disabled / hidden items on initial focus
  let el: HTMLElement | null = document.getElementById(btns[_focusIndex]);
  if (!_isFocusable(el)) {
    for (let i = 0; i < btns.length; i++) {
      _focusIndex = (_focusIndex + 1) % btns.length;
      el = document.getElementById(btns[_focusIndex]);
      if (_isFocusable(el)) break;
    }
  }
  if (_isFocusable(el)) {
    el!.classList.add(_getSelectedClass(el!));
    if (el!.tagName === 'INPUT') (el as HTMLInputElement).focus();
    else if ((document.activeElement as HTMLElement)?.tagName === 'INPUT') (document.activeElement as HTMLElement).blur();
  }
}

// ── Getters ─────────────────────────────────────────────
export function getCurrentScreen(): string | null { return currentScreen; }
export function getNavStack(): readonly (string | null)[] { return _navStack; }
export function getFocusIndex(): number { return _focusIndex; }
export function getMenuButtons(): Record<string, string[]> { return _menuButtons; }
export function isFocusable(el: HTMLElement | null): boolean { return _isFocusable(el); }
export function getPendingHistoryBack(): number { return _pendingHistoryBack; }

// ── Setters (for main.ts integration) ───────────────────
export function setCurrentScreen(screen: string | null): void { currentScreen = screen; }
export function setFocusIndex(index: number): void { _focusIndex = index; }
export function decrementPendingHistoryBack(): void { _pendingHistoryBack--; }
export function clearNavStack(): void { _navStack.length = 0; }

// ── Reset (for testing) ─────────────────────────────────
export function _resetForTesting(): void {
  currentScreen = 'main';
  _navStack.length = 0;
  _annDismissed = false;
  _screenHooks = {};
  _callbacks = {};
  _focusIndex = 0;
  _pendingHistoryBack = 0;
  hideDynBack();
}
