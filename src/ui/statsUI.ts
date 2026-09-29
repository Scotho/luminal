// ── Stats Hub UI ──────────────────────────────────────────
// Manages the stats screen: mode tabs, series pills, view tabs,
// stat card clicks, and populating stats from localStorage/Firestore.

import { fetchUserStats, getRankForMetric } from '../leaderboard';
import { getCurrentUid, getIsRealUser } from './authUI';
import { openDrilldown, getCurrentMetric } from './leaderboardUI';
import { loadStreaks, saveStreaks } from '../streak';
import { resetTotalTime } from './timeTracking';
import { swallow } from '../swallow';
import { playUiTab } from '../sfx';
import { renderHistory } from './matchHistory';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GameInstance = any;

interface StatsUIDeps {
  game: GameInstance;
  navigateTo: (screen: string) => void;
}

let _game: GameInstance = null;
let _navigateTo: ((screen: string) => void) | null = null;

let _statsMode: 'ai' | 'casual' = 'ai';
let _statsSeries: number = 1;
let _statsView: 'mystats' | 'history' | 'leaderboard' = 'mystats';

function _formatFastestWin(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}

export async function populateStats(): Promise<void> {
  const ids = ['sh-wins', 'sh-beststreak', 'sh-fastestwin', 'sh-matches', 'sh-currentstreak'];
  const rankIds = ['sh-wins-rank', 'sh-beststreak-rank', 'sh-fastestwin-rank', 'sh-matches-rank', 'sh-currentstreak-rank'];

  // Show/hide offline reset
  const resetEl = document.getElementById('stats-offline-reset')!;
  if (_statsMode === 'ai') { resetEl.classList.remove('hidden'); } else { resetEl.classList.add('hidden'); }

  // Loading state
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '...'; });
  rankIds.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ''; });

  if (_statsMode === 'ai') {
    // Offline: use localStorage stats
    const s = _game.stats;
    const el = (id: string) => document.getElementById(id)!;
    el('sh-wins').textContent = String(s.wins);
    const streaks = loadStreaks();
    const seriesKey = _statsSeries === 1 ? 'bo1' : _statsSeries === 3 ? 'bo3' : 'bo5';
    el('sh-beststreak').textContent = String(streaks[seriesKey as keyof typeof streaks].bestStreak);
    el('sh-currentstreak').textContent = String(streaks[seriesKey as keyof typeof streaks].currentStreak);
    el('sh-fastestwin').textContent = '\u2014';
    el('sh-matches').textContent = String(s.matchCount);
    // W/L/D bar
    el('sh-wld-wins').textContent = String(s.wins);
    el('sh-wld-losses').textContent = String(s.losses);
    el('sh-wld-draws').textContent = String(s.draws);
    // Win rate
    const wr = s.matchCount > 0 ? Math.round((s.wins / s.matchCount) * 100) : 0;
    el('sh-winrate').textContent = `${wr}%`;
  }

  // Fetch from Firestore (for both offline and casual — offline may have Firestore entries too)
  if (getCurrentUid() && getIsRealUser()) {
    try {
      const stats = await fetchUserStats(getCurrentUid()!, _statsSeries, _statsMode);
      if (stats) {
        const el = (id: string) => document.getElementById(id)!;
        el('sh-wins').textContent = String(stats.wins);
        el('sh-beststreak').textContent = String(stats.bestStreak);
        el('sh-currentstreak').textContent = String(stats.currentStreak);
        el('sh-fastestwin').textContent = stats.fastestWin > 0 ? _formatFastestWin(stats.fastestWin) : '\u2014';
        el('sh-matches').textContent = String(stats.matchCount);
        // W/L/D bar
        el('sh-wld-wins').textContent = String(stats.wins);
        el('sh-wld-losses').textContent = String(stats.losses);
        el('sh-wld-draws').textContent = String(stats.draws);
        // Win rate
        el('sh-winrate').textContent = `${stats.winRate}%`;
      } else if (_statsMode !== 'ai') {
        ids.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '0'; });
        document.getElementById('sh-wld-wins')!.textContent = '0';
        document.getElementById('sh-wld-losses')!.textContent = '0';
        document.getElementById('sh-wld-draws')!.textContent = '0';
        document.getElementById('sh-winrate')!.textContent = '0%';
      }

      // Fetch rank badges
      const metrics = ['wins', 'bestStreak', 'fastestWin', 'matchCount', 'currentStreak'];
      for (let i = 0; i < metrics.length; i++) {
        getRankForMetric(getCurrentUid()!, _statsSeries, _statsMode, metrics[i]).then(rank => {
          const el = document.getElementById(rankIds[i]);
          if (el) el.textContent = rank ? `#${rank}` : '';
        }).catch(swallow('statsUI'));
      }
    } catch {
      rankIds.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ''; });
    }
  }
}

