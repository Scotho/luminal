import * as THREE from 'three';
import type { TrailDesign, TrailDesignInstance, TrailLabContext } from './types';

function buildSegments(
  path: THREE.Vector3[],
  width: number,
  height: number,
  material: THREE.Material,
  renderOrder: number,
  scene: THREE.Scene,
  out: THREE.Mesh[],
): void {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dir = new THREE.Vector3().subVectors(b, a);
    const length = dir.length();
    if (length < 0.001) continue;

    const geo = new THREE.BoxGeometry(width, height, length);
    const mesh = new THREE.Mesh(geo, material);

    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    mesh.position.copy(mid);
    mesh.lookAt(b);
    mesh.rotateX(Math.PI / 2);
    mesh.renderOrder = renderOrder;

    scene.add(mesh);
    out.push(mesh);
  }
}

const design: TrailDesign = {
  name: 'Triple Layer Stack',
  description: 'Three distinct layers: opaque dark body + saturated color fill + additive bright crown',
  category: 'hybrid',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, path, color, wallHeight, wallWidth } = ctx;

    // Layer 1 — Body: nearly opaque dark physical wall
    const bodyColor = color.clone().multiplyScalar(0.2);
    const bodyEmissive = color.clone().multiplyScalar(0.2);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      emissive: bodyEmissive,
      emissiveIntensity: 0.5,
      roughness: 0.3,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // Layer 2 — Fill: semi-transparent saturated neon glow body
    const fillMat = new THREE.MeshStandardMaterial({
      color: color.clone(),
      emissive: color.clone(),
      emissiveIntensity: 2.0,
      roughness: 0.1,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // Layer 3 — Crown: thin additive white-hot top edge
    // Lerp color toward white by 30%
    const crownColor = color.clone().lerp(new THREE.Color(1, 1, 1), 0.3);
    const crownMat = new THREE.MeshBasicMaterial({
      color: crownColor,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const bodyMeshes: THREE.Mesh[] = [];
    const fillMeshes: THREE.Mesh[] = [];
    const crownMeshes: THREE.Mesh[] = [];

    buildSegments(path, wallWidth * 1.4, wallHeight, bodyMat, 8, scene, bodyMeshes);
    buildSegments(path, wallWidth * 1.2, wallHeight, fillMat, 9, scene, fillMeshes);
    buildSegments(path, wallWidth * 0.6, wallHeight, crownMat, 10, scene, crownMeshes);

    const params: TrailDesignInstance['params'] = {
      fillEmissive: {
        value: 2.0,
        min: 0.5,
        max: 5.0,
        step: 0.1,
        onChange(v) {
          fillMat.emissiveIntensity = v;
        },
      },
      fillOpacity: {
        value: 0.35,
        min: 0.05,
        max: 0.7,
        step: 0.05,
        onChange(v) {
          fillMat.opacity = v;
        },
      },
      crownOpacity: {
        value: 0.4,
        min: 0.05,
        max: 0.8,
        step: 0.05,
        onChange(v) {
          crownMat.opacity = v;
        },
      },
      bodyOpacity: {
        value: 0.8,
        min: 0.2,
        max: 1.0,
        step: 0.05,
        onChange(v) {
          bodyMat.opacity = v;
        },
      },
    };

    return {
      update(_dt: number) {
        // Static geometry — no per-frame update needed.
      },
      dispose() {
        for (const mesh of bodyMeshes) {
          scene.remove(mesh);
          mesh.geometry.dispose();
        }
        for (const mesh of fillMeshes) {
          scene.remove(mesh);
          mesh.geometry.dispose();
        }
        for (const mesh of crownMeshes) {
          scene.remove(mesh);
          mesh.geometry.dispose();
        }
        bodyMat.dispose();
        fillMat.dispose();
        crownMat.dispose();
        bodyMeshes.length = 0;
        fillMeshes.length = 0;
        crownMeshes.length = 0;
      },
      params,
    };
  },
};

export default design;
