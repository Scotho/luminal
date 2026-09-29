// ── Settings UI (Coordinator) ───────────────────────────
// Slim coordinator: holds state, getters, reset, restore listener,
// row-click cycling. Delegates to focused sub-modules.

import { playTick } from '../sfx';
import { notifySettingChanged } from '../settingsSync';
import { confirmButton } from './dom';
import { getLocalBool } from './storage';
import type { ToggleHandle } from './controls';
import { EVT_SETTINGS_RESTORED } from '../events';

import { initAudio, restoreAudio, resetAudioDefaults } from './settings/settingsAudio';
import { initGraphics, resetGraphicsDefaults } from './settings/settingsGraphics';
import { initRadar, applyRadarSize, updateRadarToggle as _updateRadarToggle, resetRadarDefaults } from './settings/settingsRadar';
import { initGameplay, restoreGameplay, resetGameplayDefaults } from './settings/settingsGameplay';
import type { GameplayHandles } from './settings/settingsGameplay';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GameInstance = any;

interface SettingsUIDeps {
  game: GameInstance;
}

// ── Injected deps (set via initSettingsUI) ──────────────
let _game: GameInstance = null;

// ── Module-level state ──────────────────────────────────
let radarEnabled: boolean = getLocalBool('luminal-radar-enabled', true);
let lineAssistEnabled: boolean = getLocalBool('luminal-lineassist', true);
let autoSubmitEnabled: boolean = getLocalBool('luminal-autosubmit', true);
let settingsSyncEnabled: boolean = getLocalBool('luminal-settings-sync', true);
let radarMobileHide: boolean = getLocalBool('luminal-radar-mobile-hide', true);

// Top bar section visibility (tbVisible tracked; tbMusic/tbOnline handled by onTbMusic/onTbOnline callbacks)
let tbVisible: boolean = getLocalBool('luminal-tb-visible', true);

// ── Toggle control handles (set in initSettingsUI) ──────
let radarToggleCtrl: ToggleHandle;
let radarMobileHideCtrl: ToggleHandle;
let _gameplayHandles: GameplayHandles;

// ── Radar Toggle wrapper (uses coordinator state) ───────
function updateRadarToggle(): void {
  _updateRadarToggle(_game, radarEnabled);
}

