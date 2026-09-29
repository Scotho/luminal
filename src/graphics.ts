// ── Graphics Quality Settings ────────────────────────────
// Central module: presets, per-setting overrides, localStorage persistence, observer pattern.

import { EVT_SETTINGS_RESTORED } from './events';
import type { GfxSettings, PresetName, SettingsListener, BloomLevel, BloomSettings, AtmosphereLevel, MapType } from './types/index';
import type * as THREE from 'three';
import type { RenderComposer } from './types/index';
import { notifySettingChanged } from './settingsSync';
import { warnDev } from './swallow';

// ── Bloom presets (pmndrs/postprocessing — mipmapBlur) ───
// Lower thresholds let environment emissives bloom; mipmapBlur keeps
// small emissives (vehicles, trails) tight rather than washed out.
export const BLOOM_PRESETS: Record<BloomLevel, BloomSettings> = {
  off:   { strength: 0,   radius: 0.4,  threshold: 0.25, vehiclesMul: 0.15, trailsMul: 0.8, environmentMul: 1.8, lightsMul: 3, enabled: false, vehiclesOn: true, trailsOn: true, environmentOn: true, lightsOn: true },
  low:   { strength: 0.6, radius: 0.35, threshold: 0.25, vehiclesMul: 0.15, trailsMul: 0.8, environmentMul: 1.8, lightsMul: 3, enabled: true,  vehiclesOn: true, trailsOn: true, environmentOn: true, lightsOn: true },
  high:  { strength: 1.0, radius: 0.5,  threshold: 0.18, vehiclesMul: 0.15, trailsMul: 0.8, environmentMul: 2.0, lightsMul: 3, enabled: true,  vehiclesOn: true, trailsOn: true, environmentOn: true, lightsOn: true },
  ultra: { strength: 1.1, radius: 0.55, threshold: 0.16, vehiclesMul: 0.15, trailsMul: 0.8, environmentMul: 2.2, lightsMul: 3, enabled: true,  vehiclesOn: true, trailsOn: true, environmentOn: true, lightsOn: true },
};

const PRESETS: Record<string, Omit<GfxSettings, 'preset'>> = {
  low:    { bloom: { ...BLOOM_PRESETS.off },   antialias: false, pixelRatio: 1.0, arenaDetail: 'minimal', raveSpotlights: 0, audioReactivity: 'off',     playerVFX: 'off',     lighting: 'minimal', atmosphere: 'off',  reflections: 'off' },
  medium: { bloom: { ...BLOOM_PRESETS.low },   antialias: false, pixelRatio: 1.5, arenaDetail: 'reduced', raveSpotlights: 2, audioReactivity: 'reduced', playerVFX: 'reduced', lighting: 'reduced', atmosphere: 'haze', reflections: 'off' },
  high:   { bloom: { ...BLOOM_PRESETS.high },  antialias: true,  pixelRatio: 2.0, arenaDetail: 'full',    raveSpotlights: 0, audioReactivity: 'reduced', playerVFX: 'full',    lighting: 'full',    atmosphere: 'haze', reflections: 'high' },
  ultra:  { bloom: { ...BLOOM_PRESETS.ultra }, antialias: true,  pixelRatio: 2.0, arenaDetail: 'full',    raveSpotlights: 0, audioReactivity: 'reduced', playerVFX: 'full',    lighting: 'full',    atmosphere: 'haze', reflections: 'ultra' },
};

const SETTING_KEYS: string[] = Object.keys(PRESETS.low);
const PREFIX: string = 'luminal-gfx-';

const settings: GfxSettings = { ...PRESETS.high, preset: 'high' };
const listeners: SettingsListener[] = [];

// Helper for dynamic key access on settings/presets.
// GfxSettings is a plain object whose keys are statically known (SETTING_KEYS),
// so indexing by string is safe within this module. We use a single widening cast
// rather than the double as-unknown-as pattern.
const asRec = (obj: GfxSettings | Omit<GfxSettings, 'preset'>): Record<string, unknown> =>
  obj as Record<string, unknown>;

