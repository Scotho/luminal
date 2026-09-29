// ── Navigation System Tests ─────────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initNavigation, showScreen, navigateTo, navigateBack,
  navigateReset, getCurrentScreen, getNavStack, setCurrentScreen,
  getFocusIndex,
  _resetForTesting, SCREEN_IDS, EXTRA_SCREEN_IDS,
} from '../navigation';

describe('Navigation', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetForTesting();
    // Reset all overlays to hidden
    document.querySelectorAll('.overlay-screen').forEach(el => el.classList.add('hidden'));
    Object.values(EXTRA_SCREEN_IDS).forEach(id => {
      document.getElementById(id)?.classList.add('hidden');
    });
    // Ensure permanent dyn-back element exists (hidden by default)
    if (!document.getElementById('dyn-back')) {
      const dynBack = document.createElement('div');
      dynBack.id = 'dyn-back';
      dynBack.className = 'menu-btn menu-btn--secondary dyn-back';
      dynBack.style.display = 'none';
      dynBack.textContent = 'BACK';
      document.body.appendChild(dynBack);
    } else {
      document.getElementById('dyn-back')!.style.display = 'none';
    }
  });

  describe('showScreen', () => {
    it('shows the main overlay when called with "main"', () => {
      showScreen('main');
      const overlay = document.getElementById('overlay')!;
      expect(overlay.classList.contains('hidden')).toBe(false);
    });

    it('hides all overlay-screens when called with null', () => {
      showScreen('main');
      showScreen(null);
      const overlays = document.querySelectorAll('.overlay-screen');
      overlays.forEach(el => {
        expect(el.classList.contains('hidden')).toBe(true);
      });
    });

    it('shows settings overlay and hides main', () => {
      showScreen('main');
      showScreen('settings');
      expect(document.getElementById('settings-overlay')!.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('overlay')!.classList.contains('hidden')).toBe(true);
    });

    it('shows each screen by name correctly', () => {
      for (const [name, id] of Object.entries(SCREEN_IDS)) {
        showScreen(name);
        const el = document.getElementById(id);
        expect(el, `screen "${name}" -> #${id}`).toBeTruthy();
        expect(el!.classList.contains('hidden'), `screen "${name}" should be visible`).toBe(false);
        // All others should be hidden
        for (const [otherName, otherId] of Object.entries(SCREEN_IDS)) {
          if (otherName === name) continue;
          const other = document.getElementById(otherId);
          if (other) {
            expect(other.classList.contains('hidden'), `"${otherName}" should be hidden when "${name}" is shown`).toBe(true);
          }
        }
      }
    });

    it('hides extra screens (pause, replay) when showing an overlay', () => {
      const pauseEl = document.getElementById('pause-overlay')!;
      pauseEl.classList.remove('hidden');
      showScreen('main');
      expect(pauseEl.classList.contains('hidden')).toBe(true);
    });

    it('shows extra screens by name', () => {
      showScreen('paused');
      expect(document.getElementById('pause-overlay')!.classList.contains('hidden')).toBe(false);
    });
  });

  describe('navigateTo', () => {
    beforeEach(() => {
      initNavigation({});
    });

    it('pushes current screen onto stack and shows target', () => {
      showScreen('main');
      navigateTo('settings');
      expect(getCurrentScreen()).toBe('settings');
      expect(document.getElementById('settings-overlay')!.classList.contains('hidden')).toBe(false);
      expect(getNavStack()).toEqual(['main']);
    });

    it('does not navigate if already on target screen', () => {
      navigateTo('main');
      const stackBefore = [...getNavStack()];
      navigateTo('main');
      expect(getNavStack()).toEqual(stackBefore);
    });

    it('builds a multi-level navigation stack', () => {
      initNavigation({});
      navigateTo('settings');
      navigateTo('keybinds');
      expect(getCurrentScreen()).toBe('keybinds');
      expect(getNavStack().length).toBe(2);
    });

    it('shows the permanent back button on non-main screens', () => {
      initNavigation({});
      navigateTo('settings');
      const backBtn = document.getElementById('dyn-back')!;
      expect(backBtn).toBeTruthy();
      expect(backBtn.style.display).toBe('');
    });

    it('hides back button on main screen', () => {
      initNavigation({});
      navigateReset('main');
      expect(document.getElementById('dyn-back')!.style.display).toBe('none');
    });
  });

  describe('navigateBack', () => {
    beforeEach(() => {
      initNavigation({});
    });

    it('returns to previous screen', () => {
      navigateTo('settings');
      navigateBack();
      expect(getCurrentScreen()).toBe('main');
      expect(document.getElementById('overlay')!.classList.contains('hidden')).toBe(false);
    });

    it('is a no-op when stack is empty', () => {
      const before = getCurrentScreen();
      navigateBack();
      expect(getCurrentScreen()).toBe(before);
    });

    it('pops the stack correctly through multiple levels', () => {
      navigateTo('settings');
      navigateTo('keybinds');
      navigateBack(); // -> settings
      expect(getCurrentScreen()).toBe('settings');
      navigateBack(); // -> main
      expect(getCurrentScreen()).toBe('main');
      expect(getNavStack().length).toBe(0);
    });

    it('hides dynamic back button when navigating back to main', () => {
      navigateTo('settings');
      expect(document.getElementById('dyn-back')!.style.display).toBe('');
      navigateBack();
      expect(document.getElementById('dyn-back')!.style.display).toBe('none');
    });

    it('calls onHideTopBar when returning to null during gameplay', () => {
      const hideTopBar = vi.fn();
      _resetForTesting();
      initNavigation({}, { onHideTopBar: hideTopBar, getGameState: () => 'playing' });
      // Simulate: game is playing (no screen open), user opens pause menu
      setCurrentScreen(null);
      navigateTo('paused');  // pushes null onto stack
      navigateBack();        // pops null -> triggers onHideTopBar
      expect(hideTopBar).toHaveBeenCalled();
    });
  });

  describe('navigateReset', () => {
    beforeEach(() => {
      initNavigation({});
    });

    it('clears the stack and goes to the target screen', () => {
      navigateTo('settings');
      navigateTo('keybinds');
      navigateReset('main');
      expect(getCurrentScreen()).toBe('main');
      expect(getNavStack().length).toBe(0);
    });

    it('defaults to main if no screen specified', () => {
      navigateTo('settings');
      navigateReset();
      expect(getCurrentScreen()).toBe('main');
    });
  });

  describe('screen hooks', () => {
    it('calls enter hook when navigating to a screen', () => {
      const enterHook = vi.fn();
      initNavigation({ settings: { enter: enterHook } });
      navigateTo('settings');
      expect(enterHook).toHaveBeenCalledOnce();
    });

    it('calls exit hook when leaving a screen', () => {
      const exitHook = vi.fn();
      initNavigation({ settings: { exit: exitHook } });
      navigateTo('settings');
      navigateBack();
      expect(exitHook).toHaveBeenCalledOnce();
    });

    it('calls exit on current screen and enter on new screen during navigateTo', () => {
      const order: string[] = [];
      initNavigation({
        main: { exit: () => order.push('exit-main') },
        settings: { enter: () => order.push('enter-settings') },
      });
      navigateTo('settings');
      expect(order).toEqual(['exit-main', 'enter-settings']);
    });

    it('calls exit hook during navigateReset', () => {
      const exitHook = vi.fn();
      initNavigation({ settings: { exit: exitHook } });
      navigateTo('settings');
      navigateReset('main');
      expect(exitHook).toHaveBeenCalledOnce();
    });
  });

  describe('callbacks', () => {
    it('calls onShowTopBar when opening a screen', () => {
      const showTopBar = vi.fn();
      initNavigation({}, { onShowTopBar: showTopBar });
      navigateTo('settings');
      expect(showTopBar).toHaveBeenCalled();
    });

    it('resets focus index when applying a screen', () => {
      initNavigation({});
      navigateTo('settings');
      expect(getFocusIndex()).toBe(0);
    });
  });
});
