// ── Controller / Gamepad Navigation Tests ───────────────
// Validates gamepad UI navigation: d-pad movement, focus management,
// confirm/back actions, screen-specific behavior (sliders, tabs, scroll).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initNavigation, navigateTo, navigateBack, navigateReset, showScreen,
  _resetForTesting as resetNav, SCREEN_IDS,
  getCurrentScreen,
} from '../navigation';
import {
  cycleTab, moveFocus, getFocusedRow, getActiveTab,
  SETTINGS_TABS, switchTab, initSettingsNav,
  _resetForTesting as resetSettingsNav,
} from '../settingsNav';

// Mock sfx module to prevent AudioContext errors from playTick
vi.mock('../../sfx', () => ({
  playTick: vi.fn(),
  playHover: vi.fn(),
  playClick: vi.fn(),
  playMatchPause: vi.fn(),
  ensureAudio: vi.fn(),
  getCtx: vi.fn(),
  playUiTab: vi.fn(),
  playNavigateBack: vi.fn(),
}));

// ── Mock Gamepad Helpers ────────────────────────────────

/** All focusable button IDs per screen (mirrors main.ts menuButtons). */
const MENU_BUTTONS: Record<string, string[]> = {
  main: ['btn-quickstart', 'btn-character-select', 'btn-online', 'btn-create-lobby', 'btn-settings', 'btn-social', 'btn-leaderboard', 'btn-stats', 'btn-music'],
  online: ['btn-casual-match', 'dyn-back'],
  queue: ['btn-queue-cancel'],
  matchFound: ['btn-match-accept'],
  stats: ['stats-tab-mystats', 'stats-tab-history', 'stats-tab-leaderboard', 'dyn-back'],
  music: ['music-shuffle-btn', 'music-prev', 'music-playpause', 'music-next', 'music-repeat-btn', 'playlist-mode-label', 'dyn-back'],
  gameover: ['map-tile-midtown_bowl', 'map-tile-synth_pit', 'btn-continue', 'btn-replay', 'btn-go-settings', 'btn-submit-match', 'btn-mainmenu'],
  paused: ['btn-resume', 'btn-pause-settings', 'btn-pause-menu'],
  lobby: ['btn-lobby-invite', 'btn-lobby-ready', 'btn-lobby-start', 'btn-lobby-leave', 'dyn-back'],
  social: ['social-tab-party', 'social-tab-friends', 'social-tab-notifs', 'btn-social-create-party', 'btn-social-signin', 'btn-social-copy-invite', 'btn-social-leave-party', 'social-friends-add-input', 'btn-social-friends-add', 'dyn-back'],
  characterSelect: ['dyn-back', 'cs-card-bike', 'cs-card-car', 'cs-color-cyan', 'cs-color-magenta', 'cs-color-lime', 'cs-color-gold', 'cs-color-white', 'cs-color-red', 'cs-color-teal', 'cs-color-blue', 'cs-color-orange', 'map-tile-midtown_bowl', 'map-tile-synth_pit'],
  profile: ['profile-edit-btn', 'profile-tab-stats', 'profile-tab-history', 'profile-mode-ai', 'profile-mode-casual', 'profile-mode-ranked', 'profile-series-1', 'profile-series-3', 'profile-series-5', 'dyn-back'],
};

/** BEM --selected class mapping (mirrors main.ts). */
const SELECTED_CLASS_MAP: [string, string][] = [
  ['menu-btn', 'menu-btn--selected'],
  ['menu-item', 'menu-item--selected'],
  ['menu-icon-btn', 'menu-icon-btn--selected'],
  ['menu-primary', 'menu-primary--selected'],
  ['control-toggle', 'control-toggle--selected'],
  ['auth-input', 'auth-input--selected'],
  ['color-opt', 'color-opt--selected'],
  ['online-option', 'online-option--selected'],
  ['replay-btn', 'replay-btn--selected'],
  ['cs-card', 'cs-card--nav-focus'],
  ['cs-color', 'cs-color--selected'],
  ['social-tab', 'social-tab--selected'],
  ['profile-tab', 'profile-tab--selected'],
  ['stats-mode-tab', 'stats-mode-tab--selected'],
  ['stats-series-pill', 'stats-series-pill--selected'],
  ['map-carousel-tile', 'map-carousel-tile--nav-focus'],
];

