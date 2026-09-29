// ── Settings Navigation ───────────────────────────────────
// Manages tab switching, per-tab focus index, and focus highlight
// for the full-page settings screen.

import { playUiTab } from '../sfx';
import { isGamepadConnected } from '../gamepad';

export const SETTINGS_TABS = [
  'gameplay', 'video', 'audio', 'camera', 'controls', 'hud', 'account',
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

const TAB_DESCRIPTIONS: Record<SettingsTab, string> = {
  gameplay: 'Assists and match behavior',
  video: 'Graphics quality and visual effects',
  audio: 'Volume levels',
  camera: 'Field of view and distance',
  controls: 'Input method and key bindings',
  hud: 'Minimap, top bar, and performance overlays',
  account: 'Cloud sync and data management',
};

let _activeTab: SettingsTab = 'video';
const _focusIndices: Record<SettingsTab, number> = {
  gameplay: 0, video: 0, audio: 0, camera: 0, controls: 0, hud: 0, account: 0,
};

let _mobileSubpageOpen = false;

/** Whether the mobile category list is showing (vs a sub-page). */
export function isMobileSubpageOpen(): boolean { return _mobileSubpageOpen; }

function _isMobile(): boolean {
  return window.matchMedia('(max-width: 768px)').matches;
}

// ── Tab switching ────────────────────────────────────────

// ts-prune-ignore-next
export function getActiveTab(): SettingsTab { return _activeTab; }

export function switchTab(tab: SettingsTab): void {
  if (tab === _activeTab) return;
  _activeTab = tab;
  _syncTabDOM();
  _syncFocusDOM();
  playUiTab();
}

export function cycleTab(dir: 1 | -1): void {
  const idx = SETTINGS_TABS.indexOf(_activeTab);
  const next = (idx + dir + SETTINGS_TABS.length) % SETTINGS_TABS.length;
  switchTab(SETTINGS_TABS[next]);
}

/** Mobile: open a category sub-page (hides category list, shows content). */
export function openMobileSubpage(tab: SettingsTab): void {
  _activeTab = tab;
  _mobileSubpageOpen = true;
  _syncTabDOM();
  _syncMobileLayout();
  _syncFocusDOM();
  _relocateDynBack();
  playUiTab();
}

/** Mobile: return to the category list (hides content, shows list). */
export function closeMobileSubpage(): void {
  _mobileSubpageOpen = false;
  _syncMobileLayout();
  _relocateDynBack();
}

function _syncMobileLayout(): void {
  const overlay = document.getElementById('settings-overlay');
  if (!overlay) return;
  overlay.classList.toggle('settings--subpage', _mobileSubpageOpen);
}

/** Move dyn-back between category header and content header depending on subpage state. */
function _relocateDynBack(): void {
  const btn = document.getElementById('dyn-back');
  if (!btn) return;
  const overlay = document.getElementById('settings-overlay');
  if (!overlay) return;
  if (_mobileSubpageOpen) {
    const contentHeader = overlay.querySelector('.settings-content-header');
    if (contentHeader) { contentHeader.prepend(btn); btn.style.display = ''; }
  } else {
    const catHeader = overlay.querySelector('.settings-cat-header');
    if (catHeader) { catHeader.prepend(btn); btn.style.display = ''; }
  }
}

// ── Focus management ─────────────────────────────────────

export function getFocusIndex(): number { return _focusIndices[_activeTab]; }

export function moveFocus(dir: 1 | -1): void {
  const rows = _getSettingRows();
  if (rows.length === 0) return;
  let idx = _focusIndices[_activeTab] + dir;
  // Wrap
  if (idx < 0) idx = rows.length - 1;
  if (idx >= rows.length) idx = 0;
  _focusIndices[_activeTab] = idx;
  _syncFocusDOM();
}

export function resetFocus(): void {
  _focusIndices[_activeTab] = 0;
  _syncFocusDOM();
}

/** Returns the currently focused DOM row, or null. */
export function getFocusedRow(): HTMLElement | null {
  const rows = _getSettingRows();
  return rows[_focusIndices[_activeTab]] ?? null;
}

// ── DOM sync helpers ─────────────────────────────────────

function _getSettingRows(): HTMLElement[] {
  const tabContent = document.getElementById('settings-tab-' + _activeTab);
  if (!tabContent) return [];
  return Array.from(tabContent.querySelectorAll('.setting-row')) as HTMLElement[];
}

function _syncTabDOM(): void {
  // Sidebar items
  document.querySelectorAll('.settings-sidebar-item').forEach((el) => {
    const tab = (el as HTMLElement).dataset.tab as SettingsTab;
    const isActive = tab === _activeTab;
    (el as HTMLElement).classList.toggle('settings-sidebar-item--active', isActive);
    el.setAttribute('aria-selected', String(isActive));
    (el as HTMLElement).tabIndex = isActive ? 0 : -1;
  });
  // Tab content panels
  SETTINGS_TABS.forEach((t) => {
    const panel = document.getElementById('settings-tab-' + t);
    if (panel) panel.classList.toggle('hidden', t !== _activeTab);
  });
  // Header text
  const titleEl = document.getElementById('settings-content-title');
  if (titleEl) titleEl.textContent = _activeTab.toUpperCase();
  const descEl = document.getElementById('settings-content-desc');
  if (descEl) descEl.textContent = TAB_DESCRIPTIONS[_activeTab];
}

function _syncFocusDOM(): void {
  // Clear all focus highlights in current tab
  const rows = _getSettingRows();
  rows.forEach((r, i) => {
    r.classList.toggle('setting-row--focused', i === _focusIndices[_activeTab]);
  });
  // Scroll focused row into view (guard: jsdom does not implement scrollIntoView)
  const focused = rows[_focusIndices[_activeTab]];
  if (focused && typeof focused.scrollIntoView === 'function') {
    focused.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

/** Resets module state to defaults — for use in tests only. */
export function _resetForTesting(): void {
  _activeTab = 'video';
  _mobileSubpageOpen = false;
  (Object.keys(_focusIndices) as SettingsTab[]).forEach((k) => { _focusIndices[k] = 0; });
  _syncMobileLayout();
}

/** Call once on settings screen show to sync initial state. */
export function initSettingsNav(): void {
  _syncTabDOM();
  _syncFocusDOM();
  // Wire sidebar clicks
  document.querySelectorAll('.settings-sidebar-item').forEach((el) => {
    el.addEventListener('click', () => {
      const tab = (el as HTMLElement).dataset.tab as SettingsTab;
      if (tab) switchTab(tab);
    });
  });
  // Wire mobile category row clicks
  document.querySelectorAll('.settings-cat-row').forEach((el) => {
    el.addEventListener('click', () => {
      const tab = (el as HTMLElement).dataset.tab as SettingsTab;
      if (tab && _isMobile()) openMobileSubpage(tab);
    });
  });
  // Show bumper hints only when a controller is connected
  const bumpers = document.querySelector('.settings-sidebar-bumpers');
  if (bumpers) bumpers.classList.toggle('settings-bumpers--visible', isGamepadConnected());
}