export function initStatsUI(deps: StatsUIDeps): void {
  _game = deps.game;
  _navigateTo = deps.navigateTo;

  // btn-stats navigation
  document.getElementById('btn-stats')!.addEventListener('click', () => _navigateTo!('stats'));

  // Stats reset button
  document.getElementById('btn-stats-reset')!.addEventListener('click', () => {
    _game.stats = { wins: 0, losses: 0, draws: 0, bestStreak: 0, totalTime: 0, matchCount: 0 };
    localStorage.setItem('luminal-stats', JSON.stringify(_game.stats));
    _game.streakData = loadStreaks();
    saveStreaks({ bo1: { currentStreak: 0, bestStreak: 0 }, bo3: { currentStreak: 0, bestStreak: 0 }, bo5: { currentStreak: 0, bestStreak: 0 } });
    _game.streakData = { bo1: { currentStreak: 0, bestStreak: 0 }, bo3: { currentStreak: 0, bestStreak: 0 }, bo5: { currentStreak: 0, bestStreak: 0 } };
    resetTotalTime();
    populateStats();
  });

  // Stats Hub: mode tabs
  document.querySelectorAll('.stats-mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.classList.contains('stats-mode-tab--disabled')) return;
      playUiTab();
      document.querySelectorAll('.stats-mode-tab').forEach(t => t.classList.remove('stats-mode-tab--active'));
      tab.classList.add('stats-mode-tab--active');
      _statsMode = (tab as HTMLElement).dataset.mode as 'ai' | 'casual';
      populateStats();
      if (_statsView === 'leaderboard') openDrilldown(getCurrentMetric(), _statsSeries, _statsMode);
    });
  });

  // Stats Hub: series pills
  document.querySelectorAll('.stats-series-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.stats-series-pill').forEach(p => p.classList.remove('stats-series-pill--active'));
      pill.classList.add('stats-series-pill--active');
      _statsSeries = parseInt((pill as HTMLElement).dataset.series!, 10);
      populateStats();
      if (_statsView === 'leaderboard') openDrilldown(getCurrentMetric(), _statsSeries, _statsMode);
    });
  });

  // Stats Hub: header tabs (MY STATS / MATCH HISTORY / LEADERBOARD)
  document.querySelectorAll('.stats-header-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const view = (tab as HTMLElement).dataset.view as 'mystats' | 'history' | 'leaderboard';
      if (!view) return;
      playUiTab();
      _statsView = view;
      document.querySelectorAll('.stats-header-tab').forEach(t => {
        t.classList.remove('stats-header-tab--active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('stats-header-tab--active');
      tab.setAttribute('aria-selected', 'true');
      document.getElementById('stats-panel-mystats')!.classList.toggle('hidden', view !== 'mystats');
      document.getElementById('stats-panel-history')!.classList.toggle('hidden', view !== 'history');
      document.getElementById('stats-panel-leaderboard')!.classList.toggle('hidden', view !== 'leaderboard');
      if (view === 'leaderboard') {
        openDrilldown('wins', _statsSeries, _statsMode);
      } else if (view === 'history') {
        renderHistory().catch(swallow('statsUI'));
      }
    });
  });

  // Stats Hub: stat card clicks → switch to leaderboard tab with that metric
  document.querySelectorAll('.stats-card-item').forEach(item => {
    item.addEventListener('click', () => {
      if ((item as HTMLElement).classList.contains('stats-card-item--no-click')) return;
      const metric = (item as HTMLElement).dataset.metric;
      if (metric) openDrilldown(metric, _statsSeries, _statsMode);
    });
  });
}

export function resetStatsView(): void {
  _statsView = 'mystats';
}
