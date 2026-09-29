// ── HUD Visibility Tests ────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest';
import { showScreen, _resetForTesting } from '../navigation';

describe('HUD Visibility', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  describe('radar', () => {
    it('#radar-wrap exists', () => {
      expect(document.getElementById('radar-wrap')).toBeTruthy();
    });

    it('#radar exists and starts hidden', () => {
      const radar = document.getElementById('radar')!;
      expect(radar).toBeTruthy();
      expect(radar.classList.contains('hidden')).toBe(true);
    });

    it('#radar-canvas exists', () => {
      expect(document.getElementById('radar-canvas')).toBeTruthy();
    });

    it('#match-timer exists and starts hidden', () => {
      const timer = document.getElementById('match-timer')!;
      expect(timer).toBeTruthy();
      expect(timer.classList.contains('hidden')).toBe(true);
    });

    it('#streak-display exists and starts hidden', () => {
      const streak = document.getElementById('streak-display')!;
      expect(streak).toBeTruthy();
      expect(streak.classList.contains('hidden')).toBe(true);
    });
  });

  describe('boost meter', () => {
    it('#meter-wrap exists', () => {
      expect(document.getElementById('meter-wrap')).toBeTruthy();
    });

    it('#meter-wrap starts with menu-hidden class', () => {
      expect(document.getElementById('meter-wrap')!.classList.contains('menu-hidden')).toBe(true);
    });

    it('#meter-fill and meter-spark exist', () => {
      expect(document.getElementById('meter-fill')).toBeTruthy();
      expect(document.getElementById('meter-spark')).toBeTruthy();
    });
  });

  describe('series score', () => {
    it('#series-score exists and starts hidden', () => {
      const el = document.getElementById('series-score')!;
      expect(el).toBeTruthy();
      expect(el.classList.contains('hidden')).toBe(true);
    });
  });

  describe('top bar (auth-status)', () => {
    it('#auth-status exists', () => {
      expect(document.getElementById('auth-status')).toBeTruthy();
    });

    it('#auth-status starts with display:none', () => {
      const el = document.getElementById('auth-status')!;
      expect(el.style.display).toBe('none');
    });

    it('contains perf stats', () => {
      expect(document.getElementById('tb-perf')).toBeTruthy();
    });

    it('contains fullscreen button', () => {
      expect(document.getElementById('fullscreen-btn')).toBeTruthy();
    });

    it('contains settings button', () => {
      expect(document.getElementById('tb-settings-btn')).toBeTruthy();
    });

    it('contains online badge in FIND MATCH button', () => {
      expect(document.getElementById('online-badge')).toBeTruthy();
      expect(document.getElementById('online-badge-count')).toBeTruthy();
    });

    it('contains friends online indicator in social trigger', () => {
      expect(document.getElementById('friends-online-indicator')).toBeTruthy();
      expect(document.getElementById('friends-online-count')).toBeTruthy();
    });

    it('contains social dropdown', () => {
      expect(document.getElementById('social-dropdown-wrap')).toBeTruthy();
    });

    it('contains notification bell', () => {
      expect(document.getElementById('notif-btn')).toBeTruthy();
      expect(document.getElementById('notif-dropdown')).toBeTruthy();
    });
  });

  describe('bottom bar', () => {
    it('#bottom-bar exists', () => {
      expect(document.getElementById('bottom-bar')).toBeTruthy();
    });

    it('#bottom-bar starts with display:none', () => {
      expect(document.getElementById('bottom-bar')!.style.display).toBe('none');
    });

    it('contains version number', () => {
      const version = document.getElementById('version')!;
      expect(version).toBeTruthy();
      expect(version.textContent).toMatch(/^v\d+\.\d+\.\d+$/);
    });

    it('about link points to credits page', () => {
      const link = document.querySelector('a[href="/credits.html"]');
      expect(link).toBeTruthy();
    });
  });

  describe('audio controls in top bar', () => {
    it('has play/pause button', () => {
      expect(document.getElementById('pause-btn')).toBeTruthy();
    });

    it('has skip and prev buttons', () => {
      expect(document.getElementById('skip-btn')).toBeTruthy();
      expect(document.getElementById('prev-btn')).toBeTruthy();
    });

    it('has repeat and shuffle buttons', () => {
      expect(document.getElementById('repeat-btn')).toBeTruthy();
      expect(document.getElementById('shuffle-btn')).toBeTruthy();
    });

    it('has mute button', () => {
      expect(document.getElementById('mute-btn')).toBeTruthy();
    });

    it('has volume slider', () => {
      const slider = document.getElementById('vol-bar-slider') as HTMLInputElement;
      expect(slider).toBeTruthy();
      expect(slider.type).toBe('range');
    });
  });
});
