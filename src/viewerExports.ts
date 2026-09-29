// ── Barrel exports for admin model viewer ─────────────────
// This file is the ONLY import boundary between admin/ and src/.
// Everything the viewer needs flows through here.

import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';
import type { SceneBundle, BloomPassLike, GfxSettings } from './types/index';
import { getGfx, VISUAL_TUNING } from './graphics';

// ── Config re-exports ───────────────────────────────────
// ts-prune-ignore-next
export { VISUAL_TUNING, BLOOM_PRESETS, BLOOM_LEVEL_NAMES, getBloomLevel, PRESET_NAMES, getGfx, setPreset } from './graphics';
// ts-prune-ignore-next
export { LOADOUT_DISPLAY_NAMES, getVehiclePhysics } from './vehicleConfig';
// ts-prune-ignore-next
export type { VehiclePhysics } from './vehicleConfig';
// ts-prune-ignore-next
export type { SceneBundle, BloomPassLike, GfxSettings, PresetName, BloomLevel, BloomSettings, VehicleType } from './types/index';

// ── Model re-exports ──────────────────────────────────
// ts-prune-ignore-next
export { loadBikeModel, cloneBikeModel, isBikeModelLoaded, getBikeModelHeight } from './bikeModel';
// ts-prune-ignore-next
export { loadCarModel, cloneCarModel, isCarModelLoaded } from './carModel';
// ts-prune-ignore-next
export { loadHoverboardModel, cloneHoverboardModel, isHoverboardModelLoaded, getHoverboardModelHeight, HOVER_FACING_OFFSET } from './hoverboardModel';
// ts-prune-ignore-next
export { HoverboardAnimator, HoverAnimState } from './hoverboardAnimator';
// ts-prune-ignore-next
export type { HoverAnimInput } from './hoverboardAnimator';
// ts-prune-ignore-next
export { BikeAnimator, BikeAnimState } from './bikeAnimator';
// ts-prune-ignore-next
export type { BikeAnimInput } from './bikeAnimator';
// ts-prune-ignore-next
export { CarAnimator, CarAnimState } from './carAnimator';
// ts-prune-ignore-next
export type { CarAnimInput } from './carAnimator';

// ── Viewer-specific scene factory ───────────────────────
// Unlike createScene() in scene.ts, this targets a container element
// instead of document.body and sizes to the container, not the window.

// ts-prune-ignore-next
export function createViewerScene(container: HTMLElement): SceneBundle {
  const gfx: GfxSettings = getGfx();
  const w = container.clientWidth;
  const h = container.clientHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: gfx.antialias, powerPreference: 'default' });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, gfx.pixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = (VISUAL_TUNING[gfx.preset] ?? VISUAL_TUNING.high).exposure;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020305);

  const camera = new THREE.PerspectiveCamera(72, w / h, 0.3, 800);

  // Lighting — matches main project scene.ts
  scene.add(new THREE.AmbientLight(0x0B363D, 0.75));
  const dirLight = new THREE.DirectionalLight(0x245160, 0.65);
  dirLight.position.set(20, 80, 30);
  scene.add(dirLight);
  scene.add(new THREE.HemisphereLight(0x021214, 0x0a1a1c, 0.5));

  // Post-processing: pmndrs/postprocessing (matches main scene pipeline)
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomEffect = new BloomEffect({
    intensity: gfx.bloom.strength,
    radius: gfx.bloom.radius,
    luminanceThreshold: gfx.bloom.threshold,
    luminanceSmoothing: 0.2,
    mipmapBlur: true,
  });
  const effectPass = new EffectPass(camera, bloomEffect);
  effectPass.enabled = gfx.bloom.enabled;
  composer.addPass(effectPass);

  const bloomPass: BloomPassLike = {
    get strength() { return bloomEffect.intensity; },
    set strength(v) { bloomEffect.intensity = v; },
    get radius() { return bloomEffect.mipmapBlurPass.radius; },
    set radius(v) { bloomEffect.mipmapBlurPass.radius = v; },
    get threshold() { return bloomEffect.luminanceMaterial.threshold; },
    set threshold(v) { bloomEffect.luminanceMaterial.threshold = v; },
    get enabled() { return effectPass.enabled; },
    set enabled(v) { effectPass.enabled = v; },
  };

  return { scene, camera, renderer, composer, bloomPass };
}
