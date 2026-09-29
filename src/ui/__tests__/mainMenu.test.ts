// ── Main Menu Tests ─────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initNavigation, showScreen, navigateTo, navigateBack,
  navigateReset, getCurrentScreen, _resetForTesting,
  SCREEN_IDS,
} from '../navigation';

describe('Main Menu', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetForTesting();
    initNavigation({});
    showScreen('main');
    // Remove any stale dynamic back buttons
    document.getElementById('dyn-back')?.remove();
  });

  describe('menu buttons exist', () => {
    const buttons = [
      'btn-quickstart', 'btn-online',
      'btn-music', 'btn-stats', 'btn-settings', 'btn-leaderboard',
    ];

    buttons.forEach(id => {
      it(`#${id} exists in the DOM`, () => {
        expect(document.getElementById(id)).toBeTruthy();
      });
    });
  });

  describe('icon bar layout', () => {
    it('.menu-icon-bar contains exactly 4 buttons', () => {
      const iconBar = document.querySelector('.menu-icon-bar');
      expect(iconBar).toBeTruthy();
      const buttons = iconBar!.querySelectorAll('.menu-icon-btn');
      expect(buttons.length).toBe(4);
    });

    it('.menu-icon-bar last child is #btn-music', () => {
      const iconBar = document.querySelector('.menu-icon-bar');
      expect(iconBar).toBeTruthy();
      const last = iconBar!.lastElementChild;
      expect(last).toBeTruthy();
      expect(last!.id).toBe('btn-music');
    });

    it('#btn-settings is a full-width menu-item in menu-stack (not in icon bar)', () => {
      const settingsBtn = document.getElementById('btn-settings');
      expect(settingsBtn).toBeTruthy();
      // It must be inside .menu-stack
      expect(settingsBtn!.closest('.menu-stack')).toBeTruthy();
      // It must NOT be inside .menu-icon-bar
      expect(settingsBtn!.closest('.menu-icon-bar')).toBeNull();
      // It must carry menu-item class
      expect(settingsBtn!.classList.contains('menu-item')).toBe(true);
      // Only one btn-settings in DOM
      const allSettings = document.querySelectorAll('#btn-settings');
      expect(allSettings.length).toBe(1);
    });

    it('#btn-leaderboard exists in .menu-icon-bar with trophy icon', () => {
      const lbBtn = document.getElementById('btn-leaderboard');
      expect(lbBtn).toBeTruthy();
      expect(lbBtn!.closest('.menu-icon-bar')).toBeTruthy();
      expect(lbBtn!.classList.contains('menu-icon-btn')).toBe(true);
      expect(lbBtn!.querySelector('svg')).toBeTruthy();
    });

    it('.menu-icon-bar order is social, leaderboard, stats, music', () => {
      const iconBar = document.querySelector('.menu-icon-bar');
      const ids = Array.from(iconBar!.children).map(el => el.id);
      expect(ids).toEqual(['btn-social', 'btn-leaderboard', 'btn-stats', 'btn-music']);
    });
  });

  describe('button clicks navigate to correct screens', () => {
    const navButtons: [string, string][] = [
      ['btn-settings', 'settings'],
      ['btn-music', 'music'],

      ['btn-online', 'online'],
      ['btn-stats', 'stats'],
    ];

    navButtons.forEach(([btnId, expectedScreen]) => {
      it(`#${btnId} click navigates to "${expectedScreen}"`, () => {
        // Wire up the click handler like main.ts does
        document.getElementById(btnId)!.addEventListener('click', () => navigateTo(expectedScreen));
        document.getElementById(btnId)!.click();
        expect(getCurrentScreen()).toBe(expectedScreen);
        const overlayId = SCREEN_IDS[expectedScreen];
        expect(document.getElementById(overlayId)!.classList.contains('hidden')).toBe(false);
      });
    });
  });

  describe('quick start', () => {
    it('#btn-quickstart exists as a standalone button', () => {
      const btn = document.getElementById('btn-quickstart')!;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toContain('QUICK START');
    });

    it('no match options panel exists', () => {
      expect(document.getElementById('match-options')).toBeNull();
    });

    it('no settings toggle exists', () => {
      expect(document.getElementById('btn-qs-options')).toBeNull();
    });
  });

  describe('lobby overlay', () => {
    it('#lobby-overlay exists with controls', () => {
      expect(document.getElementById('lobby-overlay')).toBeTruthy();
      expect(document.getElementById('btn-lobby-invite')).toBeTruthy();
      expect(document.getElementById('btn-lobby-start')).toBeTruthy();
      expect(document.getElementById('btn-lobby-leave')).toBeTruthy();
    });

    it('#btn-create-lobby exists in main menu', () => {
      expect(document.getElementById('btn-create-lobby')).toBeTruthy();
    });
  });

  describe('overlay structure', () => {
    it('main overlay is visible by default after showScreen("main")', () => {
      expect(document.getElementById('overlay')!.classList.contains('hidden')).toBe(false);
    });

    it('all other overlays are hidden when main is shown', () => {
      for (const [name, id] of Object.entries(SCREEN_IDS)) {
        if (name === 'main') continue;
        const el = document.getElementById(id);
        if (el) expect(el.classList.contains('hidden')).toBe(true);
      }
    });

    it('main overlay has the LUMINAL logo', () => {
      const logo = document.getElementById('overlay')!.querySelector('.menu-logo');
      expect(logo).toBeTruthy();
      expect(logo!.getAttribute('alt')).toBe('LUMINAL');
    });

    it('controls text is present', () => {
      const controls = document.getElementById('controls-text')!;
      expect(controls).toBeTruthy();
      expect(controls.textContent).toContain('TURN');
      expect(controls.textContent).toContain('BOOST');
    });
  });
});
