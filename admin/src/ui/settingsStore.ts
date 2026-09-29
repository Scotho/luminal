// ── Admin Dashboard Settings (localStorage-backed) ───────────────────────────

import { normalizeTheme } from './themeManager';

const STORAGE_KEY = 'luminal-admin-settings';
const LEGACY_THEME_KEY = 'luminal-admin-theme';

export interface AdminSettings {
  // Auto-refresh
  autoRefreshEnabled: boolean;
  autoRefreshIntervalMs: number;     // 60000 | 120000 | 300000 | 600000

  // Agent
  claudeTimeoutMin: number;          // 10 | 30 | 60
  maxConcurrentAgents: number;       // 1–5

  // Notifications
  toastDurationMs: number;           // 2000 | 4000 | 8000
  suppressToastsDuringChat: boolean;

  // Display
  defaultSection: string;            // section name to show on load
  theme: string;                     // theme preset key — see themeManager.ts
  fontFamily: string;                // font preset key — see fontLoader.ts

  // CC Panel
  ccTarget: 'cc' | 'aider';
  aiderMode: 'suggest' | 'auto';

  // Permission Gateway
  permissionGateway: boolean;
}

const DEFAULTS: AdminSettings = {
  autoRefreshEnabled: true,
  autoRefreshIntervalMs: 300000,      // 5 minutes
  claudeTimeoutMin: 30,
  maxConcurrentAgents: 3,
  toastDurationMs: 4000,
  suppressToastsDuringChat: true,
  defaultSection: 'live',
  theme: 'graphite',
  fontFamily: 'default',
  ccTarget: 'cc',
  aiderMode: 'suggest',
  permissionGateway: false,
};

let _settings: AdminSettings | null = null;
const _listeners = new Set<() => void>();

export function loadSettings(): AdminSettings {
  if (_settings) return _settings;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AdminSettings>;
      const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY);
      _settings = {
        ...DEFAULTS,
        ...parsed,
        theme: normalizeTheme(parsed.theme ?? legacyTheme ?? DEFAULTS.theme),
      };
    } else {
      _settings = {
        ...DEFAULTS,
        theme: normalizeTheme(localStorage.getItem(LEGACY_THEME_KEY) ?? DEFAULTS.theme),
      };
    }
  } catch {
    _settings = {
      ...DEFAULTS,
      theme: normalizeTheme(localStorage.getItem(LEGACY_THEME_KEY) ?? DEFAULTS.theme),
    };
  }
  return _settings;
}

export function saveSettings(updates: Partial<AdminSettings>): void {
  const current = loadSettings();
  Object.assign(current, updates);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  for (const cb of _listeners) cb();
}

export function onSettingsChange(cb: () => void): () => void {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}

/** Get a single setting value. */
export function getSetting<K extends keyof AdminSettings>(key: K): AdminSettings[K] {
  return loadSettings()[key];
}
