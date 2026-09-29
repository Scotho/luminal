// ── Leaderboard Drilldown UI ────────────────────────────────
import { fetchLeaderboard, fetchGraveyard } from '../leaderboard';
import { loadReplay } from '../replayStore';
import { escapeHtml, show, hide } from './dom';
import type { LeaderboardEntry, ReplaySnapshot } from '../types/index';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GameInstance = any;

interface DrilldownDeps {
  currentUid: string | null;
  game: GameInstance;
  showScreen: (screen: string | null) => void;
  navigateTo: (screen: string) => void;
  resetReplayUI: (() => void) | null;
  setCurrentScreen: (screen: string | null) => void;
  getRadarEnabled: () => boolean;
}

let _currentUid: string | null = null;
let _game: GameInstance = null;
let _showScreen: ((screen: string | null) => void) | null = null;
let _resetReplayUI: (() => void) | null = null;
let _setCurrentScreen: ((screen: string | null) => void) | null = null;
let _getRadarEnabled: (() => boolean) | null = null;

const LB_METRIC_HEADERS: Record<string, string> = {
  wins: 'WINS',
  bestStreak: 'BEST STREAK',
  currentStreak: 'CURRENT',
  fastestWin: 'FASTEST WIN',
  matchCount: 'MATCHES',
  lifetimeFlow: 'LIFETIME FLOW',
};

let _onProfileClick: ((uid: string) => void) | null = null;

export function setProfileClickHandler(handler: (uid: string) => void): void {
  _onProfileClick = handler;
}

let _lbLoading = false;
let _lbPage = 0;
const LB_PAGE_SIZE = 10;
const LB_MAX_PAGES = 10;
let _lbAllEntries: LeaderboardEntry[] = [];
let _currentMetric = 'wins';
let _currentSeries = 1;
let _currentMatchType: 'ai' | 'casual' = 'ai';

function _lbFormatVal(metric: string, entry: LeaderboardEntry): string | number {
  if (metric === 'wins') return entry.wins;
  if (metric === 'bestStreak') return entry.bestStreak;
  if (metric === 'currentStreak') return entry.currentStreak;
  if (metric === 'matchCount') return entry.matchCount;
  if (metric === 'fastestWin') {
    const t = entry.fastestWin;
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 10);
    return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
  }
  return '—';
}

function _lbReplayIdForMetric(metric: string, entry: LeaderboardEntry): string {
  if (metric === 'fastestWin') return entry.fastestWinReplayId || '';
  if (metric === 'bestStreak') return entry.bestStreakReplayId || '';
  return entry.lastReplayId || '';
}

function _setActiveMetric(metric: string): void {
  // Pills (desktop)
  document.querySelectorAll('.stats-metric-pill').forEach(p => {
    p.classList.toggle('stats-metric-pill--active', (p as HTMLElement).dataset.metric === metric);
  });
  // List (mobile)
  document.querySelectorAll('.stats-metric-list-item').forEach(p => {
    p.classList.toggle('stats-metric-list-item--active', (p as HTMLElement).dataset.metric === metric);
  });
  // Update table header
  const headerEl = document.getElementById('lb-header-val');
  if (headerEl) headerEl.textContent = LB_METRIC_HEADERS[metric] || 'VALUE';
}

// Open the drilldown for a specific metric
export async function openDrilldown(metric: string, series: number, matchType: 'ai' | 'casual'): Promise<void> {
  _currentMetric = metric;
  _currentSeries = series;
  _currentMatchType = matchType;
  _lbPage = 0;

  // Switch view tabs
  document.querySelectorAll('.stats-header-tab').forEach(t => t.classList.remove('stats-header-tab--active'));
  document.querySelector('.stats-header-tab[data-view="leaderboard"]')?.classList.add('stats-header-tab--active');

  // Switch panels
  document.getElementById('stats-panel-mystats')?.classList.add('hidden');
  document.getElementById('stats-panel-history')?.classList.add('hidden');
  document.getElementById('stats-panel-leaderboard')?.classList.remove('hidden');

  // Update metric selector active state (both pills and list)
  _setActiveMetric(metric);

  // Show/hide graveyard
  const graveyardEl = document.getElementById('lb-graveyard')!;
  if (metric === 'currentStreak') {
    graveyardEl.classList.remove('hidden');
    _loadGraveyard();
  } else {
    graveyardEl.classList.add('hidden');
  }

  await _loadDrilldown(true);
}

