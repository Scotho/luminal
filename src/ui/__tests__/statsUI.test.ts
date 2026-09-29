// ── Stats Hub UI Tests ─────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../leaderboard', () => ({
  fetchUserStats: vi.fn(() => Promise.resolve(null)),
  getRankForMetric: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../leaderboardUI', () => ({
  openDrilldown: vi.fn(() => Promise.resolve()),
  getCurrentMetric: vi.fn(() => 'wins'),
}));
vi.mock('../authUI', () => ({
  getCurrentUid: vi.fn(() => null),
  getIsRealUser: vi.fn(() => false),
}));
vi.mock('../../streak', () => ({
  loadStreaks: vi.fn(() => ({
    bo1: { currentStreak: 0, bestStreak: 0 },
    bo3: { currentStreak: 0, bestStreak: 0 },
    bo5: { currentStreak: 0, bestStreak: 0 },
  })),
  saveStreaks: vi.fn(),
}));
vi.mock('../timeTracking', () => ({
  resetTotalTime: vi.fn(),
}));
vi.mock('../../sfx', () => ({
  playUiTab: vi.fn(),
  playTick: vi.fn(),
  playHover: vi.fn(),
  playClick: vi.fn(),
}));

import { initStatsUI } from '../statsUI';

describe('Stats Hub UI', () => {
  describe('stats overlay DOM', () => {
    it('#stats-overlay exists', () => {
      const el = document.getElementById('stats-overlay')!;
      expect(el).toBeTruthy();
      expect(el.classList.contains('overlay-screen')).toBe(true);
    });

    it('has mode tabs', () => {
      const statsOverlay = document.getElementById('stats-overlay')!;
      const tabs = statsOverlay.querySelectorAll('.stats-mode-tab');
      const labels = Array.from(tabs).map(t => t.textContent?.trim());
      expect(labels).toEqual(['OFFLINE', 'CASUAL', 'RANKED']);
    });

    it('OFFLINE tab is active by default', () => {
      const statsOverlay = document.getElementById('stats-overlay')!;
      const offlineTab = statsOverlay.querySelector('.stats-mode-tab[data-mode="ai"]')!;
      expect(offlineTab.classList.contains('stats-mode-tab--active')).toBe(true);
    });

    it('RANKED tab is disabled', () => {
      const statsOverlay = document.getElementById('stats-overlay')!;
      const rankedTab = statsOverlay.querySelector('.stats-mode-tab[data-mode="ranked"]')!;
      expect(rankedTab.classList.contains('stats-mode-tab--disabled')).toBe(true);
    });

    it('has series filter pills', () => {
      const statsOverlay = document.getElementById('stats-overlay')!;
      const pills = statsOverlay.querySelectorAll('.stats-series-pill');
      const labels = Array.from(pills).map(p => p.textContent?.trim());
      expect(labels).toEqual(['BO1', 'BO3', 'BO5']);
    });

    it('BO1 pill is active by default', () => {
      const statsOverlay = document.getElementById('stats-overlay')!;
      const bo1 = statsOverlay.querySelector('.stats-series-pill[data-series="1"]')!;
      expect(bo1.classList.contains('stats-series-pill--active')).toBe(true);
    });

    it('has header tabs (MY STATS, MATCH HISTORY, LEADERBOARD)', () => {
      const tabs = document.querySelectorAll('.stats-header-tab');
      const labels = Array.from(tabs).map(t => t.textContent?.trim());
      expect(labels).toEqual(['MY STATS', 'MATCH HISTORY', 'LEADERBOARD']);
    });

    it('MY STATS header tab is active by default', () => {
      const tab = document.querySelector('.stats-header-tab[data-view="mystats"]')!;
      expect(tab.classList.contains('stats-header-tab--active')).toBe(true);
    });

    it('MY STATS panel is visible by default', () => {
      const panel = document.getElementById('stats-panel-mystats')!;
      expect(panel).toBeTruthy();
      expect(panel.classList.contains('hidden')).toBe(false);
    });

    it('MATCH HISTORY panel exists and is hidden by default', () => {
      const panel = document.getElementById('stats-panel-history')!;
      expect(panel).toBeTruthy();
      expect(panel.classList.contains('hidden')).toBe(true);
    });

    it('LEADERBOARD panel is hidden by default', () => {
      const panel = document.getElementById('stats-panel-leaderboard')!;
      expect(panel).toBeTruthy();
      expect(panel.classList.contains('hidden')).toBe(true);
    });

    it('has stats card with value and rank elements', () => {
      expect(document.getElementById('sh-wins')).toBeTruthy();
      expect(document.getElementById('sh-wins-rank')).toBeTruthy();
      expect(document.getElementById('sh-beststreak')).toBeTruthy();
      expect(document.getElementById('sh-beststreak-rank')).toBeTruthy();
      expect(document.getElementById('sh-fastestwin')).toBeTruthy();
      expect(document.getElementById('sh-fastestwin-rank')).toBeTruthy();
      expect(document.getElementById('sh-matches')).toBeTruthy();
      expect(document.getElementById('sh-matches-rank')).toBeTruthy();
      expect(document.getElementById('sh-currentstreak')).toBeTruthy();
      expect(document.getElementById('sh-currentstreak-rank')).toBeTruthy();
      expect(document.getElementById('sh-winrate')).toBeTruthy();
    });

    it('has W/L/D bar elements', () => {
      expect(document.getElementById('sh-wld-wins')).toBeTruthy();
      expect(document.getElementById('sh-wld-losses')).toBeTruthy();
      expect(document.getElementById('sh-wld-draws')).toBeTruthy();
    });

    it('has time played section', () => {
      expect(document.getElementById('total-time-played')).toBeTruthy();
      expect(document.getElementById('global-time-played')).toBeTruthy();
    });

    it('has offline reset', () => {
      const resetEl = document.getElementById('stats-offline-reset')!;
      expect(resetEl).toBeTruthy();
    });

    it('stat cards have data-metric attributes', () => {
      const items = document.querySelectorAll('.stats-card-item[data-metric]');
      const metrics = Array.from(items).map(i => (i as HTMLElement).dataset.metric);
      expect(metrics).toEqual(['wins', 'bestStreak', 'fastestWin', 'matchCount', 'currentStreak']);
    });
  });

  describe('leaderboard panel DOM', () => {
    it('has metric pills', () => {
      const pills = document.querySelectorAll('.stats-metric-pill');
      expect(pills.length).toBe(6);
    });

    it('has metric list (mobile)', () => {
      const items = document.querySelectorAll('.stats-metric-list-item');
      expect(items.length).toBe(6);
    });

    it('has leaderboard table elements', () => {
      expect(document.getElementById('lb-header-val')).toBeTruthy();
      expect(document.getElementById('lb-rows')).toBeTruthy();
    });

    it('has empty state (hidden)', () => {
      const empty = document.getElementById('lb-empty')!;
      expect(empty).toBeTruthy();
      expect(empty.classList.contains('hidden')).toBe(true);
    });

    it('has loading indicator (hidden)', () => {
      const loading = document.getElementById('lb-loading')!;
      expect(loading).toBeTruthy();
      expect(loading.classList.contains('hidden')).toBe(true);
    });

    it('has pagination controls', () => {
      expect(document.getElementById('lb-prev')).toBeTruthy();
      expect(document.getElementById('lb-next')).toBeTruthy();
      expect(document.getElementById('lb-page-info')).toBeTruthy();
    });

    it('has graveyard section (hidden by default)', () => {
      const gy = document.getElementById('lb-graveyard')!;
      expect(gy).toBeTruthy();
      expect(gy.classList.contains('hidden')).toBe(true);
    });

    it('has graveyard toggle', () => {
      expect(document.getElementById('lb-graveyard-toggle')).toBeTruthy();
      expect(document.getElementById('lb-graveyard-rows')).toBeTruthy();
    });
  });

  describe('header tab switching', () => {
    beforeEach(() => {
      // Clone every header tab so prior initStatsUI() click handlers don't stack.
      document.querySelectorAll('.stats-header-tab').forEach(el => {
        const clone = el.cloneNode(true);
        el.parentNode!.replaceChild(clone, el);
      });
      // Reset tab/panel state.
      document.querySelectorAll('.stats-header-tab').forEach(t => t.classList.remove('stats-header-tab--active'));
      document.querySelector('.stats-header-tab[data-view="mystats"]')?.classList.add('stats-header-tab--active');
      document.getElementById('stats-panel-mystats')?.classList.remove('hidden');
      document.getElementById('stats-panel-history')?.classList.add('hidden');
      document.getElementById('stats-panel-leaderboard')?.classList.add('hidden');
      // Wire up the real handlers against the fresh DOM.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGame: any = { stats: { wins: 0, losses: 0, draws: 0, bestStreak: 0, totalTime: 0, matchCount: 0 } };
      initStatsUI({ game: mockGame, navigateTo: vi.fn() });
    });

    it('clicking MATCH HISTORY tab switches to history panel', () => {
      const historyTab = document.querySelector<HTMLElement>('.stats-header-tab[data-view="history"]')!;
      historyTab.click();
      expect(historyTab.classList.contains('stats-header-tab--active')).toBe(true);
      expect(document.getElementById('stats-panel-mystats')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('stats-panel-history')!.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('stats-panel-leaderboard')!.classList.contains('hidden')).toBe(true);
    });

    it('clicking LEADERBOARD tab switches to leaderboard panel', () => {
      const lbTab = document.querySelector<HTMLElement>('.stats-header-tab[data-view="leaderboard"]')!;
      lbTab.click();
      expect(lbTab.classList.contains('stats-header-tab--active')).toBe(true);
      expect(document.getElementById('stats-panel-mystats')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('stats-panel-history')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('stats-panel-leaderboard')!.classList.contains('hidden')).toBe(false);
    });

    it('clicking MY STATS tab after another tab switches back to stats', () => {
      const historyTab = document.querySelector<HTMLElement>('.stats-header-tab[data-view="history"]')!;
      const mystatsTab = document.querySelector<HTMLElement>('.stats-header-tab[data-view="mystats"]')!;
      historyTab.click();
      mystatsTab.click();
      expect(mystatsTab.classList.contains('stats-header-tab--active')).toBe(true);
      expect(historyTab.classList.contains('stats-header-tab--active')).toBe(false);
      expect(document.getElementById('stats-panel-mystats')!.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('stats-panel-history')!.classList.contains('hidden')).toBe(true);
    });
  });
});