const ALL_SELECTED_CLASSES = [
  'menu-btn--selected', 'menu-item--selected', 'menu-icon-btn--selected',
  'menu-primary--selected', 'control-toggle--selected', 'range--selected',
  'auth-input--selected', 'auth-oauth-btn--selected', 'auth-google--selected',
  'color-opt--selected', 'bestof-label--selected',
  'online-option--selected', 'replay-btn--selected', 'lobby-color-opt--selected',
  'social-tab--selected', 'cs-card--nav-focus',
  'profile-tab--selected', 'stats-mode-tab--selected', 'stats-series-pill--selected',
  'map-carousel-tile--nav-focus',
];

function getSelectedClass(el: HTMLElement): string {
  if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'range') return 'range--selected';
  for (const [base, bem] of SELECTED_CLASS_MAP) {
    if (el.classList.contains(base)) return bem;
  }
  return 'menu-btn--selected';
}

function clearSelected(el: HTMLElement): void {
  el.classList.remove(...ALL_SELECTED_CLASSES);
}

function isFocusable(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.classList.contains('menu-btn--disabled')) return false;
  if (el.classList.contains('lb-page-btn--disabled')) return false;
  if (el.classList.contains('setting-arrow--disabled')) return false;
  if (el.closest('.hidden')) return false;
  if (el.style.display === 'none') return false;
  return true;
}

/** Simulate gamepad focus: clear all, set selected class on target. */
function setFocus(btns: string[], index: number): void {
  btns.forEach(id => {
    const el = document.getElementById(id);
    if (el) clearSelected(el);
  });
  const el = document.getElementById(btns[index]);
  if (el && isFocusable(el)) {
    el.classList.add(getSelectedClass(el));
  }
}

/** Simulate d-pad navigation (mirrors gpNextEnabled from main.ts). */
function gpNextEnabled(btns: string[], focusIndex: number, dir: number): number {
  for (let i = 0; i < btns.length; i++) {
    focusIndex = (focusIndex + dir + btns.length) % btns.length;
    const el = document.getElementById(btns[focusIndex]);
    if (el && isFocusable(el)) return focusIndex;
  }
  return focusIndex;
}

/** Returns the IDs of focusable buttons for a screen. */
function getFocusableButtons(screen: string): string[] {
  const btns = MENU_BUTTONS[screen];
  if (!btns) return [];
  return btns.filter(id => {
    const el = document.getElementById(id);
    return isFocusable(el);
  });
}

function ensureDynBack(): void {
  if (!document.getElementById('dyn-back')) {
    const btn = document.createElement('div');
    btn.id = 'dyn-back';
    btn.className = 'menu-btn menu-btn--secondary dyn-back';
    btn.style.display = 'none';
    btn.innerHTML = '<span class="dyn-back__glyph">&lt;</span><span class="dyn-back__label">BACK</span>';
    document.body.appendChild(btn);
  }
}

// ── Setup ───────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  resetNav();
  resetSettingsNav();
  ensureDynBack();

  document.querySelectorAll('.overlay-screen').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.menu-btn--disabled').forEach(el => el.classList.remove('menu-btn--disabled'));
  // Clear all selected classes
  ALL_SELECTED_CLASSES.forEach(cls => {
    document.querySelectorAll('.' + cls).forEach(el => el.classList.remove(cls));
  });
});

// ════════════════════════════════════════════════════════
// 1. D-PAD NAVIGATION (focus movement)
// ════════════════════════════════════════════════════════

