// ── Bug Reporter ─────────────────────────────────────────
// Captures runtime errors and unhandled rejections, posts them to RTDB
// at debugReports/{id}. Each report includes the user, game mode, and error.
// Only functional on localhost — silently no-ops in production.

import { rtdb } from './firebase';
import { ref, push, set, query, orderByChild, limitToLast, onValue, off } from 'firebase/database';
import type { DatabaseReference, Query, Unsubscribe } from 'firebase/database';

export interface BugReport {
  username: string;
  uid: string;
  gameMode: string;
  error: string;
  stack: string;
  url: string;
  userAgent: string;
  ts: number;
}

const IS_LOCAL: boolean = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const REPORTS_PATH = 'debugReports';
const MAX_REPORTS = 200;

// ── Rate limiting ───────────────────────────────────────
// Deduplicates by error message — at most 1 write per message per cooldown window.
const RATE_LIMIT_MS = 10_000;
const _recentErrors = new Map<string, number>();

// ── Injected getters — set once from main.ts ────────────
let _getUid: () => string = () => 'anonymous';
let _getUsername: () => string = () => 'anonymous';
let _getGameMode: () => string = () => 'unknown';

export function initBugReporter(deps: {
  getUid: () => string;
  getUsername: () => string;
  getGameMode: () => string;
}): void {
  _getUid = deps.getUid;
  _getUsername = deps.getUsername;
  _getGameMode = deps.getGameMode;

  // Global error handler
  window.addEventListener('error', (e: ErrorEvent) => {
    submitReport(e.message, e.error?.stack || '');
  });

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const msg = e.reason?.message || String(e.reason);
    const stack = e.reason?.stack || '';
    submitReport(msg, stack);
  });
}

// ── Firebase SDK error filter ────────────────────────────
// Firebase SDK internal errors are noisy on localhost and aren't real bugs.
const FIREBASE_NOISE = [
  'auth/',
  'appCheck/',
  'firestore/',
  'firebase',
  'googleapis.com',
  'recaptcha',
  'ReCaptcha',
  '@firebase/',
  'FirebaseError',
];

function isFirebaseNoise(error: string, stack: string): boolean {
  const combined = `${error}\n${stack}`;
  return FIREBASE_NOISE.some(pattern => combined.includes(pattern));
}

// ── Rate limiter ────────────────────────────────────────
function isRateLimited(error: string): boolean {
  const now = Date.now();
  const last = _recentErrors.get(error);
  if (last && now - last < RATE_LIMIT_MS) return true;
  _recentErrors.set(error, now);
  // Prune stale entries to prevent memory leak
  if (_recentErrors.size > 50) {
    for (const [key, ts] of _recentErrors) {
      if (now - ts >= RATE_LIMIT_MS) _recentErrors.delete(key);
    }
  }
  return false;
}

// ── Submit a report to RTDB ──────────────────────────────
function submitReport(error: string, stack: string): void {
  if (!IS_LOCAL) return;
  if (isFirebaseNoise(error, stack)) return;
  if (isRateLimited(error)) return;
  const report: BugReport = {
    username: _getUsername(),
    uid: _getUid(),
    gameMode: _getGameMode(),
    error,
    stack: stack.slice(0, 1000), // truncate stack traces
    url: location.href,
    userAgent: navigator.userAgent,
    ts: Date.now(),
  };
  const reportsRef: DatabaseReference = ref(rtdb, REPORTS_PATH);
  const newRef = push(reportsRef);
  set(newRef, report).catch(() => {});
}

// ── Manual report (for UI "submit bug" button) ───────────
// Always allowed — not gated by IS_LOCAL like auto-capture.
export function submitManualReport(description: string): void {
  const report: BugReport = {
    username: _getUsername(),
    uid: _getUid(),
    gameMode: _getGameMode(),
    error: description,
    stack: '(manual report)',
    url: location.href,
    userAgent: navigator.userAgent,
    ts: Date.now(),
  };
  const reportsRef: DatabaseReference = ref(rtdb, REPORTS_PATH);
  const newRef = push(reportsRef);
  set(newRef, report).catch(() => {});
}

