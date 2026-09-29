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
  name: 'Inner-Outer Glow',
  description: 'Narrow bright inner core + wide soft outer glow — concentric neon tube cross-section',
  category: 'hybrid',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, path, color, wallHeight, wallWidth } = ctx;

    // Outer layer — wide, dim glow field
    const outerMat = new THREE.MeshBasicMaterial({
      color: color,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // Inner layer — tight, bright hot core
    const innerMat = new THREE.MeshBasicMaterial({
      color: color,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const outerMeshes: THREE.Mesh[] = [];
    const innerMeshes: THREE.Mesh[] = [];

    buildSegments(path, wallWidth * 3.0, wallHeight, outerMat, 9, scene, outerMeshes);
    buildSegments(path, wallWidth * 0.7, wallHeight, innerMat, 10, scene, innerMeshes);

    return {
      update(_dt: number) { /* static — additive blending does the work */ },

      dispose() {
        for (const mesh of outerMeshes) { scene.remove(mesh); mesh.geometry.dispose(); }
        for (const mesh of innerMeshes) { scene.remove(mesh); mesh.geometry.dispose(); }
        outerMat.dispose();
        innerMat.dispose();
        outerMeshes.length = 0;
        innerMeshes.length = 0;
      },

      params: {
        innerOpacity: {
          value: 0.55, min: 0.1, max: 1.0, step: 0.05,
          onChange(v: number) { innerMat.opacity = v; },
        },
        outerOpacity: {
          value: 0.15, min: 0.02, max: 0.5, step: 0.02,
          onChange(v: number) { outerMat.opacity = v; },
        },
        outerWidth: {
          value: 3.0, min: 1.0, max: 6.0, step: 0.25,
          onChange(v: number) { for (const m of outerMeshes) m.scale.x = v / 3.0; },
        },
      },
    };
  },
};

export default design;