async function _loadDrilldown(resetPage: boolean): Promise<void> {
  if (_lbLoading) return;
  _lbLoading = true;
  if (resetPage) _lbPage = 0;

  const rowsEl = document.getElementById('lb-rows')!;
  const emptyEl = document.getElementById('lb-empty')!;
  const loadingEl = document.getElementById('lb-loading')!;

  rowsEl.innerHTML = '';
  hide(emptyEl);
  show(loadingEl);

  document.getElementById('lb-header-val')!.textContent = LB_METRIC_HEADERS[_currentMetric] || 'VALUE';

  try {
    if (resetPage) {
      const timeout: Promise<never> = new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 8000));
      _lbAllEntries = await Promise.race([fetchLeaderboard(_currentMetric, _currentSeries, _currentMatchType, 100), timeout]);
    }

    hide(loadingEl);

    if (_lbAllEntries.length === 0) {
      show(emptyEl);
      _updatePaging();
    } else {
      const start = _lbPage * LB_PAGE_SIZE;
      const pageEntries = _lbAllEntries.slice(start, start + LB_PAGE_SIZE);

      pageEntries.forEach((entry, i) => {
        const row = document.createElement('div');
        row.className = 'lb-row';
        const rank = start + i + 1;
        if (rank === 1) row.classList.add('lb-row--gold');
        else if (rank === 2) row.classList.add('lb-row--silver');
        else if (rank === 3) row.classList.add('lb-row--bronze');
        const isMe = !!_currentUid && entry.uid === _currentUid;
        if (isMe) row.classList.add('lb-row--self');
        const replayId = _lbReplayIdForMetric(_currentMetric, entry);
        if (isMe && replayId) row.style.cursor = 'pointer';
        const iconHtml = entry.icon ? `<svg class="chat-icon chat-icon-${entry.icon}" data-tip="${entry.icon === 'star' ? 'EARLY ADOPTER' : ''}"><use href="/icons.svg#i-${entry.icon}"/></svg>` : '';
        const valStr = _lbFormatVal(_currentMetric, entry);
        row.innerHTML = `
          <span class="lb-col-rank">${rank <= 3 ? '<svg class="lb-medal-icon"><use href="/icons.svg#i-award"/></svg>' : ''}${rank}</span>
          <span class="lb-col-name">${iconHtml}${escapeHtml(entry.username)}</span>
          <span class="lb-col-val">${valStr}</span>
          <span class="lb-col-winrate">${entry.winRate}%</span>
          <span class="lb-col-extra">${entry.wins}/${entry.losses}</span>
        `;
        if (isMe && replayId) {
          row.addEventListener('click', () => _playReplay(replayId));
        }
        if (!isMe) {
          row.style.cursor = 'pointer';
          row.addEventListener('click', () => {
            _onProfileClick?.(entry.uid);
          });
        }
        rowsEl.appendChild(row);
      });

      _updatePaging();
    }
  } catch (e) {
    hide(loadingEl);
    emptyEl.textContent = 'FAILED TO LOAD';
    show(emptyEl);
    _updatePaging();
    console.error('Leaderboard load error:', e);
  } finally {
    _lbLoading = false;
  }
}

function _updatePaging(): void {
  const totalPages = Math.min(LB_MAX_PAGES, Math.max(1, Math.ceil(_lbAllEntries.length / LB_PAGE_SIZE)));
  const prevBtn = document.getElementById('lb-prev')!;
  const nextBtn = document.getElementById('lb-next')!;
  const info = document.getElementById('lb-page-info')!;
  info.textContent = `${_lbPage + 1} / ${totalPages}`;
  prevBtn.classList.toggle('lb-page-btn--disabled', _lbPage === 0);
  nextBtn.classList.toggle('lb-page-btn--disabled', _lbPage >= totalPages - 1);
}