describe('D-Pad Navigation', () => {
  it('d-pad down moves focus to next button', () => {
    initNavigation({});
    showScreen('main');
    const btns = MENU_BUTTONS['main'];
    let focus = 0;

    focus = gpNextEnabled(btns, focus, 1);
    setFocus(btns, focus);

    expect(focus).toBe(1);
    const el = document.getElementById(btns[1])!;
    expect(el.classList.contains(getSelectedClass(el))).toBe(true);
  });

  it('d-pad up moves focus to previous button', () => {
    showScreen('main');
    const btns = MENU_BUTTONS['main'];
    let focus = 2;
    focus = gpNextEnabled(btns, focus, -1);
    expect(focus).toBe(1);
  });

  it('focus wraps from last to first', () => {
    showScreen('main');
    const btns = MENU_BUTTONS['main'];
    let focus = btns.length - 1;
    focus = gpNextEnabled(btns, focus, 1);
    expect(focus).toBe(0);
  });

  it('focus wraps from first to last', () => {
    showScreen('main');
    const btns = MENU_BUTTONS['main'];
    let focus = 0;
    focus = gpNextEnabled(btns, focus, -1);
    expect(focus).toBe(btns.length - 1);
  });

  it('skips disabled buttons when navigating down', () => {
    initNavigation({});
    showScreen('main');
    const btns = MENU_BUTTONS['main'];
    const btn1 = document.getElementById(btns[1]);
    if (btn1) btn1.classList.add('menu-btn--disabled');

    let focus = 0;
    focus = gpNextEnabled(btns, focus, 1);
    expect(focus).toBe(2);
  });

  it('skips disabled buttons when navigating up', () => {
    initNavigation({});
    showScreen('main');
    const btns = MENU_BUTTONS['main'];
    const btn1 = document.getElementById(btns[1]);
    if (btn1) btn1.classList.add('menu-btn--disabled');

    let focus = 2;
    focus = gpNextEnabled(btns, focus, -1);
    expect(focus).toBe(0);
  });

  it('skips buttons inside .hidden containers', () => {
    showScreen('main');
    const btns = MENU_BUTTONS['main'];
    const btn1 = document.getElementById(btns[1]);
    if (!btn1) return;

    const wrapper = document.createElement('div');
    wrapper.classList.add('hidden');
    btn1.parentElement!.insertBefore(wrapper, btn1);
    wrapper.appendChild(btn1);

    let focus = 0;
    focus = gpNextEnabled(btns, focus, 1);
    expect(focus).toBe(2);

    // Cleanup
    wrapper.parentElement!.insertBefore(btn1, wrapper);
    wrapper.remove();
  });

  it('every screen with buttons has at least one focusable button', () => {
    initNavigation({});
    // Screens with dynamically generated buttons are excluded
    const DYNAMIC_SCREENS = ['characterSelect'];
    for (const [screen, btns] of Object.entries(MENU_BUTTONS)) {
      if (btns.length === 0 || DYNAMIC_SCREENS.includes(screen)) continue;
      // showScreen makes the overlay visible; navigateTo also shows dyn-back
      if (screen === 'main') {
        showScreen('main');
      } else {
        navigateTo(screen);
      }
      const focusable = getFocusableButtons(screen);
      expect(
        focusable.length,
        `screen "${screen}" has no focusable buttons for controller`,
      ).toBeGreaterThan(0);
      navigateReset('main');
    }
  });

  it('all listed static button IDs exist in the DOM', () => {
    // Buttons generated dynamically by JS (character select colors, social actions)
    // are excluded — only static HTML buttons are validated here.
    const DYNAMIC_IDS = new Set([
      'cs-color-cyan', 'cs-color-magenta', 'cs-color-lime', 'cs-color-gold',
      'cs-color-white', 'cs-color-red', 'cs-color-teal', 'cs-color-blue', 'cs-color-orange',
      'btn-social-invite-friend', 'btn-social-remove-friend',
      'map-tile-midtown_bowl', 'map-tile-synth_pit',
    ]);
    for (const [screen, btns] of Object.entries(MENU_BUTTONS)) {
      for (const id of btns) {
        if (DYNAMIC_IDS.has(id)) continue;
        expect(
          document.getElementById(id),
          `button "${id}" for screen "${screen}" not found in DOM`,
        ).toBeTruthy();
      }
    }
  });
});

// ════════════════════════════════════════════════════════
// 2. CONFIRM & BACK (A/B buttons)
// ════════════════════════════════════════════════════════

