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
    // lookAt points Z toward target; rotate so the box length (Z) aligns with direction
    mesh.rotateX(Math.PI / 2);
    mesh.renderOrder = renderOrder;

    scene.add(mesh);
    out.push(mesh);
  }
}

const design: TrailDesign = {
  name: 'Additive Glow Core',
  description: 'Core layer uses AdditiveBlending to ADD light — same technique as particles/sparks',
  category: 'material',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, path, color, wallHeight, wallWidth } = ctx;

    const darkerColor = color.clone().multiplyScalar(0.55);

    const haloMat = new THREE.MeshStandardMaterial({
      color: darkerColor,
      emissive: color.clone(),
      emissiveIntensity: 1.8,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });

    const coreMat = new THREE.MeshStandardMaterial({
      color: color.clone(),
      emissive: color.clone(),
      emissiveIntensity: 2.5,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const meshes: THREE.Mesh[] = [];

    buildSegments(path, wallWidth * 1.5, wallHeight, haloMat, 9, scene, meshes);
    buildSegments(path, wallWidth * 0.7, wallHeight, coreMat, 10, scene, meshes);

    const params: TrailDesignInstance['params'] = {
      coreEmissive: {
        value: 2.5,
        min: 0.5,
        max: 6,
        step: 0.1,
        onChange(v) {
          coreMat.emissiveIntensity = v;
        },
      },
      coreOpacity: {
        value: 0.45,
        min: 0.1,
        max: 1.0,
        step: 0.05,
        onChange(v) {
          coreMat.opacity = v;
        },
      },
      haloOpacity: {
        value: 0.4,
        min: 0.1,
        max: 1.0,
        step: 0.05,
        onChange(v) {
          haloMat.opacity = v;
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
        haloMat.dispose();
        coreMat.dispose();
        meshes.length = 0;
      },
      params,
    };
  },
};

export default design;
