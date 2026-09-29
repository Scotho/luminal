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
    const length = new THREE.Vector3().subVectors(b, a).length();
    if (length < 0.001) continue;
    const geo = new THREE.BoxGeometry(width, height, length);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5));
    mesh.lookAt(b);
    mesh.rotateX(Math.PI / 2);
    mesh.renderOrder = renderOrder;
    scene.add(mesh);
    out.push(mesh);
  }
}

function freeMeshes(meshes: THREE.Mesh[], scene: THREE.Scene): void {
  for (const m of meshes) { scene.remove(m); m.geometry.dispose(); }
  meshes.length = 0;
}

const design: TrailDesign = {
  name: 'Wireframe Energy',
  description: 'Solid body + additive wireframe overlay — digital grid energy look',
  category: 'material',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, path, color, wallHeight, wallWidth } = ctx;
    const segWidth = wallWidth * 1.2;

    // Body — semi-transparent dark fill for physical wall presence
    const bodyMat = new THREE.MeshBasicMaterial({
      color: color.clone().multiplyScalar(0.4),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // Wire — full-color wireframe with additive blending for neon grid glow
    const wireMat = new THREE.MeshBasicMaterial({
      color: color.clone(),
      wireframe: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });

    const bodyMeshes: THREE.Mesh[] = [];
    const wireMeshes: THREE.Mesh[] = [];
    buildSegments(path, segWidth, wallHeight, bodyMat, 9, scene, bodyMeshes);
    buildSegments(path, segWidth, wallHeight, wireMat, 10, scene, wireMeshes);

    const params: TrailDesignInstance['params'] = {
      bodyBrightness: {
        value: 0.4, min: 0.1, max: 1.0, step: 0.05,
        onChange(v) { (bodyMat.color as THREE.Color).copy(color).multiplyScalar(v); },
      },
      wireOpacity: {
        value: 0.6, min: 0.1, max: 1.0, step: 0.05,
        onChange(v) { wireMat.opacity = v; },
      },
      bodyOpacity: {
        value: 0.5, min: 0.1, max: 1.0, step: 0.05,
        onChange(v) { bodyMat.opacity = v; },
      },
    };

    return {
      update(_dt: number) { /* static geometry */ },
      dispose() {
        freeMeshes(bodyMeshes, scene);
        freeMeshes(wireMeshes, scene);
        bodyMat.dispose();
        wireMat.dispose();
      },
      params,
    };
  },
};

export default design;
