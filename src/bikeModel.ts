import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getGfx, VISUAL_TUNING } from './graphics';

interface GLTFResult {
  scene: THREE.Group;
  scenes: THREE.Group[];
  animations: THREE.AnimationClip[];
  cameras: THREE.Camera[];
  asset: Record<string, unknown>;
  parser: unknown;
  userData: Record<string, unknown>;
}

interface BikeLegacyVisualTuning {
  neonMul: number;
  riderMul: number;
  bodyDarken: number;
}

const BIKE_LEGACY_VISUAL_TUNING: BikeLegacyVisualTuning = {
  neonMul: 1.12,
  riderMul: 1.18,
  bodyDarken: 0.84,
};

let _template: GLTFResult | null = null;
let _modelHeight: number = 2.668; // fallback — updated on load from bounding box

// Deferred clones: placeholder groups that need the real mesh once the model loads
const _deferred: { group: THREE.Group; color: number }[] = [];

function _applyBikeClone(group: THREE.Group, color: number): void {
  const clone: THREE.Group = _template!.scene.clone(true);
  clone.rotation.y = Math.PI;

  const neonIntensity: number = (VISUAL_TUNING[getGfx().preset] ?? VISUAL_TUNING.high).neonEmissive;

  clone.traverse((child: THREE.Object3D) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;

    // Handle multi-material meshes (array) and single-material meshes
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = materials.map((mat: THREE.Material) => {
      const m = (mat as THREE.MeshStandardMaterial).clone();
      if (m.name === 'Blue Neon') {
        // Neon strips: recolor emissive to player color
        m.emissive = new THREE.Color(color);
        m.emissiveIntensity = neonIntensity * BIKE_LEGACY_VISUAL_TUNING.neonMul;
        m.color.setScalar(0); // keep base black so glow dominates
      } else if (m.name === 'Scene_-_Root' || m.name === 'Scene - Root') {
        // Rider: match neon glow pattern with player color
        m.emissive = new THREE.Color(color);
        m.emissiveIntensity = neonIntensity * BIKE_LEGACY_VISUAL_TUNING.riderMul;
        m.color.setScalar(0);
      } else {
        // Body: keep dark, no emissive — just metallic surface
        m.color.multiplyScalar(BIKE_LEGACY_VISUAL_TUNING.bodyDarken);
        m.emissive.setScalar(0);
        m.emissiveIntensity = 0;
        m.metalness = 0.9;
        m.roughness = 0.36;
      }
      return m;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
  });

  group.add(clone);
}

export function loadBikeModel(): Promise<void> {
  if (_template) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    new GLTFLoader().load('/models/tron_motorcycle.glb', (gltf: GLTFResult) => {
      _template = gltf;

      // Compute actual model height for accurate scaling
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = new THREE.Vector3();
      box.getSize(size);
      _modelHeight = size.y || 2.668;

      // Fill in any placeholder groups that were created before the model loaded
      for (const d of _deferred) {
        _applyBikeClone(d.group, d.color);
      }
      _deferred.length = 0;
      resolve();
    }, undefined, reject);
  });
}

export function isBikeModelLoaded(): boolean {
  return _template !== null;
}

/** Returns the measured model height (for scale calculations in player.ts). */
export function getBikeModelHeight(): number {
  return _modelHeight;
}

export function cloneBikeModel(color: number): THREE.Group {
  const group = new THREE.Group();
  if (_template) {
    _applyBikeClone(group, color);
  } else {
    // Model not ready — register for deferred fill-in when it loads
    if (import.meta.env.DEV) console.warn('[BUG-18] bike model DEFERRED — not yet loaded at clone time');
    _deferred.push({ group, color });
  }
  return group;
}

/**
 * Clear deferred clone queue — call when switching away from bike vehicle
 * type to prevent orphaned placeholder groups from leaking.
 */
// ts-prune-ignore-next
export function clearBikeDeferredQueue(): void {
  _deferred.length = 0;
}