// ── Helpers ──────────────────────────────────────────────

function detectMatchingPreset(): PresetName {
  for (const [name, preset] of Object.entries(PRESETS)) {
    if (SETTING_KEYS.every(k => {
      const a = asRec(settings)[k], b = asRec(preset)[k];
      return typeof a === 'object' ? JSON.stringify(a) === JSON.stringify(b) : a === b;
    })) return name as PresetName;
  }
  return 'custom';
}

function save(): void {
  localStorage.setItem(PREFIX + 'preset', settings.preset);
  for (const k of SETTING_KEYS) {
    localStorage.setItem(PREFIX + k, JSON.stringify(asRec(settings)[k]));
  }
  notifySettingChanged();
}

function notify(): void {
  for (const cb of listeners) cb(settings);
}

// ── Public API ───────────────────────────────────────────

export function getGfx(): GfxSettings {
  return settings;
}

export function setPreset(level: PresetName): void {
  const p = PRESETS[level];
  if (!p) return;
  for (const k of SETTING_KEYS) {
    const v = asRec(p)[k];
    asRec(settings)[k] = typeof v === 'object' && v !== null ? { ...v } : v;
  }
  settings.preset = level;
  save();
  notify();
}

export function setSetting(key: string, value: string | number | boolean | BloomSettings): void {
  if (!SETTING_KEYS.includes(key)) return;
  asRec(settings)[key] = typeof value === 'object' && value !== null ? { ...value } : value;
  settings.preset = detectMatchingPreset();
  save();
  notify();
}

export function onSettingsChange(cb: SettingsListener): void {
  listeners.push(cb);
}

export function loadSettings(): boolean {
  const saved: string | null = localStorage.getItem(PREFIX + 'preset');
  if (!saved) return false; // no saved settings — caller should auto-detect

  if (saved !== 'custom' && PRESETS[saved]) {
    // Load from preset — deep-copy objects
    for (const k of SETTING_KEYS) {
      const v = asRec(PRESETS[saved])[k];
      asRec(settings)[k] = typeof v === 'object' && v !== null ? { ...v } : v;
    }
    settings.preset = saved as PresetName;
  } else {
    // Load individual keys
    for (const k of SETTING_KEYS) {
      const v: string | null = localStorage.getItem(PREFIX + k);
      if (v !== null) {
        try { asRec(settings)[k] = JSON.parse(v); } catch (err) {
          warnDev(`graphics: invalid stored setting ${k}, keeping default`, err);
        }
      }
    }
    // Migrate legacy string bloom level → BloomSettings object
    if (typeof settings.bloom === 'string') {
      const level = settings.bloom as unknown as BloomLevel;
      settings.bloom = { ...(BLOOM_PRESETS[level] ?? BLOOM_PRESETS.high) };
    }
    settings.preset = detectMatchingPreset();
  }
  return true;
}

/** Run once on first visit to pick an appropriate default preset.
 *  Renders a few frames with a minimal scene and measures frame time. */
export function detectPreset(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, composer: RenderComposer): void {
  if (localStorage.getItem(PREFIX + 'preset')) return; // already saved

  // On touch/mobile devices, skip the GPU benchmark entirely — the synchronous
  // readPixels loop causes memory spikes that crash iOS Safari.
  const isTouch: boolean = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (isTouch) {
    setPreset('medium');
    return;
  }

  try {
    // Warm up — discard first frame
    composer.render();

    const samples: number = 8;
    const times: number[] = [];
    for (let i = 0; i < samples; i++) {
      const t0: number = performance.now();
      composer.render();
      // Force GPU sync via readPixels on a tiny area
      const gl: WebGLRenderingContext = renderer.getContext() as WebGLRenderingContext;
      const buf: Uint8Array = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      times.push(performance.now() - t0);
    }

    // Drop highest and lowest, average the rest
    times.sort((a: number, b: number) => a - b);
    const trimmed: number[] = times.slice(1, -1);
    const avg: number = trimmed.reduce((a: number, b: number) => a + b, 0) / trimmed.length;

    let level: PresetName;
    if (avg > 16) level = 'low';
    else if (avg > 10) level = 'medium';
    else if (avg > 5) level = 'high';
    else level = 'ultra';

    setPreset(level);
  } catch {
    setPreset('high'); // fallback
  }
}

