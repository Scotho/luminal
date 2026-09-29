// ── Time Tracking ─────────────────────────────────────────
// Manages session time, total playtime (persisted to localStorage + Firestore),
// and the global all-players time counter (from Firebase RTDB via presence).

import { onGlobalTimePlayed } from '../presence';
import { warnDev } from '../swallow';

// ── Total Time Played (real wall-clock time across all sessions) ──
const _sessionStart: number = Date.now();
let _totalTimeBase: number = parseFloat(localStorage.getItem('luminal-total-time') || '0');
let _totalTimeInterval: ReturnType<typeof setInterval> | null = null;

function _formatTotalTime(seconds: number): string {
  const total: number = Math.floor(seconds);
  const d: number = Math.floor(total / 86400);
  const h: number = Math.floor((total % 86400) / 3600);
  const m: number = Math.floor((total % 3600) / 60);
  const s: number = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${h}h ${pad(m)}m ${pad(s)}s`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  return `${m}m ${pad(s)}s`;
}

function _updateTotalTime(): void {
  const sessionSecs: number = (Date.now() - _sessionStart) / 1000;
  const total: number = _totalTimeBase + sessionSecs;
  const el: HTMLElement | null = document.getElementById('total-time-played');
  if (el) el.textContent = _formatTotalTime(total);
}

export function startTotalTimeTimer(): void {
  if (_totalTimeInterval) return;
  _updateTotalTime();
  _totalTimeInterval = setInterval(_updateTotalTime, 1000);
}

export function resetTotalTime(): void {
  _totalTimeBase = 0;
  localStorage.setItem('luminal-total-time', '0');
  _updateTotalTime();
}

// ── Sync Time Played to Firestore (every 5 min) ──────────
let _lastSyncedTime: number = _totalTimeBase;   // what we last told the server
const TIME_SYNC_INTERVAL: number = 5 * 60 * 1000;  // 5 minutes

export function getCurrentTotalTime(): number {
  return _totalTimeBase + (Date.now() - _sessionStart) / 1000;
}

async function _syncTimeToServer(): Promise<void> {
  const { auth: fbAuth } = await import('../firebase.js');
  const user = fbAuth.currentUser;
  if (!user || user.isAnonymous) return;

  const current: number = getCurrentTotalTime();
  const delta: number = current - _lastSyncedTime;
  if (delta < 1) return;   // nothing meaningful to sync

  try {
    const { doc: fsDoc, updateDoc } = await import('firebase/firestore');
    const { db: fsDb } = await import('../firebase.js');
    await updateDoc(fsDoc(fsDb, 'users', user.uid), { timePlayed: Math.round(current) });
    _lastSyncedTime = current;
  } catch (e) { warnDev('timeTracking', e); }
}

// ── Global Time Played (all players server-synced) ────────
let _globalTimeServer: number = 0;
let _globalTimeLocal: number = 0;
let _globalTimeLastUpdate: number = 0;

function _formatGlobalTime(seconds: number): string {
  const s: number = Math.floor(seconds);
  const d: number = Math.floor(s / 86400);
  const h: number = Math.floor((s % 86400) / 3600);
  const m: number = Math.floor((s % 3600) / 60);
  const sec: number = s % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${h}h ${pad(m)}m ${pad(sec)}s`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(sec)}s`;
  return `${m}m ${pad(sec)}s`;
}

function _renderGlobalTime(): void {
  const el: HTMLElement | null = document.getElementById('global-time-played');
  if (!el) return;
  el.textContent = _globalTimeLocal < 60 ? '—' : _formatGlobalTime(_globalTimeLocal);
}

export function initTimeTracking(): void {
  // Persist total time every 30s and on page unload
  setInterval(() => {
    const sessionSecs: number = (Date.now() - _sessionStart) / 1000;
    localStorage.setItem('luminal-total-time', (_totalTimeBase + sessionSecs).toFixed(1));
  }, 30000);
  window.addEventListener('beforeunload', () => {
    const sessionSecs: number = (Date.now() - _sessionStart) / 1000;
    localStorage.setItem('luminal-total-time', (_totalTimeBase + sessionSecs).toFixed(1));
    _syncTimeToServer();   // best-effort sync on unload
  });

  startTotalTimeTimer();

  // Schedule Firestore sync: initial after 30s, then every 5min
  setTimeout(_syncTimeToServer, 30000);
  setInterval(_syncTimeToServer, TIME_SYNC_INTERVAL);

  // Set up global time listener
  onGlobalTimePlayed((totalSecs: number) => {
    _globalTimeServer = totalSecs;
    _globalTimeLocal = totalSecs;
    _globalTimeLastUpdate = Date.now();
    _renderGlobalTime();
  });

  // Tick global time +1s locally between server updates
  setInterval(() => {
    if (_globalTimeServer > 0) {
      const elapsed: number = (Date.now() - _globalTimeLastUpdate) / 1000;
      _globalTimeLocal = _globalTimeServer + elapsed;
      _renderGlobalTime();
    }
  }, 1000);
}
