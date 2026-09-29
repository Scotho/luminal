// ── Session Data Service ──────────────────────────────────────────────────────
//
// Unified background poller for sessions.json. Runs regardless of which admin
// section is active, so the agent panel + sessions section + sidebar badge all
// stay current.

import type { Session } from '../types';

const POLL_INTERVAL = 5_000; // 5s

let _cache: Session[] = [];
let _timer: ReturnType<typeof setInterval> | null = null;
let _lastJson = '';
const _listeners: Array<(sessions: Session[]) => void> = [];

async function poll(): Promise<void> {
  try {
    const res = await fetch('/data/sessions.json');
    if (!res.ok) return;
    const raw = await res.text();

    // Skip if identical to last fetch (avoid unnecessary re-renders)
    if (raw === _lastJson) return;
    _lastJson = raw;

    _cache = JSON.parse(raw) as Session[];
    for (const fn of _listeners) fn(_cache);
  } catch { /* network error — keep stale cache */ }
}

/** Start the background poller. Call once at dashboard init. */
export function startSessionDataService(): void {
  if (_timer) return; // already running
  poll(); // immediate first fetch
  _timer = setInterval(poll, POLL_INTERVAL);
}

/** Stop the background poller. */
export function stopSessionDataService(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

/** Get all cached sessions (any status). */
export function getSessionCache(): Session[] {
  return _cache;
}

/** Get only sessions the agent panel considers "active". */
export function getActiveSessions(): Session[] {
  return _cache.filter(
    s => s.status === 'active' || s.status === 'needs-attention' || s.status === 'blocked',
  );
}

/** Subscribe to session data changes. Returns unsubscribe function. */
export function onSessionsChanged(fn: (sessions: Session[]) => void): () => void {
  _listeners.push(fn);
  return () => {
    const idx = _listeners.indexOf(fn);
    if (idx >= 0) _listeners.splice(idx, 1);
  };
}

/** Reset for testing. */
export function _resetForTesting(): void {
  stopSessionDataService();
  _cache = [];
  _lastJson = '';
  _listeners.length = 0;
}