export const PRESET_NAMES: PresetName[] = ['low', 'medium', 'high', 'ultra'];
export const BLOOM_LEVEL_NAMES: BloomLevel[] = ['off', 'low', 'high', 'ultra'];
export const PIXEL_RATIO_OPTIONS: number[] = [1.0, 1.5, 2.0];
export const ARENA_DETAIL_OPTIONS: string[] = ['minimal', 'reduced', 'full'];
export const RAVE_OPTIONS: number[] = [0, 4, 8];
export const REACTIVITY_OPTIONS: string[] = ['off', 'reduced', 'full'];
export const VFX_OPTIONS: string[] = ['off', 'reduced', 'full'];
export const LIGHTING_OPTIONS: string[] = ['minimal', 'reduced', 'full'];
export const ATMOSPHERE_OPTIONS: AtmosphereLevel[] = ['off', 'haze', 'full'];

/** Derive the named bloom tier from the current bloom settings (matches by strength). */
export function getBloomLevel(): BloomLevel {
  const s = settings.bloom.strength;
  for (const [level, preset] of Object.entries(BLOOM_PRESETS)) {
    if (preset.strength === s) return level as BloomLevel;
  }
  return settings.bloom.enabled ? 'high' : 'off';
}

// ── Per-map bloom category override ─────────────────────
// Set by setActiveBloomMap (called from scene.ts via applyMapBloomOverride).
// bloomMul reads from the map override first, falls back to user preset.
let _activeBloomMap: MapType = 'midtown_bowl';

/** Called from scene.ts when the active map changes so bloomMul picks up
 *  per-map category multipliers (e.g. synth_city vehiclesMul: 0.15). */
export function setActiveBloomMap(mapType: MapType): void {
  _activeBloomMap = mapType;
}

/** Live accessor for per-category effective multipliers.
 *  Checks the active map's MAP_TUNING.bloom override first, then the user preset. */
export const bloomMul = {
  get vehicles(): number {
    const b = getGfx().bloom;
    if (!b.vehiclesOn) return 0;
    return MAP_TUNING[_activeBloomMap]?.bloom?.vehiclesMul ?? b.vehiclesMul;
  },
  get trails(): number {
    const b = getGfx().bloom;
    if (!b.trailsOn) return 0;
    return MAP_TUNING[_activeBloomMap]?.bloom?.trailsMul ?? b.trailsMul;
  },
  get environment(): number {
    const b = getGfx().bloom;
    if (!b.environmentOn) return 0;
    return MAP_TUNING[_activeBloomMap]?.bloom?.environmentMul ?? b.environmentMul;
  },
  get lights(): number {
    const b = getGfx().bloom;
    if (!b.lightsOn) return 0;
    return MAP_TUNING[_activeBloomMap]?.bloom?.lightsMul ?? b.lightsMul;
  },
};

// ── Per-preset visual tuning ────────────────────────────
// Values tuned via admin panel, baked here for each quality tier.
export interface VisualTuning {
  exposure: number;
  neonEmissive: number;
  // Trail
  wallEmissive: number;
  // Vehicle
  bikeLightInt: number;
  underGlowInt: number;
  rimStrength: number;   // Fresnel rim-light strength; 0 disables
  rimPower: number;      // Fresnel sharpness (higher = thinner rim)
  rimAIMult: number;     // AI vehicles get rimStrength * this
  // Floor reflector
  floorReflectStrength: number;
  floorEmissiveIntensity: number;
  floorRoughness: number;
}