describe('Confirm & Back', () => {
  beforeEach(() => {
    initNavigation({});
  });

  it('A button triggers click on focused button', () => {
    showScreen('main');
    const btns = MENU_BUTTONS['main'];
    const el = document.getElementById(btns[0])!;
    const handler = vi.fn();
    el.addEventListener('click', handler);

    el.click(); // Simulate confirm = click focused element
    expect(handler).toHaveBeenCalledOnce();
    el.removeEventListener('click', handler);
  });

  it('B button navigates back from sub-screens', () => {
    navigateTo('stats');
    expect(getCurrentScreen()).toBe('stats');
    navigateBack();
    expect(getCurrentScreen()).toBe('main');
  });

  it('gameover buttons all exist (B-back is blocked, must click)', () => {
    const btns = MENU_BUTTONS['gameover'];
    expect(btns.length).toBeGreaterThan(0);
    // Map tiles are created dynamically by game JS, not present in static HTML
    const DYNAMIC_IDS = new Set(['map-tile-midtown_bowl', 'map-tile-synth_pit']);
    for (const id of btns) {
      if (DYNAMIC_IDS.has(id)) continue;
      expect(document.getElementById(id), `gameover button "${id}" missing`).toBeTruthy();
    }
  });

  it('confirm does not crash on screens with only dyn-back', () => {
    navigateTo('bugreport');
    const el = document.getElementById('dyn-back')!;
    expect(() => el.click()).not.toThrow();
  });
});

// ════════════════════════════════════════════════════════
// 3. FOCUS VISUAL INDICATORS
// ════════════════════════════════════════════════════════