// ── Init ─────────────────────────────────────────────────
export function initSettingsUI(deps: SettingsUIDeps): void {
  _game = deps.game;

  // ── Sub-module init ────────────────────────────────────
  initAudio();

  initGraphics();

  const radarHandles = initRadar({
    game: _game,
    onRadarToggle(v) { radarEnabled = v; },
    onRadarMobileHide(v) { radarMobileHide = v; },
    getRadarEnabled() { return radarEnabled; },
  });
  radarToggleCtrl = radarHandles.radarToggleCtrl;
  radarMobileHideCtrl = radarHandles.radarMobileHideCtrl;
  _game.radarMobileHide = radarMobileHide;

  _gameplayHandles = initGameplay({
    game: _game,
    onLineAssist(v) { lineAssistEnabled = v; },
    onAutoSubmit(v) { autoSubmitEnabled = v; },
    onSettingsSync(v) { settingsSyncEnabled = v; },
    onTbVisible(v) { tbVisible = v; },
    onTbMusic(_v) {},
    onTbOnline(_v) {},
  });

  // ── Slider Default Notches ─────────────────────────────
  document.querySelectorAll('.slider-wrap').forEach((wrap: Element) => {
    const input: HTMLInputElement | null = wrap.querySelector('input[type="range"]');
    const notch: HTMLElement | null = wrap.querySelector('.slider-notch');
    if (!input || !notch) return;
    const def: number = Number(input.dataset.default);
    const min: number = Number(input.min);
    const max: number = Number(input.max);
    const pct: number = ((def - min) / (max - min)) * 100;
    notch.style.left = pct + '%';
  });

  // ── Reset to Defaults ───────────────────────────────────
  confirmButton(document.getElementById('btn-settings-reset')!, () => {
    // Sliders: reset to data-default attribute values
    document.querySelectorAll('#settings-overlay input[type="range"]').forEach((el: Element) => {
      const input: HTMLInputElement = el as HTMLInputElement;
      const def: string | undefined = input.dataset.default;
      if (def) {
        input.value = def;
        input.dispatchEvent(new Event('input'));
        input.dispatchEvent(new Event('change'));
      }
    });

    // Delegate to sub-modules
    resetAudioDefaults();
    resetGraphicsDefaults();
    resetRadarDefaults();

    // Radar toggles (coordinator state)
    radarEnabled = true;
    radarToggleCtrl.setValue('on');
    updateRadarToggle();

    radarMobileHide = true;
    radarMobileHideCtrl.setValue('on');
    _game.radarMobileHide = radarMobileHide;

    // Gameplay toggles (coordinator state)
    lineAssistEnabled = true;
    autoSubmitEnabled = true;
    settingsSyncEnabled = true;
    tbVisible = true;

    resetGameplayDefaults(_gameplayHandles);

    notifySettingChanged();
    playTick();
  });

  // ── Mobile reset button (delegates to desktop reset) ───────────────────
  const mobileResetBtn = document.getElementById('btn-settings-reset-mobile');
  if (mobileResetBtn) {
    confirmButton(mobileResetBtn, () => {
      document.getElementById('btn-settings-reset')?.click();
    });
  }

  // ── Re-read settings after server restore (new device / cleared storage)
  window.addEventListener(EVT_SETTINGS_RESTORED, () => {
    // Radar
    radarEnabled = getLocalBool('luminal-radar-enabled', true);
    radarToggleCtrl.setValue(radarEnabled ? 'on' : 'off');
    updateRadarToggle();

    radarMobileHide = getLocalBool('luminal-radar-mobile-hide', true);
    radarMobileHideCtrl.setValue(radarMobileHide ? 'on' : 'off');
    _game.radarMobileHide = radarMobileHide;

    // Gameplay toggles
    lineAssistEnabled = getLocalBool('luminal-lineassist', true);
    _gameplayHandles.lineAssistCtrl.setValue(lineAssistEnabled ? 'on' : 'off');

    autoSubmitEnabled = getLocalBool('luminal-autosubmit', true);
    _gameplayHandles.autoSubmitCtrl.setValue(autoSubmitEnabled ? 'on' : 'off');

    settingsSyncEnabled = getLocalBool('luminal-settings-sync', true);
    _gameplayHandles.syncCtrl.setValue(settingsSyncEnabled ? 'on' : 'off');

    // Audio sliders
    restoreAudio();

    // Camera / shake sliders
    restoreGameplay(_gameplayHandles);

    // Radar size
    const savedSize = localStorage.getItem('luminal-radar-size');
    if (savedSize) {
      (document.getElementById('radar-size') as HTMLInputElement).value = savedSize;
      applyRadarSize(Number(savedSize));
    }
  });

  // ── Row-click toggle cycling (delegated) ─────────────────
  // Clicking anywhere on a setting-row that contains a two-option
  // toggle will cycle it, so users don't have to hit the small toggle.
  const settingsBody = document.getElementById('settings-content-body');
  if (settingsBody) {
    settingsBody.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      // Skip if the click was directly on a toggle option (handled by toggle itself)
      if (target.closest('.control-toggle')) return;
      // Skip if the click was on an arrow / select / slider / button
      if (target.closest('.setting-select, .setting-arrow, .slider-wrap, .menu-btn, input')) return;
      const row = target.closest('.setting-row') as HTMLElement | null;
      if (!row) return;
      const toggle = row.querySelector('.control-toggle') as HTMLElement | null;
      if (!toggle) return;
      const opts = Array.from(toggle.querySelectorAll('.control-toggle__option')) as HTMLElement[];
      if (opts.length !== 2) return;
      // Find current active and cycle to next
      const activeIdx = opts.findIndex(o => o.classList.contains('control-toggle__option--active'));
      const nextOpt = opts[(activeIdx + 1) % opts.length];
      nextOpt.click();
    });
  }
}

// ── Getters for module-level state ──────────────────────
export function getRadarEnabled(): boolean { return radarEnabled; }
export function getRadarMobileHide(): boolean { return radarMobileHide; }
export function getLineAssistEnabled(): boolean { return lineAssistEnabled; }
export function getAutoSubmitEnabled(): boolean { return autoSubmitEnabled; }
export function getSettingsSyncEnabled(): boolean { return settingsSyncEnabled; }
export function getTopBarVisible(): boolean { return tbVisible; }

// ── Re-exports for external use ─────────────────────────
export { applyRadarSize, updateRadarToggle };
