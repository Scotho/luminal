// ── Presence System ──────────────────────────────────────
// Heartbeat-based: each client pings every 30s, stale entries (>2min) pruned on read
import { rtdb, auth } from './firebase';
import { ref, set, onValue, onDisconnect, remove, runTransaction } from 'firebase/database';
import { onAuthStateChanged } from 'firebase/auth';
import { signInAnon } from './auth';
import { swallow, warnDev } from './swallow';
import type { PresenceEntry } from './types/index';
import type { DatabaseReference, Unsubscribe } from 'firebase/database';
import type { User } from 'firebase/auth';

const HEARTBEAT_INTERVAL: number = 30000; // 30s
const STALE_THRESHOLD: number = 120000;   // 2 minutes — prune entries older than this

let presenceRef: DatabaseReference | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let countUnsub: Unsubscribe | null = null;
let connectedUnsub: Unsubscribe | null = null;
let _connected: boolean = false;
let _onConnectedCb: ((connected: boolean) => void) | null = null;
let _authUnsub: (() => void) | null = null;

export async function initPresence(): Promise<void> {
  try { await signInAnon(); } catch (e) { warnDev('presence', e); }

  // Unsubscribe previous auth listener to prevent accumulation on re-init
  if (_authUnsub) { _authUnsub(); _authUnsub = null; }

  _authUnsub = onAuthStateChanged(auth, (user: User | null) => {
    if (user) setupPresenceNode(user.uid);
  });

  if (auth.currentUser) setupPresenceNode(auth.currentUser.uid);
}

function setupPresenceNode(uid: string): void {
  // Clean up old
  if (presenceRef) set(presenceRef, null).catch(swallow('presence'));
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (connectedUnsub) connectedUnsub();

  presenceRef = ref(rtdb, `status/${uid}`);

  // Use .info/connected
  const connRef: DatabaseReference = ref(rtdb, '.info/connected');
  connectedUnsub = onValue(connRef, (snap) => {
    _connected = snap.val() === true;
    if (_onConnectedCb) _onConnectedCb(_connected);

    if (_connected) {
      onDisconnect(presenceRef!).remove().then(() => {
        writeHeartbeat();
      });
    }
  });

  // Heartbeat every 30s
  heartbeatTimer = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL);
}

function writeHeartbeat(): void {
  if (!presenceRef) return;
  set(presenceRef, { online: true, ts: Date.now() }).catch(swallow('presence'));
  // Increment global time counter by heartbeat interval (30s)
  incrementGlobalTimeDelta(HEARTBEAT_INTERVAL / 1000);
}

// ── Global Time Played (all players) ─────────────────────
let _globalTimeUnsub: Unsubscribe | null = null;

export function incrementGlobalTimeDelta(seconds: number): void {
  if (seconds <= 0) return;
  const gRef: DatabaseReference = ref(rtdb, 'globalStats/totalTimePlayed');
  runTransaction(gRef, (current: number | null) => {
    const next: number = (current || 0) + seconds;
    // Never allow regression — only move forward
    return next > (current || 0) ? next : current;
  }).catch(swallow('presence'));
}

// Listen to global time played across all players
export function onGlobalTimePlayed(callback: (totalSeconds: number) => void): void {
  if (_globalTimeUnsub) _globalTimeUnsub();
  const gRef: DatabaseReference = ref(rtdb, 'globalStats/totalTimePlayed');
  _globalTimeUnsub = onValue(gRef, (snap) => {
    callback(snap.val() || 0);
  });
}

// Listen to online count — prunes stale entries
export function onOnlineCount(callback: (count: number) => void): void {
  const statusRef: DatabaseReference = ref(rtdb, 'status');
  if (countUnsub) countUnsub();

  countUnsub = onValue(statusRef, (snapshot) => {
    const val: Record<string, PresenceEntry> | null = snapshot.val();
    if (!val) { callback(0); return; }

    const now: number = Date.now();
    let count: number = 0;

    for (const uid of Object.keys(val)) {
      const entry: PresenceEntry = val[uid];
      const ts: number = entry?.ts || 0;
      if (now - ts > STALE_THRESHOLD) {
        // Prune stale entry (best effort — may fail if not our uid)
        remove(ref(rtdb, `status/${uid}`)).catch(swallow('presence'));
      } else {
        count++;
      }
    }

    callback(count);
  });
}

export function onConnectionChange(callback: (connected: boolean) => void): void {
  _onConnectedCb = callback;
  callback(_connected);
}
