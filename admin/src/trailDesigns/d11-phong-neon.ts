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
  name: 'Phong Neon Tube',
  description: 'MeshPhongMaterial with high shininess + emissive — classic neon tube rendering',
  category: 'material',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, path, color, wallHeight, wallWidth } = ctx;

    // Body layer — dark tinted wall with tight specular highlights (glass tube effect)
    const bodyColor = color.clone().multiplyScalar(0.3);
    const bodyMat = new THREE.MeshPhongMaterial({
      color: bodyColor,
      emissive: color.clone(),
      emissiveIntensity: 1.5,
      shininess: 100,
      specular: new THREE.Color(0x444444),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // Highlight layer — bright additive core streak
    const highlightMat = new THREE.MeshPhongMaterial({
      color: color.clone(),
      emissive: color.clone(),
      emissiveIntensity: 2.5,
      shininess: 60,
      specular: new THREE.Color(0x888888),
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const bodyMeshes: THREE.Mesh[] = [];
    const highlightMeshes: THREE.Mesh[] = [];

    buildSegments(path, wallWidth * 1.3, wallHeight, bodyMat, 9, scene, bodyMeshes);
    buildSegments(path, wallWidth * 0.7, wallHeight, highlightMat, 10, scene, highlightMeshes);

    const params: TrailDesignInstance['params'] = {
      shininess: {
        value: 100,
        min: 10,
        max: 200,
        step: 5,
        onChange(v) {
          bodyMat.shininess = v;
        },
      },
      emissiveBody: {
        value: 1.5,
        min: 0.3,
        max: 4,
        step: 0.1,
        onChange(v) {
          bodyMat.emissiveIntensity = v;
        },
      },
      emissiveHighlight: {
        value: 2.5,
        min: 0.5,
        max: 6,
        step: 0.1,
        onChange(v) {
          highlightMat.emissiveIntensity = v;
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
        for (const mesh of highlightMeshes) {
          scene.remove(mesh);
          mesh.geometry.dispose();
        }
        bodyMat.dispose();
        highlightMat.dispose();
        bodyMeshes.length = 0;
        highlightMeshes.length = 0;
      },
      params,
    };
  },
};

export default design;
