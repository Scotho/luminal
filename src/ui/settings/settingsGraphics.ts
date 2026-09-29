// ── Settings: Graphics ──────────────────────────────────
// Graphics preset toggle, per-setting arrows, and label updates.

import { playTick } from '../../sfx';
import { getGfx, setPreset, setSetting, PRESET_NAMES, BLOOM_LEVEL_NAMES, BLOOM_PRESETS, getBloomLevel, PIXEL_RATIO_OPTIONS, ARENA_DETAIL_OPTIONS, RAVE_OPTIONS, REACTIVITY_OPTIONS, VFX_OPTIONS, LIGHTING_OPTIONS, ATMOSPHERE_OPTIONS } from '../../graphics';
import type { GfxSettings, PresetName } from '../../types/index';

// ── Toggle Helper (local copy — same logic as coordinator) ──
function _setToggleActive(toggleEl: HTMLElement, activeVal: string): void {
  toggleEl.querySelectorAll('.control-toggle__option').forEach((opt: Element) => {
    (opt as HTMLElement).classList.toggle('control-toggle__option--active', (opt as HTMLElement).dataset.val === String(activeVal));
  });
}

// ── State ────────────────────────────────────────────────
let _presetToggle: HTMLElement | null = null;

function _updateGfxLabels(): void {
  const g: GfxSettings = getGfx();
  _setToggleActive(_presetToggle!, g.preset || 'custom');
  document.getElementById('gfx-bloom-label')!.textContent = getBloomLevel().toUpperCase();
  document.getElementById('gfx-pr-label')!.textContent = String(g.pixelRatio) + 'X';
  document.getElementById('gfx-arena-label')!.textContent = g.arenaDetail.toUpperCase();
  document.getElementById('gfx-rave-label')!.textContent = String(g.raveSpotlights);
  document.getElementById('gfx-react-label')!.textContent = g.audioReactivity.toUpperCase();
  document.getElementById('gfx-vfx-label')!.textContent = g.playerVFX.toUpperCase();
  document.getElementById('gfx-light-label')!.textContent = g.lighting.toUpperCase();
  document.getElementById('gfx-atmo-label')!.textContent = g.atmosphere.toUpperCase();
}

// ── Init ─────────────────────────────────────────────────
export function initGraphics(): void {
  function _cycleSetting<T>(options: T[], current: T, dir: number): T {
    let idx: number = options.indexOf(current);
    if (idx === -1) idx = 0;
    idx = Math.max(0, Math.min(options.length - 1, idx + dir));
    return options[idx];
  }

  _presetToggle = document.getElementById('gfx-preset-toggle');

  // Preset segmented toggle
  _presetToggle!.addEventListener('click', (e: Event) => {
    const opt: HTMLElement | null = (e.target as HTMLElement).closest('.control-toggle__option');
    if (!opt) return;
    e.stopPropagation();
    const val: string = opt.dataset.val!;
    if ((PRESET_NAMES as string[]).includes(val) && val !== getGfx().preset) {
      setPreset(val as PresetName); _updateGfxLabels(); playTick();
    }
  });

  // Individual setting arrows — helper
  function _wireArrowSetting<T extends string | number | boolean>(idPrefix: string, key: keyof GfxSettings, options: T[]): void {
    document.getElementById(idPrefix + '-left')!.addEventListener('click', () => {
      const next: T = _cycleSetting(options, getGfx()[key] as T, -1);
      setSetting(key, next); _updateGfxLabels(); playTick();
    });
    document.getElementById(idPrefix + '-right')!.addEventListener('click', () => {
      const next: T = _cycleSetting(options, getGfx()[key] as T, 1);
      setSetting(key, next); _updateGfxLabels(); playTick();
    });
  }

  // Bloom arrows — cycles through named bloom presets
  document.getElementById('gfx-bloom-left')!.addEventListener('click', () => {
    const idx: number = Math.max(0, BLOOM_LEVEL_NAMES.indexOf(getBloomLevel()) - 1);
    setSetting('bloom', BLOOM_PRESETS[BLOOM_LEVEL_NAMES[idx]]); _updateGfxLabels(); playTick();
  });
  document.getElementById('gfx-bloom-right')!.addEventListener('click', () => {
    const idx: number = Math.min(BLOOM_LEVEL_NAMES.length - 1, BLOOM_LEVEL_NAMES.indexOf(getBloomLevel()) + 1);
    setSetting('bloom', BLOOM_PRESETS[BLOOM_LEVEL_NAMES[idx]]); _updateGfxLabels(); playTick();
  });
  _wireArrowSetting('gfx-pr', 'pixelRatio', PIXEL_RATIO_OPTIONS);
  _wireArrowSetting('gfx-arena', 'arenaDetail', ARENA_DETAIL_OPTIONS);
  _wireArrowSetting('gfx-rave', 'raveSpotlights', RAVE_OPTIONS);
  _wireArrowSetting('gfx-react', 'audioReactivity', REACTIVITY_OPTIONS);
  _wireArrowSetting('gfx-vfx', 'playerVFX', VFX_OPTIONS);
  _wireArrowSetting('gfx-light', 'lighting', LIGHTING_OPTIONS);
  _wireArrowSetting('gfx-atmo', 'atmosphere', ATMOSPHERE_OPTIONS);

  // Populate labels on load
  _updateGfxLabels();
}

// ── Reset to Defaults ────────────────────────────────────
export function resetGraphicsDefaults(): void {
  setPreset('high' as PresetName);
  _updateGfxLabels();
}
