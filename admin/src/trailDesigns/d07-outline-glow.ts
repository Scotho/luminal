import * as THREE from 'three';
import type { TrailDesign, TrailDesignInstance, TrailLabContext } from './types';

function buildLayer(
  path: THREE.Vector3[],
  width: number,
  height: number,
  material: THREE.Material,
  renderOrder: number,
  scale: THREE.Vector3 | null,
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

    if (scale !== null) mesh.scale.copy(scale);

    scene.add(mesh);
    out.push(mesh);
  }
}

const design: TrailDesign = {
  name: 'Outline Glow Shell',
  description: 'Opaque dark body + scaled-up additive wireframe shell creates edge-only glow',
  category: 'hybrid',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, path, color, wallHeight, wallWidth } = ctx;

    // Body: dark opaque fill with subtle emissive
    const bodyColor = color.clone().multiplyScalar(0.25);
    const bodyEmissive = color.clone().multiplyScalar(0.3);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      emissive: bodyEmissive,
      emissiveIntensity: 1.0,
      roughness: 0.2,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.FrontSide,
    });

    // Outline: same color, BackSide only, additive — shows only the rim behind the body edges
    const outlineMat = new THREE.MeshBasicMaterial({
      color: color.clone(),
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      side: THREE.BackSide,
    });

    const outlineScale = new THREE.Vector3(1.15, 1.05, 1.15);

    const bodyMeshes: THREE.Mesh[] = [];
    const outlineMeshes: THREE.Mesh[] = [];

    buildLayer(path, wallWidth, wallHeight, bodyMat, 9, null, scene, bodyMeshes);
    buildLayer(path, wallWidth, wallHeight, outlineMat, 10, outlineScale, scene, outlineMeshes);

    const params: TrailDesignInstance['params'] = {
      outlineScale: {
        value: 1.15,
        min: 1.02,
        max: 1.5,
        step: 0.01,
        onChange(v) {
          for (const mesh of outlineMeshes) {
            mesh.scale.set(v, 1.05, v);
          }
        },
      },
      outlineOpacity: {
        value: 0.3,
        min: 0.05,
        max: 0.8,
        step: 0.05,
        onChange(v) {
          outlineMat.opacity = v;
        },
      },
      bodyOpacity: {
        value: 0.85,
        min: 0.2,
        max: 1.0,
        step: 0.05,
        onChange(v) {
          bodyMat.opacity = v;
        },
      },
    };

    return {
      update(_dt: number) { /* static geometry */ },
      dispose() {
        for (const mesh of [...bodyMeshes, ...outlineMeshes]) {
          scene.remove(mesh);
          mesh.geometry.dispose();
        }
        bodyMat.dispose();
        outlineMat.dispose();
        bodyMeshes.length = 0;
        outlineMeshes.length = 0;
      },
      params,
    };
  },
};

export default design;
