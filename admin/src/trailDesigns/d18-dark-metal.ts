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
  name: 'Dark Metal Neon',
  description: 'Dark metallic body (high metalness/low roughness) with bright emissive neon lines embedded',
  category: 'material',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, path, color, wallHeight, wallWidth } = ctx;

    const neonColor = color.clone().multiplyScalar(0.5);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x080808,
      metalness: 0.85,
      roughness: 0.05,
      emissive: color.clone(),
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const neonMat = new THREE.MeshStandardMaterial({
      color: neonColor,
      metalness: 0.1,
      roughness: 0.3,
      emissive: color.clone(),
      emissiveIntensity: 3.0,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const meshes: THREE.Mesh[] = [];
    buildSegments(path, wallWidth * 1.3, wallHeight, bodyMat, 9,  scene, meshes);
    buildSegments(path, wallWidth * 0.6, wallHeight, neonMat, 10, scene, meshes);

    const params: TrailDesignInstance['params'] = {
      metalness: {
        value: 0.85, min: 0.0, max: 1.0, step: 0.05,
        onChange(v: number) { bodyMat.metalness = v; },
      },
      roughness: {
        value: 0.05, min: 0.0, max: 1.0, step: 0.05,
        onChange(v: number) { bodyMat.roughness = v; },
      },
      neonEmissive: {
        value: 3.0, min: 0.5, max: 8, step: 0.1,
        onChange(v: number) { neonMat.emissiveIntensity = v; },
      },
      bodyEmissive: {
        value: 0.8, min: 0.1, max: 3, step: 0.1,
        onChange(v: number) { bodyMat.emissiveIntensity = v; },
      },
    };

    return {
      update(_dt: number): void {
        // Static geometry — MeshStandardMaterial handles reflections per frame automatically.
      },
      dispose(): void {
        for (const mesh of meshes) {
          scene.remove(mesh);
          mesh.geometry.dispose();
        }
        bodyMat.dispose();
        neonMat.dispose();
        meshes.length = 0;
      },
      params,
    };
  },
};

export default design;