function _timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function _loadGraveyard(): Promise<void> {
  const rowsEl = document.getElementById('lb-graveyard-rows')!;
  rowsEl.innerHTML = '';

  try {
    const fallen = await fetchGraveyard(_currentSeries, _currentMatchType, 20);
    for (const entry of fallen) {
      const row = document.createElement('div');
      row.className = 'lb-graveyard-row';
      const iconHtml = entry.icon ? `<svg class="chat-icon chat-icon-${entry.icon}"><use href="/icons.svg#i-${entry.icon}"/></svg>` : '';
      row.innerHTML = `
        <span class="lb-col-name">${iconHtml}${escapeHtml(entry.username)}</span>
        <span class="lb-graveyard-streak">had a ${entry.currentStreakPeak}-streak</span>
        <span class="lb-graveyard-time">${_timeAgo(entry.currentStreakBrokenAt!)}</span>
      `;
      rowsEl.appendChild(row);
    }
    if (fallen.length === 0) {
      rowsEl.innerHTML = '<div style="text-align:center;color:rgba(var(--mist-200),0.2);font-size:11px;padding:8px">No recent casualties</div>';
    }
  } catch (e) {
    console.warn('Failed to load graveyard:', e);
  }
}

async function _playReplay(replayId: string): Promise<void> {
  try {
    const replay = await loadReplay(replayId);
    if (!replay) return;
    const snapshot: ReplaySnapshot = {
      frames: replay.frames as unknown as ReplaySnapshot['frames'],
      playerColor: replay.playerColor,
      playerEmissive: replay.playerEmissive || 0x184D51,
      playerVehicle: replay.playerVehicle || 'bike',
      aiColors: replay.aiColors,
      aiVehicles: replay.aiVehicles || [],
      duration: replay.duration,
    };
    _showScreen!('replay');
    _setCurrentScreen!('replay');
    if (typeof _resetReplayUI === 'function') _resetReplayUI();
    await _game.startReplayFromSnapshot(snapshot);
  } catch (e) {
    console.error('Failed to load replay:', e);
  }
}

// ── Radar preview helpers ───────────────────────────────

function showRadarPreview(): void {
  const radarEl = document.getElementById('radar')!;
  _game.settingsOpen = true;
  if (_getRadarEnabled!()) {
    show(radarEl);
    radarEl.classList.remove('radar--preview');
    show('match-timer');
  } else {
    hide(radarEl);
    hide('match-timer');
  }
}

function hideRadarPreview(): void {
  const radarEl = document.getElementById('radar')!;
  hide(radarEl);
  radarEl.classList.remove('radar--preview');
  hide('match-timer');
  _game.settingsOpen = false;
}

// ── Init ───────────────────────────────────

export function initLeaderboardUI(deps: DrilldownDeps): void {
  _currentUid = deps.currentUid;
  _game = deps.game;
  _showScreen = deps.showScreen;
  _resetReplayUI = deps.resetReplayUI;
  _setCurrentScreen = deps.setCurrentScreen;
  _getRadarEnabled = deps.getRadarEnabled;

  // Paging buttons
  document.getElementById('lb-prev')!.addEventListener('click', () => {
    if (_lbPage > 0) { _lbPage--; _loadDrilldown(false); }
  });
  document.getElementById('lb-next')!.addEventListener('click', () => {
    const totalPages = Math.min(LB_MAX_PAGES, Math.ceil(_lbAllEntries.length / LB_PAGE_SIZE));
    if (_lbPage < totalPages - 1) { _lbPage++; _loadDrilldown(false); }
  });

  // Graveyard toggle
  document.getElementById('lb-graveyard-toggle')!.addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    const rows = document.getElementById('lb-graveyard-rows')!;
    rows.style.display = checked ? '' : 'none';
  });

  // Metric pills (desktop)
  document.querySelectorAll('.stats-metric-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const metric = (pill as HTMLElement).dataset.metric;
      if (metric) openDrilldown(metric, _currentSeries, _currentMatchType);
    });
  });

  // Metric list (mobile)
  document.querySelectorAll('.stats-metric-list-item').forEach(item => {
    item.addEventListener('click', () => {
      const metric = (item as HTMLElement).dataset.metric;
      if (metric) openDrilldown(metric, _currentSeries, _currentMatchType);
    });
  });

}

export function updateCurrentUser(uid: string | null): void {
  _currentUid = uid;
}

export function getCurrentMetric(): string { return _currentMetric; }

export { showRadarPreview, hideRadarPreview };