export const VISUAL_TUNING: Record<string, VisualTuning> = {
  low: {
    exposure: 1.10, neonEmissive: 3.0,
    wallEmissive: 1.5,
    bikeLightInt: 0.9, underGlowInt: 1.1,
    rimStrength: 0.3, rimPower: 3.5, rimAIMult: 0.7,
    floorReflectStrength: 0.55, floorEmissiveIntensity: 0.42, floorRoughness: 0.0,
  },
  medium: {
    exposure: 1.2, neonEmissive: 4.0,
    wallEmissive: 2.5,
    bikeLightInt: 1.5, underGlowInt: 1.9,
    rimStrength: 0.4, rimPower: 3.2, rimAIMult: 0.7,
    floorReflectStrength: 0.7, floorEmissiveIntensity: 0.8, floorRoughness: 0.4,
  },
  high: {
    exposure: 1.25, neonEmissive: 5.0,
    wallEmissive: 3.0,
    bikeLightInt: 2.0, underGlowInt: 2.3,
    rimStrength: 0.5, rimPower: 3.0, rimAIMult: 0.75,
    floorReflectStrength: 0.76, floorEmissiveIntensity: 2.0, floorRoughness: 0.14,
  },
  ultra: {
    exposure: 0.95, neonEmissive: 5.0,
    wallEmissive: 3.75,
    bikeLightInt: 2.4, underGlowInt: 2.8,
    rimStrength: 0.6, rimPower: 2.8, rimAIMult: 0.8,
    floorReflectStrength: 0.76, floorEmissiveIntensity: 2.0, floorRoughness: 0.14,
  },
};

// ── Per-map floor/reflection tuning ───────────────────────
// Authoritative source for map-specific floor + reflection values.
// Admin panel sliders read initial values from here and write back on change,
// so a copy-paste loop captures per-map tweaks. Bump via admin flyout then bake.
export interface MapTuning {
  floorReflectStrength: number;
  floorEmissiveIntensity: number;
  floorRoughness: number;
  reflectionsIntensity: number;  // scalar applied to Reflector 'color' uniform
  reflectionsYOffset: number;    // reflector plane y position
  reflectionsClipBias: number;   // Reflector clipBias (near-plane epsilon)
  /** Optional per-map bloom override. When set, replaces the user's gfx.bloom
   *  settings while this map is active. Cleared automatically on map switch.
   *  Admin sliders still write to gfx.bloom, but their effect is shadowed
   *  until the user switches to a map without an override. */
  bloom?: {
    strength: number;
    radius: number;
    threshold: number;
    vehiclesMul?: number;
    trailsMul?: number;
    environmentMul?: number;
    lightsMul?: number;
  };
}

export const MAP_TUNING: Record<MapType, MapTuning> = {
  synth_pit: {
    floorReflectStrength: 0.8,
    floorEmissiveIntensity: 2.0,
    floorRoughness: 0.46,
    reflectionsIntensity: 0.07,
    reflectionsYOffset: 0,
    reflectionsClipBias: 0.003,
  },
  midtown_bowl: {
    floorReflectStrength: 0.94,
    floorEmissiveIntensity: 0.8,
    floorRoughness: 0.12,
    reflectionsIntensity: 0.78,
    reflectionsYOffset: 0,
    reflectionsClipBias: 0.009,
    bloom: {
      strength: 0.34,
      radius: 0.20,
      threshold: 0.15,
      vehiclesMul: 1.0,
      trailsMul: 2.1,
      environmentMul: 0.45,
      lightsMul: 1.5,
    },
  },
  synth_city: {
    floorReflectStrength: 0.85,
    floorEmissiveIntensity: 2.0,
    floorRoughness: 0.35,
    reflectionsIntensity: 0.65,
    reflectionsYOffset: 0,
    reflectionsClipBias: 0.004,
    bloom: {
      strength: 3.4,
      radius: 0.87,
      threshold: 0.17,
      vehiclesMul: 0.15,
    },
  },
};

// Re-read settings when restored from server (new device / cleared storage)
window.addEventListener(EVT_SETTINGS_RESTORED, () => {
  if (loadSettings()) notify();
});
