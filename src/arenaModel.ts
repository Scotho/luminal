import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

interface GLTFResult {
  scene: THREE.Group;
  scenes: THREE.Group[];
  animations: THREE.AnimationClip[];
  cameras: THREE.Camera[];
  asset: Record<string, unknown>;
  parser: unknown;
  userData: Record<string, unknown>;
}

let _template: GLTFResult | null = null;
let _radius: number = 192; // fallback, measured on load

export function loadArenaModel(): Promise<void> {
  if (_template) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    new GLTFLoader().load('/models/lightcycle_arena_rev_02__tebg.glb', (gltf: GLTFResult) => {
      // Sanitize: remove meshes with NaN/Infinity in position data.
      // Some GLB exports contain degenerate meshes that corrupt WebGL state.
      const badMeshes: THREE.Object3D[] = [];
      gltf.scene.traverse((child: THREE.Object3D) => {
        if (!(child as THREE.Mesh).isMesh) return;
        const geo = (child as THREE.Mesh).geometry;
        const pos = geo?.attributes?.position;
        if (!pos || pos.count === 0) { badMeshes.push(child); return; }
        const arr = pos.array as Float32Array;
        for (let i = 0; i < arr.length; i++) {
          if (!Number.isFinite(arr[i])) { badMeshes.push(child); return; }
        }
      });
      for (const m of badMeshes) {
        if (import.meta.env.DEV) console.warn('[arenaModel] removing degenerate mesh:', m.name);
        m.removeFromParent();
      }

      _template = gltf;
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      _radius = Math.max(size.x, size.z) / 2;
      if (import.meta.env.DEV) {
        console.log('[arenaModel] loaded — bbox size:', size, 'radius:', _radius);
        console.log('[arenaModel] bbox min:', box.min, 'max:', box.max);
        gltf.scene.traverse((child: THREE.Object3D) => {
          if ((child as THREE.Mesh).isMesh) {
            const mb = new THREE.Box3().setFromObject(child);
            const ms = mb.getSize(new THREE.Vector3());
            const mc = mb.getCenter(new THREE.Vector3());
            console.log(`[arenaModel] mesh: "${child.name}" size: ${ms.x.toFixed(1)} x ${ms.y.toFixed(1)} x ${ms.z.toFixed(1)}  center: ${mc.x.toFixed(1)}, ${mc.y.toFixed(1)}, ${mc.z.toFixed(1)}`);
          }
        });
      }
      resolve();
    }, undefined, reject);
  });
}

export function cloneArenaModel(): THREE.Group {
  if (!_template) {
    if (import.meta.env.DEV) console.warn('[arenaModel] called before load');
    return new THREE.Group();
  }
  const clone = _template.scene.clone(true);
  clone.traverse((child: THREE.Object3D) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((m: THREE.Material) => m.clone());
      } else {
        mesh.material = (mesh.material as THREE.Material).clone();
      }
    }
  });
  return clone;
}

// ts-prune-ignore-next
export function getArenaModelRadius(): number {
  return _radius;
}

export function isArenaModelLoaded(): boolean {
  return _template !== null;
}

/** Dispose all cloned materials and geometries within an arena clone group. */
// ts-prune-ignore-next
export function disposeArenaClone(group: THREE.Group): void {
  group.traverse((child: THREE.Object3D) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        std.map?.dispose();
        std.emissiveMap?.dispose();
        std.normalMap?.dispose();
        std.roughnessMap?.dispose();
        (m as THREE.Material).dispose();
      }
    }
  });
}
