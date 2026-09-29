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
  name: 'MeshBasic Additive',
  description: 'MeshBasicMaterial bypasses all lighting — pure self-luminous additive trail',
  category: 'material',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, path, color, wallHeight, wallWidth } = ctx;

    let bodyBrightness = 0.6;
    const bodyMat = new THREE.MeshBasicMaterial({
      color: color.clone().multiplyScalar(bodyBrightness),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: color.clone(),
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const meshes: THREE.Mesh[] = [];
    buildSegments(path, wallWidth * 1.4, wallHeight, bodyMat, 9, scene, meshes);
    buildSegments(path, wallWidth, wallHeight, glowMat, 10, scene, meshes);

    const params: TrailDesignInstance['params'] = {
      bodyBrightness: {
        value: 0.6,
        min: 0.1,
        max: 1.0,
        step: 0.05,
        onChange(v) {
          bodyBrightness = v;
          bodyMat.color.copy(color).multiplyScalar(bodyBrightness);
        },
      },
      glowOpacity: {
        value: 0.35,
        min: 0.05,
        max: 0.8,
        step: 0.05,
        onChange(v) {
          glowMat.opacity = v;
        },
      },
      bodyOpacity: {
        value: 0.5,
        min: 0.1,
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
        for (const mesh of meshes) {
          scene.remove(mesh);
          mesh.geometry.dispose();
        }
        bodyMat.dispose();
        glowMat.dispose();
        meshes.length = 0;
      },
      params,
    };
  },
};
export default design;