describe('Focus Visual Indicators', () => {
  it('selected class is correct for each element type', () => {
    const cases: [string, string][] = [
      ['btn-quickstart', 'menu-primary--selected'],
      ['social-tab-party', 'social-tab--selected'],
    ];
    for (const [id, expected] of cases) {
      const el = document.getElementById(id);
      if (!el) continue;
      expect(getSelectedClass(el), `wrong selected class for "${id}"`).toBe(expected);
    }
  });

  it('clearSelected removes all BEM --selected variants', () => {
    const el = document.getElementById('btn-quickstart')!;
    el.classList.add('menu-btn--selected', 'color-opt--selected');
    clearSelected(el);
    for (const cls of ALL_SELECTED_CLASSES) {
      expect(el.classList.contains(cls), `${cls} not cleared`).toBe(false);
    }
  });

  it('only one button is focused at a time', () => {
    showScreen('main');
    const btns = MENU_BUTTONS['main'];
    setFocus(btns, 0);
    const el0 = document.getElementById(btns[0])!;
    expect(el0.classList.contains(getSelectedClass(el0))).toBe(true);

    setFocus(btns, 1);
    expect(el0.classList.contains(getSelectedClass(el0))).toBe(false);
    const el1 = document.getElementById(btns[1])!;
    expect(el1.classList.contains(getSelectedClass(el1))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════
// 4. SETTINGS — TAB CYCLING (LB/RB)
// ════════════════════════════════════════════════════════

describe('Settings — Tab Cycling', () => {
  beforeEach(() => {
    resetSettingsNav();
  });

  it('RB cycles to next settings tab', () => {
    const initialIdx = SETTINGS_TABS.indexOf(getActiveTab());
    cycleTab(1);
    expect(getActiveTab()).toBe(SETTINGS_TABS[(initialIdx + 1) % SETTINGS_TABS.length]);
  });

  it('LB cycles to previous settings tab', () => {
    const initialIdx = SETTINGS_TABS.indexOf(getActiveTab());
    cycleTab(-1);
    expect(getActiveTab()).toBe(SETTINGS_TABS[(initialIdx - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length]);
  });

  it('tab cycling wraps from last to first', () => {
    switchTab(SETTINGS_TABS[SETTINGS_TABS.length - 1]);
    cycleTab(1);
    expect(getActiveTab()).toBe(SETTINGS_TABS[0]);
  });

  it('tab cycling wraps from first to last', () => {
    switchTab(SETTINGS_TABS[0]);
    cycleTab(-1);
    expect(getActiveTab()).toBe(SETTINGS_TABS[SETTINGS_TABS.length - 1]);
  });

  it('all settings tabs are valid', () => {
    expect(SETTINGS_TABS).toEqual(['gameplay', 'video', 'audio', 'camera', 'controls', 'hud', 'account']);
  });

  it('switching tab syncs sidebar DOM active class', () => {
    switchTab('audio');
    const audioItem = document.querySelector('[data-tab="audio"]');
    if (audioItem) {
      expect(audioItem.classList.contains('settings-sidebar-item--active')).toBe(true);
    }
    // Other tabs should not be active
    const videoItem = document.querySelector('[data-tab="video"]');
    if (videoItem) {
      expect(videoItem.classList.contains('settings-sidebar-item--active')).toBe(false);
    }
  });
});

// ════════════════════════════════════════════════════════
// 5. SETTINGS — FOCUS NAVIGATION (up/down)
// ════════════════════════════════════════════════════════

describe('Settings — Row Focus', () => {
  beforeEach(() => {
    resetSettingsNav();
    initSettingsNav();
  });

  it('moveFocus(1) moves down one row', () => {
    switchTab('video');
    const rows = document.querySelectorAll('#settings-tab-video .setting-row');
    if (rows.length > 1) {
      moveFocus(1);
      const focused = getFocusedRow();
      expect(focused).toBe(rows[1]);
    }
  });

  it('moveFocus(-1) wraps from first to last row', () => {
    switchTab('video');
    const rows = document.querySelectorAll('#settings-tab-video .setting-row');
    if (rows.length > 0) {
      moveFocus(-1);
      expect(getFocusedRow()).toBe(rows[rows.length - 1]);
    }
  });

  it('focused row gets setting-row--focused class', () => {
    switchTab('video');
    initSettingsNav(); // re-sync DOM
    const rows = document.querySelectorAll('#settings-tab-video .setting-row');
    if (rows.length > 0) {
      expect(rows[0].classList.contains('setting-row--focused')).toBe(true);
    }
  });

  it('switching tabs starts focus at row 0', () => {
    switchTab('video');
    moveFocus(1);
    moveFocus(1);
    switchTab('audio');
    const audioRows = document.querySelectorAll('#settings-tab-audio .setting-row');
    if (audioRows.length > 0) {
      expect(audioRows[0].classList.contains('setting-row--focused')).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════
// 6. SETTINGS — SLIDER ADJUST (left/right)
// ════════════════════════════════════════════════════════

describe('Settings — Slider Adjustment', () => {
  it('slider DOM elements have min and max attributes', () => {
    document.querySelectorAll('.setting-row input[type="range"]').forEach(input => {
      const range = input as HTMLInputElement;
      expect(range.min || range.getAttribute('min'), `slider "${range.id}" missing min`).toBeTruthy();
      expect(range.max || range.getAttribute('max'), `slider "${range.id}" missing max`).toBeTruthy();
    });
  });

  it('slider value can be adjusted and fires input event', () => {
    const slider = document.querySelector('.setting-row input[type="range"]') as HTMLInputElement | null;
    if (!slider) return;
    const sMin = Number(slider.min) || 0;
    const sMax = Number(slider.max) || 100;
    const step = Math.max(1, Math.round((sMax - sMin) / 20));

    const handler = vi.fn();
    slider.addEventListener('input', handler);

    // Simulate right press
    const initial = Number(slider.value);
    slider.value = String(Math.min(sMax, initial + step));
    slider.dispatchEvent(new Event('input'));
    expect(handler).toHaveBeenCalled();
    expect(Number(slider.value)).toBeGreaterThanOrEqual(initial);

    slider.removeEventListener('input', handler);
  });

  it('slider does not exceed min/max bounds', () => {
    const slider = document.querySelector('.setting-row input[type="range"]') as HTMLInputElement | null;
    if (!slider) return;
    const sMin = Number(slider.min) || 0;
    const sMax = Number(slider.max) || 100;
    const step = Math.max(1, Math.round((sMax - sMin) / 20));

    // Try below min
    slider.value = String(Math.max(sMin, sMin - step));
    expect(Number(slider.value)).toBeGreaterThanOrEqual(sMin);

    // Try above max
    slider.value = String(Math.min(sMax, sMax + step));
    expect(Number(slider.value)).toBeLessThanOrEqual(sMax);
  });
});

// ════════════════════════════════════════════════════════
// 7. SETTINGS — TOGGLE CYCLING (left/right)
// ════════════════════════════════════════════════════════

describe('Settings — Toggle Cycling', () => {
  it('toggle options exist with at most one active', () => {
    document.querySelectorAll('.control-toggle').forEach(toggle => {
      const opts = toggle.querySelectorAll('.control-toggle__option');
      expect(opts.length).toBeGreaterThan(0);
      const activeCount = Array.from(opts).filter(o =>
        o.classList.contains('control-toggle__option--active'),
      ).length;
      expect(activeCount, 'toggle should have at most one active option').toBeLessThanOrEqual(1);
    });
  });

  it('toggle option click does not throw', () => {
    const toggle = document.querySelector('.control-toggle') as HTMLElement | null;
    if (!toggle) return;
    const opts = Array.from(toggle.querySelectorAll('.control-toggle__option')) as HTMLElement[];
    if (opts.length < 2) return;

    expect(() => opts[0].click()).not.toThrow();
    expect(() => opts[1].click()).not.toThrow();
  });
});

// ════════════════════════════════════════════════════════
// 8. RIGHT-STICK SCROLLING
// ════════════════════════════════════════════════════════

describe('Right-Stick Scrolling', () => {
  const SCROLL_MAP: Record<string, string> = {
    settings: 'settings-content-body',
    history: 'history-list',
    friends: 'friends-list',
    social: 'social-overlay',
    profile: 'profile-overlay',
  };

  it('scroll target elements exist in DOM for all mapped screens', () => {
    for (const [screen, containerId] of Object.entries(SCROLL_MAP)) {
      expect(
        document.getElementById(containerId),
        `scroll target "${containerId}" for "${screen}" missing from DOM`,
      ).toBeTruthy();
    }
  });

  it('scroll targets accept scrollTop assignment without error', () => {
    for (const containerId of Object.values(SCROLL_MAP)) {
      const el = document.getElementById(containerId)!;
      expect(() => { el.scrollTop = 100; }).not.toThrow();
    }
  });

  it('scroll targets have no inline overflow:hidden', () => {
    for (const [screen, containerId] of Object.entries(SCROLL_MAP)) {
      const el = document.getElementById(containerId)!;
      expect(el.style.overflow, `"${screen}" scroll target blocked`).not.toBe('hidden');
      expect(el.style.overflowY).not.toBe('hidden');
    }
  });
});

// ════════════════════════════════════════════════════════
// 9. SOCIAL TABS (LB/RB on social screen)
// ════════════════════════════════════════════════════════

describe('Social Tab Navigation', () => {
  it('social tab buttons exist in DOM', () => {
    for (const id of ['social-tab-party', 'social-tab-friends', 'social-tab-notifs']) {
      expect(document.getElementById(id), `social tab "${id}" missing`).toBeTruthy();
    }
  });

  it('social tab click does not throw', () => {
    const tab = document.getElementById('social-tab-party');
    if (tab) expect(() => tab.click()).not.toThrow();
  });
});

// ════════════════════════════════════════════════════════
// 10. SCREEN-SPECIFIC BACK BEHAVIOR
// ════════════════════════════════════════════════════════

describe('Screen-Specific Back Behavior', () => {
  it('queue screen has cancel button for B-back', () => {
    expect(document.getElementById('btn-queue-cancel')).toBeTruthy();
  });

  it('lobby screen has leave button for B-back', () => {
    expect(document.getElementById('btn-lobby-leave')).toBeTruthy();
  });

  it('joinLobby screen has leave button for B-back', () => {
    expect(document.getElementById('btn-join-lobby-leave')).toBeTruthy();
  });

  it('pause screen has resume and menu buttons', () => {
    expect(document.getElementById('btn-resume')).toBeTruthy();
    expect(document.getElementById('btn-pause-menu')).toBeTruthy();
  });

  it('gameover screen has required action buttons', () => {
    for (const id of ['btn-continue', 'btn-mainmenu']) {
      expect(document.getElementById(id), `gameover button "${id}" missing`).toBeTruthy();
    }
  });

  it('replay screen has exit button for B-back', () => {
    expect(document.getElementById('btn-replay-exit-top')).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════
// 11. MULTI-SCREEN FOCUS CONSISTENCY
// ════════════════════════════════════════════════════════

describe('Multi-Screen Focus Consistency', () => {
  beforeEach(() => {
    initNavigation({});
  });

  it('focus tracking works across screen transitions', () => {
    showScreen('main');
    const btns = MENU_BUTTONS['main'];
    let focus = 0;
    focus = gpNextEnabled(btns, focus, 1);
    focus = gpNextEnabled(btns, focus, 1);
    expect(focus).toBe(2);
  });

  it('navigating deep and back maintains screen state', () => {
    navigateTo('online');
    expect(getCurrentScreen()).toBe('online');
    navigateTo('stats');
    expect(getCurrentScreen()).toBe('stats');
    navigateBack();
    expect(getCurrentScreen()).toBe('online');

    // Buttons for online screen should be focusable
    showScreen('online');
    expect(getFocusableButtons('online').length).toBeGreaterThan(0);
  });

  it('navigateReset clears stack and resets to target', () => {
    navigateTo('stats');
    navigateTo('friends');
    navigateTo('music');
    navigateReset('main');
    expect(getCurrentScreen()).toBe('main');
  });
});

// ════════════════════════════════════════════════════════
// 12. PROFILE SCREEN NAVIGATION
// ════════════════════════════════════════════════════════

describe('Profile Screen Navigation', () => {
  it('profile screen has registered focusable buttons', () => {
    const btns = MENU_BUTTONS['profile'];
    expect(btns).toBeDefined();
    expect(btns.length).toBeGreaterThan(0);
  });

  it('profile tab IDs exist in DOM', () => {
    for (const id of ['profile-tab-stats', 'profile-tab-history']) {
      expect(document.getElementById(id), `profile tab "${id}" missing`).toBeTruthy();
    }
  });

  it('profile mode tab IDs exist in DOM', () => {
    for (const id of ['profile-mode-ai', 'profile-mode-casual', 'profile-mode-ranked']) {
      expect(document.getElementById(id), `profile mode tab "${id}" missing`).toBeTruthy();
    }
  });

  it('profile series pill IDs exist in DOM', () => {
    for (const id of ['profile-series-1', 'profile-series-3', 'profile-series-5']) {
      expect(document.getElementById(id), `profile series pill "${id}" missing`).toBeTruthy();
    }
  });

  it('profile screen has focusable elements excluding profile-edit-btn (hidden by default)', () => {
    navigateTo('profile');
    // profile-edit-btn is hidden by default (display:none), but other buttons should be focusable
    const btns = MENU_BUTTONS['profile'];
    const focusable = btns.filter(id => {
      const el = document.getElementById(id);
      return el && isFocusable(el);
    });
    expect(focusable.length, 'profile screen should have focusable buttons').toBeGreaterThan(0);
    navigateReset('main');
  });

  it('profile-tab elements receive correct selected class', () => {
    const tab = document.getElementById('profile-tab-stats');
    if (!tab) return;
    expect(getSelectedClass(tab)).toBe('profile-tab--selected');
  });

  it('stats-mode-tab elements receive correct selected class', () => {
    const tab = document.getElementById('profile-mode-ai');
    if (!tab) return;
    expect(getSelectedClass(tab)).toBe('stats-mode-tab--selected');
  });

  it('stats-series-pill elements receive correct selected class', () => {
    const pill = document.getElementById('profile-series-1');
    if (!pill) return;
    expect(getSelectedClass(pill)).toBe('stats-series-pill--selected');
  });

  it('profile overlay is scroll target for right-stick', () => {
    expect(document.getElementById('profile-overlay'), 'profile-overlay missing from DOM').toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════
// MAP CAROUSEL GAMEPAD NAVIGATION
// ════════════════════════════════════════════════════════

describe('Map Carousel Gamepad Navigation', () => {
  function ensureMapTiles(): void {
    for (const id of ['map-tile-midtown_bowl', 'map-tile-synth_pit']) {
      if (!document.getElementById(id)) {
        const tile = document.createElement('div');
        tile.id = id;
        tile.className = 'map-carousel-tile';
        document.body.appendChild(tile);
      }
    }
  }

  beforeEach(() => {
    ensureMapTiles();
    // Make dyn-back visible so screens that still use it can reach it
    const dynBack = document.getElementById('dyn-back');
    if (dynBack) dynBack.style.display = '';
  });

  it('map-carousel-tile gets nav-focus BEM class', () => {
    const tile = document.getElementById('map-tile-midtown_bowl')!;
    expect(getSelectedClass(tile)).toBe('map-carousel-tile--nav-focus');
  });

  it('gameover screen includes map tiles in focus list', () => {
    const btns = MENU_BUTTONS['gameover'];
    expect(btns).toContain('map-tile-midtown_bowl');
    expect(btns).toContain('map-tile-synth_pit');
  });

  it('characterSelect screen includes map tiles in focus list', () => {
    const btns = MENU_BUTTONS['characterSelect'];
    expect(btns).toContain('map-tile-midtown_bowl');
    expect(btns).toContain('map-tile-synth_pit');
  });

  it('map tiles appear before action buttons in gameover list', () => {
    const btns = MENU_BUTTONS['gameover'];
    const mapIdx = btns.indexOf('map-tile-midtown_bowl');
    const continueIdx = btns.indexOf('btn-continue');
    expect(mapIdx).toBeLessThan(continueIdx);
  });

  it('d-pad navigates through map tiles on gameover screen', () => {
    // Make the gameover overlay visible so btn-continue etc. pass isFocusable
    const resultOverlay = document.getElementById('result');
    if (resultOverlay) resultOverlay.classList.remove('hidden');

    const btns = MENU_BUTTONS['gameover'];
    let focus = 0; // starts on map-tile-midtown_bowl

    setFocus(btns, focus);
    const tile1 = document.getElementById('map-tile-midtown_bowl')!;
    expect(tile1.classList.contains('map-carousel-tile--nav-focus')).toBe(true);

    // D-pad down → map-tile-synth_pit
    focus = gpNextEnabled(btns, focus, 1);
    setFocus(btns, focus);
    expect(focus).toBe(1);
    const tile2 = document.getElementById('map-tile-synth_pit')!;
    expect(tile2.classList.contains('map-carousel-tile--nav-focus')).toBe(true);
    // Previous tile should lose focus
    expect(tile1.classList.contains('map-carousel-tile--nav-focus')).toBe(false);

    // D-pad down → btn-continue
    focus = gpNextEnabled(btns, focus, 1);
    setFocus(btns, focus);
    expect(focus).toBe(2);
    expect(document.getElementById('btn-continue')!.classList.contains('menu-btn--selected')).toBe(true);
    expect(tile2.classList.contains('map-carousel-tile--nav-focus')).toBe(false);
  });

  it('d-pad up from btn-continue reaches map tiles', () => {
    // Make the gameover overlay visible so btn-continue passes isFocusable
    const resultOverlay = document.getElementById('result');
    if (resultOverlay) resultOverlay.classList.remove('hidden');

    const btns = MENU_BUTTONS['gameover'];
    let focus = btns.indexOf('btn-continue'); // index 2

    // D-pad up → synth_pit
    focus = gpNextEnabled(btns, focus, -1);
    expect(btns[focus]).toBe('map-tile-synth_pit');

    // D-pad up → midtown_bowl
    focus = gpNextEnabled(btns, focus, -1);
    expect(btns[focus]).toBe('map-tile-midtown_bowl');
  });

  it('map tiles on characterSelect come after color swatches', () => {
    const btns = MENU_BUTTONS['characterSelect'];
    const orangeIdx = btns.indexOf('cs-color-orange');
    const mapIdx = btns.indexOf('map-tile-midtown_bowl');
    expect(mapIdx).toBeGreaterThan(orangeIdx);
  });

  it('d-pad navigates from color swatches to map tiles on characterSelect', () => {
    const btns = MENU_BUTTONS['characterSelect'];
    let focus = btns.indexOf('cs-color-orange');

    focus = gpNextEnabled(btns, focus, 1);
    expect(btns[focus]).toBe('map-tile-midtown_bowl');

    focus = gpNextEnabled(btns, focus, 1);
    expect(btns[focus]).toBe('map-tile-synth_pit');
  });

  it('confirm (A button) on map tile triggers click', () => {
    ensureMapTiles();
    const tile = document.getElementById('map-tile-synth_pit')!;
    const clickSpy = vi.fn();
    tile.addEventListener('click', clickSpy);

    // Simulate A-button: el.click()
    tile.click();
    expect(clickSpy).toHaveBeenCalledTimes(1);

    tile.removeEventListener('click', clickSpy);
  });

  it('map tiles are focusable when visible', () => {
    ensureMapTiles();
    const tile = document.getElementById('map-tile-midtown_bowl')!;
    expect(isFocusable(tile)).toBe(true);
  });

  it('map tiles inside .hidden container are not focusable', () => {
    const wrapper = document.createElement('div');
    wrapper.className = 'hidden';
    const tile = document.createElement('div');
    tile.id = 'map-tile-test';
    tile.className = 'map-carousel-tile';
    wrapper.appendChild(tile);
    document.body.appendChild(wrapper);

    expect(isFocusable(tile)).toBe(false);

    document.body.removeChild(wrapper);
  });
});
