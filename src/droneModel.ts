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

export function loadDroneModel(): Promise<void> {
  if (_template) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    new GLTFLoader().load('/models/tron-ish_low-poly_drone.glb', (gltf: GLTFResult) => {
      _template = gltf;
      resolve();
    }, undefined, reject);
  });
}

export function cloneDroneModel(): THREE.Group {
  if (!_template) {
    if (import.meta.env.DEV) console.warn('[droneModel] cloneDroneModel() called before model loaded — returning empty group');
    return new THREE.Group();
  }
  const clone: THREE.Group = _template.scene.clone(true);
  clone.traverse((child: THREE.Object3D) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.material = (mesh.material as THREE.Material).clone();
    }
  });
  return clone;
}
