// ── Settings Sync ────────────────────────────────────────
// Saves syncable user settings to Firestore and restores
// them on login when localStorage is empty (new device / cleared storage).

import { EVT_SETTINGS_RESTORED } from './events';
import { auth, db } from './firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { net } from './netLog';
import { warnDev } from './swallow';

// Keys that should sync (without the 'luminal-' prefix).
// Device-specific (positions, panel state) and ephemeral keys are excluded.
const SYNCABLE_KEYS: string[] = [
  // Player identity
  'vehicle', 'color',
  // Audio
  'vol-master', 'vol-music', 'vol-sfx', 'shuffle', 'playlist-mode',
  'custom-playlist', 'custom-muted', 'disabled-defaults',
  // Graphics
  'gfx-preset', 'gfx-bloom', 'gfx-antialias', 'gfx-pixelRatio',
  'gfx-arenaDetail', 'gfx-raveSpotlights', 'gfx-audioReactivity',
  'gfx-playerVFX', 'gfx-lighting', 'gfx-atmosphere', 'gfx-reflections',
  // Camera
  'cam-fov', 'cam-dist', 'cam-stiffness', 'cam-shake', 'radar-size',
  // Gameplay
  'radar-enabled', 'radar-mobile-hide', 'lineassist', 'autosubmit',
  'force-kb', 'perf-fps', 'perf-mem', 'perf-ping', 'perf-vram',
  // Game state
  'bestof', 'opponents',
  // Input
  'keybinds', 'stick-deadzone',
];

const LS_PREFIX = 'luminal-';
const SENTINEL_KEY = 'luminal-gfx-preset'; // If absent, localStorage is "empty"
const DEBOUNCE_MS = 5_000;

let _uploadTimer: ReturnType<typeof setTimeout> | null = null;
let _currentUid: string | null = null;
let _syncEnabled = false;

// ── Internal helpers ─────────────────────────────────────

/** Collect all syncable settings from localStorage into a plain object. */
function _gatherSettings(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of SYNCABLE_KEYS) {
    const val = localStorage.getItem(LS_PREFIX + key);
    if (val !== null) result[key] = val;
  }
  return result;
}

/** Write a blob of settings into localStorage. */
function _applySettings(blob: Record<string, string>): void {
  for (const [key, val] of Object.entries(blob)) {
    if (SYNCABLE_KEYS.includes(key)) {
      localStorage.setItem(LS_PREFIX + key, val);
    }
  }
}

/** Returns true if localStorage has no saved settings. */
function _isLocalEmpty(): boolean {
  return localStorage.getItem(SENTINEL_KEY) === null;
}

/** Flush pending upload immediately (for beforeunload). */
function _flushUpload(): void {
  if (!_syncEnabled || !_currentUid) return;
  if (_uploadTimer) { clearTimeout(_uploadTimer); _uploadTimer = null; }
  const settings = _gatherSettings();
  // Firestore REST API expects document format with typed fields
  const mapValue: Record<string, { stringValue: string }> = {};
  for (const [k, v] of Object.entries(settings)) {
    mapValue[k] = { stringValue: v };
  }
  const payload = JSON.stringify({
    fields: {
      settings: { mapValue: { fields: mapValue } },
    },
  });
  const url = `https://firestore.googleapis.com/v1/projects/luminal-game/databases/(default)/documents/users/${_currentUid}?updateMask.fieldPaths=settings`;
  // sendBeacon can't PATCH, so we fall back to fetch keepalive
  try {
     
    fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    });
  } catch (err) {
    net.warn('[settingsSync] Settings flush failed:', err);
  }
}

/** Schedule a debounced upload to Firestore. */
function _scheduleUpload(): void {
  if (!_syncEnabled || !_currentUid) return;
  if (_uploadTimer) clearTimeout(_uploadTimer);
  _uploadTimer = setTimeout(async () => {
    _uploadTimer = null;
    if (!_currentUid) return;
    try {
      const settings = _gatherSettings();
      await updateDoc(doc(db, 'users', _currentUid), { settings });
    } catch (e) {
      console.warn('[settingsSync] upload failed:', e);
    }
  }, DEBOUNCE_MS);
}

// ── Public API ───────────────────────────────────────────

/** Called by other modules after they write a syncable key to localStorage. */
export function notifySettingChanged(): void {
  _scheduleUpload();
}

/**
 * Enable sync for a real (non-anonymous) user.
 * If localStorage is empty and cachedSettings is provided, applies them
 * and dispatches EVT_SETTINGS_RESTORED so modules can re-read.
 * Otherwise schedules an upload as a backup.
 */
export function initSettingsSync(
  uid: string,
  cachedSettings?: Record<string, string> | null,
): void {
  if (!uid) return; // no-op without valid UID

  if (auth.currentUser && auth.currentUser.uid !== uid) {
    warnDev('settingsSync: UID mismatch', uid, 'vs', auth.currentUser.uid);
  }

  _currentUid = uid;
  _syncEnabled = true;

  if (_isLocalEmpty() && cachedSettings && Object.keys(cachedSettings).length > 0) {
    _applySettings(cachedSettings);
    window.dispatchEvent(new CustomEvent(EVT_SETTINGS_RESTORED));
  } else {
    // Local settings exist — upload as backup (debounced)
    _scheduleUpload();
  }

  // Remove any existing listener to prevent duplicates on re-init (BUG-7)
  window.removeEventListener('beforeunload', _flushUpload);
  window.addEventListener('beforeunload', _flushUpload);
}

/** Disable sync (on sign-out or switch to anonymous). */
export function stopSettingsSync(): void {
  _flushUpload();
  _syncEnabled = false;
  _currentUid = null;
  if (_uploadTimer) { clearTimeout(_uploadTimer); _uploadTimer = null; }
  window.removeEventListener('beforeunload', _flushUpload);
}

/** Reset all module-level state. For use in tests only. */
export function _resetForTesting(): void {
  _syncEnabled = false;
  _currentUid = null;
  if (_uploadTimer) { clearTimeout(_uploadTimer); _uploadTimer = null; }
  window.removeEventListener('beforeunload', _flushUpload);
}
