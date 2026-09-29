// ── Auto-Refresh Scheduler ───────────────────────────────────────────────────
//
// Periodically re-renders the active admin section if it's in the safe list.
// Only sections backed by local JSON files are auto-refreshed.
// Firebase/GitHub API sections require manual refresh.

import { loadSettings, onSettingsChange } from './settingsStore';

/** Sections safe to auto-refresh (local JSON, no external API). */
const AUTO_REFRESH_SECTIONS = new Set([
  'sessions', 'tasks', 'audits', 'e2e-matrix',
  'notes', 'links', 'notifications', 'pipeline',
]);

let _intervalId: ReturnType<typeof setInterval> | null = null;
let _getActiveSection: (() => string) | null = null;
let _refreshSection: ((section: string) => void) | null = null;

/** Start the auto-refresh scheduler. Call once from main.ts. */
export function initAutoRefresh(
  getActiveSection: () => string,
  refreshSection: (section: string) => void,
): void {
  _getActiveSection = getActiveSection;
  _refreshSection = refreshSection;
  _restart();
  onSettingsChange(_restart);
}

function _restart(): void {
  if (_intervalId) clearInterval(_intervalId);
  const settings = loadSettings();

  if (!settings.autoRefreshEnabled) {
    _intervalId = null;
    return;
  }

  _intervalId = setInterval(() => {
    if (!_getActiveSection || !_refreshSection) return;
    const active = _getActiveSection();
    if (AUTO_REFRESH_SECTIONS.has(active)) {
      _refreshSection(active);
    }
  }, settings.autoRefreshIntervalMs);
}

/** Check if a section supports auto-refresh. Used by settings UI. */
export function isAutoRefreshable(section: string): boolean {
  return AUTO_REFRESH_SECTIONS.has(section);
}
