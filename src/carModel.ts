// ── Car Model Loader ─────────────────────────────────────
// Same template-cache + deferred-clone pattern as bikeModel.ts

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getGfx, VISUAL_TUNING } from './graphics';
import { computeEmissiveColor, computeDarkBoost, computeVehicleVisibilityBoost } from './emissiveUtils';

interface GLTFResult {
  scene: THREE.Group;
  scenes: THREE.Group[];
  animations: THREE.AnimationClip[];
  cameras: THREE.Camera[];
  asset: Record<string, unknown>;
  parser: unknown;
  userData: Record<string, unknown>;
}

interface CloneCarModelOptions {
  preview?: boolean;
}

let _template: GLTFResult | null = null;
const _deferred: Array<{ group: THREE.Group; color: number; options: CloneCarModelOptions }> = [];
const _emissiveMapCache = new Map<string, THREE.CanvasTexture>();

/** Recolor an emissiveMap texture: shift green-ish pixels to the target color. */
function _recolorEmissiveMap(srcTex: THREE.Texture, targetColor: THREE.Color): THREE.CanvasTexture {
  const key = `${srcTex.uuid}|${targetColor.getHexString()}`;
  const cached = _emissiveMapCache.get(key);
  if (cached) return cached;

  const image = srcTex.image as HTMLImageElement | ImageBitmap;
  const w = image.width;
  const h = image.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image as CanvasImageSource, 0, 0);
  const imgData = ctx.getImageData(0, 0, w, h);
  const px = imgData.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    // Brightness of this pixel in the emissive map
    const brightness = Math.max(r, g, b) / 255;
    if (brightness < 0.05) continue; // skip black pixels
    // Tint every lit pixel toward the target color, preserving brightness
    px[i]     = Math.round(targetColor.r * 255 * brightness);
    px[i + 1] = Math.round(targetColor.g * 255 * brightness);
    px[i + 2] = Math.round(targetColor.b * 255 * brightness);
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = srcTex.flipY;
  tex.colorSpace = srcTex.colorSpace;
  _emissiveMapCache.set(key, tex);
  return tex;
}

function _applyCarClone(group: THREE.Group, color: number, options: CloneCarModelOptions = {}): void {
  const clone: THREE.Group = _template!.scene.clone(true);
  clone.rotation.y = Math.PI;
  const emissiveColor: THREE.Color = computeEmissiveColor(color);
  const { darkBoost } = computeDarkBoost(color);
  const { visibilityBoost } = computeVehicleVisibilityBoost(color);
  const neonIntensity: number = (VISUAL_TUNING[getGfx().preset] ?? VISUAL_TUNING.high).neonEmissive;
  const preview = options.preview === true;

  clone.traverse((child: THREE.Object3D) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = materials.map((mat: THREE.Material) => {
      const m = (mat as THREE.MeshStandardMaterial).clone();
      const origE = m.emissive;
      const origESum: number = origE ? (origE.r + origE.g + origE.b) : 0;
      const hasEmissiveMap = !!m.emissiveMap;

      if (hasEmissiveMap) {
        // Neon textures: recolor emissive map and boost intensity
        m.emissiveMap = _recolorEmissiveMap(m.emissiveMap!, emissiveColor);
        m.emissive = emissiveColor;
        m.emissiveIntensity = neonIntensity;
      } else if (origESum > 0.05) {
        // Already-emissive materials: recolor to player color
        m.emissive = emissiveColor;
        m.emissiveIntensity = neonIntensity;
        m.color.setScalar(0);
      } else {
        // Body panels: dark metallic with subtle player-colored emissive edge glow
        m.emissive = new THREE.Color(color);
        m.emissiveIntensity = preview
          ? 0.15 + darkBoost * 0.1
          : 0.18 + darkBoost * 0.18 + (visibilityBoost - 1) * 0.14;
        m.metalness = 0.92;
        m.roughness = 0.2;
      }
      return m;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
  });
  group.add(clone);
}

export function loadCarModel(): Promise<void> {
  if (_template) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    new GLTFLoader().load('/models/cyberpunk_ghetto_delorean.glb', (gltf: GLTFResult) => {
      _template = gltf;
      for (const d of _deferred) {
        _applyCarClone(d.group, d.color, d.options);
      }
      _deferred.length = 0;
      resolve();
    }, undefined, reject);
  });
}

export function isCarModelLoaded(): boolean {
  return _template !== null;
}

export function cloneCarModel(color: number, options: CloneCarModelOptions = {}): THREE.Group {
  const group = new THREE.Group();
  if (_template) {
    _applyCarClone(group, color, options);
  } else {
    if (import.meta.env.DEV) console.warn('[BUG-18] car model DEFERRED — not yet loaded at clone time');
    _deferred.push({ group, color, options });
  }
  return group;
}

/** Dispose every cached emissive texture and clear the cache. */
export function clearEmissiveMapCache(): void {
  for (const tex of _emissiveMapCache.values()) {
    tex.dispose();
  }
  _emissiveMapCache.clear();
}

/** Returns the number of entries currently in the emissive map cache. */
// ts-prune-ignore-next
export function getEmissiveMapCacheSize(): number {
  return _emissiveMapCache.size;
}
