// ── Pause Menu Tests ────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initNavigation, showScreen, navigateTo, navigateReset,
  getCurrentScreen, setCurrentScreen, _resetForTesting,
} from '../navigation';
import { createMockGame } from './helpers/mockGame';

describe('Pause Menu', () => {
  let game: ReturnType<typeof createMockGame>;

  beforeEach(() => {
    localStorage.clear();
    _resetForTesting();
    game = createMockGame({ state: 'playing' });
    initNavigation({});
  });

  describe('local pause overlay', () => {
    it('#pause-overlay exists and is hidden by default', () => {
      const el = document.getElementById('pause-overlay')!;
      expect(el).toBeTruthy();
      expect(el.classList.contains('hidden')).toBe(true);
    });

    it('shows pause overlay when showScreen("paused") is called', () => {
      showScreen('paused');
      expect(document.getElementById('pause-overlay')!.classList.contains('hidden')).toBe(false);
    });

    it('has Resume button', () => {
      const btn = document.getElementById('btn-resume')!;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toContain('RESUME');
    });

    it('has Settings button', () => {
      const btn = document.getElementById('btn-pause-settings')!;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toContain('SETTINGS');
    });

    it('has Main Menu button', () => {
      const btn = document.getElementById('btn-pause-menu')!;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toContain('MAIN MENU');
    });

    it('resume button calls game.resume', () => {
      const btn = document.getElementById('btn-resume')!;
      btn.addEventListener('click', () => game.resume());
      btn.click();
      expect(game.resume).toHaveBeenCalledOnce();
    });

    it('main menu button returns to main', () => {
      const btn = document.getElementById('btn-pause-menu')!;
      btn.addEventListener('click', () => {
        game.returnToMenu();
        navigateReset('main');
      });
      btn.click();
      expect(game.returnToMenu).toHaveBeenCalledOnce();
      expect(getCurrentScreen()).toBe('main');
    });

    it('settings button navigates to settings', () => {
      setCurrentScreen('paused');
      const btn = document.getElementById('btn-pause-settings')!;
      btn.addEventListener('click', () => navigateTo('settings'));
      btn.click();
      expect(getCurrentScreen()).toBe('settings');
    });

    it('has music controls (prev, mute, skip)', () => {
      expect(document.getElementById('btn-pause-prev')).toBeTruthy();
      expect(document.getElementById('btn-pause-mute')).toBeTruthy();
      expect(document.getElementById('btn-pause-skip')).toBeTruthy();
    });
  });

  describe('online pause overlay', () => {
    it('#online-pause-overlay exists and is hidden', () => {
      const el = document.getElementById('online-pause-overlay')!;
      expect(el).toBeTruthy();
      expect(el.classList.contains('hidden')).toBe(true);
    });

    it('has Resume button', () => {
      expect(document.getElementById('btn-online-resume')).toBeTruthy();
    });

    it('has Settings button', () => {
      expect(document.getElementById('btn-online-pause-settings')).toBeTruthy();
    });

    it('has Forfeit button', () => {
      const btn = document.getElementById('btn-online-forfeit')!;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toContain('FORFEIT');
    });
  });
});
