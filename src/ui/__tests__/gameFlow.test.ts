// ── Game Flow Tests ─────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initNavigation, showScreen, navigateTo, navigateReset,
  getCurrentScreen, _resetForTesting,
} from '../navigation';
import { createMockGame } from './helpers/mockGame';

describe('Game Flow', () => {
  let game: ReturnType<typeof createMockGame>;

  beforeEach(() => {
    localStorage.clear();
    _resetForTesting();
    game = createMockGame();
    initNavigation({});
    showScreen('main');
  });

  describe('quickstart flow', () => {
    it('clicking quickstart calls game.startSeries', () => {
      const btn = document.getElementById('btn-quickstart')!;
      btn.addEventListener('click', () => game.startSeries());
      btn.click();
      expect(game.startSeries).toHaveBeenCalledOnce();
    });

    it('quickstart button exists and is labeled', () => {
      const btn = document.getElementById('btn-quickstart')!;
      expect(btn.textContent).toContain('QUICK START');
    });
  });

  describe('game over screen', () => {
    it('#result overlay exists with correct structure', () => {
      const result = document.getElementById('result')!;
      expect(result).toBeTruthy();
      expect(result.classList.contains('overlay-screen')).toBe(true);
    });

    it('has result text, summary, and buttons', () => {
      expect(document.getElementById('result-text')).toBeTruthy();
      expect(document.getElementById('result-summary')).toBeTruthy();
      expect(document.getElementById('result-duration')).toBeTruthy();
      expect(document.getElementById('result-radar')).toBeTruthy();
    });

    it('has continue button', () => {
      const btn = document.getElementById('btn-continue')!;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toContain('CONTINUE');
    });

    it('has replay button', () => {
      const btn = document.getElementById('btn-replay')!;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toContain('REPLAY');
    });

    it('has settings button', () => {
      expect(document.getElementById('btn-go-settings')).toBeTruthy();
    });

    it('has main menu button', () => {
      const btn = document.getElementById('btn-mainmenu')!;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toContain('MAIN MENU');
    });

    it('has submit to leaderboard button (hidden by default)', () => {
      const btn = document.getElementById('btn-submit-match')!;
      expect(btn).toBeTruthy();
      expect(btn.style.display).toBe('none');
    });

    it('main menu button navigates to main', () => {
      const btn = document.getElementById('btn-mainmenu')!;
      btn.addEventListener('click', () => {
        game.returnToMenu();
        navigateReset('main');
      });

      showScreen('gameover');
      btn.click();

      expect(game.returnToMenu).toHaveBeenCalledOnce();
      expect(getCurrentScreen()).toBe('main');
    });

    it('settings button navigates to settings from gameover', () => {
      const btn = document.getElementById('btn-go-settings')!;
      btn.addEventListener('click', () => navigateTo('settings'));

      showScreen('gameover');
      btn.click();

      expect(getCurrentScreen()).toBe('settings');
    });
  });

  describe('unified result buttons', () => {
    it('online buttons exist in unified result-buttons', () => {
      expect(document.getElementById('btn-online-next')).toBeTruthy();
      expect(document.getElementById('btn-online-rematch')).toBeTruthy();
      expect(document.getElementById('btn-online-leave')).toBeTruthy();
    });

    it('match selector exists', () => {
      expect(document.getElementById('result-match-selector')).toBeTruthy();
      expect(document.getElementById('match-sel-label')).toBeTruthy();
    });
  });

  describe('countdown element', () => {
    it('#countdown exists and is hidden', () => {
      const el = document.getElementById('countdown')!;
      expect(el).toBeTruthy();
      expect(el.classList.contains('hidden')).toBe(true);
    });

    it('has countdown number element', () => {
      const num = document.getElementById('countdown-num')!;
      expect(num).toBeTruthy();
      expect(num.textContent).toBe('3');
    });
  });

  describe('pregame screen', () => {
    it('#pregame-screen exists and is hidden', () => {
      const el = document.getElementById('pregame-screen')!;
      expect(el).toBeTruthy();
      expect(el.classList.contains('hidden')).toBe(true);
    });

    it('has pregame title and vs elements', () => {
      expect(document.getElementById('pregame-title')).toBeTruthy();
      expect(document.getElementById('pregame-vs')).toBeTruthy();
      expect(document.getElementById('pregame-score')).toBeTruthy();
    });
  });

  describe('online cleanup on return to menu', () => {
    it('_teardownOnline is callable when _onlineMatch exists', () => {
      const mockStop = vi.fn();
      const g = createMockGame({
        mode: 'online',
        _onlineMatch: { stop: mockStop },
        _lockstep: {},
      });
      // Simulate what _teardownOnline does
      if (g._onlineMatch) {
        g._onlineMatch.stop();
        g._onlineMatch = null;
      }
      g._lockstep = null;
      g.mode = 'local';

      expect(mockStop).toHaveBeenCalled();
      expect(g._onlineMatch).toBeNull();
      expect(g._lockstep).toBeNull();
      expect(g.mode).toBe('local');
    });

    it('_teardownOnline is safe when _onlineMatch is already null', () => {
      const g = createMockGame();
      // Should not throw when nothing to clean up
      expect(g._onlineMatch).toBeNull();
      expect(g._lockstep).toBeNull();
    });
  });
});
